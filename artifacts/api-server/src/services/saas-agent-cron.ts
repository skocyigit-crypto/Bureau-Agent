/**
 * Cron de l'agent autonome super-admin.
 *
 * Cadence quotidienne: les signaux SaaS (essais, impayes, factures) evoluent a
 * l'echelle du jour, pas de la minute. La deduplication par `sourceRef`
 * (org + categorie + jour) rend un passage supplementaire inoffensif.
 *
 * Declenchement EXCLUSIVEMENT externe (Cloud Scheduler -> /api/cron/tick), sans
 * minuteur interne: le service tourne avec `cpu-throttling: true`, Cloud Run
 * n'alloue du CPU que pendant une requete. Executer depuis un `setInterval`
 * reviendrait a travailler sans processeur (cf. la meme lecon sur les autres
 * crons).
 */
import { logger } from "../lib/logger";
import { registerRunnableCron } from "./cron-registry";
import { recordCronHeartbeat } from "./health-agents";
import { runSaasAgent } from "./saas-agent";

const TICK_MS = 24 * 60 * 60 * 1000; // 1 jour
const CRON_NAME = "saas-agent";

let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runSaasAgent();
    await recordCronHeartbeat(CRON_NAME, TICK_MS / 1000);
  } catch (err) {
    logger.error({ err }, "[SaasAgentCron] Erreur du cycle");
    await recordCronHeartbeat(CRON_NAME, TICK_MS / 1000, err instanceof Error ? err.message : "erreur inconnue")
      .catch(() => {});
  } finally {
    running = false;
  }
}

export function startSaasAgentCron(): void {
  if (started) return;
  started = true;
  logger.info("[SaasAgentCron] Agent super-admin inscrit (cadence quotidienne, déclenchement externe)");
  registerRunnableCron(CRON_NAME, TICK_MS, () => tick());
}
