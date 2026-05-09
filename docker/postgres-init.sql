-- Agent de Bureau — PostgreSQL initialization
-- This runs once on first container start. Drizzle migrations handle schema.
-- Just set up extensions and sensible defaults here.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

ALTER DATABASE agentdebureau SET timezone TO 'UTC';
