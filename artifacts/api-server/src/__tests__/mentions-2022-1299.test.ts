/**
 * Les quatre mentions du decret n° 2022-1299, sur le PDF et dans le XML.
 *
 * Ce fichier existe pour une raison precise: ces mentions ne se voient pas.
 * Une facture a laquelle il manque le SIREN du client s'imprime, s'envoie et
 * se paie — jusqu'au controle, ou l'article 1737 du CGI compte 15 € par
 * mention manquante, et jusqu'au jour ou l'annuaire central refuse de router
 * la facture faute d'adresse. Rien dans le produit ne signale la perte. Les
 * tests, si.
 */
import { describe, expect, it } from "vitest";

import { buildFacturXXml } from "../services/facturx";
import { buildInvoiceDocument, type InvoiceRecord, type InvoiceSeller } from "../services/invoice-pdf";
import { MENTION_TVA_DEBITS } from "../services/siren";

const SIRET_CLIENT = "55210055400013";
const SIREN_CLIENT = "552100554";

const vendeur: InvoiceSeller = {
  name: "Ajant Bureau SAS",
  address: "12 rue des Lilas\n75011 Paris",
  siret: "89012345600012",
  tvaNumber: "FR12890123456",
};

function facture(extra: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    reference: "F-2027-0001",
    clientName: "Entreprise Martin",
    clientAddress: "3 avenue du Port\n69002 Lyon",
    items: [{ description: "Pose de carrelage", quantity: 1, unitPrice: 1000, taxRate: 20 }],
    dueDate: "2027-10-30",
    createdAt: "2027-09-30",
    ...extra,
  };
}

describe("mentions obligatoires sur le document", () => {
  it("porte l'identifiant du client et la categorie de l'operation", () => {
    const doc = buildInvoiceDocument(
      facture({ clientSiren: SIRET_CLIENT, operationCategory: "services" }),
      vendeur,
    );
    expect(doc.buyer.lines.join(" | ")).toContain(`SIRET : ${SIRET_CLIENT}`);
    expect(doc.legalMentions.join(" | ")).toContain("Prestation de services");
  });

  it("recopie la mention des debits a l'identique, et seulement sur option", () => {
    const sans = buildInvoiceDocument(facture({ clientSiren: SIREN_CLIENT }), vendeur);
    expect(sans.legalMentions.join(" | ")).not.toContain("d'apres les debits");

    const avec = buildInvoiceDocument(
      facture({ clientSiren: SIREN_CLIENT, vatOnDebits: true }),
      vendeur,
    );
    expect(avec.legalMentions.join(" | ")).toContain(MENTION_TVA_DEBITS);
  });

  it("n'imprime l'adresse de livraison que si elle differe de la facturation", () => {
    const identique = buildInvoiceDocument(
      facture({ clientSiren: SIREN_CLIENT, deliveryAddress: "3 avenue du Port\n69002 Lyon" }),
      vendeur,
    );
    expect(identique.buyer.lines.join(" | ")).not.toContain("Livraison :");

    const chantier = buildInvoiceDocument(
      facture({ clientSiren: SIREN_CLIENT, deliveryAddress: "Chantier ZAC Nord\n69100 Villeurbanne" }),
      vendeur,
    );
    expect(chantier.buyer.lines.join(" | ")).toContain("Chantier ZAC Nord");
  });

  it("avertit quand une mention manque, plutot que d'emettre en silence", () => {
    const doc = buildInvoiceDocument(facture(), vendeur);
    const avertissements = doc.warnings.join(" | ");
    expect(avertissements).toContain("SIREN du client est absent");
    expect(avertissements).toContain("categorie de l'operation est absente");
  });

  it("refuse d'imprimer un identifiant mal recopie", () => {
    // Chiffre transpose: la longueur est bonne, la cle ne tombe plus juste.
    // L'imprimer serait pire que de ne rien mettre — la facture partirait
    // vers une autre entreprise.
    const doc = buildInvoiceDocument(facture({ clientSiren: "552100545" }), vendeur);
    expect(doc.buyer.lines.join(" | ")).not.toContain("552100545");
    expect(doc.warnings.join(" | ")).toContain("invalide");
  });
});

describe("identite de l'acheteur dans le XML", () => {
  it("ecrit le SIREN du client sous le schemeID du repertoire SIRENE", () => {
    const { xml } = buildFacturXXml(
      facture({ clientSiren: SIRET_CLIENT, operationCategory: "biens" }),
      vendeur,
    );
    // L'annuaire central route sur cet element: sa presence est la condition
    // de delivrance de la facture.
    expect(xml).toContain(
      `<ram:BuyerTradeParty>`,
    );
    const buyerBlock = xml.slice(xml.indexOf("<ram:BuyerTradeParty>"), xml.indexOf("</ram:BuyerTradeParty>"));
    expect(buyerBlock).toContain(`<ram:ID schemeID="0002">${SIRET_CLIENT}</ram:ID>`);
  });

  it("n'ecrit rien plutot qu'un identifiant faux, et le dit", () => {
    const { xml, warnings } = buildFacturXXml(facture({ clientSiren: "552100545" }), vendeur);
    const buyerBlock = xml.slice(xml.indexOf("<ram:BuyerTradeParty>"), xml.indexOf("</ram:BuyerTradeParty>"));
    expect(buyerBlock).not.toContain("SpecifiedLegalOrganization");
    expect(warnings.join(" | ")).toContain("invalide");
  });

  it("signale l'absence de SIREN comme un defaut de routage, pas de forme", () => {
    const { warnings } = buildFacturXXml(facture(), vendeur);
    expect(warnings.join(" | ")).toContain("ne pourra pas etre routee");
  });
});
