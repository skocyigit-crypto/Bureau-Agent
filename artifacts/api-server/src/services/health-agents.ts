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
import { registerRunnableCron } from "./cron-registry";
import { withDbRetry } from "../lib/db-retry";

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

/**
 * Etat du pool releve juste avant le lancement des agents.
 *
 * Sans cela l'observation fausse la mesure: les agents tournent en parallele
 * et consomment eux-memes des connexions, le pool paraissait donc sature a
 * chaque cycle. On fige l'etat "au repos" et l'agent base de donnees le lit.
 */
let poolSnapshot: { total: number; idle: number; waiting: number } | null = null;

/**
 * Latence de la base et retard de la boucle d'evenements, releves AVANT le
 * lancement des agents — pour la meme raison que `poolSnapshot`.
 *
 * Ces deux mesures decrivent l'etat de l'application; les prendre pendant que
 * sept agents tournent en parallele sur un seul vCPU revenait a mesurer les
 * agents eux-memes. En production, le `SELECT 1` grimpait a 10 secondes et la
 * boucle accusait plusieurs centaines de millisecondes de retard, alors que
 * les requetes des utilisateurs, au meme moment, etaient normales.
 */
let baselineSnapshot: { queryLatencyMs: number | null; eventLoopLagMs: number | null } = {
  queryLatencyMs: null,
  eventLoopLagMs: null,
};

async function measureBaseline(): Promise<void> {
  let queryLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    queryLatencyMs = Date.now() - t0;
  } catch {
    // On laisse `null`: le controle refera la mesure et rapportera l'echec
    // avec son propre message.
  }

  const t1 = Date.now();
  await new Promise((r) => setTimeout(r, 100));
  const eventLoopLagMs = Date.now() - t1 - 100;

  baselineSnapshot = { queryLatencyMs, eventLoopLagMs };
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
    //
    // La mesure est celle prise AVANT le lancement des agents (poolSnapshot),
    // pas l'etat courant: les agents s'executent en parallele et interrogent
    // tous la base, ils saturaient donc eux-memes le pool qu'ils mesurent.
    // Le premier cycle rapportait ainsi "8/8 occupees" alors que la charge
    // venait uniquement de l'observation.
    results.push(await safeCheck("pool_saturation", async () => {
      const snap = poolSnapshot ?? {
        total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
      };
      const total = snap.total;
      const idle = snap.idle;
      const waiting = snap.waiting;
      const max = (pool.options as { max?: number }).max ?? 0;
      const usage = max > 0 ? (total - idle) / max : 0;
      // SEULE l'attente constitue une degradation: elle signifie qu'un
      // traitement n'a pas obtenu de connexion et patiente.
      //
      // Un taux d'occupation eleve sans aucune attente decrit un pool qui fait
      // exactement son travail. Le signaler produisait une fausse alerte a
      // chaque cycle depuis que les agents de sante s'executent dans la chaine
      // des taches planifiees: le releve a alors lieu juste apres les autres
      // taches, donc au moment le plus charge, et « 14/15 actives, 0 en
      // attente » etait rapporte comme une anomalie alors qu'aucun utilisateur
      // n'etait ralenti. L'occupation reste visible dans les metriques et dans
      // le resume, sans declencher d'alerte.
      const status: CheckStatus = waiting > 0 ? "degrade" : "ok";
      const active = total - idle;
      return {
        check: "pool_saturation",
        status,
        severity: waiting > 0 ? "haute" : "basse",
        summary: status === "ok"
          ? usage >= 0.9
            ? `Pool tres sollicite mais sans attente: ${active}/${max} connexions actives.`
            : `Pool sain: ${active}/${max} connexions actives.`
          : `Pool sous tension: ${active}/${max} actives, ${waiting} requete(s) en attente.`,
        remediation: status === "ok" ? "" : "Reduire DB_POOL_MAX, ou augmenter max_connections cote Cloud SQL. Verifier qu'aucune requete ne tient une connexion trop longtemps.",
        metrics: { total, idle, waiting, max, usagePct: Math.round(usage * 100) },
      };
    }));

    // Latence: un SELECT 1 doit etre quasi instantane. S'il traine, la base ou
    // le lien reseau est en difficulte bien avant que les requetes echouent.
    results.push(await safeCheck("query_latency", async () => {
      let ms = baselineSnapshot.queryLatencyMs;
      if (ms === null) {
        // Le releve initial a echoue: on refait la mesure ici pour que
        // l'echec soit rapporte avec son message d'origine.
        const t0 = Date.now();
        await db.execute(sql`SELECT 1`);
        ms = Date.now() - t0;
      }
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
      let lag = baselineSnapshot.eventLoopLagMs;
      if (lag === null) {
        const t0 = Date.now();
        await new Promise((r) => setTimeout(r, 100));
        lag = Date.now() - t0 - 100;
      }
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

/**
 * Declare une tache planifiee au demarrage, sans compter d'execution.
 *
 * Distinct de recordCronHeartbeat, qui incremente runCount: le montage d'un
 * cron n'est pas un passage. On pose seulement `lastRunAt` a l'instant du
 * montage pour que la tache ne soit pas immediatement jugee "en retard" —
 * elle vient d'etre armee, son premier tick n'a pas encore eu lieu.
 * `onConflictDoNothing` preserve l'historique d'un cron deja connu.
 */
/**
 * Inscrit un cron dans la table des battements.
 *
 * L'inscription a lieu au demarrage, c'est-a-dire au moment ou toutes les
 * instances se connectent en meme temps. Sur un deploiement, les anciennes
 * drainent pendant que les nouvelles montent, et les connexions manquent
 * quelques secondes: `timeout exceeded when trying to connect`.
 *
 * L'echec etait seulement journalise. Le cron continuait de tourner, mais sans
 * ligne de battement il sortait du champ de l'agent « Taches planifiees »:
 * une hoquet de connexion au demarrage privait donc discretement une tache de
 * toute surveillance, jusqu'au redemarrage suivant. Une reprise suffit — la
 * base redevient joignable des que la vague de connexions retombe.
 */
async function registerCron(name: string, expectedIntervalSec: number): Promise<void> {
  try {
    await withDbRetry(
      () =>
        db.insert(cronHeartbeatsTable)
          .values({ name, expectedIntervalSec, lastRunAt: new Date(), runCount: 0, errorCount: 0 })
          .onConflictDoNothing({ target: cronHeartbeatsTable.name }),
      { label: `health:register-cron:${name}` },
    );
  } catch (err) {
    logger.warn({ err, name }, "[Health] Echec inscription du cron");
  }
}

/**
 * Enveloppe le `tick` d'une tache planifiee pour qu'elle signale son passage.
 *
 * A preferer a un appel manuel a recordCronHeartbeat en fin de tick: place ici,
 * le battement est enregistre meme si le tick leve une exception (le cas
 * justement interessant), et il n'y a rien a ne pas oublier dans le corps de
 * la tache. Usage:
 *   setInterval(withHeartbeat("app-audit", TICK_MS, tick), TICK_MS);
 */
export function withHeartbeat(
  name: string,
  intervalMs: number,
  tick: () => Promise<void>,
): () => void {
  const intervalSec = Math.round(intervalMs / 1000);

  // Inscription immediate, au montage du cron (cet appel a lieu pendant
  // startXCron). Sans elle, une tache qui n'a JAMAIS tourne serait absente de
  // la table et donc invisible pour l'agent scheduler — precisement le cas
  // qu'on veut detecter.
  void registerCron(name, intervalSec);

  // Renvoie la promesse au lieu de la detacher: le declencheur externe
  // (runDueCrons) peut ainsi enchainer les taches dues au lieu de les lancer
  // toutes en parallele et de saturer le pool de connexions. Les appelants
  // `setInterval` continuent d'ignorer la valeur de retour, sans changement.
  const run = async (): Promise<void> => {
    try {
      await tick();
      await recordCronHeartbeat(name, intervalSec);
    } catch (err) {
      // Le second enregistrement peut lui aussi echouer (c'est typiquement la
      // base qui est en cause). Sans ce catch, la promesse serait rejetee sans
      // gestionnaire — `setInterval` ignore la valeur de retour — et un
      // `unhandledRejection` ferait tomber le processus.
      await recordCronHeartbeat(name, intervalSec, err instanceof Error ? err.message : "erreur inconnue")
        .catch(() => {});
    }
  };

  // Inscription au registre pour permettre un declenchement EXTERNE
  // (Cloud Scheduler -> /api/cron/tick). Sans cela, une instance arretee par
  // Cloud Run emporte ses setInterval avec elle et la tache ne tourne plus.
  registerRunnableCron(name, intervalMs, run);

  return run;
}

/**
 * Cadence du declenchement externe (Cloud Scheduler -> /api/cron/tick).
 *
 * Doit refleter la planification reelle du job `agent-de-bureau-cron`
 * (toutes les 10 minutes au moment de l'ecriture). Ce n'est pas une
 * preference: une tache ne peut tourner qu'a un battement, donc cette valeur
 * determine la cadence REELLEMENT atteignable de toutes les taches.
 */
const TICK_INTERVAL_SEC = parseInt(process.env.CRON_TICK_INTERVAL_SEC || "600", 10);

/**
 * A partir de quel age une tache est vraiment en retard.
 *
 * Une tache ne demarre qu'a un battement du declencheur externe. Une tache
 * "toutes les 15 min" avec un battement toutes les 10 min ne peut donc pas
 * tourner mieux que toutes les 20 min — c'est sa cadence reelle, pas un
 * retard. L'ancienne regle (2x l'intervalle demande, soit 30 min) ne laissait
 * alors qu'UN SEUL battement de marge: un deploiement qui recycle l'instance
 * pendant un battement suffisait a franchir le seuil, et le proprietaire
 * recevait une "panne d'automatisation" alors que tout fonctionnait. C'est
 * arrive en production le 2026-09-01 (trou 11:40 -> 12:10).
 *
 * Une alerte qui se declenche en fonctionnement normal est pire qu'absente:
 * on apprend a la filtrer, et la vraie panne part avec elle.
 *
 * On prend donc le PLUS GRAND des deux seuils:
 *   - l'ancienne tolerance (2x), pour ne relacher aucune surveillance
 *     existante — les taches horaires et quotidiennes gardent leur seuil;
 *   - la cadence reellement atteignable + deux battements de marge, pour les
 *     taches dont l'intervalle n'est pas un multiple du battement.
 *
 * Le seuil ne peut ainsi que s'assouplir la ou il etait intenable, jamais se
 * durcir ailleurs. Une tache reellement morte reste detectee: au pire 40 min
 * pour une tache de 15 min, au lieu de 30.
 */
export function cronLateAfterSec(expectedIntervalSec: number, tickSec = TICK_INTERVAL_SEC): number {
  const legacy = expectedIntervalSec * 2;
  if (tickSec <= 0) return legacy;
  // Cadence reelle: l'intervalle demande arrondi au battement superieur.
  const achievable = Math.ceil(expectedIntervalSec / tickSec) * tickSec;
  return Math.max(legacy, achievable + tickSec * 2);
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
      const late = ageSec > cronLateAfterSec(r.expectedIntervalSec);
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
        metrics: {
          ageSec,
          expectedIntervalSec: r.expectedIntervalSec,
          lateAfterSec: cronLateAfterSec(r.expectedIntervalSec),
          runCount: r.runCount,
          errorCount: r.errorCount,
        },
      };
    });
  },
};

// ── Registre ────────────────────────────────────────────────────────────────

/**
 * Agents ajoutes ici sont automatiquement executes et affiches — un nouveau
 * domaine de surveillance se resume a ecrire un HealthAgent et a l'inscrire.
 */
// ── Agent: fournisseurs IA ──────────────────────────────────────────────────

/**
 * Signale qu'un fournisseur IA ne repond plus, meme quand la bascule masque
 * la panne pour l'utilisateur.
 *
 * Le 1er septembre 2026, les credits Gemini epuises ont coupe toutes les
 * fonctions IA. Personne n'a ete prevenu: la panne a ete decouverte parce
 * qu'une personne a remarque que l'assistant ne repondait plus. Aucun agent ne
 * surveillait ce domaine.
 *
 * Depuis, la bascule automatique fait que l'utilisateur ne voit plus rien —
 * ce qui rend cet agent PLUS necessaire, pas moins: la depense glisse
 * silencieusement vers un fournisseur plus cher, et la chaine de secours
 * s'epuise sans que personne ne le sache.
 *
 * L'agent n'appelle aucun fournisseur: il lit l'etat laisse par les appels
 * reels. Sonder activement couterait de l'argent a chaque cycle pour une
 * information que le trafic donne deja.
 */
const aiProvidersAgent: HealthAgent = {
  id: "ai_providers",
  name: "Fournisseurs IA",
  domain: "Disponibilite des fournisseurs (credits, quotas) et bascules en cours",
  run: async () => {
    const results: CheckResult[] = [];

    results.push(await safeCheck("ai_provider_availability", async () => {
      const { providerHealth, probeStaleProviders } = await import("./ai-failover");

      // Sonder AVANT de lire: la bascule s'arrete au premier fournisseur qui
      // repond, donc les recours suivants ne sont jamais appeles tant que le
      // premier tient — et un recours jamais appele passait pour sain. Sans
      // cette ligne, cet agent affirme une disponibilite qu'il n'a pas
      // verifiee.
      await probeStaleProviders();

      const states = providerHealth();
      const failing = states.filter((s) => s.failing);
      const healthy = states.filter((s) => !s.failing && s.failures === 0);

      if (failing.length === 0) {
        // Distinguer « verifie disponible » de « jamais appele ». Un
        // fournisseur sans observation n'est pas une bonne nouvelle, c'est
        // une absence de nouvelle — et c'est ce qui a fait passer une panne
        // d'OpenAI pour un recours en bon etat.
        const inconnus = states.filter((s) => s.lastSeenMs === null);
        return {
          check: "ai_provider_availability",
          status: "ok" as const,
          severity: "basse" as CheckSeverity,
          summary: inconnus.length === 0
            ? `Fournisseurs IA verifies disponibles: ${states.length}.`
            : `Aucune indisponibilite relevee, mais ${inconnus.length} fournisseur(s) n'ont pas pu etre verifies (${inconnus.map((s) => s.provider).join(", ")}).`,
          remediation: inconnus.length === 0
            ? ""
            : "Etat inconnu, pas forcement mauvais: la sonde est-elle desactivee (AI_PROVIDER_PROBE=off) ?",
          metrics: { fournisseurs: states.length, verifies: states.length - inconnus.length },
        };
      }

      const noms = failing.map((f) => f.provider).join(", ");
      const raison = failing[0]?.reason ?? "raison inconnue";

      // Plus aucun recours: l'IA est reellement hors service.
      if (failing.length >= states.length) {
        return {
          check: "ai_provider_availability",
          status: "echec" as const,
          severity: "critique" as CheckSeverity,
          summary: `Tous les fournisseurs IA sont indisponibles (${noms}). Les fonctions IA ne repondent plus. Cause du dernier echec: ${raison}`,
          remediation:
            "Recharger le compte du fournisseur principal (credits/quota), ou verifier les cles. Voir services/ai-failover.ts.",
          metrics: { indisponibles: noms, restants: healthy.length },
        };
      }

      const restants = states.length - failing.length;

      // Un seul fournisseur encore debout: la prochaine panne devient une
      // vraie coupure. C'est le moment d'alerter, pas apres.
      //
      // `echec` + `haute` est la condition retenue par selectAlertableChecks
      // pour envoyer un e-mail. Elle est volontairement etroite afin d'eviter
      // le bruit; un dernier recours en jeu la merite.
      if (restants <= 1) {
        return {
          check: "ai_provider_availability",
          status: "echec" as const,
          severity: "haute" as CheckSeverity,
          summary:
            `${noms} indisponible(s): il ne reste qu'un seul fournisseur IA. ` +
            `La prochaine panne coupera les fonctions IA. Cause: ${raison}`,
          remediation:
            "Recharger le compte du fournisseur indisponible avant que le dernier recours ne cede.",
          metrics: { indisponibles: noms, restants },
        };
      }

      // Un fournisseur perdu sur trois: l'application fonctionne et l'alerte
      // par e-mail serait du bruit. L'etat reste visible dans le panneau de
      // sante, ou l'exploitant le verra en regardant.
      return {
        check: "ai_provider_availability",
        status: "degrade" as const,
        severity: "moyenne" as CheckSeverity,
        summary:
          `${noms} indisponible(s); les appels basculent sur un autre fournisseur. ` +
          `L'application fonctionne, mais la depense se deplace et le recours s'amenuise. Cause: ${raison}`,
        remediation:
          "Recharger le compte concerne. Tant qu'il est vide, chaque appel paie un aller-retour perdu: " +
          "AI_PROVIDER_ORDER permet de le passer en dernier sans redeployer.",
        metrics: { indisponibles: noms, restants },
      };
    }));

    return results;
  },
};

export const HEALTH_AGENTS: HealthAgent[] = [
  databaseAgent,
  aiProvidersAgent,
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

  // Photo du pool AVANT toute requete des agents (cf. poolSnapshot).
  poolSnapshot = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };

  // Mesures d'etat prises au repos, avant le lancement parallele des agents.
  await measureBaseline();

  const runOne = async (agent: HealthAgent) => {
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
  };

  // Concurrence bornee plutot que sept agents lances d'un coup.
  //
  // Chaque agent enchaine plusieurs requetes; a sept en parallele ils
  // pouvaient monopoliser les 15 connexions du pool et se faire echouer
  // mutuellement — le controle des connexions serveur remontait ainsi un
  // "Failed query" faute de connexion disponible. Deux a la fois suffisent a
  // couvrir l'attente des sondes reseau (dependances externes) sans que le
  // diagnostic devienne lui-meme la cause de la panne qu'il signale.
  const AGENT_CONCURRENCY = 2;
  const perAgent: Array<Awaited<ReturnType<typeof runOne>>> = [];
  for (let i = 0; i < HEALTH_AGENTS.length; i += AGENT_CONCURRENCY) {
    const slice = HEALTH_AGENTS.slice(i, i + AGENT_CONCURRENCY);
    perAgent.push(...(await Promise.all(slice.map(runOne))));
  }

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
    // Le journal ne portait que des COMPTEURS ("3 degrades, 4 echecs"), sans
    // dire quel agent ni pourquoi. En production, ce message revenait a chaque
    // cycle sans qu'on puisse rien en faire: pour connaitre le detail il
    // fallait ouvrir l'application et consulter l'ecran dedie. On liste donc
    // les constats non-ok, ce qui rend l'alerte exploitable depuis les seuls
    // journaux — y compris quand c'est l'application elle-meme qui va mal.
    logger.warn(
      {
        runId: finalRunId,
        degraded,
        failed,
        anomalies: results
          .filter((r) => r.status !== "ok")
          .map((r) => `${r.agent}/${r.check} [${r.status}] ${r.summary.slice(0, 160)}`),
      },
      "[Health] Anomalies detectees",
    );
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
