/**
 * Etat du Super Agent: lecture/ecriture partagees entre les instances.
 *
 * Voir `lib/db/src/schema/super-agent.ts` pour le pourquoi. Ce module est la
 * seule porte vers ces deux tables; les routes ne les touchent pas directement.
 *
 * Degradation volontaire: le schema de production n'est pas pousse par le
 * pipeline de deploiement (`deploy/gcp-schema-push.sh` est lance a part), il
 * existe donc une fenetre, a chaque nouvelle table, ou le code deploye connait
 * une table que la base ignore. Pendant cette fenetre, le Super Agent doit
 * continuer de tourner: on retombe sur l'ancien comportement (etat en memoire,
 * par instance) et on le journalise une fois par heure plutot qu'a chaque
 * requete. Ce qui ne doit JAMAIS arriver, c'est qu'un cycle echoue parce que
 * son compte rendu n'a pas pu s'ecrire.
 */
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db, superAgentLogsTable, superAgentStateTable } from "@workspace/db";
import { logger } from "../lib/logger";

export type SuperAgentLogLevel = "info" | "success" | "warning" | "error";
export type SuperAgentLogSource = "email" | "chantier" | "system" | "tache" | "appel";

export interface SuperAgentLog {
  timestamp: string;
  level: SuperAgentLogLevel;
  source: SuperAgentLogSource;
  message: string;
  detail?: string;
}

export interface SuperAgentStats {
  tasksCreated: number;
  tasksFixed: number;
  emailsProcessed: number;
  reportsProcessed: number;
  fixesApplied: number;
  cyclesRun: number;
}

export interface SuperAgentSnapshot {
  running: boolean;
  lastRun?: string;
  stats: SuperAgentStats;
  recentLogs: SuperAgentLog[];
  /** Vrai quand la reponse vient du repli en memoire (table absente). */
  degraded: boolean;
}

/** Nombre de lignes de journal conservees par organisation. */
const LOG_RETENTION = 500;
/** Lignes rendues par `GET /status`. */
const LOG_PAGE = 50;
/**
 * Au-dela, un cycle est considere abandonne (instance tuee en plein vol) et
 * une nouvelle execution peut reprendre le drapeau. Un cycle reel dure
 * quelques minutes; trente minutes laissent une marge large sans bloquer une
 * organisation pour la journee.
 */
const STALE_CYCLE_MS = 30 * 60 * 1000;

function emptyStats(): SuperAgentStats {
  return { tasksCreated: 0, tasksFixed: 0, emailsProcessed: 0, reportsProcessed: 0, fixesApplied: 0, cyclesRun: 0 };
}

// ---------------------------------------------------------------------------
// Repli en memoire — uniquement tant que les tables n'existent pas.
// ---------------------------------------------------------------------------
interface FallbackState { running: boolean; runningSince?: number; lastRun?: string; stats: SuperAgentStats; logs: SuperAgentLog[] }
const fallback = new Map<number, FallbackState>();
let lastFallbackWarn = 0;

function fallbackState(orgId: number): FallbackState {
  let s = fallback.get(orgId);
  if (!s) { s = { running: false, stats: emptyStats(), logs: [] }; fallback.set(orgId, s); }
  return s;
}

/**
 * 42P01 « undefined_table ». Le CODE est teste, pas le message: celui-ci est
 * traduit selon la locale du serveur.
 */
function isUndefinedTable(err: unknown): boolean {
  const cause = (err as { cause?: unknown })?.cause;
  for (const candidate of [err, cause]) {
    if (candidate && typeof candidate === "object" && (candidate as { code?: string }).code === "42P01") return true;
  }
  return false;
}

/**
 * Execute `fn`; si les tables manquent, bascule sur `onMissing` sans faire
 * echouer l'appelant. Toute autre erreur remonte: elle ne se limiterait pas a
 * une table absente et la masquer reviendrait a rendre le Super Agent muet sur
 * ses propres pannes.
 */
async function withFallback<T>(fn: () => Promise<T>, onMissing: () => T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
    const now = Date.now();
    if (now - lastFallbackWarn > 3600_000) {
      lastFallbackWarn = now;
      logger.error(
        {},
        "[super-agent] tables super_agent_* absentes de la base — etat par instance (lancer deploy/gcp-schema-push.sh)",
      );
    }
    return onMissing();
  }
}

async function ensureRow(orgId: number): Promise<void> {
  await db.insert(superAgentStateTable)
    .values({ organisationId: orgId })
    .onConflictDoNothing();
}

/**
 * Prend le drapeau `running` pour cette organisation, ou renvoie false si un
 * cycle est deja en cours ailleurs. L'acquisition est UNE seule instruction
 * SQL conditionnelle: deux instances qui demarrent en meme temps ne peuvent
 * pas la gagner toutes les deux, ce qu'un `if (state.running)` en memoire ne
 * garantissait pas.
 */
export async function tryStartSuperAgentCycle(orgId: number): Promise<boolean> {
  return withFallback(async () => {
    await ensureRow(orgId);
    const staleBefore = new Date(Date.now() - STALE_CYCLE_MS);
    const updated = await db.update(superAgentStateTable)
      .set({
        running: true,
        runningSince: new Date(),
        cyclesRun: sql`${superAgentStateTable.cyclesRun} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(superAgentStateTable.organisationId, orgId),
        or(
          eq(superAgentStateTable.running, false),
          lt(superAgentStateTable.runningSince, staleBefore),
        ),
      ))
      .returning({ organisationId: superAgentStateTable.organisationId });
    return updated.length > 0;
  }, () => {
    const s = fallbackState(orgId);
    if (s.running && s.runningSince && Date.now() - s.runningSince < STALE_CYCLE_MS) return false;
    s.running = true;
    s.runningSince = Date.now();
    s.stats.cyclesRun++;
    return true;
  });
}

/**
 * Libere le drapeau. Appele dans un `finally`: un cycle qui echoue doit rendre
 * la main, sinon l'organisation reste bloquee jusqu'au delai de reprise.
 */
export async function finishSuperAgentCycle(orgId: number, opts: { completed: boolean } = { completed: true }): Promise<void> {
  await withFallback(async () => {
    await db.update(superAgentStateTable)
      .set({
        running: false,
        runningSince: null,
        ...(opts.completed ? { lastRun: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(superAgentStateTable.organisationId, orgId));
  }, () => {
    const s = fallbackState(orgId);
    s.running = false;
    s.runningSince = undefined;
    if (opts.completed) s.lastRun = new Date().toISOString();
  });
}

/**
 * Incremente les compteurs. Les deltas sont appliques EN SQL, jamais par
 * relecture puis reecriture: deux cycles simultanes (organisations differentes
 * ou reprise apres abandon) ne peuvent pas s'ecraser.
 */
export async function bumpSuperAgentStats(orgId: number, deltas: Partial<SuperAgentStats>): Promise<void> {
  const entries = Object.entries(deltas).filter(([, v]) => typeof v === "number" && v !== 0) as [keyof SuperAgentStats, number][];
  if (entries.length === 0) return;
  await withFallback(async () => {
    await ensureRow(orgId);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of entries) {
      set[key] = sql`${superAgentStateTable[key]} + ${value}`;
    }
    await db.update(superAgentStateTable).set(set)
      .where(eq(superAgentStateTable.organisationId, orgId));
  }, () => {
    const s = fallbackState(orgId);
    for (const [key, value] of entries) s.stats[key] += value;
  });
}

/**
 * Ajoute une ligne de journal. N'echoue jamais l'appelant: un journal perdu
 * est regrettable, un cycle interrompu parce que son journal n'a pas pu
 * s'ecrire l'est davantage.
 */
export async function appendSuperAgentLog(
  orgId: number,
  level: SuperAgentLogLevel,
  source: SuperAgentLogSource,
  message: string,
  detail?: string,
): Promise<void> {
  try {
    await withFallback(async () => {
      const [row] = await db.insert(superAgentLogsTable)
        .values({ organisationId: orgId, level, source, message, detail: detail ?? null })
        .returning({ id: superAgentLogsTable.id });
      // Elagage opportuniste: une ligne sur cinquante suffit a garder la table
      // bornee sans payer un DELETE a chaque evenement.
      if (row && row.id % 50 === 0) await pruneSuperAgentLogs(orgId);
    }, () => {
      const s = fallbackState(orgId);
      s.logs.push({ timestamp: new Date().toISOString(), level, source, message, detail });
      if (s.logs.length > LOG_RETENTION) s.logs = s.logs.slice(-LOG_RETENTION);
    });
  } catch (err) {
    logger.warn({ err, orgId }, "[super-agent] ecriture du journal impossible");
  }
}

async function pruneSuperAgentLogs(orgId: number): Promise<void> {
  const keep = await db.select({ id: superAgentLogsTable.id })
    .from(superAgentLogsTable)
    .where(eq(superAgentLogsTable.organisationId, orgId))
    .orderBy(desc(superAgentLogsTable.id))
    .limit(1)
    .offset(LOG_RETENTION - 1);
  const cutoff = keep[0]?.id;
  if (cutoff === undefined) return;
  await db.delete(superAgentLogsTable).where(and(
    eq(superAgentLogsTable.organisationId, orgId),
    lt(superAgentLogsTable.id, cutoff),
  ));
}

/** Ce que renvoie `GET /ai/super-agent/status`. */
export async function getSuperAgentSnapshot(orgId: number): Promise<SuperAgentSnapshot> {
  return withFallback<SuperAgentSnapshot>(async () => {
    const [row] = await db.select().from(superAgentStateTable)
      .where(eq(superAgentStateTable.organisationId, orgId));
    const logs = await db.select().from(superAgentLogsTable)
      .where(eq(superAgentLogsTable.organisationId, orgId))
      .orderBy(desc(superAgentLogsTable.id))
      .limit(LOG_PAGE);
    // Un cycle abandonne ne doit pas s'afficher comme « en cours » indefiniment.
    const stale = row?.runningSince ? Date.now() - row.runningSince.getTime() > STALE_CYCLE_MS : false;
    return {
      running: Boolean(row?.running) && !stale,
      lastRun: row?.lastRun?.toISOString(),
      stats: row
        ? {
            tasksCreated: row.tasksCreated, tasksFixed: row.tasksFixed,
            emailsProcessed: row.emailsProcessed, reportsProcessed: row.reportsProcessed,
            fixesApplied: row.fixesApplied, cyclesRun: row.cyclesRun,
          }
        : emptyStats(),
      recentLogs: logs.reverse().map((l) => ({
        timestamp: l.createdAt.toISOString(),
        level: l.level as SuperAgentLogLevel,
        source: l.source as SuperAgentLogSource,
        message: l.message,
        ...(l.detail ? { detail: l.detail } : {}),
      })),
      degraded: false,
    };
  }, () => {
    const s = fallbackState(orgId);
    return {
      running: s.running,
      lastRun: s.lastRun,
      stats: { ...s.stats },
      recentLogs: s.logs.slice(-LOG_PAGE),
      degraded: true,
    };
  });
}

/** Reservee aux tests: remet le repli en memoire a zero. */
export function __resetSuperAgentFallback(): void {
  fallback.clear();
  lastFallbackWarn = 0;
}
