/**
 * L'identite du vendeur telle qu'elle figure sur une facture, lue UNE fois.
 *
 * Le meme bloc de vingt champs etait recopie dans la route du PDF et dans
 * celle du XML Factur-X ; la transmission a la plateforme agreee en aurait
 * ajoute une troisieme copie. Trois copies, et la premiere mention ajoutee a
 * l'une (assurance, mediateur) manque aux deux autres : le PDF telecharge et
 * celui transmis a l'administration ne diraient plus la meme chose.
 */
import { eq } from "drizzle-orm";
import { db, organisationsTable, type FactureClient } from "@workspace/db";
import { buildInvoiceDocument, renderInvoicePdf } from "./invoice-pdf";
import { buildFacturXXml } from "./facturx";

export async function vendeurFacture(orgId: number) {
  const [org] = await db.select({
    name: organisationsTable.name,
    legalForm: organisationsTable.legalForm,
    capital: organisationsTable.capital,
    address: organisationsTable.address,
    siret: organisationsTable.siret,
    tvaNumber: organisationsTable.tvaNumber,
    email: organisationsTable.email,
    phone: organisationsTable.phone,
    bankName: organisationsTable.bankName,
    bankIban: organisationsTable.bankIban,
    bankBic: organisationsTable.bankBic,
    invoiceFooter: organisationsTable.invoiceFooter,
    assuranceNom: organisationsTable.assuranceNom,
    assuranceAdresse: organisationsTable.assuranceAdresse,
    assuranceContrat: organisationsTable.assuranceContrat,
    assuranceActivites: organisationsTable.assuranceActivites,
    assuranceZone: organisationsTable.assuranceZone,
    mediateurNom: organisationsTable.mediateurNom,
    mediateurAdresse: organisationsTable.mediateurAdresse,
    mediateurUrl: organisationsTable.mediateurUrl,
  }).from(organisationsTable).where(eq(organisationsTable.id, orgId));
  return org;
}

/**
 * Le PDF Factur-X complet d'une facture : lisible, XML CII attache, produit
 * depuis le MEME enregistrement. C'est ce fichier-la que l'on telecharge et
 * celui que l'on transmet a la plateforme agreee.
 */
export async function pdfFacturX(facture: FactureClient, orgId: number) {
  const org = await vendeurFacture(orgId);
  const model = buildInvoiceDocument(facture, org ?? {});
  const facturX = buildFacturXXml(facture, org ?? {});
  const pdf = await renderInvoicePdf(model, { facturXXml: facturX.xml });
  return { pdf, avertissements: model.warnings };
}
