/**
 * Execution periodique des agents de sante.
 *
 * Cadence de 15 minutes: assez frequent pour reperer une degradation avant
 * qu'un utilisateur ne la signale, assez espace pour que les sondes reseau
 * (Resend, Gemini, Stripe...) restent negligeables en cout.
 *
 * Le premier passage est differe de 3 minutes: sonder des dependances externes
 * pendant que l'instance demarre fausserait la mesure (latences de demarrage a
 * froid) et alourdirait le boot.
 */
import { logger } from "../lib/logger";
import { runHealthAgents, recordCronHeartbeat } from "./health-agents";

const TICK_MS = 15 * 60 * 1000;
const CRON_NAME = "health-agents";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
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
  if (intervalHandle) return;
  logger.info("[HealthCron] Agents de sante demarres (toutes les 15 min)");

  setTimeout(() => { tick().catch(() => {}); }, 3 * 60 * 1000);
  intervalHandle = setInterval(() => { tick().catch(() => {}); }, TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
