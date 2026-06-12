// Capture automatique des dépenses — couche client (Tâche #292).
//
// Tout justificatif entrant (upload UI ou pièce jointe Gmail) reconnu comme
// `facture` ou `note_frais` par Document IA est transformé en une ligne
// `depenses` au statut `en_attente` (file d'inspection), avec les champs
// préremplis (fournisseur, date, HT/TVA/TTC, référence) et une catégorie
// devinée par mots-clés. L'humain corrige puis approuve/rejette ensuite.
//
// Garde-fous :
//   - opt-in par organisation (`expenseAutoCaptureEnabled`, défaut true) ;
//   - seuls les types MIME susceptibles d'être des justificatifs déclenchent
//     une analyse IA (PDF, images, Excel, CSV) — pas les .docx/zip/etc. ;
//   - une seule dépense par `documentId` (idempotent : un double déclenchement
//     ne crée pas de doublon) ;
//   - tout est fire-and-forget : une erreur IA/quota n'impacte JAMAIS
//     l'ingestion du document.

import { db, depensesTable, organisationsTable, EXPENSE_CATEGORIES } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { analyzeDocument } from "./document-ai";
import { logger } from "../lib/logger";

// Types MIME pour lesquels une capture de dépense est tentée. Aligné sur les
// formats que Document IA sait lire pour un justificatif.
const EXPENSE_ELIGIBLE_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

// Mots-clés -> catégorie de dépense. Première correspondance gagne. Le test se
// fait sur fournisseur + titre + référence, en minuscules sans accents.
const CATEGORY_KEYWORDS: Array<[(typeof EXPENSE_CATEGORIES)[number], string[]]> = [
  ["carburant", ["carburant", "essence", "gazole", "diesel", "station", "total", "esso", "shell", "bp ", "carrefour carburant"]],
  ["entretien_vehicule", ["garage", "pneu", "vidange", "reparation vehicule", "controle technique", "norauto", "feu vert", "midas"]],
  ["sous_traitance", ["sous-traitance", "sous traitance", "prestation", "main d'oeuvre", "chantier"]],
  ["materiel", ["materiel", "outillage", "quincaillerie", "leroy merlin", "castorama", "brico", "point p", "bricoman"]],
  ["fournitures", ["fourniture", "papeterie", "bureau", "cartouche", "consommable"]],
  ["telephone_internet", ["telephone", "mobile", "internet", "orange", "sfr", "free", "bouygues", "forfait"]],
  ["loyer", ["loyer", "bail", "location locaux", "credit-bail immobilier"]],
  ["assurance", ["assurance", "mutuelle", "axa", "maaf", "groupama", "allianz", "macif"]],
  ["repas", ["restaurant", "repas", "traiteur", "dejeuner", "brasserie", "cafe"]],
  ["deplacement", ["sncf", "billet", "train", "avion", "hotel", "peage", "parking", "taxi", "uber", "vtc"]],
  ["honoraires", ["honoraires", "avocat", "comptable", "expert-comptable", "notaire", "conseil"]],
  ["taxes", ["urssaf", "impot", "taxe", "tva", "tresor public", "cotisation"]],
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function guessExpenseCategory(...parts: Array<string | null | undefined>): (typeof EXPENSE_CATEGORIES)[number] {
  const haystack = normalize(parts.filter(Boolean).join(" "));
  if (!haystack) return "autre";
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) return category;
  }
  return "autre";
}

/**
 * Empreinte de déduplication : normalize(vendor)|amountTtc(2 déc.)|YYYY-MM-DD.
 * Deux dépenses partageant cette empreinte sont des doublons présumés.
 */
export function computeDedupeHash(vendor: string, amountTtc: number, expenseDate: Date | null): string {
  const v = normalize(vendor).replace(/[^a-z0-9]/g, "");
  const amt = (Number.isFinite(amountTtc) ? amountTtc : 0).toFixed(2);
  const day = expenseDate ? expenseDate.toISOString().slice(0, 10) : "no-date";
  return `${v}|${amt}|${day}`;
}

/** Parse un montant qui peut arriver en string ("1 250,00 €") ou number. */
export function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  // Retire tout sauf chiffres, séparateurs et signe ; gère la virgule décimale.
  let s = raw.replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Format FR : virgule décimale, point séparateur de milliers.
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Format US/EN : point décimal, virgule séparateur de milliers.
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Parse une date ISO ou FR (JJ/MM/AAAA) en Date, ou null si illisible. */
export function parseDocumentDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const s = String(raw).trim();
  if (!s) return null;
  // JJ/MM/AAAA ou JJ-MM-AAAA
  const fr = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (fr) {
    const day = Number(fr[1]);
    const month = Number(fr[2]);
    let year = Number(fr[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstString(fields: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function firstValue(fields: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (fields[k] !== undefined && fields[k] !== null && fields[k] !== "") return fields[k];
  }
  return undefined;
}

export interface CaptureResult {
  status: "created" | "skipped";
  reason?: string;
  depenseId?: number;
  duplicate?: boolean;
}

/**
 * Analyse un document et, si c'est une facture/note de frais avec un montant
 * exploitable, crée une dépense `en_attente`. Idempotent par `documentId`.
 */
export async function captureExpenseFromDocument(params: {
  docId: number;
  orgId: number;
  userId: number | null;
  fileContent: string;
  mimeType: string;
  fileName: string;
  source: "upload" | "gmail" | "manuel";
}): Promise<CaptureResult> {
  const { docId, orgId, userId, fileContent, mimeType, fileName, source } = params;

  // Idempotence : une seule dépense par justificatif source.
  const [existing] = await db
    .select({ id: depensesTable.id })
    .from(depensesTable)
    .where(and(eq(depensesTable.organisationId, orgId), eq(depensesTable.documentId, docId)))
    .limit(1);
  if (existing) return { status: "skipped", reason: "already_captured", depenseId: existing.id };

  const analysis = await analyzeDocument(fileContent, mimeType, fileName, orgId);
  if (analysis.documentType !== "facture" && analysis.documentType !== "note_frais") {
    return { status: "skipped", reason: `not_an_expense:${analysis.documentType}` };
  }

  const f = analysis.extractedFields || {};
  const vendor =
    firstString(f, ["fournisseur", "vendeur", "emetteur", "societe", "employe", "magasin", "enseigne"]) ||
    analysis.title ||
    fileName;
  const reference = firstString(f, ["numero", "reference", "numeroFacture", "num_facture", "facture"]);

  let amountTtc = parseAmount(firstValue(f, ["montantTTC", "montant_ttc", "montantTotal", "total", "totalTTC", "montant"]));
  let amountHt = parseAmount(firstValue(f, ["montantHT", "montant_ht", "totalHT", "sousTotal", "subtotal"]));
  let amountTva = parseAmount(firstValue(f, ["tva", "montantTVA", "montant_tva", "tvaAmount"]));

  // Cohérence des montants : reconstruit les valeurs manquantes quand possible.
  if (amountTtc <= 0 && amountHt > 0) amountTtc = amountHt + Math.max(0, amountTva);
  if (amountHt <= 0 && amountTtc > 0) amountHt = Math.max(0, amountTtc - Math.max(0, amountTva));
  if (amountTva <= 0 && amountTtc > 0 && amountHt > 0) amountTva = Math.max(0, amountTtc - amountHt);

  if (amountTtc <= 0 && amountHt <= 0) {
    return { status: "skipped", reason: "no_amount" };
  }
  if (amountTtc <= 0) amountTtc = amountHt;

  const expenseDate = parseDocumentDate(firstValue(f, ["date", "dateFacture", "date_facture", "dateEmission"]));
  const dueDate = parseDocumentDate(firstValue(f, ["echeance", "dateEcheance", "date_echeance", "dueDate"]));
  const category = guessExpenseCategory(vendor, analysis.title, reference);
  const dedupeHash = computeDedupeHash(vendor, amountTtc, expenseDate);

  // Détection de doublon : même empreinte, non rejetée, dans l'org.
  const [dup] = await db
    .select({ id: depensesTable.id })
    .from(depensesTable)
    .where(and(eq(depensesTable.organisationId, orgId), eq(depensesTable.dedupeHash, dedupeHash)))
    .limit(1);
  const duplicateOfId = dup?.id ?? null;

  const confidence = Number.isFinite(analysis.confidence)
    ? Math.max(0, Math.min(1, analysis.confidence)).toFixed(3)
    : null;

  const [inserted] = await db
    .insert(depensesTable)
    .values({
      organisationId: orgId,
      documentId: docId,
      vendor,
      title: analysis.title || null,
      reference: reference || null,
      category,
      expenseDate,
      dueDate,
      amountHt: amountHt.toFixed(2),
      amountTva: amountTva.toFixed(2),
      amountTtc: amountTtc.toFixed(2),
      status: "en_attente",
      paymentStatus: "a_payer",
      source,
      extractedFields: f,
      aiConfidence: confidence,
      dedupeHash,
      duplicateOfId,
      createdBy: userId,
    })
    .returning({ id: depensesTable.id });

  logger.info(
    { orgId, docId, depenseId: inserted?.id, vendor, amountTtc, duplicate: !!duplicateOfId, source },
    "[expense-capture] dépense créée depuis un justificatif",
  );

  return { status: "created", depenseId: inserted?.id, duplicate: !!duplicateOfId };
}

/**
 * Point d'entrée à brancher après l'ingestion d'un document. Vérifie
 * l'éligibilité (réglage org + type MIME) puis lance la capture en
 * arrière-plan (fire-and-forget). Ne lève JAMAIS : une erreur de capture ne
 * doit pas affecter l'ingestion du document.
 */
export function triggerExpenseCapture(params: {
  docId: number;
  orgId: number;
  userId: number | null;
  fileContent: string;
  mimeType: string;
  fileName: string;
  source: "upload" | "gmail" | "manuel";
}): void {
  if (!EXPENSE_ELIGIBLE_MIME_TYPES.has(params.mimeType)) return;

  void (async () => {
    try {
      const [org] = await db
        .select({ enabled: organisationsTable.expenseAutoCaptureEnabled })
        .from(organisationsTable)
        .where(eq(organisationsTable.id, params.orgId))
        .limit(1);
      if (org && org.enabled === false) return;
      await captureExpenseFromDocument(params);
    } catch (err) {
      logger.error({ err, docId: params.docId, orgId: params.orgId }, "[expense-capture] échec de la capture automatique");
    }
  })();
}
