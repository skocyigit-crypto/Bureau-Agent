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

  // Execution SEQUENTIELLE, en arriere-plan.
  //
  // Les taches etaient lancees toutes en meme temps. Le declencheur externe
  // passe toutes les 10 minutes et jusqu'a cinq taches pouvaient etre dues au
  // meme instant: elles saturaient alors le pool de connexions (15/15 actives,
  // 4 requetes en attente mesurees en production), au point que meme un
  // `SELECT 1` de diagnostic n'obtenait plus de connexion, avec 2 secondes de
  // blocage de la boucle d'evenements. Autrement dit, l'entretien degradait
  // l'application pour les utilisateurs presents a ce moment-la.
  //
  // On ne les attend toujours pas depuis la requete HTTP du declencheur (une
  // tache longue la ferait expirer), mais on les enchaine les unes apres les
  // autres.
  if (dueCrons.length > 0) {
    void (async () => {
      for (const cron of dueCrons) {
        try {
          await cron.run();
        } catch (err) {
          logger.error({ err, cron: cron.name }, "[CronTick] Echec declenchement");
        }
      }
    })();
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
