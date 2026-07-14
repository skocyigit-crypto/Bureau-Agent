/**
 * Cron des rappels de paiement automatiques.
 *
 * Avant: "/license-management/auto-reminders" (runAutoRemindersForOrg) ne
 * s'executait QUE sur clic humain (bouton dans l'ecran de facturation)
 * malgre son nom "auto" — aucun cron ne l'appelait. Ce service l'execute une
 * fois par jour pour chaque organisation.
 *
 * Durabilite (meme pattern que autonomous-secretary-cron.ts /
 * daily-digest-cron.ts): le garde "une fois par jour" n'est PAS en memoire —
 * il est derive des lignes license_audit_log deja ecrites aujourd'hui
 * (action `auto_reminders_run`). Un redemarrage du serveur ne provoque donc
 * jamais de double envoi.
 */
import { and, eq, gte } from "drizzle-orm";
import { db } from "@workspace/db";
import { organisationsTable, licenseAuditLogTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { runAutoRemindersForOrg } from "../routes/license-management";

const TICK_MS = 60 * 60 * 1000; // 1h — verifie a chaque heure si c'est l'heure d'envoi
const SEND_HOUR_UTC = 8; // ~9-10h en France selon heure d'ete/hiver

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

function todayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function tick(): Promise<void> {
  if (running) return;
  const nowHourUtc = new Date().getUTCHours();
  if (nowHourUtc !== SEND_HOUR_UTC) return;
  running = true;

  try {
    const orgs = await withDbRetry(
      () => db.select({ id: organisationsTable.id }).from(organisationsTable),
      { label: "invoice-reminder-cron:orgs" },
    );

    for (const org of orgs) {
      try {
        const already = await withDbRetry(
          () => db.select({ id: licenseAuditLogTable.id })
            .from(licenseAuditLogTable)
            .where(and(
              eq(licenseAuditLogTable.organisationId, org.id),
              eq(licenseAuditLogTable.action, "auto_reminders_run"),
              gte(licenseAuditLogTable.createdAt, todayStart()),
            ))
            .limit(1),
          { label: "invoice-reminder-cron:already-run" },
        );
        if (already.length > 0) continue;

        const result = await runAutoRemindersForOrg(org.id);
        logger.info({ orgId: org.id, ...result }, "[InvoiceReminderCron] Rappels envoyes pour une organisation");
      } catch (err) {
        logger.warn({ err, orgId: org.id }, "[InvoiceReminderCron] Échec pour une organisation");
      }
    }
  } catch (err) {
    logger.error({ err }, "[InvoiceReminderCron] Erreur du cycle");
  } finally {
    running = false;
  }
}

export function startInvoiceReminderCron(): void {
  if (intervalHandle) return;
  logger.info("[InvoiceReminderCron] Rappels de paiement automatiques démarrés");

  setTimeout(() => { tick().catch(() => {}); }, 150 * 1000);
  intervalHandle = setInterval(() => { tick().catch(() => {}); }, TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
