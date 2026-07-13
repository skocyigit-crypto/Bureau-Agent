import { db, licenseAuditLogTable } from "@workspace/db";
import { logger } from "../lib/logger";

export type LicenseAuditAction =
  | "subscription_created"
  | "trial_started"
  | "trial_ending_warning"
  | "trial_expired"
  | "plan_upgraded"
  | "plan_downgraded"
  | "subscription_suspended"
  | "subscription_reactivated"
  | "payment_failed"
  | "payment_recovered"
  | "subscription_cancelled"
  | "license_key_regenerated"
  | "trial_extended_by_admin"
  | "manual_suspended_by_admin"
  | "manual_reactivated_by_admin"
  | "downgrade_quota_breach"
  | "invoice_generated"
  | "invoice_email_sent"
  | "payment_reminder_sent"
  | "payment_recorded"
  | "client_invoice_created"
  | "invoice_marked_paid"
  | "auto_reminders_run"
  | "billing_settings_updated";

export async function logLicenseEvent(
  orgId: number | null,
  action: LicenseAuditAction | string,
  details: string,
  options?: { performedBy?: number | null; ipAddress?: string | null; metadata?: Record<string, unknown> | null },
): Promise<void> {
  try {
    await db.insert(licenseAuditLogTable).values({
      organisationId: orgId,
      action,
      details,
      performedBy: options?.performedBy ?? null,
      ipAddress: options?.ipAddress ?? null,
      metadata: (options?.metadata as Record<string, any> | null) ?? null,
    });
  } catch (err) {
    logger.error({ err, orgId, action }, "[license-audit] insert failed");
  }
}
