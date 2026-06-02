-- Reconcile legacy unique-constraint names so `drizzle-kit push` does NOT try to
-- DROP + ADD them (an ADD of a UNIQUE constraint on a populated table triggers an
-- interactive "truncate?" prompt that a non-TTY push silently aborts on).
--
-- Older databases name their column-unique constraints with Postgres' default
-- `<table>_<col>_key` suffix, while current Drizzle expects `<table>_<col>_unique`.
-- drizzle-kit keys its diff on the constraint NAME, so it sees the `_key` one as
-- "extra" (drop) and the `_unique` one as "missing" (add → truncate prompt).
-- Renaming the existing constraint to Drizzle's expected name makes the diff a
-- no-op: no drop, no add, no prompt, and zero data movement.
--
-- Generic and idempotent: once a constraint is `_unique` it no longer matches.
--   * Only unique constraints (contype = 'u'); primary keys (`_pkey`) are skipped.
--   * `user_sessions` is intentionally excluded (owned by connect-pg-simple, kept
--     out of the Drizzle schema — see drizzle.config.ts tablesFilter).
--   * Renames are skipped if the target `_unique` name already exists.
-- A `_key` constraint that the schema no longer declares is harmless to rename:
-- drizzle-kit will simply DROP it (a DROP never prompts for truncation).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      con.conname                                   AS oldname,
      regexp_replace(con.conname, '_key$', '_unique') AS newname,
      nsp.nspname                                   AS schemaname,
      rel.relname                                   AS tablename
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'u'
      AND con.conname LIKE '%\_key'
      AND nsp.nspname = 'public'
      AND rel.relname <> 'user_sessions'
  LOOP
    IF r.newname <> r.oldname
       AND NOT EXISTS (
         SELECT 1
         FROM pg_constraint c2
         JOIN pg_class rel2 ON rel2.oid = c2.conrelid
         WHERE c2.conname = r.newname
           AND rel2.relname = r.tablename
       )
    THEN
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
        r.schemaname, r.tablename, r.oldname, r.newname
      );
      RAISE NOTICE 'renamed % -> % on %', r.oldname, r.newname, r.tablename;
    END IF;
  END LOOP;
END $$;
