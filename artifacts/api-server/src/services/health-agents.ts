/**
 * Agents de sante TECHNIQUE de la plateforme.
 *
 * Pourquoi ce fichier existe: la supervision existante (app-audit,
 * proactive-engine, /ai/anomalies, data-protection-monitor) couvre tres bien
 * la sante des DONNEES METIER — taches en retard, contacts inactifs,
 * sauvegardes anciennes. Elle ne regarde jamais l'INFRASTRUCTURE. Les pannes
 * reellement vecues venaient pourtant toutes de la:
 *   - le pool Postgres sature -> toutes les requetes en 500 ;
 *   - un e-mail refuse par Resend (domaine non verifie) -> echec silencieux ;
 *   - Google OAuth en 503 faute de variables d'environnement ;
 *   - un rate limiter mal monte -> 429 sur toute l'API.
 * Aucun de ces incidents n'etait detectable par un controle metier.
 *
 * Principe: chaque agent est DETERMINISTE (aucun appel LLM). Un diagnostic
 * doit etre reproductible, instantane et gratuit — et rester fiable quand
 * justement le fournisseur d'IA est en panne.
 *
 * Chaque agent est isole: son echec est capture et transforme en constat
 * `echec`, il n'interrompt jamais les autres.
 */
import { db, pool } from "@workspace/db";
import { healthChecksTable, cronHeartbeatsTable } from "@workspace/db/schema";
import { sql, desc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  dependenciesAgent,
  configurationAgent,
  errorRateAgent,
  dataIntegrityAgent,
} from "./health-agents-external";

export type CheckStatus = "ok" | "degrade" | "echec" | "inconnu";
export type CheckSeverity = "basse" | "moyenne" | "haute" | "critique";

export interface CheckResult {
  check: string;
  status: CheckStatus;
  severity: CheckSeverity;
  summary: string;
  remediation?: string;
  metrics?: Record<string, unknown>;
}

export interface HealthAgent {
  id: string;
  /** Nom lisible affiche dans le panneau de sante. */
  name: string;
  /** Ce que l'agent surveille, en une phrase. */
  domain: string;
  run: () => Promise<CheckResult[]>;
}

/** Enveloppe une sonde pour qu'une exception devienne un constat, jamais un crash. */
async function safeCheck(
  check: string,
  fn: () => Promise<CheckResult>,
): Promise<CheckResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      check,
      status: "echec",
      severity: "haute",
      summary: `La verification n'a pas pu s'executer: ${err instanceof Error ? err.message : "erreur inconnue"}`,
      remediation: "Consulter les journaux du serveur pour cette verification.",
    };
  }
}

// ── Agent 1: base de donnees ────────────────────────────────────────────────

const databaseAgent: HealthAgent = {
  id: "database",
  name: "Base de donnees",
  domain: "Saturation du pool, latence des requetes, connexions Postgres",
  run: async () => {
    const results: CheckResult[] = [];

    // Saturation du pool. C'est LA panne vecue: max=20 par instance x plusieurs
    // instances contre un Postgres qui n'accepte que ~25 connexions.
    results.push(await safeCheck("pool_saturation", async () => {
      const total = pool.totalCount;
      const idle = pool.idleCount;
      const waiting = pool.waitingCount;
      const max = (pool.options as { max?: number }).max ?? 0;
      const usage = max > 0 ? (total - idle) / max : 0;
      // Des clients en attente signifient que le pool est deja insuffisant:
      // c'est plus grave qu'un simple taux d'occupation eleve.
      const status: CheckStatus = waiting > 0 || usage >= 0.9 ? "degrade" : "ok";
      return {
        check: "pool_saturation",
        status,
        severity: waiting > 0 ? "haute" : usage >= 0.9 ? "moyenne" : "basse",
        summary: status === "ok"
          ? `Pool sain: ${total - idle}/${max} connexions actives.`
          : `Pool sous tension: ${total - idle}/${max} actives, ${waiting} requete(s) en attente.`,
        remediation: status === "ok" ? "" : "Reduire DB_POOL_MAX, ou augmenter max_connections cote Cloud SQL. Verifier qu'aucune requete ne tient une connexion trop longtemps.",
        metrics: { total, idle, waiting, max, usagePct: Math.round(usage * 100) },
      };
    }));

    // Latence: un SELECT 1 doit etre quasi instantane. S'il traine, la base ou
    // le lien reseau est en difficulte bien avant que les requetes echouent.
    results.push(await safeCheck("query_latency", async () => {
      const t0 = Date.now();
      await db.execute(sql`SELECT 1`);
      const ms = Date.now() - t0;
      const status: CheckStatus = ms > 1000 ? "degrade" : "ok";
      return {
        check: "query_latency",
        status,
        severity: ms > 3000 ? "haute" : ms > 1000 ? "moyenne" : "basse",
        summary: status === "ok" ? `Latence normale (${ms} ms).` : `Latence elevee: ${ms} ms pour un SELECT 1.`,
        remediation: status === "ok" ? "" : "Verifier la charge de l'instance Cloud SQL et les requetes lentes en cours.",
        metrics: { latencyMs: ms },
      };
    }));

    // Connexions cote serveur: rapporte l'occupation REELLE de Postgres, tous
    // clients confondus (autres instances Cloud Run, proxy, migrations).
    results.push(await safeCheck("server_connections", async () => {
      const r = await db.execute<{ used: number; max_conn: number }>(sql`
        SELECT (SELECT count(*) FROM pg_stat_activity)::int AS used,
               (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
      `);
      const row = (r as unknown as { rows: Array<{ used: number; max_conn: number }> }).rows?.[0];
      const used = Number(row?.used ?? 0);
      const maxConn = Number(row?.max_conn ?? 0);
      const pct = maxConn > 0 ? used / maxConn : 0;
      const status: CheckStatus = pct >= 0.85 ? "degrade" : "ok";
      return {
        check: "server_connections",
        status,
        severity: pct >= 0.95 ? "critique" : pct >= 0.85 ? "haute" : "basse",
        summary: `${used}/${maxConn} connexions Postgres utilisees (${Math.round(pct * 100)}%).`,
        remediation: status === "ok" ? "" : "Proche de la limite: baisser DB_POOL_MAX ou augmenter max_connections. Au-dela, toutes les requetes echouent en 500.",
        metrics: { used, maxConnections: maxConn, usagePct: Math.round(pct * 100) },
      };
    }));

    return results;
  },
};

// ── Agent 6: ressources d'execution ─────────────────────────────────────────

const runtimeAgent: HealthAgent = {
  id: "runtime",
  name: "Ressources serveur",
  domain: "Memoire, blocage de la boucle d'evenements, duree de fonctionnement",
  run: async () => {
    const results: CheckResult[] = [];

    results.push(await safeCheck("memory", async () => {
      const m = process.memoryUsage();
      const rssMb = Math.round(m.rss / 1024 / 1024);
      const heapMb = Math.round(m.heapUsed / 1024 / 1024);
      const heapTotalMb = Math.round(m.heapTotal / 1024 / 1024);
      // La limite du conteneur n'est pas lisible depuis le processus: on la
      // prend dans MEMORY_LIMIT_MB. Defaut 1024 Mo = l'allocation reelle du
      // service Cloud Run. Un seuil code en dur serait pire qu'inutile: cale
      // trop bas, l'agent crierait au feu en permanence et on finirait par
      // ignorer ses alertes — y compris les vraies.
      const limitMb = parseInt(process.env.MEMORY_LIMIT_MB || "1024", 10);
      const pct = Math.round((rssMb / limitMb) * 100);
      const status: CheckStatus = pct >= 80 ? "degrade" : "ok";
      return {
        check: "memory",
        status,
        severity: pct >= 92 ? "critique" : pct >= 80 ? "haute" : "basse",
        summary: `Memoire: ${rssMb} Mo sur ${limitMb} Mo (${pct}%), tas ${heapMb}/${heapTotalMb} Mo.`,
        remediation: status === "ok" ? "" : "Proche de la limite du conteneur: risque d'arret brutal (OOM). Augmenter --memory sur Cloud Run ou chercher une fuite.",
        metrics: { rssMb, heapUsedMb: heapMb, heapTotalMb, limitMb, usagePct: pct },
      };
    }));

    // Boucle d'evenements: si elle est bloquee, l'application repond lentement
    // a TOUT sans qu'aucune requete ne soit en cause individuellement.
    results.push(await safeCheck("event_loop_lag", async () => {
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 100));
      const lag = Date.now() - t0 - 100;
      const status: CheckStatus = lag > 200 ? "degrade" : "ok";
      return {
        check: "event_loop_lag",
        status,
        severity: lag > 500 ? "haute" : lag > 200 ? "moyenne" : "basse",
        summary: status === "ok" ? `Boucle d'evenements fluide (retard ${lag} ms).` : `Boucle d'evenements bloquee: retard de ${lag} ms.`,
        remediation: status === "ok" ? "" : "Un traitement synchrone long monopolise le processus (boucle lourde, JSON enorme, crypto). Le deplacer hors du chemin de requete.",
        metrics: { lagMs: lag },
      };
    }));

    results.push(await safeCheck("uptime", async () => {
      const sec = Math.round(process.uptime());
      // Un uptime tres court a chaque passage signale des redemarrages en
      // boucle (crash au demarrage, OOM, sondes qui echouent).
      const status: CheckStatus = sec < 120 ? "degrade" : "ok";
      return {
        check: "uptime",
        status,
        severity: sec < 60 ? "moyenne" : "basse",
        summary: status === "ok"
          ? `En fonctionnement depuis ${Math.round(sec / 60)} min.`
          : `Instance demarree il y a ${sec} s — redemarrage recent.`,
        remediation: status === "ok" ? "" : "Si ce constat revient a chaque cycle, l'instance redemarre en boucle: verifier les journaux de demarrage et la memoire.",
        metrics: { uptimeSec: sec },
      };
    }));

    return results;
  },
};

// ── Agent 4: taches planifiees ──────────────────────────────────────────────

/**
 * Enregistre le passage d'un cron. A appeler depuis chaque tache planifiee:
 * sans battement, un cron mort reste invisible.
 */
export async function recordCronHeartbeat(
  name: string,
  expectedIntervalSec: number,
  error?: string | null,
): Promise<void> {
  try {
    const now = new Date();
    await db.insert(cronHeartbeatsTable)
      .values({
        name,
        expectedIntervalSec,
        lastRunAt: now,
        lastSuccessAt: error ? null : now,
        lastError: error ?? null,
        runCount: 1,
        errorCount: error ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: cronHeartbeatsTable.name,
        set: {
          expectedIntervalSec,
          lastRunAt: now,
          ...(error ? {} : { lastSuccessAt: now }),
          lastError: error ?? null,
          runCount: sql`${cronHeartbeatsTable.runCount} + 1`,
          errorCount: error ? sql`${cronHeartbeatsTable.errorCount} + 1` : cronHeartbeatsTable.errorCount,
        },
      });
  } catch (err) {
    // Le suivi ne doit jamais faire echouer la tache qu'il observe.
    logger.warn({ err, name }, "[Health] Echec enregistrement du battement de cron");
  }
}

const schedulerAgent: HealthAgent = {
  id: "scheduler",
  name: "Taches planifiees",
  domain: "Crons vivants, retards, erreurs repetees",
  run: async () => {
    const rows = await db.select().from(cronHeartbeatsTable);
    if (rows.length === 0) {
      return [{
        check: "heartbeats_present",
        status: "inconnu",
        severity: "moyenne",
        summary: "Aucun battement de cron enregistre.",
        remediation: "Normal juste apres un deploiement: les taches s'enregistrent a leur premier passage. Si cela persiste plus d'une heure, aucune tache planifiee ne tourne.",
      }];
    }

    const now = Date.now();
    return rows.map((r) => {
      const ageSec = Math.round((now - new Date(r.lastRunAt).getTime()) / 1000);
      // Tolerance x2: un cron horaire n'est pas en retard a 61 minutes.
      const late = ageSec > r.expectedIntervalSec * 2;
      const failing = r.lastError != null;
      const status: CheckStatus = late ? "echec" : failing ? "degrade" : "ok";
      return {
        check: `cron:${r.name}`,
        status,
        severity: late ? "haute" : failing ? "moyenne" : "basse",
        summary: late
          ? `"${r.name}" n'a pas tourne depuis ${Math.round(ageSec / 60)} min (attendu toutes les ${Math.round(r.expectedIntervalSec / 60)} min).`
          : failing
            ? `"${r.name}" a tourne mais a echoue: ${r.lastError}`
            : `"${r.name}" a jour (il y a ${Math.round(ageSec / 60)} min).`,
        remediation: late
          ? "La tache est probablement morte (exception non rattrapee ou instance recyclee). Redemarrer le service et verifier les journaux."
          : failing
            ? "Corriger l'erreur remontee ci-dessus."
            : "",
        metrics: { ageSec, expectedIntervalSec: r.expectedIntervalSec, runCount: r.runCount, errorCount: r.errorCount },
      };
    });
  },
};

// ── Registre ────────────────────────────────────────────────────────────────

/**
 * Agents ajoutes ici sont automatiquement executes et affiches — un nouveau
 * domaine de surveillance se resume a ecrire un HealthAgent et a l'inscrire.
 */
export const HEALTH_AGENTS: HealthAgent[] = [
  databaseAgent,
  runtimeAgent,
  schedulerAgent,
  dependenciesAgent,
  configurationAgent,
  errorRateAgent,
  dataIntegrityAgent,
];

export interface HealthRunSummary {
  runId: string;
  startedAt: string;
  durationMs: number;
  total: number;
  ok: number;
  degraded: number;
  failed: number;
  /** Pire etat rencontre — resume l'ensemble en un mot. */
  worst: CheckStatus;
  results: Array<CheckResult & { agent: string; durationMs: number }>;
}

/** Execute tous les agents en parallele et persiste les constats. */
export async function runHealthAgents(runId?: string): Promise<HealthRunSummary> {
  const startedAt = new Date();
  const finalRunId = runId ?? `auto-${startedAt.toISOString()}`;
  const t0 = Date.now();

  const perAgent = await Promise.all(
    HEALTH_AGENTS.map(async (agent) => {
      const at0 = Date.now();
      try {
        const results = await agent.run();
        const dur = Date.now() - at0;
        return results.map((r) => ({ ...r, agent: agent.id, durationMs: dur }));
      } catch (err) {
        // Un agent entier qui tombe ne doit pas masquer les autres.
        logger.error({ err, agent: agent.id }, "[Health] Agent en echec");
        return [{
          check: "agent_execution",
          status: "echec" as CheckStatus,
          severity: "haute" as CheckSeverity,
          summary: `L'agent "${agent.name}" n'a pas pu s'executer: ${err instanceof Error ? err.message : "erreur inconnue"}`,
          remediation: "Consulter les journaux du serveur.",
          agent: agent.id,
          durationMs: Date.now() - at0,
        }];
      }
    }),
  );

  const results = perAgent.flat();
  const ok = results.filter((r) => r.status === "ok").length;
  const degraded = results.filter((r) => r.status === "degrade").length;
  const failed = results.filter((r) => r.status === "echec").length;
  const worst: CheckStatus = failed > 0 ? "echec" : degraded > 0 ? "degrade" : "ok";

  // Persistance best-effort: un incident de base ne doit pas empecher de
  // RENVOYER le diagnostic — c'est precisement quand la base va mal que le
  // diagnostic est le plus utile.
  try {
    if (results.length > 0) {
      await db.insert(healthChecksTable).values(
        results.map((r) => ({
          runId: finalRunId,
          agent: r.agent,
          check: r.check,
          status: r.status,
          severity: r.severity,
          summary: r.summary.slice(0, 2000),
          remediation: (r.remediation ?? "").slice(0, 2000),
          durationMs: r.durationMs,
          metrics: (r.metrics ?? {}) as Record<string, unknown>,
        })),
      );
    }
  } catch (err) {
    logger.error({ err }, "[Health] Echec persistance des constats");
  }

  const summary: HealthRunSummary = {
    runId: finalRunId,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - t0,
    total: results.length,
    ok, degraded, failed, worst,
    results,
  };

  if (worst !== "ok") {
    logger.warn({ runId: finalRunId, degraded, failed }, "[Health] Anomalies detectees");
  }
  return summary;
}

/** Dernier cycle enregistre, pour affichage sans relancer les sondes. */
export async function getLatestHealthRun(): Promise<HealthCheckRow[]> {
  const [latest] = await db.select({ runId: healthChecksTable.runId })
    .from(healthChecksTable)
    .orderBy(desc(healthChecksTable.createdAt))
    .limit(1);
  if (!latest) return [];
  return db.select().from(healthChecksTable)
    .where(eq(healthChecksTable.runId, latest.runId))
    .orderBy(healthChecksTable.agent);
}

type HealthCheckRow = typeof healthChecksTable.$inferSelect;
