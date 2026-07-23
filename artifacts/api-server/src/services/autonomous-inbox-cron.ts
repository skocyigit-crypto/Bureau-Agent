/**
 * Cron de la boîte e-mail autonome (Tâche #290).
 *
 * À cadence régulière (par défaut 30 min, réglable via AUTONOMOUS_INBOX_TICK_MS),
 * scanne la boîte de réception de chaque organisation éligible, trie par IA et
 * dépose des brouillons de réponse dans la file d'approbation.
 *
 * Cadence DISTINCTE du veilleur déterministe (proactive-engine, 10 min) car le
 * scan IA + Gmail est coûteux : on ne le lance pas à chaque tick proactif.
 *
 * Pas de marqueur "dernier passage" en base : contrairement aux crons qui
 * ENVOIENT (où un redémarrage pourrait dupliquer un envoi), ce service N'ENVOIE
 * JAMAIS de façon autonome. Un re-scan après redémarrage est idempotent : la
 * dédup (org, dedupeKey) + index unique pending empêche tout doublon de
 * suggestion ; le seul coût est un appel de triage IA supplémentaire, borné par
 * le quota. Un garde anti-recouvrement en mémoire suffit donc ici.
 */
import { logger } from "../lib/logger";
import { runInboxScanTick } from "./autonomous-inbox";
import { withHeartbeat } from "./health-agents";

const TICK_MS = Number(process.env.AUTONOMOUS_INBOX_TICK_MS ?? 30 * 60 * 1000);
const FIRST_RUN_MS = 2 * 60 * 1000; // premier passage 2 min après le démarrage

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // garde anti-recouvrement (un scan peut être long)
  running = true;
  try {
    await runInboxScanTick();
  } catch (err) {
    logger.error({ err }, "[autonomous-inbox-cron] erreur du cycle");
  } finally {
    running = false;
  }
}

export function startAutonomousInboxCron(): void {
  if (intervalHandle) return;
  logger.info({ tickMs: TICK_MS }, "[autonomous-inbox-cron] boîte e-mail autonome démarrée");

  setTimeout(() => { tick().catch(() => {}); }, FIRST_RUN_MS);
  intervalHandle = setInterval(withHeartbeat("autonomous-inbox", TICK_MS, tick), TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
