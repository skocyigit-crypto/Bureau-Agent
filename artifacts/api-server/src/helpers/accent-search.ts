import { db } from "@workspace/db";
import { ilike, sql, type Column, type SQL } from "drizzle-orm";

// Strip diacritics (NFD + remove combining marks) so "impayées" -> "impayees".
// Used both for in-memory normalisation and when building DB patterns paired
// with unaccent() so accent-stripped keywords still match accented rows.
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Lazily detect whether the Postgres `unaccent` extension AND the immutable
// `f_unaccent()` wrapper are available so that list/search queries can match
// accented DB rows ("impayée") from accent-stripped keywords ("impaye"). The
// wrapper is what lets the GIN trigram expression indexes
// (`gin (f_unaccent(col) gin_trgm_ops)`) be picked up by the planner. We try
// to install both once; if that fails (insufficient privileges, hosted DB
// without the extension), we fall back to plain ILIKE matching.
let unaccentAvailable: boolean | null = null;
export async function ensureUnaccentExtension(): Promise<boolean> {
  if (unaccentAvailable !== null) return unaccentAvailable;
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await db.execute(sql.raw(
      `CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text ` +
      `LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT ` +
      `AS $$ SELECT public.unaccent('public.unaccent', $1) $$`
    ));
    unaccentAvailable = true;
  } catch {
    try {
      const r = await db.execute<{ exists: number }>(sql`
        SELECT 1 AS exists
        FROM pg_extension e
        JOIN pg_proc p ON p.proname = 'f_unaccent'
        WHERE e.extname = 'unaccent'
        LIMIT 1
      `);
      unaccentAvailable = r.rows.length > 0;
    } catch {
      unaccentAvailable = false;
    }
  }
  return unaccentAvailable;
}

// Builds an accent-insensitive ILIKE condition. When the unaccent extension
// is installed both sides are wrapped in f_unaccent() (an IMMUTABLE wrapper
// around unaccent()) so the planner can use the GIN trigram expression
// indexes declared in the schema. Otherwise we fall back to a plain ILIKE on
// the accent-stripped pattern.
export function accentInsensitiveIlike(
  column: Column,
  pattern: string,
  useUnaccent: boolean,
): SQL {
  if (useUnaccent) {
    return sql`f_unaccent(${column}) ILIKE f_unaccent(${pattern})`;
  }
  return ilike(column, stripAccents(pattern));
}
