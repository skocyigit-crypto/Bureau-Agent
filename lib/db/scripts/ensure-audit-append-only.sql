-- Defense in depth: enforce append-only semantics on audit tables at the
-- database layer, not just the application layer. Even a developer who
-- accidentally writes `db.update(auditLogsTable)…` or a compromised app
-- role with broad table privileges cannot tamper with the audit trail.
--
-- Idempotent: safe to re-run on every `pnpm --filter @workspace/db push`
-- and on every api-server boot.

CREATE OR REPLACE FUNCTION audit_log_append_only_guard()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit log is append-only: % on table % is forbidden',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DO $$
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
$$;
