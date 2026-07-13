-- Ensure extensions and helper function used by accent-insensitive trigram
-- search indexes (Commandant chat retrieval, smart search, …).
--
-- This script is idempotent and is executed before `drizzle-kit push` so the
-- generated `gin (f_unaccent(col) gin_trgm_ops)` indexes can be created.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Postgres' built-in `unaccent()` is STABLE (the dictionary it loads can
-- change), so it cannot be used directly inside an expression index. Wrap it
-- in an IMMUTABLE SQL function so we can index `f_unaccent(col)` and have the
-- planner reuse the index for `f_unaccent(col) ILIKE …` predicates.
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
