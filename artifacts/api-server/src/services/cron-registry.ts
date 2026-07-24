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
  /**
   * Le tick DEJA enveloppe: il enregistre son propre battement et capture ses
   * propres erreurs. Peut renvoyer une promesse, ce qui permet de les enchainer
   * (cf. runDueCrons) au lieu de les lancer toutes en meme temps.
   */
  run: () => void | Promise<void>;
}

const registry = new Map<string, RegisteredCron>();

/** Appele par withHeartbeat au montage de chaque cron. */
export function registerRunnableCron(name: string, intervalMs: number, run: () => void | Promise<void>): void {
  registry.set(name, { name, intervalMs, run });
}

export function listRegisteredCrons(): Array<{ name: string; intervalMs: number }> {
  return [...registry.values()].map(({ name, intervalMs }) => ({ name, intervalMs }));
}

export interface CronTickResult {
  checked: number;
  triggered: string[];
  skipped: string[];
  /** Dues mais non executees faute de temps: reprises au tick suivant. */
  deferred: string[];
}

/**
 * Temps maximal consacre aux taches pendant une requete du declencheur.
 *
 * Le delai d'attente de Cloud Scheduler est de 60 s et celui de Cloud Run de
 * 300 s. On reste nettement sous les deux: une tache qui deborde n'est pas
 * perdue, elle reste due et repart au tick suivant (10 minutes plus tard).
 */
const TICK_BUDGET_MS = Number(process.env.CRON_TICK_BUDGET_MS) > 0
  ? Number(process.env.CRON_TICK_BUDGET_MS)
  : 45_000;

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
  const result: CronTickResult = { checked: 0, triggered: [], skipped: [], deferred: [] };
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
  const dueCrons: RegisteredCron[] = [];
  for (const cron of registry.values()) {
    result.checked++;
    const last = lastRunByName.get(cron.name);
    // Jamais executee: on la declenche (elle vient d'etre inscrite au montage).
    const due = last === undefined || now - last >= cron.intervalMs;
    if (!due) { result.skipped.push(cron.name); continue; }
    dueCrons.push(cron);
    result.triggered.push(cron.name);
  }

  // Execution SEQUENTIELLE et DANS la requete du declencheur.
  //
  // Deux problemes se cumulaient. D'une part les taches etaient lancees toutes
  // en meme temps: jusqu'a cinq pouvaient etre dues au meme instant et elles
  // saturaient le pool de connexions (15/15 actives, 4 requetes en attente
  // mesurees en production). D'autre part elles etaient detachees de la
  // requete — or le service tourne avec `cpu-throttling: true`, c'est-a-dire
  // que Cloud Run n'alloue de CPU que PENDANT le traitement d'une requete. Le
  // travail de fond s'executait donc quasiment sans processeur: les agents de
  // sante ont mesure 12,5 secondes de retard de boucle d'evenements et l'echec
  // d'un simple `SELECT 1`.
  //
  // On les enchaine donc, et on les attend, pour qu'elles disposent reellement
  // du processeur. Le budget borne la duree: ce qui n'a pas pu passer reste du
  // et sera repris au tick suivant. Sans ce garde-fou, une tache longue ferait
  // expirer la requete du declencheur.
  const deadline = Date.now() + TICK_BUDGET_MS;
  for (const cron of dueCrons) {
    if (Date.now() >= deadline) {
      result.deferred.push(cron.name);
      result.triggered = result.triggered.filter((n) => n !== cron.name);
      continue;
    }
    try {
      await cron.run();
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
