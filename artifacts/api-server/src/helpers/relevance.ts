import { stripAccents } from "./accent-search";

/**
 * Shared relevance-ranking primitives for the assistant's name -> id resolver
 * tools (find_contact, find_task, find_event, find_recent_call).
 *
 * These tools turn a spoken name ("reporte la reunion cuisine", "le numero
 * d'Ali Yilmaz") into a DB id before any write. They must rank candidates the
 * same way everywhere: exact > prefix > substring, with phone-digit matching
 * and a recency tiebreak. Defining the scoring constants, the normalisation and
 * the sort pipeline once keeps the four tools from drifting apart.
 */

/**
 * Canonical relevance tiers, highest first. Every resolver tool scores its
 * fields against these so a tweak here applies consistently across all tools.
 */
export const RELEVANCE = {
  /** Whole-field exact match (full name, title, contact name). */
  EXACT: 100,
  /** Phone number matches the queried digits exactly. */
  PHONE_EXACT: 98,
  /** A single identifying field matches exactly (first/last name, email). */
  FIELD_EXACT: 95,
  /** Secondary identifying field matches exactly (company). */
  COMPANY_EXACT: 85,
  /** Phone number contains the queried digits. */
  PHONE_PARTIAL: 75,
  /** Primary field starts with the query (first/last name, title). */
  PREFIX: 70,
  /** Composite field starts with the query (full name, company). */
  FULL_PREFIX: 60,
  /** Primary field contains the query (title, contact name). */
  SUBSTRING: 50,
  /** Secondary field contains the query (full name, company, email, location). */
  FIELD_SUBSTRING: 40,
  /** Descriptive field contains the query (description). */
  DESC_SUBSTRING: 30,
} as const;

/** Minimum query length (in digits) before phone matching kicks in. */
const MIN_PHONE_DIGITS = 3;

/**
 * Normalise a value for accent-insensitive, case-insensitive comparison:
 * "Léveque" -> "leveque". Used on every candidate field.
 */
export function normText(s: unknown): string {
  return stripAccents(String(s ?? "")).toLowerCase().trim();
}

/** Keep only the digits of a value (for phone-number matching). */
export function digitsOnly(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

export interface NormalisedQuery {
  /** Accent-stripped, lowercased query text. */
  nq: string;
  /** Digit-only form of the query (for phone matching). */
  nqDigits: string;
}

/** Pre-compute the normalised forms of a raw query once per search. */
export function prepareQuery(query: string): NormalisedQuery {
  return { nq: stripAccents(query).toLowerCase(), nqDigits: digitsOnly(query) };
}

/**
 * Score a phone number against the queried digits. Returns 0 when the query is
 * too short to be a phone number or there is no match, so callers can fold it
 * into a Math.max() chain.
 */
export function scorePhoneMatch(phone: unknown, nqDigits: string): number {
  if (nqDigits.length < MIN_PHONE_DIGITS) return 0;
  const phoneDigits = digitsOnly(phone);
  if (!phoneDigits) return 0;
  if (phoneDigits === nqDigits) return RELEVANCE.PHONE_EXACT;
  if (phoneDigits.includes(nqDigits)) return RELEVANCE.PHONE_PARTIAL;
  return 0;
}

/** Tiebreak comparator: most recently created row first. */
export function byCreatedAtDesc(a: { createdAt: Date }, b: { createdAt: Date }): number {
  return b.createdAt.getTime() - a.createdAt.getTime();
}

/**
 * Fields a project/chantier row exposes to the relevance scorer. Values are
 * normalised internally, so callers pass the raw DB values.
 */
export interface ProjectFields {
  title: unknown;
  clientName: unknown;
  clientCompany: unknown;
  address: unknown;
  description: unknown;
}

/**
 * Score a project/chantier row for the find_project resolver tool, using the
 * shared RELEVANCE tiers so project search ranks the same way as the other
 * name -> id tools:
 *   - title exact / prefix / substring -> EXACT / PREFIX / SUBSTRING
 *   - client name, client company or address contains the query -> FIELD_SUBSTRING
 *   - description contains the query -> DESC_SUBSTRING
 * Returns 0 when nothing matches.
 */
export function scoreProjectFields(fields: ProjectFields, nq: string): number {
  const title = normText(fields.title);
  const client = normText(fields.clientName);
  const company = normText(fields.clientCompany);
  const addr = normText(fields.address);
  const desc = normText(fields.description);
  let score = 0;
  if (title === nq) score = Math.max(score, RELEVANCE.EXACT);
  if (title.startsWith(nq)) score = Math.max(score, RELEVANCE.PREFIX);
  if (title.includes(nq)) score = Math.max(score, RELEVANCE.SUBSTRING);
  if (client.includes(nq) || company.includes(nq) || addr.includes(nq))
    score = Math.max(score, RELEVANCE.FIELD_SUBSTRING);
  if (desc.includes(nq)) score = Math.max(score, RELEVANCE.DESC_SUBSTRING);
  return score;
}

export interface RankOptions<T> {
  /** Maximum number of ranked rows to return. */
  limit: number;
  /**
   * Tiebreak applied when two rows have equal scores. Defaults to most-recent
   * first (`byCreatedAtDesc`), which requires rows to carry a `createdAt`.
   */
  tiebreak?: (a: T, b: T) => number;
}

/**
 * Rank rows by a per-tool score function, breaking ties with `tiebreak`
 * (recency by default), then keep the top `limit`. Returns each surviving row
 * paired with its score so callers can expose it as `pertinence`.
 */
export function rankByRelevance<T>(
  rows: T[],
  score: (row: T) => number,
  opts: RankOptions<T>,
): Array<{ row: T; score: number }> {
  const tiebreak =
    opts.tiebreak ?? (byCreatedAtDesc as unknown as (a: T, b: T) => number);
  return rows
    .map((row) => ({ row, score: score(row) }))
    .sort((x, y) => y.score - x.score || tiebreak(x.row, y.row))
    .slice(0, opts.limit);
}
