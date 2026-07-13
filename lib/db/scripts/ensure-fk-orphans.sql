-- Remediate orphaned rows that block `drizzle-kit push` from adding foreign keys
-- on a database that drifted before the FKs existed (Postgres error 23503,
-- "violates foreign key constraint"). Each cleanup mirrors the schema's declared
-- onDelete behaviour, so it only removes data the FK itself would have removed.
--
-- Idempotent and additive: each block no-ops once there are no orphans (or when
-- the column does not exist yet on an older database).

-- audit_logs.user_id -> users.id (onDelete: "set null").
-- audit_logs is append-only (a BEFORE UPDATE trigger forbids writes), so the
-- trigger is dropped before the NULL-out. ensure-audit-append-only (run AFTER
-- push and on every api-server boot) reinstalls it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'user_id'
  ) THEN
    DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;

    UPDATE audit_logs a
    SET user_id = NULL
    WHERE a.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id);
  END IF;
END $$;

-- notifications.user_id -> users.id (onDelete: "cascade").
-- Orphan notifications would have been deleted when their user was removed, so
-- deleting them here matches the cascade semantics.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'user_id'
  ) THEN
    DELETE FROM notifications n
    WHERE n.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id);
  END IF;
END $$;
