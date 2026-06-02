-- Remediate orphaned automation_logs rows before `drizzle-kit push` applies
-- the automation_logs_rule_id_automation_rules_id_fk foreign key.
--
-- System-level logs (the "Protection des donnees" data-protection monitor and
-- the generic automation-engine logAutomationRun helper) historically wrote
-- rule_id = 0, a sentinel that points to no real automation rule. Those rows
-- violate the foreign key on automation_logs.rule_id and block the constraint
-- from being created (Postgres error 23503), which would fail a fresh
-- `pnpm db:push` / deploy migration.
--
-- This script is idempotent and is executed before `drizzle-kit push`:
--   1. Make rule_id nullable so the sentinels can be cleared even on a DB that
--      still has the old NOT NULL constraint.
--   2. Null out any row whose rule_id does not reference an existing rule
--      (covers the rule_id = 0 sentinels and any other orphans).
-- The matching schema (lib/db/src/schema/automations.ts) keeps the FK with a
-- nullable rule_id, so drizzle-kit push can then add the constraint cleanly.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'automation_logs' AND column_name = 'rule_id'
  ) THEN
    ALTER TABLE automation_logs ALTER COLUMN rule_id DROP NOT NULL;

    UPDATE automation_logs al
    SET rule_id = NULL
    WHERE al.rule_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM automation_rules ar WHERE ar.id = al.rule_id
      );
  END IF;
END $$;
