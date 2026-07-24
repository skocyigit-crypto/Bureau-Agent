/**
 * Cron des rappels de paiement automatiques.
 *
 * Avant: "/license-management/auto-reminders" (runAutoRemindersForOrg) ne
 * s'executait QUE sur clic humain (bouton dans l'ecran de facturation)
 * malgre son nom "auto" — aucun cron ne l'appelait. Ce service l'execute une
 * fois par jour pour chaque organisation.
 *
 * Deux garde-fous ajoutes depuis: l'organisation peut couper les relances
 * (`autoRemindersEnabled`), et par defaut (`billingRequiresApproval`) le cron
 * ne fait que PROPOSER les relances dans la file d'approbation — c'est un
 * e-mail vers le client final de l'organisation, un humain doit l'avoir lu.
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
import { registerRunnableCron } from "./cron-registry";
import { withDbRetry } from "../lib/db-retry";
import { withCronLock, CRON_LOCK_NAMESPACE } from "../lib/cron-lock";
import { runAutoRemindersForOrg } from "../routes/license-management";
import { recordCronHeartbeat } from "./health-agents";

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
  if (nowHourUtc !== SEND_HOUR_UTC) {
    // La tache s'execute bien toutes les heures; simplement, hors de l'heure
    // d'envoi elle n'a rien a faire. Sans ce battement, la table ne retenait
    // qu'une execution PAR JOUR alors que l'intervalle declare est d'une
    // heure: l'agent de sante signalait donc en permanence un retard (415 min
    // constates en production) pour une tache parfaitement fonctionnelle.
    await recordCronHeartbeat("invoice-reminder", TICK_MS / 1000);
    return;
  }
  running = true;

  try {
    // Filtre explicite: une organisation peut couper entierement les relances
    // (autoRemindersEnabled). Avant, le cron passait sur TOUTES les
    // organisations sans condition — il n'existait aucun moyen de s'en
    // desinscrire alors que ces e-mails partent vers leurs propres clients.
    const orgs = await withDbRetry(
      () => db.select({ id: organisationsTable.id, requiresApproval: organisationsTable.billingRequiresApproval })
        .from(organisationsTable)
        .where(eq(organisationsTable.autoRemindersEnabled, true)),
      { label: "invoice-reminder-cron:orgs" },
    );

    for (const org of orgs) {
      try {
        // Verrou consultatif Postgres: le check-puis-execution ci-dessous
        // n'est pas atomique — sans ce verrou, deux instances Cloud Run
        // (maxScale=3) qui tiquent au meme moment pourraient toutes deux
        // passer le check avant que l'une n'ecrive sa marque, et donc
        // envoyer les rappels en double pour la meme organisation.
        await withCronLock(CRON_LOCK_NAMESPACE.invoiceReminder, org.id, async () => {
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
          if (already.length > 0) return;

          const result = await runAutoRemindersForOrg(org.id, undefined, {
            mode: org.requiresApproval ? "propose" : "send",
          });
          logger.info(
            { orgId: org.id, mode: org.requiresApproval ? "propose" : "send", ...result },
            "[InvoiceReminderCron] Cycle de relances termine pour une organisation",
          );
        });
      } catch (err) {
        logger.warn({ err, orgId: org.id }, "[InvoiceReminderCron] Échec pour une organisation");
      }
    }
    await recordCronHeartbeat("invoice-reminder", TICK_MS / 1000);
  } catch (err) {
    logger.error({ err }, "[InvoiceReminderCron] Erreur du cycle");
    await recordCronHeartbeat("invoice-reminder", TICK_MS / 1000, err instanceof Error ? err.message : "erreur inconnue");
  } finally {
    running = false;
  }
}

export function startInvoiceReminderCron(): void {
  if (intervalHandle) return;
  logger.info("[InvoiceReminderCron] Rappels de paiement automatiques démarrés");

  const run = () => { void tick().catch(() => {}); };

  // Inscription au registre pour permettre un declenchement EXTERNE
  // (Cloud Scheduler -> /api/cron/tick).
  //
  // Sans elle, la tache ne reposait que sur le `setInterval` ci-dessous. Or le
  // service tourne avec `min-instances=0`: le conteneur s'arrete des qu'il est
  // inactif et emporte ses minuteurs. L'envoi n'a lieu qu'a une heure precise
  // (SEND_HOUR_UTC); si aucune instance n'est vivante a ce moment-la, les
  // relances de la journee sautent purement et simplement. Le declencheur
  // externe garantit qu'un tick a lieu dans cette fenetre.
  registerRunnableCron("invoice-reminder", TICK_MS, run);

  setTimeout(run, 150 * 1000);
  intervalHandle = setInterval(run, TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
