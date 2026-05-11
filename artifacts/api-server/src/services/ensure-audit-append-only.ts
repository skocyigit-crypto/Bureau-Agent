import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

// Defense in depth: enforce append-only semantics on audit tables at the
// database layer. Even an accidental `db.update(auditLogsTable)…` or a
// compromised app role with broad table privileges cannot tamper with the
// audit trail.
//
// Source of truth for this SQL lives at
//   lib/db/scripts/ensure-audit-append-only.sql
// Kept in sync manually — both run the same idempotent statements. The .sql
// file runs as part of `pnpm --filter @workspace/db push`; this TS service
// runs on every api-server boot so dev/staging/prod cannot drift.
const ENSURE_AUDIT_APPEND_ONLY_SQL = `
CREATE OR REPLACE FUNCTION audit_log_append_only_guard()
  RETURNS trigger
  LANGUAGE plpgsql
AS $func$
BEGIN
  RAISE EXCEPTION
    'audit log is append-only: % on table % is forbidden',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$func$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'audit_logs') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs';
    EXECUTE 'DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs';
    EXECUTE
      'CREATE TRIGGER audit_logs_no_update
         BEFORE UPDATE ON audit_logs
         FOR EACH ROW EXECUTE FUNCTION audit_log_append_only_guard()';
    EXECUTE
      'CREATE TRIGGER audit_logs_no_delete
         BEFORE DELETE ON audit_logs
         FOR EACH ROW EXECUTE FUNCTION audit_log_append_only_guard()';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'license_audit_log') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS license_audit_log_no_update ON license_audit_log';
    EXECUTE 'DROP TRIGGER IF EXISTS license_audit_log_no_delete ON license_audit_log';
    EXECUTE
      'CREATE TRIGGER license_audit_log_no_update
         BEFORE UPDATE ON license_audit_log
         FOR EACH ROW EXECUTE FUNCTION audit_log_append_only_guard()';
    EXECUTE
      'CREATE TRIGGER license_audit_log_no_delete
         BEFORE DELETE ON license_audit_log
         FOR EACH ROW EXECUTE FUNCTION audit_log_append_only_guard()';
  END IF;
END;
$do$;
`;

export async function ensureAuditAppendOnly(): Promise<void> {
  try {
    await db.execute(sql.raw(ENSURE_AUDIT_APPEND_ONLY_SQL));
    logger.info("[audit] append-only triggers installed on audit_logs + license_audit_log");
  } catch (err) {
    // Ne pas tuer le serveur — on log, l'app reste fonctionnelle. Le garde
    // applicatif (aucun update/delete dans le code) reste actif.
    logger.error({ err }, "[audit] failed to install append-only triggers — continuing without DB-level guard");
  }
}
