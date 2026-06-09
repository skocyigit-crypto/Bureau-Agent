import { RELEVANCE, normText, scorePhoneMatch, type NormalisedQuery } from "./relevance";

/**
 * Per-tool relevance scorers for the assistant's name -> id resolver tools.
 *
 * `helpers/relevance.ts` owns the shared primitives (tiers, normalisation, the
 * sort pipeline). Each resolver tool layers its OWN field-to-tier mapping on
 * top: which fields count as EXACT vs PREFIX vs SUBSTRING, how the phone digits
 * fold in, and the Math.max() collapse of the per-field scores. A wrong mapping
 * in one tool would still pass the shared-helper tests yet resolve the wrong
 * record before a write, so each scorer lives here as an exported pure function
 * that can be unit-tested in isolation.
 *
 * Every scorer takes an already-normalised query (`prepareQuery(...)`) so the
 * accent/case folding happens once per search, exactly as the live tools do.
 */

/** Subset of contact columns the find_contact scorer reads. */
export interface ContactScoreRow {
  firstName: unknown;
  lastName: unknown;
  company: unknown;
  email: unknown;
  phone: unknown;
}

/**
 * Score a contact row. Mirrors find_contact: full name (either order) is EXACT,
 * a single identifying field (first/last/email) is FIELD_EXACT, company is
 * COMPANY_EXACT, name prefixes beat full-name/company prefixes, phone digits
 * fold in via scorePhoneMatch, and any substring hit lands at FIELD_SUBSTRING.
 */
export function scoreContact(r: ContactScoreRow, q: NormalisedQuery): number {
  const { nq, nqDigits } = q;
  const first = normText(r.firstName);
  const last = normText(r.lastName);
  const full = `${first} ${last}`.trim();
  const company = normText(r.company);
  const email = normText(r.email);
  let score = 0;
  if (full === nq || `${last} ${first}`.trim() === nq) score = Math.max(score, RELEVANCE.EXACT);
  if (first === nq || last === nq || email === nq) score = Math.max(score, RELEVANCE.FIELD_EXACT);
  if (company === nq) score = Math.max(score, RELEVANCE.COMPANY_EXACT);
  if (first.startsWith(nq) || last.startsWith(nq)) score = Math.max(score, RELEVANCE.PREFIX);
  if (full.startsWith(nq) || company.startsWith(nq)) score = Math.max(score, RELEVANCE.FULL_PREFIX);
  score = Math.max(score, scorePhoneMatch(r.phone, nqDigits));
  if (full.includes(nq) || company.includes(nq) || email.includes(nq)) score = Math.max(score, RELEVANCE.FIELD_SUBSTRING);
  return score;
}

/** Subset of task columns the find_task scorer reads. */
export interface TaskScoreRow {
  title: unknown;
  description: unknown;
}

/**
 * Score a task row. Mirrors find_task: title exact > title prefix > title
 * substring, with a description substring at the lowest DESC_SUBSTRING tier.
 */
export function scoreTask(r: TaskScoreRow, q: NormalisedQuery): number {
  const { nq } = q;
  const title = normText(r.title);
  const desc = normText(r.description);
  let score = 0;
  if (title === nq) score = Math.max(score, RELEVANCE.EXACT);
  if (title.startsWith(nq)) score = Math.max(score, RELEVANCE.PREFIX);
  if (title.includes(nq)) score = Math.max(score, RELEVANCE.SUBSTRING);
  if (desc.includes(nq)) score = Math.max(score, RELEVANCE.DESC_SUBSTRING);
  return score;
}

/** Subset of calendar-event columns the find_event scorer reads. */
export interface EventScoreRow {
  title: unknown;
  description: unknown;
  location: unknown;
}

/**
 * Score a calendar-event row. Mirrors find_event: title exact > prefix >
 * substring, then a location substring at FIELD_SUBSTRING and a description
 * substring at DESC_SUBSTRING.
 */
export function scoreEvent(r: EventScoreRow, q: NormalisedQuery): number {
  const { nq } = q;
  const title = normText(r.title);
  const desc = normText(r.description);
  const loc = normText(r.location);
  let score = 0;
  if (title === nq) score = Math.max(score, RELEVANCE.EXACT);
  if (title.startsWith(nq)) score = Math.max(score, RELEVANCE.PREFIX);
  if (title.includes(nq)) score = Math.max(score, RELEVANCE.SUBSTRING);
  if (loc.includes(nq)) score = Math.max(score, RELEVANCE.FIELD_SUBSTRING);
  if (desc.includes(nq)) score = Math.max(score, RELEVANCE.DESC_SUBSTRING);
  return score;
}

/** Subset of call columns the find_recent_call scorer reads. */
export interface CallScoreRow {
  contactName: unknown;
  phoneNumber: unknown;
}

/**
 * Score a call row. Mirrors find_recent_call: contact name exact > prefix >
 * substring (only when a name is present), with phone digits folded in via
 * scorePhoneMatch so a digit query can win on PHONE_EXACT/PHONE_PARTIAL.
 */
export function scoreCall(r: CallScoreRow, q: NormalisedQuery): number {
  const { nq, nqDigits } = q;
  const name = normText(r.contactName);
  let score = 0;
  if (name && name === nq) score = Math.max(score, RELEVANCE.EXACT);
  if (name && name.startsWith(nq)) score = Math.max(score, RELEVANCE.PREFIX);
  if (name && name.includes(nq)) score = Math.max(score, RELEVANCE.SUBSTRING);
  score = Math.max(score, scorePhoneMatch(r.phoneNumber, nqDigits));
  return score;
}

/**
 * Project-specific tiers. The client / company / address fields sit between the
 * title substring (SUBSTRING) and the description substring (DESC_SUBSTRING) and
 * are ordered client > company > address. They have no equivalent in the shared
 * RELEVANCE table, so they are named here to keep the ordering explicit.
 */
export const PROJECT_RELEVANCE = {
  TITLE_EXACT: RELEVANCE.EXACT,
  TITLE_PREFIX: RELEVANCE.PREFIX,
  TITLE_SUBSTRING: RELEVANCE.SUBSTRING,
  CLIENT_SUBSTRING: 45,
  COMPANY_SUBSTRING: 42,
  ADDRESS_SUBSTRING: 40,
  DESC_SUBSTRING: RELEVANCE.DESC_SUBSTRING,
} as const;

/** Subset of project columns the find_project scorer reads. */
export interface ProjectScoreRow {
  title: unknown;
  clientName: unknown;
  clientCompany: unknown;
  address: unknown;
  description: unknown;
}

/**
 * Score a project / chantier row. Mirrors find_project: title exact > prefix >
 * substring, then client > company > address substrings, with the description
 * substring at the lowest tier.
 */
export function scoreProject(r: ProjectScoreRow, q: NormalisedQuery): number {
  const { nq } = q;
  const title = normText(r.title);
  const client = normText(r.clientName);
  const company = normText(r.clientCompany);
  const addr = normText(r.address);
  const desc = normText(r.description);
  let score = 0;
  if (title === nq) score = Math.max(score, PROJECT_RELEVANCE.TITLE_EXACT);
  if (title.startsWith(nq)) score = Math.max(score, PROJECT_RELEVANCE.TITLE_PREFIX);
  if (title.includes(nq)) score = Math.max(score, PROJECT_RELEVANCE.TITLE_SUBSTRING);
  if (client.includes(nq)) score = Math.max(score, PROJECT_RELEVANCE.CLIENT_SUBSTRING);
  if (company.includes(nq)) score = Math.max(score, PROJECT_RELEVANCE.COMPANY_SUBSTRING);
  if (addr.includes(nq)) score = Math.max(score, PROJECT_RELEVANCE.ADDRESS_SUBSTRING);
  if (desc.includes(nq)) score = Math.max(score, PROJECT_RELEVANCE.DESC_SUBSTRING);
  return score;
}
