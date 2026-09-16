/**
 * La retenue de garantie : 5 % du chantier, douze mois, et rien dans le code.
 *
 * CE QUI MANQUAIT — MESURE DU 16/09
 *
 * Aucune graphie de « retenue de garantie » n'existait dans le depot :
 * `retenueGarantie`, `retenue_garantie`, `holdback`, `retainage` — zero
 * occurrence. Or en BTP elle est systematique, et trois consequences
 * decoulaient de son absence, toutes dans le meme sens :
 *
 *   - la facture annoncait un net a payer que le client n'allait pas regler ;
 *   - la prevision de tresorerie comptait 5 % d'encaissements qui
 *     n'arriveraient pas dans son horizon de 90 jours ;
 *   - rien ne rappelait l'echeance de restitution — et 5 % d'un marche ne se
 *     reclament pas tout seuls.
 *
 * TROIS REGLES QUI SE TROMPENT FACILEMENT
 *
 * 1. La TVA reste due sur la TOTALITE. La retenue porte sur ce que le client
 *    verse, pas sur l'assiette de TVA. La calculer sur le net a payer est
 *    l'erreur la plus courante.
 * 2. Une caution bancaire SUPPRIME la retenue (art. 2). Elle ne la reporte
 *    pas : la totalite reste exigible, et c'est la banque qui porte le risque.
 * 3. Le delai part de la RECEPTION, pas de la facture ni de la fin des
 *    travaux. Sans reception, le delai n'a pas commence.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import { TAUX_MAX_LEGAL, appliquerRetenue, exigibiliteRetenue } from "../services/retenue-garantie";

describe("le calcul de la retenue", () => {
  it("5 % de 12 000 EUR font 600 EUR retenus", () => {
    const r = appliquerRetenue(12_000, 5);
    expect(r.montant).toBe(600);
    expect(r.netAPayer).toBe(11_400);
  });

  it("le plafond legal est celui de la loi de 1971", () => {
    // Le chiffre EST la regle: 10 % serait une autre loi.
    expect(TAUX_MAX_LEGAL).toBe(5);
  });

  it("un taux nul ne retient rien et n'avertit de rien", () => {
    // Le cas majoritaire hors BTP: aucun bruit ne doit apparaitre.
    const r = appliquerRetenue(12_000, 0);
    expect(r.montant).toBe(0);
    expect(r.netAPayer).toBe(12_000);
    expect(r.avertissements).toEqual([]);
  });

  it("la retenue est arrondie au centime", () => {
    const r = appliquerRetenue(1_234.56, 5);
    expect(r.montant).toBe(61.73);
    expect(r.netAPayer).toBe(1_172.83);
  });

  it("le net a payer et la retenue reconstituent le total", () => {
    // Propriete qui doit tenir a l'arrondi pres, sinon la facture ne tombe
    // pas juste et c'est le client qui le signale.
    for (const total of [12_000, 1_234.56, 99.99, 7]) {
      const r = appliquerRetenue(total, 5);
      expect(Math.abs(r.montant + r.netAPayer - total), String(total)).toBeLessThan(0.02);
    }
  });

  it("un total nul ou absurde ne produit pas NaN", () => {
    // `totalAmount` vient d'une colonne texte: une valeur illisible se
    // propagerait a tout le document.
    expect(appliquerRetenue(0, 5).montant).toBe(0);
    expect(appliquerRetenue(Number.NaN, 5).montant).toBe(0);
    expect(appliquerRetenue(-100, 5).netAPayer).toBe(0);
  });

  it("un taux illisible est traite comme nul", () => {
    expect(appliquerRetenue(12_000, null).montant).toBe(0);
    expect(appliquerRetenue(12_000, "abc").montant).toBe(0);
    expect(appliquerRetenue(12_000, undefined).montant).toBe(0);
  });

  it("un taux saisi en chaine est accepte", () => {
    // La colonne est un `numeric`: le pilote rend une chaine.
    expect(appliquerRetenue(12_000, "5.00").montant).toBe(600);
  });
});

describe("le plafond legal, qui n'est pas un refus", () => {
  it("5 % ne declenche aucun reproche de plafond", () => {
    const r = appliquerRetenue(12_000, 5);
    expect(r.tauxExcedentaire).toBe(0);
    expect(r.avertissements.join(" ")).not.toMatch(/plafond/i);
  });

  it("7 % est ENREGISTRE, et l'exces est chiffre", () => {
    // LE CHOIX. La retenue est imposee par le client: refuser la saisie
    // interdirait a l'utilisateur de decrire son propre chantier, et la
    // facture cesserait de correspondre a la realite.
    const r = appliquerRetenue(12_000, 7);
    expect(r.montant).toBe(840);
    expect(r.tauxExcedentaire).toBe(2);
    expect(r.montantRecuperable).toBe(240);
    expect(r.avertissements.join(" ")).toMatch(/plafond legal/i);
  });

  it("le motif cite la loi, pour etre verifiable", () => {
    expect(appliquerRetenue(12_000, 7).avertissements.join(" ")).toContain("71-584");
  });

  it("l'obligation de consignation est rappelee des qu'il y a retenue", () => {
    // C'est l'obligation la plus souvent ignoree, et celle qui protege
    // l'entrepreneur si le client fait defaut.
    expect(appliquerRetenue(12_000, 5).avertissements.join(" ")).toMatch(/consignee/i);
  });
});

describe("la caution bancaire supprime la retenue", () => {
  it("rien n'est retenu, la totalite est exigible", () => {
    // Art. 2 de la loi. Elle ne REPORTE pas la somme: c'est la banque qui
    // porte le risque, et le client paie tout.
    const r = appliquerRetenue(12_000, 5, { cautionBancaire: true });
    expect(r.montant).toBe(0);
    expect(r.netAPayer).toBe(12_000);
    expect(r.remplaceeParCaution).toBe(true);
  });

  it("un taux saisi malgre la caution est signale comme contradictoire", () => {
    const r = appliquerRetenue(12_000, 5, { cautionBancaire: true });
    expect(r.avertissements.join(" ")).toMatch(/aucune somme ne doit etre retenue/i);
  });

  it("sans taux, la caution ne produit aucun bruit", () => {
    expect(appliquerRetenue(12_000, 0, { cautionBancaire: true }).avertissements).toEqual([]);
  });
});

describe("l'exigibilite part de la reception", () => {
  it("un an apres la reception", () => {
    const d = exigibiliteRetenue("2026-03-10T00:00:00Z");
    expect(d?.toISOString().slice(0, 10)).toBe("2027-03-10");
  });

  it("sans reception, aucune echeance", () => {
    // Calculer depuis la facture ferait reclamer trop tot, et un rappel
    // premature abime la relation avec le client.
    expect(exigibiliteRetenue(null)).toBeNull();
    expect(exigibiliteRetenue(undefined)).toBeNull();
    expect(exigibiliteRetenue("")).toBeNull();
  });

  it("une date illisible ne produit pas d'echeance inventee", () => {
    expect(exigibiliteRetenue("pas-une-date")).toBeNull();
  });

  it("un objet Date est accepte comme une chaine", () => {
    const d = exigibiliteRetenue(new Date("2026-03-10T00:00:00Z"));
    expect(d?.toISOString().slice(0, 10)).toBe("2027-03-10");
  });
});

describe("la facture porte la retenue", () => {
  it("le document expose la retenue et le net a payer", async () => {
    const { buildInvoiceDocument } = await import("../services/invoice-pdf");
    const doc = buildInvoiceDocument(
      {
        reference: "F-1",
        clientName: "Client",
        items: [{ description: "Travaux", quantity: 1, unitPrice: 10_000, taxRate: 20 }],
        retenueGarantieRate: 5,
        receptionDate: "2026-03-10T00:00:00Z",
      },
      { name: "Vendeur" },
    );
    expect(doc.retenue).not.toBeNull();
    expect(doc.retenue!.montant).toBe(600);
    expect(doc.retenue!.netAPayer).toBe(11_400);
    expect(doc.retenue!.exigibleLe?.toISOString().slice(0, 10)).toBe("2027-03-10");
  });

  it("la mention legale cite le montant retenu et la loi", async () => {
    const { buildInvoiceDocument } = await import("../services/invoice-pdf");
    const doc = buildInvoiceDocument(
      {
        reference: "F-1",
        clientName: "Client",
        items: [{ description: "Travaux", quantity: 1, unitPrice: 10_000, taxRate: 20 }],
        retenueGarantieRate: 5,
      },
      { name: "Vendeur" },
    );
    const m = doc.legalMentions.join(" ");
    expect(m).toMatch(/Retenue de garantie de 5 %/);
    expect(m).toContain("71-584");
  });

  it("la TVA reste calculee sur la TOTALITE, pas sur le net a payer", async () => {
    // L'ERREUR LA PLUS COURANTE. 20 % de 10 000 EUR font 2 000 EUR de TVA,
    // que la retenue soit de 5 % ou de zero: elle porte sur le versement, pas
    // sur l'assiette.
    const { buildInvoiceDocument } = await import("../services/invoice-pdf");
    const base = {
      reference: "F-1",
      clientName: "Client",
      items: [{ description: "Travaux", quantity: 1, unitPrice: 10_000, taxRate: 20 }],
    };
    const sans = buildInvoiceDocument(base, { name: "Vendeur" });
    const avec = buildInvoiceDocument({ ...base, retenueGarantieRate: 5 }, { name: "Vendeur" });
    expect(sans.taxAmount).toBe(2_000);
    expect(avec.taxAmount).toBe(2_000);
    expect(avec.totalAmount).toBe(sans.totalAmount);
  });

  it("sans retenue, aucune ligne n'apparait", async () => {
    // Afficher « retenue : 0 EUR » inviterait a en pratiquer une.
    const { buildInvoiceDocument } = await import("../services/invoice-pdf");
    const doc = buildInvoiceDocument(
      { reference: "F-1", clientName: "Client", items: [{ description: "T", quantity: 1, unitPrice: 100, taxRate: 20 }] },
      { name: "Vendeur" },
    );
    expect(doc.retenue).toBeNull();
    expect(doc.legalMentions.join(" ")).not.toMatch(/retenue/i);
  });

  it("une retenue sans date de reception est signalee", async () => {
    const { buildInvoiceDocument } = await import("../services/invoice-pdf");
    const doc = buildInvoiceDocument(
      {
        reference: "F-1",
        clientName: "Client",
        items: [{ description: "T", quantity: 1, unitPrice: 10_000, taxRate: 20 }],
        retenueGarantieRate: 5,
      },
      { name: "Vendeur" },
    );
    expect(doc.retenue!.exigibleLe).toBeNull();
    expect(doc.warnings.join(" ")).toMatch(/reception des travaux n'est pas connue/i);
  });

  it("un devis ne porte jamais de retenue", async () => {
    // Elle s'applique aux paiements, et un devis n'en declenche aucun.
    const { buildDevisDocument } = await import("../services/devis-pdf");
    const doc = buildDevisDocument(
      {
        reference: "D-1",
        clientName: "Client",
        items: [{ description: "T", quantity: 1, unitPrice: 10_000, taxRate: 20 }],
        validUntil: "2026-10-01T00:00:00Z",
      } as never,
      { name: "Vendeur" },
    );
    expect(doc.retenue).toBeNull();
  });
});
