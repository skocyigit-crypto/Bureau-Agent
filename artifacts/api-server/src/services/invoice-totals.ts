/**
 * Calcul des totaux d'un devis ou d'une facture — LA source de verite unique.
 *
 * Avant, le serveur enregistrait tels quels les `subtotal`/`taxAmount`/
 * `totalAmount` envoyes par le client (routes/devis.ts, routes/factures-
 * client.ts): aucun calcul, donc des montants potentiellement faux ou
 * manipulables, et aucune coherence entre les lignes et les totaux. Ce module
 * recalcule TOUT a partir des seules lignes, cote serveur; les totaux du client
 * sont ignores.
 *
 * Regles:
 *   - total d'une ligne = quantite × prix unitaire HT (arrondi au centime);
 *   - sous-total HT = somme des lignes;
 *   - TVA ventilee PAR TAUX (une facture peut mixer 20 %, 10 %, 5,5 %, 0 %),
 *     chaque bloc arrondi au centime — c'est l'exigence d'une ventilation de
 *     TVA conforme (et de Factur-X);
 *   - total TTC = HT + somme des TVA.
 *
 * Autoliquidation (sous-traitance BTP, art. 283-2 nonies CGI): la TVA n'est pas
 * facturee par le prestataire (le client l'autoliquide). On force alors la TVA
 * a 0 et TTC = HT, tout en conservant la mention obligatoire cote document.
 */

export interface InvoiceLineInput {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  taxRate?: number | string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number; // HT, arrondi au centime
}

export interface VatBreakdownEntry {
  taxRate: number;
  base: number; // assiette HT pour ce taux
  amount: number; // TVA pour ce taux
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  subtotal: number; // HT
  taxAmount: number; // TVA totale
  totalAmount: number; // TTC
  vatBreakdown: VatBreakdownEntry[];
  autoliquidation: boolean;
  /** true si un montant depasse la capacite de la colonne numeric(12,2). */
  overflow: boolean;
}

/**
 * Plafond d'un montant stockable: la colonne est `numeric(12,2)`, soit au plus
 * 9 999 999 999,99. Au-dela, l'insert echouerait avec un "numeric field
 * overflow" opaque (500 generique). On le detecte en amont pour renvoyer une
 * erreur claire.
 */
export const MAX_INVOICE_AMOUNT = 9_999_999_999.99;

/** Bornes anti-abus sur les lignes (evite un jsonb/CPU non borne). */
export const MAX_INVOICE_LINES = 500;
export const MAX_LINE_DESCRIPTION = 500;

/** Valide un code devise ISO 4217 (3 lettres reconnues par Intl). */
export function isValidCurrency(code: unknown): boolean {
  if (typeof code !== "string" || !/^[A-Za-z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: code.toUpperCase() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse une date d'entree utilisateur. Renvoie un `Date` valide, `null` si
 * l'entree est absente, ou `undefined` si elle est presente mais invalide
 * (permet au routeur de repondre 400 au lieu d'un 500 opaque a l'insert).
 */
export function parseUserDate(v: unknown): Date | null | undefined {
  if (v == null || v === "") return null;
  // On refuse les nombres bruts (ambigus: epoch ms ? annee ?) et n'accepte
  // qu'une chaine de date explicite.
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Borne une valeur de pagination (limit/offset) recue en query string. */
export function clampPagination(rawLimit: unknown, rawOffset: unknown): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(rawLimit)) || 50));
  const offset = Math.max(0, Math.floor(Number(rawOffset)) || 0);
  return { limit, offset };
}

/**
 * Normalise un montant paye: nombre fini, >= 0, borne au plafond. Renvoie
 * toujours une chaine (la colonne est notNull) — jamais null.
 */
export function normalizePaidAmount(v: unknown): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(Math.min(n, MAX_INVOICE_AMOUNT));
}

/** Arrondi commercial au centime (2 decimales), stable pour l'argent. */
function round2(n: number): number {
  // +Number.EPSILON evite que 1.005 tombe a 1.00 par erreur binaire.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toNum(v: number | string | undefined | null): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calcule les totaux a partir des lignes. `autoliquidation` force la TVA a 0.
 * Fonction PURE et deterministe: aucune I/O, testable directement.
 */
export function computeInvoiceTotals(
  rawLines: InvoiceLineInput[] | null | undefined,
  opts: { autoliquidation?: boolean } = {},
): InvoiceTotals {
  const autoliquidation = !!opts.autoliquidation;
  // On borne le nombre de lignes traitees (protection memoire/CPU); au-dela,
  // c'est une erreur d'entree, pas une facture legitime.
  const capped = (Array.isArray(rawLines) ? rawLines : []).slice(0, MAX_INVOICE_LINES);
  const lines: InvoiceLine[] = capped.map((l) => {
    // Les montants ne peuvent pas etre negatifs sur une facture: une quantite
    // ou un prix negatif est une erreur de saisie (il n'existe pas de notion
    // de remise negative ici). On borne a 0 plutot que de produire un total
    // negatif silencieux.
    const quantity = Math.max(0, toNum(l.quantity));
    const unitPrice = Math.max(0, toNum(l.unitPrice));
    const taxRate = autoliquidation ? 0 : Math.max(0, toNum(l.taxRate));
    const description = (typeof l.description === "string" ? l.description : "").slice(0, MAX_LINE_DESCRIPTION);
    return { description, quantity, unitPrice, taxRate, total: round2(quantity * unitPrice) };
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));

  // Ventilation de la TVA par taux (bloc arrondi au centime).
  const byRate = new Map<number, number>();
  for (const l of lines) {
    byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + l.total);
  }
  const vatBreakdown: VatBreakdownEntry[] = [...byRate.entries()]
    .map(([taxRate, base]) => ({
      taxRate,
      base: round2(base),
      amount: autoliquidation ? 0 : round2(round2(base) * (taxRate / 100)),
    }))
    .sort((a, b) => b.taxRate - a.taxRate);

  const taxAmount = autoliquidation ? 0 : round2(vatBreakdown.reduce((s, v) => s + v.amount, 0));
  const totalAmount = round2(subtotal + taxAmount);
  const overflow = totalAmount > MAX_INVOICE_AMOUNT || subtotal > MAX_INVOICE_AMOUNT;

  return { lines, subtotal, taxAmount, totalAmount, vatBreakdown, autoliquidation, overflow };
}
