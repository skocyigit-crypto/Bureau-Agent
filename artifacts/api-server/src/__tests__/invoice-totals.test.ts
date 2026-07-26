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
import { computeInvoiceTotals } from "../services/invoice-totals";

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

  it("les lignes normalisées portent le total recalculé, pas celui du client", () => {
    // Le client tente d'injecter un total mensonger.
    const t = computeInvoiceTotals([{ quantity: 2, unitPrice: 100, taxRate: 20, total: 5 } as never]);
    expect(t.lines[0].total).toBe(200);
  });
});
