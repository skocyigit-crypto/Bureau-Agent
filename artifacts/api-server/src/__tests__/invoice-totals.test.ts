/**
 * Tests du moteur de calcul des totaux (services/invoice-totals.ts).
 *
 * C'est desormais la SEULE source de verite des montants d'un devis ou d'une
 * facture: le serveur ignore les totaux envoyes par le client et recalcule a
 * partir des lignes. Ces tests verrouillent la correction financiere —
 * arrondis au centime, ventilation de TVA par taux, autoliquidation BTP —
 * parce qu'une erreur ici se traduit directement en montant faux sur une
 * facture legale.
 */
import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  isValidCurrency,
  parseUserDate,
  clampPagination,
  normalizePaidAmount,
  MAX_INVOICE_AMOUNT,
} from "../services/invoice-totals";

describe("computeInvoiceTotals", () => {
  it("ligne simple: total HT = quantité × prix, TVA 20%", () => {
    const t = computeInvoiceTotals([{ quantity: 2, unitPrice: 100, taxRate: 20 }]);
    expect(t.subtotal).toBe(200);
    expect(t.taxAmount).toBe(40);
    expect(t.totalAmount).toBe(240);
    expect(t.lines[0].total).toBe(200);
  });

  it("ventile la TVA par taux (20% + 10% + 5,5%)", () => {
    const t = computeInvoiceTotals([
      { quantity: 1, unitPrice: 100, taxRate: 20 },
      { quantity: 1, unitPrice: 100, taxRate: 10 },
      { quantity: 1, unitPrice: 100, taxRate: 5.5 },
    ]);
    expect(t.subtotal).toBe(300);
    // 20 + 10 + 5.5
    expect(t.taxAmount).toBe(35.5);
    expect(t.totalAmount).toBe(335.5);
    expect(t.vatBreakdown.map((v) => v.taxRate)).toEqual([20, 10, 5.5]);
    expect(t.vatBreakdown.find((v) => v.taxRate === 5.5)?.amount).toBe(5.5);
  });

  it("arrondit chaque montant au centime (pas de traînée binaire)", () => {
    // 3 × 33.33 = 99.99 HT ; TVA 20% = 19.998 → 20.00
    const t = computeInvoiceTotals([{ quantity: 3, unitPrice: 33.33, taxRate: 20 }]);
    expect(t.subtotal).toBe(99.99);
    expect(t.taxAmount).toBe(20);
    expect(t.totalAmount).toBe(119.99);
  });

  it("regroupe plusieurs lignes au même taux dans un seul bloc de TVA", () => {
    const t = computeInvoiceTotals([
      { quantity: 1, unitPrice: 50, taxRate: 20 },
      { quantity: 1, unitPrice: 30, taxRate: 20 },
    ]);
    expect(t.vatBreakdown).toHaveLength(1);
    expect(t.vatBreakdown[0].base).toBe(80);
    expect(t.vatBreakdown[0].amount).toBe(16);
  });

  it("autoliquidation BTP: TVA forcée à 0, TTC = HT", () => {
    const t = computeInvoiceTotals(
      [{ quantity: 10, unitPrice: 100, taxRate: 20 }],
      { autoliquidation: true },
    );
    expect(t.subtotal).toBe(1000);
    expect(t.taxAmount).toBe(0);
    expect(t.totalAmount).toBe(1000);
    expect(t.autoliquidation).toBe(true);
    expect(t.vatBreakdown[0].amount).toBe(0);
  });

  it("accepte les nombres en chaîne et la virgule décimale", () => {
    const t = computeInvoiceTotals([{ quantity: "2", unitPrice: "49,99", taxRate: "20" }]);
    expect(t.subtotal).toBe(99.98);
    expect(t.totalAmount).toBe(119.98);
  });

  it("valeurs manquantes/invalides → 0, jamais NaN", () => {
    const t = computeInvoiceTotals([{ description: "x" }, { quantity: 1, unitPrice: "abc", taxRate: 20 }]);
    expect(t.subtotal).toBe(0);
    expect(t.taxAmount).toBe(0);
    expect(t.totalAmount).toBe(0);
    expect(Number.isNaN(t.totalAmount)).toBe(false);
  });

  it("liste vide ou nulle → tout à 0", () => {
    expect(computeInvoiceTotals([]).totalAmount).toBe(0);
    expect(computeInvoiceTotals(null).totalAmount).toBe(0);
    expect(computeInvoiceTotals(undefined).totalAmount).toBe(0);
  });

  it("un taux négatif est ramené à 0 (pas de TVA négative)", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unitPrice: 100, taxRate: -5 }]);
    expect(t.taxAmount).toBe(0);
  });

  it("quantité/prix négatifs sont ramenés à 0 (jamais de total négatif)", () => {
    const t = computeInvoiceTotals([{ quantity: -3, unitPrice: 100, taxRate: 20 }, { quantity: 1, unitPrice: -50, taxRate: 20 }]);
    expect(t.subtotal).toBe(0);
    expect(t.totalAmount).toBe(0);
  });

  it("signale un dépassement de capacité (numeric 12,2)", () => {
    const t = computeInvoiceTotals([{ quantity: 1e9, unitPrice: 1e9, taxRate: 20 }]);
    expect(t.overflow).toBe(true);
  });

  it("un montant normal ne déclenche pas overflow", () => {
    const t = computeInvoiceTotals([{ quantity: 2, unitPrice: 100, taxRate: 20 }]);
    expect(t.overflow).toBe(false);
  });

  it("borne le nombre de lignes traitées", () => {
    const many = Array.from({ length: 900 }, () => ({ quantity: 1, unitPrice: 1, taxRate: 20 }));
    const t = computeInvoiceTotals(many);
    expect(t.lines.length).toBe(500);
  });
});

describe("helpers de validation facturation", () => {
  it("isValidCurrency accepte EUR/USD, refuse le reste", () => {
    expect(isValidCurrency("EUR")).toBe(true);
    expect(isValidCurrency("usd")).toBe(true);
    expect(isValidCurrency("XX")).toBe(false);
    expect(isValidCurrency("euro")).toBe(false);
    expect(isValidCurrency(123)).toBe(false);
  });

  it("parseUserDate: null si absent, undefined si invalide, Date si valide", () => {
    expect(parseUserDate("")).toBeNull();
    expect(parseUserDate(null)).toBeNull();
    expect(parseUserDate("pas une date")).toBeUndefined();
    expect(parseUserDate(12345)).toBeUndefined(); // nombre brut refuse
    expect(parseUserDate("2026-07-26") instanceof Date).toBe(true);
  });

  it("clampPagination borne limit à [1,500] et offset à >= 0", () => {
    expect(clampPagination(99999999, 0).limit).toBe(500);
    expect(clampPagination("abc", -5)).toEqual({ limit: 50, offset: 0 });
    expect(clampPagination(20, 40)).toEqual({ limit: 20, offset: 40 });
  });

  it("normalizePaidAmount: jamais négatif, jamais null, borné", () => {
    expect(normalizePaidAmount(-500)).toBe("0");
    expect(normalizePaidAmount(null)).toBe("0");
    expect(normalizePaidAmount("abc")).toBe("0");
    expect(normalizePaidAmount(150.5)).toBe("150.5");
    expect(Number(normalizePaidAmount(1e15))).toBe(MAX_INVOICE_AMOUNT);
  });

  it("les lignes normalisées portent le total recalculé, pas celui du client", () => {
    // Le client tente d'injecter un total mensonger.
    const t = computeInvoiceTotals([{ quantity: 2, unitPrice: 100, taxRate: 20, total: 5 } as never]);
    expect(t.lines[0].total).toBe(200);
  });
});
