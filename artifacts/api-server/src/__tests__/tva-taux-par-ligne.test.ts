/**
 * Le taux de TVA appartient a la LIGNE, pas a la facture.
 *
 * La voie d'emission par l'agent IA calculait ses totaux elle-meme, avec un
 * taux unique (`data.tvaRate ?? 20`) applique a toutes les lignes. Sur un
 * chantier ordinaire — main d'oeuvre de renovation a 10 %, materiaux a 20 % —
 * cela donnait:
 *
 *     moteur central : HT 2550   TVA 375,00   TTC 2925,00
 *     formule d'avant: HT 2550   TVA 255,00   TTC 2805,00
 *
 * 120 EUR de TVA manquants. Une facture qui sous-declare la TVA n'est pas un
 * defaut d'affichage: c'est une piece comptable fausse, opposable a celui qui
 * l'emet.
 *
 * Le defaut a dure parce qu'il est INVISIBLE a taux unique — les deux formules
 * y donnent le meme centime. Il n'apparait qu'avec des taux melanges, c'est-a-
 * dire dans le cas normal du batiment: 10 % en renovation, 5,5 % en
 * amelioration energetique, 20 % sur le neuf et les fournitures.
 *
 * Ce fichier verifie deux choses qui ne se remplacent pas:
 *
 *   - le CHIFFRE: le moteur central ventile bien par taux (sinon le reste ne
 *     vaut rien);
 *   - la FORME: la route IA passe par ce moteur, au lieu de refaire le calcul.
 *     C'est la seule garantie qu'une troisieme formule ne reapparaisse pas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { computeInvoiceTotals } from "../services/invoice-totals";

/** Le chantier de la mesure: renovation a 10 %, fournitures a 20 %. */
const CHANTIER_MIXTE = [
  { description: "Main d'oeuvre renovation", quantity: 30, unitPrice: 45, taxRate: 10 },
  { description: "Materiaux", quantity: 1, unitPrice: 1200, taxRate: 20 },
];

/** La formule fautive, conservee ici comme contre-epreuve. */
function ancienneFormule(items: typeof CHANTIER_MIXTE, taux: number) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = subtotal * (taux / 100);
  return { subtotal, taxAmount: tax, totalAmount: subtotal + tax };
}

describe("une facture a taux melanges", () => {
  it("ventile la TVA par taux, et non au taux de la premiere ligne", () => {
    const t = computeInvoiceTotals(CHANTIER_MIXTE);

    // 1350 a 10 % = 135 ; 1200 a 20 % = 240 ; total 375.
    expect(t.subtotal).toBe(2550);
    expect(t.taxAmount).toBe(375);
    expect(t.totalAmount).toBe(2925);
  });

  it("l'ancienne formule sous-declarait bien la TVA de 120 EUR", () => {
    // Sans cette contre-epreuve, le test ci-dessus decrirait un comportement
    // dont rien ne dit qu'il a jamais ete faux.
    const ancien = ancienneFormule(CHANTIER_MIXTE, CHANTIER_MIXTE[0].taxRate);
    const juste = computeInvoiceTotals(CHANTIER_MIXTE);

    expect(ancien.taxAmount).toBe(255);
    expect(juste.taxAmount - ancien.taxAmount).toBe(120);
  });

  it("a taux unique, les deux formules donnaient le meme centime", () => {
    // C'est ce qui rendait le defaut indetectable a l'usage courant: il ne se
    // manifeste jamais sur une facture a un seul taux.
    const unSeulTaux = [
      { description: "Isolation", quantity: 85, unitPrice: 23.9, taxRate: 5.5 },
    ];
    const ancien = ancienneFormule(unSeulTaux, 5.5);
    const juste = computeInvoiceTotals(unSeulTaux);

    expect(Number(juste.taxAmount.toFixed(2))).toBe(Number(ancien.taxAmount.toFixed(2)));
  });
});

describe("les voies d'emission", () => {
  const routeIa = readFileSync(
    join(import.meta.dirname, "..", "routes", "ai-analysis.ts"),
    "utf8",
  );

  it("la route IA delegue le calcul au moteur central", () => {
    expect(
      routeIa.includes("computeInvoiceTotals"),
      "la route recalcule les montants elle-meme: deux moteurs, deux reponses",
    ).toBe(true);
  });

  it("elle n'applique plus un taux unique a toutes les lignes", () => {
    // La signature exacte du defaut: le taux de la facture ecrit dans chaque
    // ligne, en ignorant celui que la ligne porte.
    expect(
      /taxRate:\s*tvaRate\b/.test(routeIa),
      "le taux de la facture est de nouveau impose a chaque ligne",
    ).toBe(false);
  });
});

describe("l'import de document", () => {
  const importDoc = readFileSync(
    join(import.meta.dirname, "..", "services", "document-ai.ts"),
    "utf8",
  );

  it("ne prend plus le montant HT pour un montant TTC", () => {
    // Le repli d'avant: `data.montantTTC || data.montantHT`. Quand la lecture
    // du document ne trouvait pas de TTC, la facture etait enregistree avec un
    // total egal au HT — TVA disparue, sans un mot.
    expect(
      /totalAmount:\s*\n?\s*data\.montantTTC \|\| data\.montantHT/.test(importDoc),
      "le total retombe directement sur le montant hors taxes",
    ).toBe(false);
    expect(importDoc).toContain("montantTVA");
  });
});
