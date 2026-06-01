// Service des listes personnalisees de securite (domaines + telephones) par
// organisation. Persiste en base (table security_lists) et expose des
// verifications rapides avec un cache memoire court par org pour ne pas frapper
// la DB a chaque scan d'URL / appel entrant.

import { and, eq } from "drizzle-orm";
import { db, securityListsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import type { UrlScanResult } from "./url-safety";

export type ListEntryType = "domain" | "phone";
export type ListKind = "block" | "allow";

export interface SecurityListItem {
  id: number;
  entryType: ListEntryType;
  listKind: ListKind;
  value: string;
  note: string | null;
  createdAt: string;
}

/** Reduit une saisie quelconque (URL, sous-domaine, www...) au hostname nu. */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // retire le schema
  s = s.split("/")[0] ?? s; // retire le chemin
  s = s.split("?")[0] ?? s; // retire la query
  s = s.split("@").pop() ?? s; // retire userinfo
  s = s.split(":")[0] ?? s; // retire le port
  s = s.replace(/^www\./, "");
  return s;
}

/** Normalise un numero en E.164 (heuristique FR pour les numeros locaux). */
export function normalizePhone(input: string): string {
  const cleaned = input.replace(/[^0-9+]/g, "");
  if (!cleaned) return input.trim();
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("0") && cleaned.length === 10) return "+33" + cleaned.slice(1);
  return "+" + cleaned;
}

function normalizeValue(entryType: ListEntryType, value: string): string {
  return entryType === "domain" ? normalizeDomain(value) : normalizePhone(value);
}

// Domaine valide: au moins un point, labels alphanumeriques (tirets internes).
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// Numero E.164: + suivi de 7 a 15 chiffres, premier chiffre non nul.
const E164_RE = /^\+[1-9]\d{6,14}$/;

/** Valide une valeur deja normalisee; rejette les saisies qui ne matcheront jamais. */
function isValidNormalizedValue(entryType: ListEntryType, value: string): boolean {
  return entryType === "domain" ? DOMAIN_RE.test(value) : E164_RE.test(value);
}

// ── Cache memoire court par org ───────────────────────────────────────────────
interface OrgListCache {
  at: number;
  domains: Map<string, ListKind>;
  phones: Map<string, ListKind>;
}
const CACHE_TTL_MS = 60_000;
const cache = new Map<number, OrgListCache>();

function invalidate(orgId: number): void {
  cache.delete(orgId);
}

async function loadOrgLists(orgId: number): Promise<OrgListCache> {
  const cached = cache.get(orgId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  const domains = new Map<string, ListKind>();
  const phones = new Map<string, ListKind>();
  try {
    const rows = await db
      .select()
      .from(securityListsTable)
      .where(eq(securityListsTable.organisationId, orgId));
    for (const r of rows) {
      const kind = r.listKind as ListKind;
      if (r.entryType === "domain") domains.set(r.value, kind);
      else if (r.entryType === "phone") phones.set(r.value, kind);
    }
  } catch (err) {
    // Fail-safe: ne JAMAIS mettre en cache une liste vide sur erreur DB, sinon
    // les regles de blocage seraient ignorees pendant tout le TTL (fail-open).
    // On reutilise le dernier cache valide s'il existe, sinon on renvoie un
    // resultat transitoire NON mis en cache (la prochaine requete reessaiera).
    logger.warn({ err, orgId }, "[security-lists] chargement liste echoue");
    if (cached) return cached;
    return { at: 0, domains, phones };
  }
  const entry: OrgListCache = { at: Date.now(), domains, phones };
  cache.set(orgId, entry);
  return entry;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function listSecurityEntries(orgId: number): Promise<SecurityListItem[]> {
  const rows = await db
    .select()
    .from(securityListsTable)
    .where(eq(securityListsTable.organisationId, orgId));
  return rows
    .map((r) => ({
      id: r.id,
      entryType: r.entryType as ListEntryType,
      listKind: r.listKind as ListKind,
      value: r.value,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addSecurityEntry(input: {
  orgId: number;
  userId: number | null;
  entryType: ListEntryType;
  listKind: ListKind;
  value: string;
  note: string | null;
}): Promise<SecurityListItem> {
  const value = normalizeValue(input.entryType, input.value);
  if (!value || !isValidNormalizedValue(input.entryType, value)) {
    throw new Error("invalid_value");
  }
  const [row] = await db
    .insert(securityListsTable)
    .values({
      organisationId: input.orgId,
      entryType: input.entryType,
      listKind: input.listKind,
      value,
      note: input.note,
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [
        securityListsTable.organisationId,
        securityListsTable.entryType,
        securityListsTable.value,
      ],
      set: { listKind: input.listKind, note: input.note },
    })
    .returning();
  invalidate(input.orgId);
  return {
    id: row.id,
    entryType: row.entryType as ListEntryType,
    listKind: row.listKind as ListKind,
    value: row.value,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function removeSecurityEntry(orgId: number, id: number): Promise<boolean> {
  const res = await db
    .delete(securityListsTable)
    .where(and(eq(securityListsTable.id, id), eq(securityListsTable.organisationId, orgId)))
    .returning({ id: securityListsTable.id });
  invalidate(orgId);
  return res.length > 0;
}

// ── Verifications (utilisees par les scanners) ────────────────────────────────
/** Verdict de liste pour un domaine, en remontant aux domaines parents. */
export async function checkDomainList(orgId: number, domain: string): Promise<ListKind | null> {
  if (!domain) return null;
  const norm = normalizeDomain(domain);
  const { domains } = await loadOrgLists(orgId);
  if (domains.has(norm)) return domains.get(norm) ?? null;
  const parts = norm.split(".");
  // sub.exemple.com doit aussi correspondre a une regle sur exemple.com.
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (domains.has(parent)) return domains.get(parent) ?? null;
  }
  return null;
}

export async function checkPhoneList(orgId: number, phone: string): Promise<ListKind | null> {
  const norm = normalizePhone(phone);
  const { phones } = await loadOrgLists(orgId);
  return phones.get(norm) ?? null;
}

/** Applique le verdict de liste personnalisee a un resultat d'analyse d'URL. */
export async function applyDomainListToUrl(
  orgId: number,
  result: UrlScanResult,
): Promise<UrlScanResult> {
  const verdict = await checkDomainList(orgId, result.domain);
  if (verdict === "block") {
    return {
      ...result,
      risk: "dangerous",
      reasons: ["Bloque par votre liste personnalisee", ...result.reasons],
    };
  }
  if (verdict === "allow") {
    return {
      ...result,
      risk: "safe",
      reasons: ["Autorise par votre liste personnalisee"],
    };
  }
  return result;
}
