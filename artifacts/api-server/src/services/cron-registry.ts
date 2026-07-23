/**
 * Registre des taches planifiees, pour un declenchement EXTERNE.
 *
 * Pourquoi: les crons reposent sur setInterval dans le processus. Avec
 * min-instances=0 (choisi pour ne pas payer une instance qui dort), Cloud Run
 * arrete l'instance des que le trafic cesse — et le temps s'arrete avec elle.
 * Les relances, digests et sauvegardes ne partaient donc que si quelqu'un
 * utilisait l'application au meme moment.
 *
 * Garder une instance eveillee couterait ~60-70 EUR/mois. A la place, Cloud
 * Scheduler appelle /api/cron/tick a intervalle regulier: l'instance se
 * reveille quelques secondes, execute ce qui est du, puis s'eteint. Cout
 * quasi nul.
 *
 * Le registre est alimente par `withHeartbeat` (services/health-agents.ts), que
 * chaque cron utilise deja: aucune declaration supplementaire n'est requise
 * dans les taches elles-memes.
 */
import { db } from "@workspace/db";
import { cronHeartbeatsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

interface RegisteredCron {
  name: string;
  intervalMs: number;
  /** Le tick DEJA enveloppe: il enregistre son propre battement. */
  run: () => void;
}

const registry = new Map<string, RegisteredCron>();

/** Appele par withHeartbeat au montage de chaque cron. */
export function registerRunnableCron(name: string, intervalMs: number, run: () => void): void {
  registry.set(name, { name, intervalMs, run });
}

export function listRegisteredCrons(): Array<{ name: string; intervalMs: number }> {
  return [...registry.values()].map(({ name, intervalMs }) => ({ name, intervalMs }));
}

export interface CronTickResult {
  checked: number;
  triggered: string[];
  skipped: string[];
}

/**
 * Execute les taches dont l'echeance est depassee, d'apres la table des
 * battements — la meme source que l'agent de sante, donc une seule verite.
 *
 * On declenche des que `lastRunAt` remonte a plus d'un intervalle: le
 * declencheur externe n'est pas synchronise avec les intervalles internes, et
 * attendre une marge supplementaire ferait deriver les taches. Chaque tache
 * garde par ailleurs ses propres garde-fous (verrou consultatif, garde
 * "une fois par jour" derive de la base), donc un declenchement en avance ne
 * produit pas de doublon.
 */
export async function runDueCrons(): Promise<CronTickResult> {
  const result: CronTickResult = { checked: 0, triggered: [], skipped: [] };
  if (registry.size === 0) return result;

  let beats: Array<{ name: string; lastRunAt: Date }> = [];
  try {
    beats = await db.select({
      name: cronHeartbeatsTable.name,
      lastRunAt: cronHeartbeatsTable.lastRunAt,
    }).from(cronHeartbeatsTable);
  } catch (err) {
    logger.error({ err }, "[CronTick] Lecture des battements impossible");
    return result;
  }
  const lastRunByName = new Map(beats.map((b) => [b.name, new Date(b.lastRunAt).getTime()]));

  const now = Date.now();
  for (const cron of registry.values()) {
    result.checked++;
    const last = lastRunByName.get(cron.name);
    // Jamais executee: on la declenche (elle vient d'etre inscrite au montage).
    const due = last === undefined || now - last >= cron.intervalMs;
    if (!due) { result.skipped.push(cron.name); continue; }
    try {
      // `run` est deja fire-and-forget et capture ses propres erreurs; on ne
      // l'attend pas pour ne pas faire expirer la requete du declencheur si
      // une tache est longue.
      cron.run();
      result.triggered.push(cron.name);
    } catch (err) {
      logger.error({ err, cron: cron.name }, "[CronTick] Echec declenchement");
    }
  }

  if (result.triggered.length > 0) {
    logger.info({ triggered: result.triggered }, "[CronTick] Taches declenchees");
  }
  return result;
}

/** Remet a zero le battement d'une tache (usage: forcer une execution). */
export async function resetCronHeartbeat(name: string): Promise<boolean> {
  try {
    const rows = await db.update(cronHeartbeatsTable)
      .set({ lastRunAt: new Date(0) })
      .where(eq(cronHeartbeatsTable.name, name))
      .returning({ name: cronHeartbeatsTable.name });
    return rows.length > 0;
  } catch {
    return false;
  }
}
