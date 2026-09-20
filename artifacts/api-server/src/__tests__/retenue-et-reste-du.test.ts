/**
 * Un document ne porte pas deux montants qui se contredisent.
 *
 * La retenue de garantie (loi n° 71-584 du 16 juillet 1971) autorise le client
 * a conserver jusqu'a 5 % du marche jusqu'a l'expiration du delai de garantie.
 * Le produit la calcule bien, et l'annonce dans les mentions legales :
 *
 *   « Retenue de garantie de 5 % : 500,00 EUR retenus, net a payer
 *     9 500,00 EUR. »
 *
 * Mais le « reste du » valait `total TTC - deja regle`, sans connaitre cette
 * retenue — elle etait calculee vingt lignes plus bas et poussee uniquement
 * dans les mentions. Le meme document annoncait donc :
 *
 *   - « net a payer 9 500,00 EUR » dans les mentions legales ;
 *   - « Reste du : 10 000,00 EUR » dans le bloc des totaux ;
 *   - `10000.00` dans le `DuePayableAmount` du XML Factur-X — celui que lit le
 *     systeme comptable du client, et qui fait foi dans un echange
 *     dematerialise.
 *
 * Le client paie le net a payer, qui est le bon montant. La facture reste
 * alors indefiniment « partiellement payee » et relancable, pour une somme
 * qu'il n'a pas a verser avant l'expiration du delai de garantie.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { buildInvoiceDocument } from "../services/invoice-pdf";

const VENDEUR = {
  name: "SK GROUP",
  address: "1 rue de l'Exemple",
  siret: "55210055400013",
  legalForm: "SARL",
};

/** Une facture de 10 000 EUR TTC (8 333,33 HT + 1 666,67 de TVA). */
function facture(v: Record<string, unknown> = {}) {
  return {
    reference: "FAC-2026-0001",
    issuedAt: new Date("2026-09-01T00:00:00.000Z"),
    dueDate: new Date("2026-10-01T00:00:00.000Z"),
    clientName: "Dupont BTP",
    clientAddress: "2 rue du Chantier",
    items: [{ description: "Gros oeuvre", quantity: 1, unitPrice: 8333.33, taxRate: 20 }],
    currency: "EUR",
    status: "envoyee",
    paidAmount: 0,
    ...v,
  };
}

const construire = (inv: Record<string, unknown>, type: "facture" | "devis" = "facture") =>
  buildInvoiceDocument(inv as never, VENDEUR as never, new Date("2026-09-15T00:00:00.000Z"), type);

/** Le « reste du » tel qu'il apparait dans le bloc REGLEMENT. */
const ligneResteDu = (doc: { payment: string[] }) =>
  doc.payment.find((l) => /reste du/i.test(l)) ?? "";

describe("sans retenue de garantie, rien ne change", () => {
  it("le reste du est le total moins le deja regle", () => {
    const doc = construire(facture({ paidAmount: 2000 }));
    expect(doc.remaining).toBeCloseTo(doc.totalAmount - 2000, 2);
  });

  it("une facture non reglee doit son total", () => {
    const doc = construire(facture());
    expect(doc.remaining).toBeCloseTo(doc.totalAmount, 2);
  });

  it("aucune retenue n'est annoncee", () => {
    // Une ligne « retenue : 0 EUR » inviterait a en pratiquer une.
    const doc = construire(facture());
    expect(doc.retenue).toBeNull();
  });
});

describe("avec une retenue de garantie, le du immediat la deduit", () => {
  const avecRetenue = () => construire(facture({ retenueGarantieRate: 5 }));

  it("la retenue est bien calculee", () => {
    const doc = avecRetenue();
    expect(doc.retenue, "la retenue n'est plus appliquee").not.toBeNull();
    expect(doc.retenue!.montant).toBeCloseTo(doc.totalAmount * 0.05, 2);
  });

  it("le reste du vaut le net a payer, pas le total", () => {
    const doc = avecRetenue();
    expect(doc.remaining, "le document reclame la retenue avant terme")
      .toBeCloseTo(doc.retenue!.netAPayer, 2);
    expect(doc.remaining).not.toBeCloseTo(doc.totalAmount, 2);
  });

  it("les deux montants du document concordent", () => {
    // C'est le coeur du defaut: les mentions legales disaient une chose, le
    // bloc des totaux une autre.
    const doc = avecRetenue();
    const mention = doc.legalMentions.find((m) => /net a payer/i.test(m)) ?? "";
    expect(mention, "la mention legale a disparu").toMatch(/net a payer/i);
    const montantMention = mention.match(/net a payer\s+([\d\s.,]+)/i)?.[1] ?? "";
    const normalise = (v: string) => Number(v.replace(/\s/g, "").replace(/[^\d,.]/g, "").replace(",", "."));
    expect(normalise(montantMention)).toBeCloseTo(doc.remaining, 2);
  });

  it("la ligne REGLEMENT annonce le meme montant", () => {
    const doc = construire(facture({ retenueGarantieRate: 5, paidAmount: 1000 }));
    const ligne = ligneResteDu(doc);
    expect(ligne, "la ligne « reste du » a disparu du bloc reglement").toMatch(/reste du/i);
    // Le formateur francais separe les milliers par une espace insecable
    // ETROITE (U+202F): comparer avec une espace ordinaire echouerait sur le
    // caractere, pas sur le montant.
    const sansEspaces = ligne.replace(/[\s  ]/g, "");
    expect(sansEspaces, `ligne rendue: ${ligne}`).toContain("8500,00");
  });

  it("un acompte deja verse se deduit du net a payer", () => {
    const doc = construire(facture({ retenueGarantieRate: 5, paidAmount: 1000 }));
    expect(doc.remaining).toBeCloseTo(doc.retenue!.netAPayer - 1000, 2);
  });

  it("le reste du ne descend jamais sous zero", () => {
    // Un trop-percu ne doit pas produire un montant negatif dans le XML.
    const doc = construire(facture({ retenueGarantieRate: 5, paidAmount: 99999 }));
    expect(doc.remaining).toBe(0);
  });

  it("le total, lui, reste le total", () => {
    // La retenue ne diminue pas la creance: elle en differe une partie.
    const doc = avecRetenue();
    expect(doc.totalAmount).toBeGreaterThan(doc.remaining);
  });

  it("une caution bancaire rend la totalite exigible", () => {
    // Art. 2 de la loi: avec une caution, rien n'est retenu.
    const doc = construire(facture({ retenueGarantieRate: 5, cautionBancaire: true }));
    expect(doc.retenue, "une retenue est pratiquee malgre la caution").toBeNull();
    expect(doc.remaining).toBeCloseTo(doc.totalAmount, 2);
  });

  it("un devis ne porte pas de retenue", () => {
    // Elle s'applique aux paiements, et il n'y a pas encore de paiement.
    const doc = construire(facture({ retenueGarantieRate: 5 }), "devis");
    expect(doc.retenue).toBeNull();
  });
});
