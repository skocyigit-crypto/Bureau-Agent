import { db, organisationsTable, subscriptionsTable, licenseAuditLogTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { sendTrialEndingEmail } from "./email";
import { logLicenseEvent } from "./license-audit";
import { logger } from "../lib/logger";

let timer: NodeJS.Timeout | null = null;
type Bucket = "T-3" | "T-1" | "T-0";

async function alreadyNotified(orgId: number, bucket: Bucket, trialEndsAt: Date): Promise<boolean> {
  const action = bucket === "T-0" ? "trial_expired" : "trial_ending_warning";
  const isoEnd = trialEndsAt.toISOString();
  const [hit] = await db
    .select({ id: licenseAuditLogTable.id })
    .from(licenseAuditLogTable)
    .where(and(
      eq(licenseAuditLogTable.organisationId, orgId),
      eq(licenseAuditLogTable.action, action),
      sql`${licenseAuditLogTable.metadata}->>'bucket' = ${bucket}`,
      sql`${licenseAuditLogTable.metadata}->>'trialEndsAt' = ${isoEnd}`,
    ))
    .limit(1);
  return Boolean(hit);
}

async function tick() {
  try {
    const rows = await db
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
      .where(and(eq(organisationsTable.actif, true), eq(subscriptionsTable.plan, "essai")));

    const now = Date.now();
    for (const row of rows) {
      if (!row.trialEndsAt) continue;
      if (row.status === "annulee" || row.status === "cancelled" || row.status === "suspended") continue;

      const endsAt = new Date(row.trialEndsAt);
      const hoursLeft = (endsAt.getTime() - now) / 3600000;
      const daysLeft = Math.ceil(hoursLeft / 24);

      let bucket: Bucket | null = null;
      if (hoursLeft <= 0 && hoursLeft > -24) bucket = "T-0";
      else if (hoursLeft > 0 && hoursLeft <= 24) bucket = "T-1";
      else if (hoursLeft > 24 && hoursLeft <= 72) bucket = "T-3";
      if (!bucket) continue;

      if (await alreadyNotified(row.id, bucket, endsAt)) continue;

      const meta = { bucket, daysLeft, trialEndsAt: endsAt.toISOString() };
      if (bucket === "T-0") {
        await logLicenseEvent(row.id, "trial_expired", `Periode d'essai expiree (notification automatique)`, { metadata: meta });
      } else {
        await logLicenseEvent(row.id, "trial_ending_warning", `Avertissement trial: ${daysLeft} jour(s) restant(s)`, { metadata: meta });
      }

      if (row.email) {
        const result = await sendTrialEndingEmail({
          to: row.email,
          orgName: row.name,
          daysLeft: Math.max(0, daysLeft),
          trialEndsAt: endsAt,
          expired: bucket === "T-0",
        });
        if (!result.success) {
          logger.warn({ orgId: row.id, err: result.error }, "[trial-warning] envoi email echoue");
        }
      }
      logger.info({ orgId: row.id, bucket, daysLeft }, "[trial-warning] notification");
    }
  } catch (err) {
    logger.error({ err }, "[trial-warning] tick failed");
  }
}

export function startTrialWarningCron(): void {
  if (timer) return;
  setTimeout(() => { void tick(); }, 90 * 1000);
  timer = setInterval(() => { void tick(); }, 6 * 60 * 60 * 1000);
  logger.info("[trial-warning] cron demarre — verification toutes les 6h, dedupe persistante par bucket+trialEndsAt");
}

export function stopTrialWarningCron(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
