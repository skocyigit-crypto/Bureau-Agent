/**
 * Execution periodique des agents de sante.
 *
 * Cadence de 15 minutes: assez frequent pour reperer une degradation avant
 * qu'un utilisateur ne la signale, assez espace pour que les sondes reseau
 * (Resend, Gemini, Stripe...) restent negligeables en cout.
 *
 * L'execution passe EXCLUSIVEMENT par le declencheur externe
 * (Cloud Scheduler -> /api/cron/tick), sans minuteur interne: voir
 * `startHealthAgentsCron` pour le detail. Cela ecarte du meme coup le probleme
 * du demarrage a froid, puisque le declencheur ne tombe pas au boot.
 */
import { logger } from "../lib/logger";
import { runHealthAgents, recordCronHeartbeat } from "./health-agents";
import { registerRunnableCron } from "./cron-registry";

const TICK_MS = 15 * 60 * 1000;
const CRON_NAME = "health-agents";

let started = false;
let running = false;

async function tick(): Promise<void> {
  // Un cycle qui deborde sur le suivant serait le signe d'une sonde bloquee:
  // on saute plutot que d'empiler.
  if (running) return;
  running = true;
  try {
    const summary = await runHealthAgents();
    await recordCronHeartbeat(CRON_NAME, TICK_MS / 1000);
    // `runHealthAgents` journalise deja le detail des constats non-ok. Repeter
    // ici les seuls compteurs ajoutait une ligne sans information a chaque
    // cycle, juste au-dessus de celle qui, elle, dit quoi corriger.
  } catch (err) {
    logger.error({ err }, "[HealthCron] Erreur du cycle");
    await recordCronHeartbeat(CRON_NAME, TICK_MS / 1000, err instanceof Error ? err.message : "erreur inconnue");
  } finally {
    running = false;
  }
}

export function startHealthAgentsCron(): void {
  if (started) return;
  started = true;
  logger.info("[HealthCron] Agents de sante inscrits (cadence 15 min, declenchement externe)");

  const run = (): Promise<void> => tick().catch(() => {});

  // UNIQUEMENT par declenchement externe (Cloud Scheduler -> /api/cron/tick),
  // volontairement sans minuteur interne.
  //
  // Cloud Run n'alloue du CPU que pendant le traitement d'une requete. Sonder
  // l'etat de l'application depuis un `setInterval` revenait donc a mesurer un
  // processus prive de processeur: 3,5 s pour un `SELECT 1` et 5,2 s de retard
  // de boucle d'evenements releves ainsi, alors que les requetes des
  // utilisateurs etaient normales au meme moment. Pire, ce minuteur maintenait
  // le battement a jour, si bien que le declencheur externe ne voyait jamais
  // la tache comme due et que seule la mesure faussee subsistait.
  registerRunnableCron(CRON_NAME, TICK_MS, run);
}
