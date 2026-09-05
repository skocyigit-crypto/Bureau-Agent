/**
 * Factur-X — facture electronique hybride (Faz D de la chaine Vente).
 *
 * La reforme francaise de la facturation electronique est entree en vigueur le
 * 1er septembre 2026: recevoir une facture electronique structuree n'est plus
 * optionnel, et l'emission le devient par paliers. Un PDF, meme parfaitement
 * conforme au Code de commerce, n'est plus une facture electronique au sens de
 * la reforme: il lui faut les memes donnees sous forme LISIBLE PAR MACHINE.
 *
 * Factur-X repond a cela par un fichier unique: le PDF reste le document que
 * l'humain lit, et le XML CII (UN/CEFACT Cross Industry Invoice, profil EN
 * 16931) y est attache. Les deux doivent porter les MEMES montants — d'ou le
 * choix, ici, de ne rien recalculer: les totaux viennent de
 * `computeInvoiceTotals`, exactement comme le PDF. Deux calculs paralleles
 * finiraient par diverger, et une divergence entre le PDF et son XML est
 * precisement ce qu'un controle detecte.
 *
 * Profil retenu: BASIC. C'est le premier niveau qui porte le DETAIL DES
 * LIGNES, ce que ce produit possede deja; les profils MINIMUM et BASIC WL s'en
 * passent et n'auraient transmis que des totaux. Monter a EN 16931 (COMFORT)
 * exigerait des donnees que le modele ne detient pas encore — reference
 * d'acheteur, moyen de paiement code, conditions structurees — et un profil
 * declare mais incomplet est pire qu'un profil modeste: il annonce au receveur
 * des champs qu'il n'obtiendra pas.
 *
 * Ce module est PUR et ne connait ni PDF ni base de donnees: entrees egales,
 * sortie egale. C'est ce qui le rend verrouillable par des tests, et la
 * conformite d'une facture electronique tient a ce qui DOIT s'y trouver.
 */

import {
  FACTURX_ATTACHMENT_NAME,
  buildInvoiceDocument,
  type InvoiceRecord,
  type InvoiceSeller,
} from "./invoice-pdf";
import type { VatBreakdownEntry } from "./invoice-totals";
import { verifierIdentifiant } from "./siren";

/** Identifiant du profil, tel qu'il doit apparaitre dans le XML ET dans le XMP. */
export const FACTURX_PROFILE_BASIC =
  "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic";

/**
 * Nom de fichier impose par la specification. Un autre nom = non detecte.
 * Sa definition vit dans `invoice-pdf` pour eviter un cycle d'imports.
 */
export const FACTURX_FILENAME = FACTURX_ATTACHMENT_NAME;

/**
 * Code du type de document (UNTDID 1001). 380 = facture commerciale.
 * Un avoir serait 381; le produit n'en emet pas encore.
 */
const DOC_TYPE_INVOICE = "380";

/**
 * Categories de TVA (UNTDID 5305).
 *   S  — taux normal ou reduit applique;
 *   AE — autoliquidation: la TVA est due par le preneur;
 *   E  — exoneree (franchise en base, art. 293 B du CGI);
 *   Z  — taux zero.
 * Le choix n'est pas cosmetique: c'est lui qui dit au receveur QUI doit la
 * TVA. Se tromper de categorie fausse sa comptabilite, pas la notre.
 */
type VatCategory = "S" | "AE" | "E" | "Z";

export interface FacturXResult {
  xml: string;
  profile: string;
  /** Donnees absentes ou non structurables. La facture reste emise. */
  warnings: string[];
}

/** Adresse postale structuree, telle que la CII l'exige. */
interface PostalAddress {
  lines: string[];
  postcode: string | null;
  city: string | null;
  countryCode: string;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
};

/**
 * Echappe le texte destine au XML.
 *
 * Un nom de client contenant « & » ou « < » produirait sinon un XML
 * malforme — que le receveur rejetterait en bloc, sans que rien cote emetteur
 * ne le signale. Les caracteres de controle sont retires: ils sont interdits
 * en XML 1.0 et arrivent regulierement d'un copier-coller.
 */
function xml(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

/** Montant CII: point decimal, deux decimales, jamais de separateur de milliers. */
function amount(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * Pourcentage de TVA. Deux decimales au plus, sans zeros inutiles: 20 et non
 * 20.00, mais 5.5 conserve sa decimale.
 */
function percent(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Date au format UNTDID 2379 « 102 »: AAAAMMJJ. */
function dateCode(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Structure une adresse libre.
 *
 * La CII veut un code pays, et separement un code postal et une ville; le
 * produit ne stocke qu'un texte multiligne saisi a la main. On extrait donc au
 * mieux, et on le DIT quand on echoue plutot que d'inventer: un code postal
 * devine faux voyage jusque dans la comptabilite du client.
 *
 * Le pays par defaut est FR, seul cas ou l'hypothese est sure: l'editeur et
 * ses clients sont etablis en France, et le code pays est obligatoire (BR-09).
 * Une ligne « Belgique » ou « BE » en fin d'adresse est reconnue.
 */
export function parseAddress(raw: string | null | undefined): PostalAddress {
  const lines = (raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const address: PostalAddress = { lines: [], postcode: null, city: null, countryCode: "FR" };
  if (lines.length === 0) return address;

  const remaining = [...lines];

  // Pays eventuel en derniere ligne.
  const COUNTRIES: Record<string, string> = {
    france: "FR", belgique: "BE", belgium: "BE", suisse: "CH", switzerland: "CH",
    luxembourg: "LU", allemagne: "DE", germany: "DE", espagne: "ES", spain: "ES",
    italie: "IT", italy: "IT", "pays-bas": "NL", netherlands: "NL",
  };
  const last = remaining[remaining.length - 1]!.toLowerCase();
  if (COUNTRIES[last]) {
    address.countryCode = COUNTRIES[last]!;
    remaining.pop();
  } else if (/^[A-Z]{2}$/.test(remaining[remaining.length - 1]!)) {
    address.countryCode = remaining.pop()!;
  }

  // « 67500 Haguenau », ou « F-67500 Haguenau ». On cherche depuis la fin: une
  // adresse commence par la voie et finit par la localite.
  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    const m = remaining[i]!.match(/^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/);
    if (m) {
      address.postcode = m[1]!;
      address.city = m[2]!.trim();
      remaining.splice(i, 1);
      break;
    }
  }

  address.lines = remaining;
  return address;
}

/** Categorie de TVA d'un taux, selon le regime de la facture. */
function categoryFor(taxRate: number, autoliquidation: boolean, exempt: boolean): VatCategory {
  if (autoliquidation) return "AE";
  if (exempt) return "E";
  return taxRate > 0 ? "S" : "Z";
}

/**
 * Motif d'exoneration. Obligatoire des que la categorie n'est pas « S »
 * (BR-E-10, BR-AE-10, BR-Z-10): le receveur doit savoir POURQUOI il n'y a pas
 * de TVA, sinon il ne peut pas justifier sa propre declaration.
 */
function exemptionReason(category: VatCategory): string | null {
  switch (category) {
    case "AE": return "Autoliquidation — art. 283-2 nonies du CGI";
    case "E": return "TVA non applicable, art. 293 B du CGI";
    case "Z": return "Taux zero";
    default: return null;
  }
}

function tag(name: string, value: string | null | undefined, indent: string): string {
  if (value === null || value === undefined || value === "") return "";
  return `${indent}<${name}>${value}</${name}>\n`;
}

function addressXml(address: PostalAddress, indent: string): string {
  const [one, two, three] = address.lines;
  return (
    `${indent}<ram:PostalTradeAddress>\n` +
    tag("ram:PostcodeCode", address.postcode ? xml(address.postcode) : null, indent + "  ") +
    tag("ram:LineOne", one ? xml(one) : null, indent + "  ") +
    tag("ram:LineTwo", two ? xml(two) : null, indent + "  ") +
    tag("ram:LineThree", three ? xml(three) : null, indent + "  ") +
    tag("ram:CityName", address.city ? xml(address.city) : null, indent + "  ") +
    tag("ram:CountryID", xml(address.countryCode), indent + "  ") +
    `${indent}</ram:PostalTradeAddress>\n`
  );
}

function tradeTaxXml(
  entry: VatBreakdownEntry,
  category: VatCategory,
  indent: string,
  /**
   * Au niveau LIGNE, la CII n'admet ni montant calcule ni assiette: la ligne
   * dit seulement a quel taux et a quelle categorie elle appartient, et
   * l'assiette est agregee au niveau document. Les emettre quand meme fait
   * rejeter la facture par un controle de schema.
   */
  level: "document" | "line" = "document",
): string {
  const reason = exemptionReason(category);
  const header = level === "document";
  return (
    `${indent}<ram:ApplicableTradeTax>\n` +
    (header ? tag("ram:CalculatedAmount", amount(entry.amount), indent + "  ") : "") +
    tag("ram:TypeCode", "VAT", indent + "  ") +
    tag("ram:ExemptionReason", reason ? xml(reason) : null, indent + "  ") +
    (header ? tag("ram:BasisAmount", amount(entry.base), indent + "  ") : "") +
    tag("ram:CategoryCode", category, indent + "  ") +
    tag("ram:RateApplicablePercent", percent(entry.taxRate), indent + "  ") +
    `${indent}</ram:ApplicableTradeTax>\n`
  );
}

/**
 * Produit le XML CII d'une facture.
 *
 * Les montants ne sont PAS recalcules ici: ils viennent du meme
 * `buildInvoiceDocument` que le PDF. C'est la garantie que le document lu par
 * un humain et celui lu par une machine disent la meme chose.
 */
export function buildFacturXXml(
  invoice: InvoiceRecord,
  seller: InvoiceSeller,
  now: Date = new Date(),
): FacturXResult {
  const doc = buildInvoiceDocument(invoice, seller, now);
  const warnings: string[] = [];

  const autoliquidation = !!invoice.isAutoliquidation;
  // Franchise en base: aucune TVA nulle part alors qu'on n'est pas en
  // autoliquidation. Le document porte deja la mention; ici il faut le CODE.
  const exempt = !autoliquidation && doc.taxAmount === 0 && doc.vatBreakdown.every((v) => v.taxRate === 0);

  const sellerAddress = parseAddress(seller.address);
  const buyerAddress = parseAddress(invoice.clientAddress);
  if (!sellerAddress.city || !sellerAddress.postcode) {
    warnings.push("L'adresse du vendeur n'a pas pu etre structuree (code postal / ville).");
  }
  if (!buyerAddress.city || !buyerAddress.postcode) {
    warnings.push("L'adresse du client n'a pas pu etre structuree (code postal / ville).");
  }

  // Identifiant de l'acheteur: verifie avant d'etre ecrit. Un numero mal
  // recopie serait pire qu'absent — il routerait la facture vers une autre
  // entreprise.
  const buyerId = verifierIdentifiant(invoice.clientSiren);
  if (!buyerId.valide) {
    warnings.push(
      buyerId.motif === "identifiant absent"
        ? "Le SIREN du client est absent: la facture ne pourra pas etre routee."
        : `L'identifiant du client est invalide (${buyerId.motif}): il ne sera pas transmis.`,
    );
  }

  const siret = (seller.siret ?? "").replace(/\s/g, "");
  if (!siret) warnings.push("Le SIRET du vendeur est absent: l'identification legale du vendeur sera omise.");
  const sellerVat = (seller.tvaNumber ?? "").replace(/\s/g, "");
  if (!sellerVat && !exempt) {
    warnings.push("Le numero de TVA intracommunautaire du vendeur est absent.");
  }

  const currency = doc.currency;

  // --- Lignes ---------------------------------------------------------------
  const lineItems = doc.lines.map((line, index) => {
    const category = categoryFor(line.taxRate, autoliquidation, exempt);
    const i = "      ";
    return (
      `${i}<ram:IncludedSupplyChainTradeLineItem>\n` +
      `${i}  <ram:AssociatedDocumentLineDocument>\n` +
      tag("ram:LineID", String(index + 1), i + "    ") +
      `${i}  </ram:AssociatedDocumentLineDocument>\n` +
      `${i}  <ram:SpecifiedTradeProduct>\n` +
      tag("ram:Name", xml(line.description || `Ligne ${index + 1}`), i + "    ") +
      `${i}  </ram:SpecifiedTradeProduct>\n` +
      `${i}  <ram:SpecifiedLineTradeAgreement>\n` +
      `${i}    <ram:NetPriceProductTradePrice>\n` +
      tag("ram:ChargeAmount", amount(line.unitPrice), i + "      ") +
      `${i}    </ram:NetPriceProductTradePrice>\n` +
      `${i}  </ram:SpecifiedLineTradeAgreement>\n` +
      `${i}  <ram:SpecifiedLineTradeDelivery>\n` +
      // C62 = unite (UN/ECE Recommandation 20). Le produit ne stocke pas
      // d'unite par ligne; C62 est le code neutre prevu pour ce cas.
      `${i}    <ram:BilledQuantity unitCode="C62">${amount(line.quantity)}</ram:BilledQuantity>\n` +
      `${i}  </ram:SpecifiedLineTradeDelivery>\n` +
      `${i}  <ram:SpecifiedLineTradeSettlement>\n` +
      tradeTaxXml({ taxRate: line.taxRate, base: line.total, amount: 0 }, category, i + "    ", "line") +
      `${i}    <ram:SpecifiedTradeSettlementLineMonetarySummation>\n` +
      tag("ram:LineTotalAmount", amount(line.total), i + "      ") +
      `${i}    </ram:SpecifiedTradeSettlementLineMonetarySummation>\n` +
      `${i}  </ram:SpecifiedLineTradeSettlement>\n` +
      `${i}</ram:IncludedSupplyChainTradeLineItem>\n`
    );
  }).join("");

  // --- Ventilation de TVA ---------------------------------------------------
  const taxes = doc.vatBreakdown.map((entry) =>
    tradeTaxXml(entry, categoryFor(entry.taxRate, autoliquidation, exempt), "        "),
  ).join("");

  const buyerName = xml(doc.buyer.name || "Client");
  const sellerName = xml(doc.seller.name || "");

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsm:CrossIndustryInvoice` +
    ` xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"` +
    ` xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"` +
    ` xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">\n` +
    `  <rsm:ExchangedDocumentContext>\n` +
    `    <ram:GuidelineSpecifiedDocumentContextParameter>\n` +
    `      <ram:ID>${FACTURX_PROFILE_BASIC}</ram:ID>\n` +
    `    </ram:GuidelineSpecifiedDocumentContextParameter>\n` +
    `  </rsm:ExchangedDocumentContext>\n` +
    `  <rsm:ExchangedDocument>\n` +
    `    <ram:ID>${xml(doc.reference)}</ram:ID>\n` +
    `    <ram:TypeCode>${DOC_TYPE_INVOICE}</ram:TypeCode>\n` +
    `    <ram:IssueDateTime>\n` +
    `      <udt:DateTimeString format="102">${dateCode(doc.issueDate)}</udt:DateTimeString>\n` +
    `    </ram:IssueDateTime>\n` +
    `  </rsm:ExchangedDocument>\n` +
    `  <rsm:SupplyChainTradeTransaction>\n` +
    lineItems +
    `    <ram:ApplicableHeaderTradeAgreement>\n` +
    `      <ram:SellerTradeParty>\n` +
    tag("ram:Name", sellerName, "        ") +
    (siret
      ? `        <ram:SpecifiedLegalOrganization>\n` +
        `          <ram:ID schemeID="0002">${xml(siret)}</ram:ID>\n` +
        `        </ram:SpecifiedLegalOrganization>\n`
      : "") +
    addressXml(sellerAddress, "        ") +
    (sellerVat
      ? `        <ram:SpecifiedTaxRegistration>\n` +
        `          <ram:ID schemeID="VA">${xml(sellerVat)}</ram:ID>\n` +
        `        </ram:SpecifiedTaxRegistration>\n`
      : "") +
    `      </ram:SellerTradeParty>\n` +
    `      <ram:BuyerTradeParty>\n` +
    tag("ram:Name", buyerName, "        ") +
    // Identification legale de l'acheteur. Le schemeID "0002" designe le
    // repertoire SIRENE, comme pour le vendeur juste au-dessus. C'est sur cet
    // identifiant que l'annuaire central route la facture: sans lui, elle
    // n'atteint pas son destinataire, quelle que soit la qualite du reste.
    (buyerId.valide && buyerId.valeur
      ? `        <ram:SpecifiedLegalOrganization>\n` +
        `          <ram:ID schemeID="0002">${xml(buyerId.valeur)}</ram:ID>\n` +
        `        </ram:SpecifiedLegalOrganization>\n`
      : "") +
    addressXml(buyerAddress, "        ") +
    `      </ram:BuyerTradeParty>\n` +
    `    </ram:ApplicableHeaderTradeAgreement>\n` +
    // La livraison n'est pas suivie par le produit: l'element reste present
    // mais vide, ce que le profil BASIC autorise. L'omettre casserait l'ordre
    // impose des elements.
    `    <ram:ApplicableHeaderTradeDelivery/>\n` +
    `    <ram:ApplicableHeaderTradeSettlement>\n` +
    `      <ram:InvoiceCurrencyCode>${xml(currency)}</ram:InvoiceCurrencyCode>\n` +
    taxes +
    (doc.dueDate
      ? `      <ram:SpecifiedTradePaymentTerms>\n` +
        `        <ram:DueDateDateTime>\n` +
        `          <udt:DateTimeString format="102">${dateCode(doc.dueDate)}</udt:DateTimeString>\n` +
        `        </ram:DueDateDateTime>\n` +
        `      </ram:SpecifiedTradePaymentTerms>\n`
      : "") +
    `      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>\n` +
    tag("ram:LineTotalAmount", amount(doc.subtotal), "        ") +
    tag("ram:TaxBasisTotalAmount", amount(doc.subtotal), "        ") +
    `        <ram:TaxTotalAmount currencyID="${xml(currency)}">${amount(doc.taxAmount)}</ram:TaxTotalAmount>\n` +
    tag("ram:GrandTotalAmount", amount(doc.totalAmount), "        ") +
    tag("ram:TotalPrepaidAmount", amount(doc.paidAmount), "        ") +
    tag("ram:DuePayableAmount", amount(doc.remaining), "        ") +
    `      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>\n` +
    `    </ram:ApplicableHeaderTradeSettlement>\n` +
    `  </rsm:SupplyChainTradeTransaction>\n` +
    `</rsm:CrossIndustryInvoice>\n`;

  // Les avertissements du document (mentions legales absentes) valent aussi
  // pour le XML: c'est la meme facture.
  return { xml: body, profile: FACTURX_PROFILE_BASIC, warnings: [...doc.warnings, ...warnings] };
}
