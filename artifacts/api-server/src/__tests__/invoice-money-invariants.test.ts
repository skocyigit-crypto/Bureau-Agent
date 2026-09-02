/**
 * Invariants monetaires de la chaine Vente, verifies sur des milliers de
 * factures tirees au hasard plutot que sur trois exemples choisis.
 *
 * Ce que ces proprietes protegent: un devis converti en facture, puis rendu en
 * PDF, traverse trois representations (colonnes numeric(12,2), modele PDF,
 * ventilation de TVA). Si l'une derive d'un centime, la facture affiche un
 * total qui contredit son propre detail — le genre d'erreur qu'un test
 * d'exemple ne trouve pas et qu'un client trouve tout de suite.
 */
import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, MAX_INVOICE_AMOUNT } from "../services/invoice-totals";
import { buildInvoiceDocument } from "../services/invoice-pdf";

/** Generateur deterministe: un echec est rejouable a l'identique. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const RATES = [0, 2.1, 5.5, 10, 20];

function randomLines(rng: () => number, count: number) {
  return Array.from({ length: count }, () => ({
    description: "Ligne",
    // Quantites et prix a decimales: c'est la que naissent les erreurs de
    // centime (0.1 + 0.2 en binaire).
    quantity: Math.round(rng() * 1000) / 10,
    unitPrice: Math.round(rng() * 100000) / 100,
    taxRate: RATES[Math.floor(rng() * RATES.length)],
  }));
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

describe("computeInvoiceTotals — invariants", () => {
  it("respecte les six invariants sur 2000 factures aleatoires", () => {
    const rng = makeRng(20260902);
    for (let i = 0; i < 2000; i++) {
      const lines = randomLines(rng, 1 + Math.floor(rng() * 12));
      const autoliquidation = rng() < 0.2;
      const t = computeInvoiceTotals(lines, { autoliquidation });
      const ctx = () => `iteration ${i} / ${JSON.stringify(lines)}`;

      // 1. Chaque ligne vaut quantite x prix unitaire, au centime.
      for (const l of t.lines) {
        expect(l.total, ctx()).toBe(round2(l.quantity * l.unitPrice));
      }
      // 2. Le sous-total HT est la somme des lignes.
      expect(t.subtotal, ctx()).toBe(round2(t.lines.reduce((s, l) => s + l.total, 0)));
      // 3. Les assiettes de la ventilation couvrent exactement le HT.
      expect(round2(t.vatBreakdown.reduce((s, v) => s + v.base, 0)), ctx()).toBe(t.subtotal);
      // 4. La TVA totale est la somme des blocs de TVA.
      expect(t.taxAmount, ctx()).toBe(round2(t.vatBreakdown.reduce((s, v) => s + v.amount, 0)));
      // 5. TTC = HT + TVA.
      expect(t.totalAmount, ctx()).toBe(round2(t.subtotal + t.taxAmount));
      // 6. En autoliquidation, aucune TVA n'est facturee et TTC = HT.
      if (autoliquidation) {
        expect(t.taxAmount, ctx()).toBe(0);
        expect(t.totalAmount, ctx()).toBe(t.subtotal);
        expect(t.vatBreakdown.every((v) => v.amount === 0), ctx()).toBe(true);
      }
    }
  });

  it("chaque bloc de TVA vaut son assiette fois son taux, au centime", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const t = computeInvoiceTotals(randomLines(rng, 1 + Math.floor(rng() * 8)));
      for (const v of t.vatBreakdown) {
        expect(v.amount).toBe(round2(v.base * (v.taxRate / 100)));
      }
    }
  });

  it("ne produit jamais de montant negatif, meme sur des entrees aberrantes", () => {
    const hostile = [
      { description: "neg qte", quantity: -5, unitPrice: 100, taxRate: 20 },
      { description: "neg pu", quantity: 2, unitPrice: -100, taxRate: 20 },
      { description: "taux neg", quantity: 2, unitPrice: 100, taxRate: -20 },
      { description: "NaN", quantity: "abc" as any, unitPrice: "xyz" as any, taxRate: "?" as any },
      { description: "vide" },
    ];
    const t = computeInvoiceTotals(hostile as any);

    expect(t.subtotal).toBeGreaterThanOrEqual(0);
    expect(t.taxAmount).toBeGreaterThanOrEqual(0);
    expect(t.totalAmount).toBeGreaterThanOrEqual(0);
    expect(t.lines.every((l) => l.quantity >= 0 && l.unitPrice >= 0 && l.taxRate >= 0)).toBe(true);
  });

  it("signale le depassement de capacite de la colonne numeric(12,2)", () => {
    const t = computeInvoiceTotals([
      { description: "enorme", quantity: 1_000_000, unitPrice: 1_000_000, taxRate: 20 },
    ]);

    expect(t.overflow).toBe(true);
    expect(t.totalAmount).toBeGreaterThan(MAX_INVOICE_AMOUNT);
  });
});

describe("chaine devis -> facture -> PDF", () => {
  it("le PDF affiche exactement les totaux que le serveur a stockes", () => {
    const rng = makeRng(4242);
    for (let i = 0; i < 500; i++) {
      const lines = randomLines(rng, 1 + Math.floor(rng() * 10));
      const autoliquidation = rng() < 0.25;

      // Ce que POST /devis puis convert-to-facture ecrivent en base.
      const stored = computeInvoiceTotals(lines, { autoliquidation });
      // Ce que le PDF recalcule a partir des memes lignes.
      const model = buildInvoiceDocument(
        { reference: "FAC-1", clientName: "C", items: stored.lines, isAutoliquidation: autoliquidation, paidAmount: "0" },
        { name: "V" },
        new Date("2026-09-02T00:00:00.000Z"),
      );

      expect(model.subtotal).toBe(stored.subtotal);
      expect(model.taxAmount).toBe(stored.taxAmount);
      expect(model.totalAmount).toBe(stored.totalAmount);
      expect(model.vatBreakdown).toEqual(stored.vatBreakdown);
    }
  });

  it("le calcul est idempotent: recalculer des lignes deja calculees ne bouge rien", () => {
    // La conversion devis -> facture recopie `devis.items` (deja normalisees).
    // Si un second passage changeait un centime, la facture ne vaudrait plus
    // son devis.
    const rng = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const once = computeInvoiceTotals(randomLines(rng, 1 + Math.floor(rng() * 10)));
      const twice = computeInvoiceTotals(once.lines);

      expect(twice.lines).toEqual(once.lines);
      expect(twice.subtotal).toBe(once.subtotal);
      expect(twice.taxAmount).toBe(once.taxAmount);
      expect(twice.totalAmount).toBe(once.totalAmount);
    }
  });

  it("le reste du complete toujours le deja regle", () => {
    const rng = makeRng(1234);
    for (let i = 0; i < 500; i++) {
      const lines = randomLines(rng, 1 + Math.floor(rng() * 6));
      const totals = computeInvoiceTotals(lines);
      const paid = round2(rng() * totals.totalAmount * 1.2);
      const model = buildInvoiceDocument(
        { reference: "F", clientName: "C", items: lines, paidAmount: String(paid) },
        { name: "V" },
        new Date("2026-09-02T00:00:00.000Z"),
      );

      expect(model.remaining).toBeGreaterThanOrEqual(0);
      if (paid <= model.totalAmount) {
        expect(round2(model.paidAmount + model.remaining)).toBe(model.totalAmount);
      } else {
        expect(model.remaining).toBe(0);
      }
    }
  });
});
