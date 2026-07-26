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
  const lines: InvoiceLine[] = (Array.isArray(rawLines) ? rawLines : []).map((l) => {
    const quantity = toNum(l.quantity);
    const unitPrice = toNum(l.unitPrice);
    const taxRate = autoliquidation ? 0 : Math.max(0, toNum(l.taxRate));
    return {
      description: typeof l.description === "string" ? l.description : "",
      quantity,
      unitPrice,
      taxRate,
      total: round2(quantity * unitPrice),
    };
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

  return { lines, subtotal, taxAmount, totalAmount, vatBreakdown, autoliquidation };
}
