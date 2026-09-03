import { describe, expect, it } from "vitest";

import { buildFacturXXml } from "../services/facturx";
import {
  FACTURX_ATTACHMENT_NAME,
  buildInvoiceDocument,
  renderInvoicePdf,
} from "../services/invoice-pdf";

/**
 * Le XML voyage-t-il vraiment DANS le PDF, et sous la bonne etiquette.
 *
 * Une piece jointe se perd en silence. Le PDF s'ouvre, s'imprime, s'envoie —
 * il a l'air parfaitement normal — et la machine qui devait y lire la facture
 * ne trouve rien. Aucune erreur, aucun ecran rouge: juste un rejet plus tard,
 * chez le receveur.
 *
 * Deux details decident de tout, et ni l'un ni l'autre n'est visible a l'oeil:
 *
 *   - le NOM du fichier joint. Un lecteur cherche exactement `factur-x.xml`;
 *     sous un autre nom la piece existe mais personne ne la regarde;
 *   - la RELATION `/AFRelationship /Data`, qui dit que cette piece EST la
 *     facture et non un document annexe. Elle est produite par une option que
 *     les types livres de pdfkit (0.17.6, en retard sur pdfkit 0.18)
 *     ne declarent meme pas: si une mise a jour la retirait, le code
 *     continuerait de compiler et de repondre 200.
 *
 * Ces tests lisent donc les octets du PDF produit, pas l'intention du code.
 */

const SELLER = {
  name: "SK GROUP",
  legalForm: "SAS",
  address: "17 rue Saint-Exupery\n67500 Haguenau",
  siret: "12345678901234",
  tvaNumber: "FR12345678901",
};

const INVOICE = {
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

async function renderWithXml() {
  const model = buildInvoiceDocument(INVOICE as never, SELLER as never, NOW);
  const facturX = buildFacturXXml(INVOICE as never, SELLER as never, NOW);
  const pdf = await renderInvoicePdf(model, { facturXXml: facturX.xml });
  return { pdf, raw: pdf.toString("latin1"), facturX, model };
}

describe("le XML voyage dans le PDF", () => {
  it("joint le fichier sous le nom impose par la specification", async () => {
    const { raw } = await renderWithXml();
    expect(FACTURX_ATTACHMENT_NAME).toBe("factur-x.xml");
    expect(raw).toContain("factur-x.xml");
    // Le catalogue doit reellement porter un arbre de fichiers joints; sans
    // lui, le nom serait present mais la piece inatteignable.
    expect(raw).toContain("/EmbeddedFiles");
    expect(raw).toContain("/Filespec");
  });

  it("marque la piece comme ETANT la facture, pas comme une annexe", async () => {
    const { raw } = await renderWithXml();
    const m = raw.match(/\/AFRelationship\s*\/(\w+)/);
    expect(m, "aucune relation /AFRelationship dans le PDF").not.toBeNull();
    expect(m![1]).toBe("Data");
    // La reference depuis le document lui-meme, sans laquelle un lecteur
    // strict ne relie pas la piece a la facture.
    expect(raw).toContain("/AF");
  });

  it("n'ajoute rien quand aucun XML n'est fourni", async () => {
    // La route PDF doit rester utilisable seule: joindre un fichier vide
    // serait pire que de ne rien joindre.
    const model = buildInvoiceDocument(INVOICE as never, SELLER as never, NOW);
    const raw = (await renderInvoicePdf(model)).toString("latin1");
    expect(raw).not.toContain("factur-x.xml");
    expect(raw).not.toContain("/EmbeddedFiles");
  });
});

describe("le PDF et son XML disent la meme chose", () => {
  it("porte les memes totaux des deux cotes", async () => {
    const { facturX, model } = await renderWithXml();
    // Ils sont produits par deux chemins distincts. Le jour ou l'un
    // recalculera de son cote, l'ecart ne se verra sur aucun ecran — mais un
    // controle fiscal compare precisement ces deux valeurs.
    const grand = facturX.xml.match(/<ram:GrandTotalAmount>([\d.]+)</)?.[1];
    const base = facturX.xml.match(/<ram:TaxBasisTotalAmount>([\d.]+)</)?.[1];
    const tax = facturX.xml.match(/<ram:TaxTotalAmount[^>]*>([\d.]+)</)?.[1];

    expect(grand).toBe(model.totalAmount.toFixed(2));
    expect(base).toBe(model.subtotal.toFixed(2));
    expect(tax).toBe(model.taxAmount.toFixed(2));
  });

  it("porte la meme reference et la meme echeance", async () => {
    const { facturX, model } = await renderWithXml();
    expect(facturX.xml).toContain(`<ram:ID>${model.reference}</ram:ID>`);
    expect(facturX.xml).toContain("20261003");
  });

  it("remonte les memes avertissements que le document", async () => {
    // Une mention obligatoire absente l'est dans les deux formats: le XML ne
    // doit pas paraitre plus sain que le PDF.
    const sansAdresse = { ...INVOICE, clientAddress: null };
    const model = buildInvoiceDocument(sansAdresse as never, SELLER as never, NOW);
    const facturX = buildFacturXXml(sansAdresse as never, SELLER as never, NOW);
    for (const w of model.warnings) expect(facturX.warnings).toContain(w);
  });
});

describe("ce qui n'est PAS revendique", () => {
  it("ne declare pas une conformite PDF/A qu'il ne tient pas", async () => {
    const { raw } = await renderWithXml();
    // Factur-X exige un PDF/A-3, dont une regle centrale est l'incorporation
    // de toutes les polices. Le document utilise les polices standard, que
    // pdfkit n'incorpore pas: aucun `/FontFile` n'est produit. Declarer
    // `pdfaid:part 3` serait donc une affirmation fausse — exactement le
    // defaut que ce depot corrige ailleurs. Tant que la police n'est pas
    // livree, le PDF reste un PDF ordinaire portant le XML.
    expect(raw).not.toContain("/FontFile");
    expect(raw).not.toContain("pdfaid:part");
  });
});
