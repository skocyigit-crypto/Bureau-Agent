/**
 * Declenchement quotidien du cycle de vie des abonnements.
 *
 * DECLENCHEMENT EXTERNE, sans minuteur interne. Le service tourne avec
 * `cpu-throttling: true` : Cloud Run n'alloue du processeur que pendant une
 * requete. Un `setInterval` travaillerait donc sans processeur — c'est la
 * lecon deja tiree pour les autres crons de ce depot, et la raison pour
 * laquelle `registerRunnableCron` existe : la tache est INSCRITE, et
 * `/api/cron/tick` (appele par Cloud Scheduler, toutes les dix minutes en
 * production) l'execute quand son echeance est depassee.
 *
 * CADENCE QUOTIDIENNE. Une periode d'abonnement, un delai de grace et une
 * suspension se mesurent en jours. Passer plus souvent ne changerait aucune
 * decision et multiplierait les ecritures.
 *
 * IDEMPOTENT. Un passage supplementaire ne fait rien de plus : les decisions
 * sont prises sur l'etat courant, et chaque transition change cet etat de
 * sorte que la meme decision ne se represente pas. Un renouvellement pose une
 * fin de periode FUTURE, un passage en retard pose `lastPaymentFailedAt`, une
 * suspension pose `suspended`. C'est ce qui rend un rattrapage sans risque.
 */
import { logger } from "../lib/logger";
import { registerRunnableCron } from "./cron-registry";
import { recordCronHeartbeat } from "./health-agents";
import { appliquerCycleAbonnements } from "./cycle-abonnement";

const TICK_MS = 24 * 60 * 60 * 1000;
const CRON_NAME = "cycle-abonnement";

let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await appliquerCycleAbonnements();
    logger.info(
      { examines: r.examines, renouveles: r.renouveles, retards: r.passesEnRetard, suspendus: r.suspendus, illisibles: r.illisibles.length },
      "[CycleAbonnement] cycle applique",
    );
    // Un abonnement non traite n'est pas un abonnement sain : on le remonte
    // dans le battement de coeur plutot que de rendre un vert qui ne mesure
    // qu'une partie.
    await recordCronHeartbeat(
      CRON_NAME,
      TICK_MS / 1000,
      r.illisibles.length > 0 ? `${r.illisibles.length} abonnement(s) non traite(s) : ${r.illisibles[0]}` : undefined,
    );
  } catch (err) {
    logger.error({ err }, "[CycleAbonnement] Erreur du cycle");
    await recordCronHeartbeat(CRON_NAME, TICK_MS / 1000, err instanceof Error ? err.message : "erreur inconnue")
      .catch(() => {});
  } finally {
    running = false;
  }
}

export function startCycleAbonnementCron(): void {
  if (started) return;
  started = true;
  logger.info("[CycleAbonnement] cycle des abonnements inscrit (quotidien, declenchement externe)");
  registerRunnableCron(CRON_NAME, TICK_MS, () => tick());
}
