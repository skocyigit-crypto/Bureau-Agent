/**
 * Le devis existe enfin en tant que document.
 *
 * CE QUI MANQUAIT — MESURE DU 16/09
 *
 * `routes/devis.ts` exposait six routes — lister, lire, creer, modifier,
 * convertir en facture, supprimer — et AUCUNE ne produisait de document. Pas
 * de PDF, pas d'envoi, pas de telechargement, ni cote serveur ni dans
 * l'interface (`admin-devis.tsx`, 251 lignes, aucune action d'export). Le
 * statut « envoye » existait pourtant : il etait purement declaratif.
 * L'artisan redigeait son devis ailleurs, puis venait cocher la case ici.
 *
 * Pour une PME du batiment, c'est le document qui gagne le chantier — et le
 * plus encadre : l'arrete du 24 janvier 2017 impose le devis quel que soit le
 * montant pour le depannage, la reparation et l'entretien; la loi n° 2014-626
 * y impose les six informations d'assurance; le Code de la consommation les
 * coordonnees du mediateur. La facture etait traitee avec un soin considerable
 * dans ce produit. Le devis ne l'etait pas du tout.
 *
 * CE QUE CES TESTS VERROUILLENT
 *
 * Deux choses distinctes: que le devis porte ce qu'un devis doit porter, et
 * qu'il ne porte PAS ce qui appartient a la facture. La seconde compte autant:
 * un devis affichant une date d'echeance et des penalites de retard laisse
 * croire a une creance sur une offre qui n'a pas encore ete acceptee.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { describe, expect, it } from "vitest";

import { buildDevisDocument, devisFileName, renderDevisPdf, type DevisRecord } from "../services/devis-pdf";
import { buildInvoiceDocument, type InvoiceSeller } from "../services/invoice-pdf";

const VENDEUR: InvoiceSeller = {
  name: "Batiment Durand SARL",
  address: "4 rue du Chantier\n69003 Lyon",
  siret: "90123456700018",
  tvaNumber: "FR12901234567",
  assuranceNom: "AXA France IARD",
  assuranceAdresse: "313 Terrasses de l'Arche, 92727 Nanterre",
  assuranceContrat: "RCD-2026-889041",
  assuranceActivites: "Maconnerie, platrerie, carrelage",
  assuranceZone: "France metropolitaine et DOM",
  mediateurNom: "CNPM — Mediation de la consommation",
  mediateurAdresse: "27 avenue de la Liberte, 97200 Fort-de-France",
  mediateurUrl: "https://cnpm-mediation-consommation.eu",
};

const DEVIS: DevisRecord = {
  reference: "D-2026-0042",
  title: "Renovation salle de bain",
  description: "Depose, plomberie, carrelage mural et sol.",
  clientName: "Mme Martin",
  clientAddress: "8 rue Victor Hugo\n69002 Lyon",
  items: [
    { description: "Depose existant", quantity: 1, unitPrice: 800, taxRate: 10 },
    { description: "Fourniture carrelage", quantity: 20, unitPrice: 45, taxRate: 10 },
  ],
  createdAt: "2026-09-01T09:00:00Z",
  validUntil: "2026-10-01T09:00:00Z",
};

const doc = () => buildDevisDocument(DEVIS, VENDEUR);

describe("le devis porte ce qu'un devis doit porter", () => {
  it("la duree de validite de l'offre y figure", () => {
    // Mention obligatoire (arrete du 24 janvier 2017): passe ce delai, le
    // professionnel n'est plus engage par les prix annonces.
    expect(doc().payment.join(" ")).toMatch(/Validite de l'offre/i);
    expect(doc().payment.join(" ")).toContain("01/10/2026");
  });

  it("son absence est signalee", () => {
    const d = buildDevisDocument({ ...DEVIS, validUntil: null }, VENDEUR);
    expect(d.warnings.some((w) => /validite/i.test(w))).toBe(true);
  });

  it("l'assurance professionnelle y figure", () => {
    // Elle est exigee sur le devis AUTANT que sur la facture — c'est meme le
    // document que le client compare avant de signer.
    expect(doc().legalMentions.some((m) => m.includes("Assurance professionnelle"))).toBe(true);
    expect(doc().legalMentions.some((m) => m.includes("RCD-2026-889041"))).toBe(true);
  });

  it("le mediateur de la consommation y figure", () => {
    // Un devis de renovation de salle de bain s'adresse typiquement a un
    // particulier: c'est exactement le cas que L616-1 vise.
    expect(doc().legalMentions.some((m) => /mediateur/i.test(m))).toBe(true);
  });

  it("les lignes et la ventilation de TVA sont calculees comme sur une facture", () => {
    const d = doc();
    expect(d.lines).toHaveLength(2);
    expect(d.subtotal).toBe(1700);
    expect(d.vatBreakdown).toHaveLength(1);
    expect(d.vatBreakdown[0]!.taxRate).toBe(10);
    expect(d.totalAmount).toBe(1870);
  });

  it("la description du chantier est reprise dans le document", () => {
    expect(doc().notes.join(" ")).toContain("plomberie");
  });

  it("un vendeur complet ne produit aucun reproche", () => {
    // Garde-fou: si la liste n'est jamais vide, les avertissements deviennent
    // du bruit et personne ne les lit.
    expect(doc().warnings).toEqual([]);
  });
});

describe("le devis ne porte PAS ce qui appartient a la facture", () => {
  it("aucune date d'echeance de reglement", () => {
    // Une echeance sur un devis laisse croire a une creance exigible.
    expect(doc().payment.join(" ")).not.toMatch(/echeance/i);
    expect(doc().dueDate).toBeNull();
  });

  it("aucune penalite de retard ni indemnite de recouvrement", () => {
    // Elles sanctionnent un retard de PAIEMENT. Avant acceptation, il n'y a
    // rien a payer.
    const m = doc().legalMentions.join(" ");
    expect(m).not.toMatch(/Penalites de retard/i);
    expect(m).not.toMatch(/indemnite forfaitaire/i);
  });

  it("l'absence d'echeance n'est pas reprochee au devis", () => {
    // La facture, elle, doit la porter — et le reproche doit rester la-bas.
    expect(doc().warnings.some((w) => /echeance/i.test(w))).toBe(false);

    const facture = buildInvoiceDocument(
      { reference: "F-1", clientName: "X", items: DEVIS.items, dueDate: null },
      VENDEUR,
    );
    expect(facture.warnings.some((w) => /echeance/i.test(w)), "le reproche a disparu de la facture").toBe(true);
  });

  it("la categorie de l'operation n'est pas reprochee au devis", () => {
    // Mention du decret 2022-1299, propre a la facture. L'exiger ici ferait
    // crier au loup sur un document qui n'y est pas soumis.
    expect(doc().warnings.some((w) => /categorie de l'operation/i.test(w))).toBe(false);
  });

  it("le plafond de delai de paiement ne s'applique pas au devis", () => {
    // Il n'y a pas d'echeance a comparer: le signaler enverrait l'utilisateur
    // chercher un probleme inexistant.
    const d = buildDevisDocument({ ...DEVIS, validUntil: "2027-06-01T09:00:00Z" }, VENDEUR);
    expect(d.warnings.some((w) => /delai de paiement/i.test(w))).toBe(false);
  });
});

describe("le fichier produit", () => {
  it("le nom de fichier est derive de la reference", () => {
    expect(devisFileName("D-2026-0042")).toBe("devis-D-2026-0042.pdf");
  });

  it("une reference exotique ne produit pas un nom de fichier dangereux", () => {
    // Une reference vient de l'utilisateur: elle ne doit pas pouvoir sortir du
    // nom de fichier via des separateurs de chemin ou des guillemets.
    const nom = devisFileName('../../etc/passwd"; rm -rf /');
    expect(nom).not.toContain("/");
    expect(nom).not.toContain("\\");
    expect(nom).not.toContain('"');
    expect(nom.startsWith("devis-")).toBe(true);
  });

  it("une reference vide donne quand meme un nom exploitable", () => {
    expect(devisFileName("")).toBe("devis-sans-reference.pdf");
  });

  it("le PDF est reellement produit et commence par l'entete PDF", async () => {
    // La verification qui compte pour l'utilisateur: le fichier s'ouvre.
    const pdf = await renderDevisPdf(doc());
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("le document s'intitule DEVIS, pas FACTURE", async () => {
    // Le meme moteur de rendu sert les deux: sans ce test, un devis pourrait
    // sortir avec le titre FACTURE et personne ne s'en apercevrait avant un
    // client.
    const pdf = await renderDevisPdf(doc());
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { extractTextFromFile } = await import("../services/document-ai");

    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "devis-pdf-"));
    const fichier = path.join(dossier, "devis.pdf");
    try {
      await fs.writeFile(fichier, pdf);
      const texte = (await extractTextFromFile(pdf.toString("base64"), "application/pdf", "devis.pdf")) ?? "";
      expect(texte).toContain("DEVIS");
      expect(texte).not.toContain("FACTURE");
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  });
});
