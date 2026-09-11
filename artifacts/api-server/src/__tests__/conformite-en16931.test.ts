/**
 * Ce que nous produisons passerait-il chez une plateforme?
 *
 * A partir de la reforme, une facture ne part plus par courriel: elle transite
 * par une PDP ou par Chorus Pro, qui la VALIDE avant transmission. Un XML
 * refuse, c'est un paiement qui n'arrive pas — et l'artisan l'apprend au pire
 * moment, sans savoir quoi corriger.
 *
 * Deux choses sont verifiees ici, et la seconde compte autant que la premiere:
 *
 *   1. le XML produit par `buildFacturXXml` respecte les regles obligatoires;
 *   2. le verificateur DETECTE reellement les manquements. Un controle qui
 *      approuve tout donnerait la pire des assurances: celle qu'on croit avoir.
 */
import { describe, expect, it } from "vitest";

import { verifierEn16931 } from "../services/conformite-en16931";
import { buildFacturXXml } from "../services/facturx";

const VENDEUR = {
  name: "SK GROUP",
  legalForm: "SAS",
  address: "17 rue Saint-Exupery\n67500 Haguenau",
  siret: "12345678901234",
  tvaNumber: "FR12345678901",
};

const FACTURE = {
  reference: "FA-2026-0042",
  clientName: "Jean Client",
  clientCompany: "ACME SARL",
  clientAddress: "5 avenue des Tilleuls\n75011 Paris",
  currency: "EUR",
  createdAt: new Date("2026-09-03T08:00:00Z"),
  dueDate: new Date("2026-10-03T00:00:00Z"),
  items: [
    { description: "Prestation de conseil", quantity: 2, unitPrice: 500, taxRate: 20 },
    { description: "Fourniture", quantity: 1, unitPrice: 100, taxRate: 5.5 },
  ],
};

const NOW = new Date("2026-09-03T10:00:00Z");

function xmlDe(facture: unknown = FACTURE): string {
  return buildFacturXXml(facture as never, VENDEUR as never, NOW).xml;
}

describe("nos factures passeraient la validation d'une plateforme", () => {
  it("une facture complete ne presente aucun manquement", () => {
    const verdict = verifierEn16931(xmlDe());
    expect(
      verdict.manquements.map((m) => `${m.regle}: ${m.explication}`),
      "ces manquements feraient rejeter la facture par la plateforme",
    ).toEqual([]);
    expect(verdict.conforme).toBe(true);
  });

  it("les totaux s'additionnent, en centimes", () => {
    // 2 x 500 a 20 % et 1 x 100 a 5,5 %: 1100 HT, 205,50 de TVA, 1305,50 TTC.
    const verdict = verifierEn16931(xmlDe());
    const coherence = verdict.manquements.filter((m) => m.regle.startsWith("BR-CO"));
    expect(coherence).toEqual([]);
  });
});

describe("le verificateur detecte vraiment les manquements", () => {
  /*
   * Sans ces cas, le fichier precedent prouverait seulement que la fonction
   * rend une liste vide — ce qu'une fonction qui ne regarde rien fait aussi.
   */
  it("voit un nom de client absent", () => {
    const xml = xmlDe().replace(/<ram:BuyerTradeParty>[\s\S]*?<\/ram:BuyerTradeParty>/, "<ram:BuyerTradeParty></ram:BuyerTradeParty>");
    const regles = verifierEn16931(xml).manquements.map((m) => m.regle);
    expect(regles).toContain("BR-07");
    expect(regles).toContain("BR-10");
    expect(regles).toContain("BR-11");
  });

  it("voit une facture sans ligne", () => {
    const xml = xmlDe().replace(/<ram:IncludedSupplyChainTradeLineItem>[\s\S]*<\/ram:IncludedSupplyChainTradeLineItem>/, "");
    expect(verifierEn16931(xml).manquements.map((m) => m.regle)).toContain("BR-16");
  });

  it("voit un total qui ne correspond pas a la somme des lignes", () => {
    // Le cas le plus dangereux: le document reste bien forme, s'affiche, et
    // seule la plateforme s'apercoit que les chiffres ne tombent pas juste.
    const xml = xmlDe().replace(/<ram:GrandTotalAmount>[\d.]+<\/ram:GrandTotalAmount>/, "<ram:GrandTotalAmount>9999.99</ram:GrandTotalAmount>");
    expect(verifierEn16931(xml).manquements.map((m) => m.regle)).toContain("BR-CO-15");
  });

  it("voit une devise absente", () => {
    const xml = xmlDe().replace(/<ram:InvoiceCurrencyCode>[^<]*<\/ram:InvoiceCurrencyCode>/, "");
    expect(verifierEn16931(xml).manquements.map((m) => m.regle)).toContain("BR-05");
  });

  it("rend TOUS les manquements, pas seulement le premier", () => {
    // Corriger une facture champ par champ, en la renvoyant a chaque fois, est
    // ce qui rend ces plateformes detestables. On ne reproduit pas ca.
    const xml = xmlDe()
      .replace(/<ram:InvoiceCurrencyCode>[^<]*<\/ram:InvoiceCurrencyCode>/, "")
      .replace(/<ram:BuyerTradeParty>[\s\S]*?<\/ram:BuyerTradeParty>/, "<ram:BuyerTradeParty></ram:BuyerTradeParty>");
    expect(verifierEn16931(xml).manquements.length).toBeGreaterThan(2);
  });
});

describe("ce qui manque a l'utilisateur lui est dit en francais", () => {
  it("chaque manquement porte sa regle ET une explication lisible", () => {
    const xml = xmlDe().replace(/<ram:BuyerTradeParty>[\s\S]*?<\/ram:BuyerTradeParty>/, "<ram:BuyerTradeParty></ram:BuyerTradeParty>");
    for (const m of verifierEn16931(xml).manquements) {
      // L'identifiant sert a faire le lien avec le rejet de la plateforme;
      // l'explication sert a la personne qui doit corriger. Les deux, pas l'un.
      expect(m.regle).toMatch(/^BR-/);
      expect(m.explication.length).toBeGreaterThan(15);
      expect(m.explication).not.toMatch(/^BR-/);
    }
  });
});
