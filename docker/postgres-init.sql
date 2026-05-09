-- Agent de Bureau — PostgreSQL initialization
-- This runs once on first container start. Drizzle migrations handle schema.
-- Just set up extensions and sensible defaults here.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Immutable wrapper around unaccent() so it can be used inside expression
-- indexes (e.g. `gin (f_unaccent(col) gin_trgm_ops)`). The built-in
-- unaccent() is STABLE because the dictionary can change at runtime.
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

ALTER DATABASE agentdebureau SET timezone TO 'UTC';
