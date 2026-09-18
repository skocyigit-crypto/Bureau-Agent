import { db, organisationsTable, subscriptionsTable, licenseAuditLogTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { sendTrialEndingEmail } from "./email";
import { logLicenseEvent } from "./license-audit";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { withHeartbeat } from "./health-agents";
import { withCronLock, CRON_LOCK_NAMESPACE } from "../lib/cron-lock";

let timer: NodeJS.Timeout | null = null;
export type Bucket = "T-3" | "T-1" | "T-0";

/**
 * Le seul avertissement que recoit le client avant de perdre l'ecriture.
 *
 * A l'expiration, `middleware/license-check.ts` fait basculer le compte en
 * lecture seule. Cet email est ce qui separe « j'ai ete prevenu trois fois »
 * de « le logiciel s'est arrete sans rien dire » — et c'est le second qui
 * produit les demandes de remboursement.
 */
export function bucketPourHeures(heuresRestantes: number): Bucket | null {
  if (heuresRestantes <= 0 && heuresRestantes > -24) return "T-0";
  if (heuresRestantes > 0 && heuresRestantes <= 24) return "T-1";
  if (heuresRestantes > 24 && heuresRestantes <= 72) return "T-3";
  return null;
}

async function alreadyNotified(orgId: number, bucket: Bucket, trialEndsAt: Date): Promise<boolean> {
  const action = bucket === "T-0" ? "trial_expired" : "trial_ending_warning";
  const isoEnd = trialEndsAt.toISOString();
  const [hit] = await withDbRetry(
    () => db
      .select({ id: licenseAuditLogTable.id })
      .from(licenseAuditLogTable)
      .where(and(
        eq(licenseAuditLogTable.organisationId, orgId),
        eq(licenseAuditLogTable.action, action),
        sql`${licenseAuditLogTable.metadata}->>'bucket' = ${bucket}`,
        sql`${licenseAuditLogTable.metadata}->>'trialEndsAt' = ${isoEnd}`,
      ))
      .limit(1),
    { label: "trial-warning:already-notified" },
  );
  return Boolean(hit);
}

export async function tick() {
  try {
    const rows = await withDbRetry(
      () => db
        .select({
          id: organisationsTable.id,
          name: organisationsTable.name,
          email: organisationsTable.email,
          actif: organisationsTable.actif,
          plan: subscriptionsTable.plan,
          status: subscriptionsTable.status,
          trialEndsAt: subscriptionsTable.trialEndsAt,
        })
        .from(organisationsTable)
        .innerJoin(subscriptionsTable, eq(subscriptionsTable.organisationId, organisationsTable.id))
        .where(and(eq(organisationsTable.actif, true), eq(subscriptionsTable.plan, "essai"))),
      { label: "trial-warning:trial-orgs" },
    );

    const now = Date.now();
    for (const row of rows) {
      if (!row.trialEndsAt) continue;
      if (row.status === "annulee" || row.status === "cancelled" || row.status === "suspended") continue;

      const endsAt = new Date(row.trialEndsAt);
      const hoursLeft = (endsAt.getTime() - now) / 3600000;
      const daysLeft = Math.ceil(hoursLeft / 24);

      const bucket = bucketPourHeures(hoursLeft);
      if (!bucket) continue;

      // Verrou par organisation.
      //
      // La deduplication est un SELECT (`alreadyNotified`) suivi d'une
      // ecriture — non atomique. Cloud Run demarre jusqu'a trois instances,
      // qui portent toutes ce cron: deux d'entre elles pouvaient constater
      // « pas encore notifie » avant que l'une n'ecrive, et le client recevait
      // deux fois le meme avertissement. C'est le motif meme pour lequel
      // `withCronLock` existe dans ce depot.
      await withCronLock(CRON_LOCK_NAMESPACE.trialWarning, row.id, async () => {
        if (await alreadyNotified(row.id, bucket, endsAt)) return;

        // L'ENVOI D'ABORD, LA TRACE ENSUITE.
        //
        // Mesure du 18/09: la trace etait ecrite avant l'envoi, et la
        // deduplication porte sur (bucket, trialEndsAt) — donc definitive. Un
        // envoi echoue (SMTP indisponible, adresse temporairement refusee)
        // etait memorise comme « notifie »: les trois cycles suivants de la
        // fenetre se sautaient, et le client perdait l'ecriture sans avoir
        // jamais ete prevenu. La panne ne laissait qu'un `logger.warn` que
        // personne ne relit.
        //
        // Dans cet ordre, le risque s'inverse: un arret du processus entre
        // l'envoi et la trace fait repartir un second email six heures plus
        // tard. Un avertissement recu deux fois se comprend; un avertissement
        // jamais recu se plaide.
        if (row.email) {
          const result = await sendTrialEndingEmail({
            to: row.email,
            orgName: row.name,
            daysLeft: Math.max(0, daysLeft),
            trialEndsAt: endsAt,
            expired: bucket === "T-0",
          });
          if (!result.success) {
            logger.warn({ orgId: row.id, bucket, err: result.error }, "[trial-warning] envoi echoue: on retentera au prochain cycle");
            return;
          }
        }

        const meta = { bucket, daysLeft, trialEndsAt: endsAt.toISOString() };
        if (bucket === "T-0") {
          await logLicenseEvent(row.id, "trial_expired", `Periode d'essai expiree (notification automatique)`, { metadata: meta });
        } else {
          await logLicenseEvent(row.id, "trial_ending_warning", `Avertissement trial: ${daysLeft} jour(s) restant(s)`, { metadata: meta });
        }
        logger.info({ orgId: row.id, bucket, daysLeft }, "[trial-warning] notification");
      });
    }
  } catch (err) {
    logger.error({ err }, "[trial-warning] tick failed");
  }
}

export function startTrialWarningCron(): void {
  if (timer) return;
  setTimeout(() => { void tick(); }, 90 * 1000);
  timer = setInterval(withHeartbeat("trial-warning", 6 * 60 * 60 * 1000, tick), 6 * 60 * 60 * 1000);
  logger.info("[trial-warning] cron demarre — verification toutes les 6h, dedupe persistante par bucket+trialEndsAt");
}

export function stopTrialWarningCron(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
