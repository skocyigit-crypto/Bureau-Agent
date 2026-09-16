import {
  buildInvoiceDocument,
  renderInvoicePdf,
  type InvoiceDocument,
  type InvoiceRecord,
  type InvoiceSeller,
} from "./invoice-pdf";

/**
 * Le devis, en tant que DOCUMENT.
 *
 * CE QUI MANQUAIT
 *
 * Mesure du 16/09 : `routes/devis.ts` exposait six routes — lister, lire,
 * creer, modifier, convertir en facture, supprimer — et AUCUNE ne produisait
 * de document. Ni PDF, ni envoi, ni telechargement, ni cote serveur ni dans
 * l'interface (`admin-devis.tsx`, 251 lignes). Le statut « envoye » existait
 * pourtant : il etait declaratif. L'artisan produisait son devis ailleurs,
 * puis venait cocher la case ici.
 *
 * Pour une PME du batiment, le devis est le document qui gagne le chantier,
 * et c'est aussi le plus encadre : l'arrete du 24 janvier 2017 l'impose quel
 * que soit le montant pour le depannage, la reparation et l'entretien, la loi
 * Pinel y impose les six informations d'assurance, et le Code de la
 * consommation les coordonnees du mediateur. La facture etait traitee avec
 * soin dans ce produit; le devis ne l'etait pas du tout.
 *
 * POURQUOI REUTILISER LE CONSTRUCTEUR DE FACTURE
 *
 * Les deux documents partagent le vendeur, l'acheteur, les lignes, la
 * ventilation de TVA, l'assurance et le mediateur. Un second constructeur
 * aurait duplique tout cela — et les deux copies auraient diverge. C'est
 * precisement le mode de panne que cet audit a corrige trois fois ailleurs :
 * une regle appliquee d'un seul cote. Un seul chemin, un parametre.
 */

/** Devis, tel que stocke sur `devis`. */
export interface DevisRecord {
  reference: string;
  title?: string | null;
  description?: string | null;
  clientName: string;
  clientCompany?: string | null;
  clientAddress?: string | null;
  clientEmail?: string | null;
  items?: InvoiceRecord["items"];
  currency?: string | null;
  validUntil?: Date | string | null;
  createdAt?: Date | string | null;
  notes?: string | null;
  conditions?: string | null;
}

export function buildDevisDocument(
  devis: DevisRecord,
  seller: InvoiceSeller,
  now: Date = new Date(),
): InvoiceDocument {
  const enregistrement: InvoiceRecord = {
    reference: devis.reference,
    title: devis.title,
    clientName: devis.clientName,
    clientCompany: devis.clientCompany,
    clientAddress: devis.clientAddress,
    clientEmail: devis.clientEmail,
    items: devis.items,
    currency: devis.currency,
    createdAt: devis.createdAt,
    validUntil: devis.validUntil,
    // Un devis n'a pas d'echeance de reglement: il n'y a pas encore de
    // creance. Le passer a `dueDate` ferait apparaitre une date d'echeance et
    // des penalites de retard sur une offre non acceptee.
    dueDate: null,
    notes: [devis.description, devis.notes].filter(Boolean).join("\n\n") || null,
    conditions: devis.conditions,
  };
  return buildInvoiceDocument(enregistrement, seller, now, "devis");
}

export async function renderDevisPdf(model: InvoiceDocument): Promise<Buffer> {
  // Pas de Factur-X ici: le format couvre la FACTURE electronique. Joindre un
  // XML de facture a un devis produirait un document qu'une plateforme
  // pourrait prendre pour une facture.
  return renderInvoicePdf(model, { documentType: "devis" });
}

export function devisFileName(reference: string): string {
  const propre = reference.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `devis-${propre || "sans-reference"}.pdf`;
}
