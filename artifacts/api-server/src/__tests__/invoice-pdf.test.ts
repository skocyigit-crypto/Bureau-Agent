/**
 * Ce que la loi exige d'une facture francaise ne depend pas de la mise en page:
 * ces tests verrouillent le MODELE (`buildInvoiceDocument`), pur et
 * deterministe, et ne verifient du rendu que ce qui doit rester vrai — un PDF
 * valide, complet, produit sans exception.
 */
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  AUTOLIQUIDATION_MENTION,
  buildInvoiceDocument,
  invoiceFileName,
  LATE_PENALTY_MENTION,
  NO_DISCOUNT_MENTION,
  RECOVERY_INDEMNITY_MENTION,
  renderInvoicePdf,
  toWinAnsiText,
  VAT_EXEMPT_MENTION,
  type InvoiceRecord,
  type InvoiceSeller,
} from "../services/invoice-pdf";


/**
 * Texte reellement dessine dans le PDF: on decompresse le flux de contenu et
 * on recolle les fragments hexadecimaux emis par pdfkit. Verifier le modele ne
 * suffit pas — l encodage de la police peut encore abimer un montant.
 */
function drawnText(pdf: Buffer): string {
  const start = pdf.indexOf("stream");
  const end = pdf.indexOf("endstream", start);
  let from = start + "stream".length;
  while (pdf[from] === 13 || pdf[from] === 10) from++;
  let to = end;
  while (pdf[to - 1] === 10 || pdf[to - 1] === 13) to--;
  const content = inflateSync(pdf.subarray(from, to)).toString("latin1");
  return content
    .split("Tm")
    .map((segment) => [...segment.matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join(""))
    .join("\n");
}

const NOW = new Date("2026-09-02T10:00:00.000Z");

const SELLER: InvoiceSeller = {
  name: "Agent de Bureau SAS",
  legalForm: "SAS",
  capital: "10 000 EUR",
  address: "12 rue des Lilas\n75011 Paris",
  siret: "90123456700018",
  tvaNumber: "FR12901234567",
  email: "contact@agentdebureau.fr",
  phone: "01 23 45 67 89",
  bankName: "Qonto",
  bankIban: "FR7616798000010000123456789",
  bankBic: "QNTOFRP1XXX",
  invoiceFooter: "Merci de votre confiance.",
};

const INVOICE: InvoiceRecord = {
  reference: "FAC-2026-0007",
  title: "Prestation de conseil",
  clientName: "Marie Durand",
  clientCompany: "Durand Travaux",
  clientAddress: "5 avenue du Port\n33000 Bordeaux",
  clientEmail: "compta@durand-travaux.fr",
  // Mentions du decret n° 2022-1299: une facture qui ne les porte pas n'est
  // plus complete, et cette fixture est celle de la facture COMPLETE.
  clientSiren: "552100554",
  operationCategory: "services",
  items: [
    { description: "Journee de conseil", quantity: 3, unitPrice: 600, taxRate: 20 },
    { description: "Deplacement", quantity: 1, unitPrice: 120, taxRate: 10 },
  ],
  paidAmount: "0",
  currency: "EUR",
  isAutoliquidation: false,
  dueDate: "2026-10-02T00:00:00.000Z",
  createdAt: "2026-09-02T08:00:00.000Z",
  paymentMethod: "Virement",
  conditions: "Paiement a 30 jours.",
};

describe("buildInvoiceDocument — mentions obligatoires", () => {
  it("porte les quatre mentions exigees de toute facture", () => {
    const doc = buildInvoiceDocument(INVOICE, SELLER, NOW);

    expect(doc.legalMentions).toContain(LATE_PENALTY_MENTION);
    expect(doc.legalMentions).toContain(RECOVERY_INDEMNITY_MENTION);
    expect(doc.legalMentions).toContain(NO_DISCOUNT_MENTION);
    expect(doc.payment.some((l) => l.startsWith("Date d'echeance"))).toBe(true);
  });

  it("identifie le vendeur avec SIRET, TVA, forme juridique et capital", () => {
    const doc = buildInvoiceDocument(INVOICE, SELLER, NOW);

    expect(doc.seller.name).toBe("Agent de Bureau SAS");
    expect(doc.seller.lines).toContain("SAS — capital 10 000 EUR");
    expect(doc.seller.lines).toContain("SIRET 90123456700018");
    expect(doc.seller.lines).toContain("TVA intracommunautaire FR12901234567");
    expect(doc.seller.lines).toContain("12 rue des Lilas");
    expect(doc.seller.lines).toContain("75011 Paris");
    expect(doc.warnings).toEqual([]);
  });

  it("identifie l'acheteur par sa raison sociale puis son interlocuteur", () => {
    const doc = buildInvoiceDocument(INVOICE, SELLER, NOW);

    expect(doc.buyer.name).toBe("Durand Travaux");
    expect(doc.buyer.lines).toContain("Marie Durand");
    expect(doc.buyer.lines).toContain("33000 Bordeaux");
  });

  it("signale chaque mention obligatoire absente au lieu de la passer sous silence", () => {
    const doc = buildInvoiceDocument(
      { ...INVOICE, clientAddress: null, dueDate: null },
      { name: "Sans Papiers SARL" },
      NOW,
    );

    expect(doc.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("SIRET"),
      expect.stringContaining("adresse du siege"),
      expect.stringContaining("adresse du client"),
      expect.stringContaining("echeance"),
    ]));
  });
});

describe("buildInvoiceDocument — TVA", () => {
  it("ventile la TVA par taux et recalcule les totaux depuis les lignes", () => {
    const doc = buildInvoiceDocument(INVOICE, SELLER, NOW);

    // 3 x 600 = 1800 a 20 % ; 1 x 120 = 120 a 10 %.
    expect(doc.subtotal).toBe(1920);
    expect(doc.vatBreakdown).toEqual([
      { taxRate: 20, base: 1800, amount: 360 },
      { taxRate: 10, base: 120, amount: 12 },
    ]);
    expect(doc.taxAmount).toBe(372);
    expect(doc.totalAmount).toBe(2292);
  });

  it("ignore des totaux stockes qui auraient derive des lignes", () => {
    // Les colonnes subtotal/taxAmount/totalAmount ne sont meme pas lues: seules
    // les lignes font foi, donc une ligne ajoutee hors calcul ne peut pas
    // produire une facture dont le total contredit son detail.
    const doc = buildInvoiceDocument(
      { ...INVOICE, items: [{ description: "Une ligne", quantity: 2, unitPrice: 50, taxRate: 20 }] },
      SELLER,
      NOW,
    );

    expect(doc.subtotal).toBe(100);
    expect(doc.totalAmount).toBe(120);
  });

  it("porte la mention d'autoliquidation et facture zero TVA", () => {
    const doc = buildInvoiceDocument({ ...INVOICE, isAutoliquidation: true }, SELLER, NOW);

    expect(doc.legalMentions).toContain(AUTOLIQUIDATION_MENTION);
    expect(doc.legalMentions).not.toContain(VAT_EXEMPT_MENTION);
    expect(doc.taxAmount).toBe(0);
    expect(doc.totalAmount).toBe(doc.subtotal);
  });

  it("porte la franchise en base quand il n'y a ni numero de TVA ni TVA facturee", () => {
    const doc = buildInvoiceDocument(
      { ...INVOICE, items: [{ description: "Prestation", quantity: 1, unitPrice: 500, taxRate: 0 }] },
      { ...SELLER, tvaNumber: null },
      NOW,
    );

    expect(doc.legalMentions).toContain(VAT_EXEMPT_MENTION);
    expect(doc.taxAmount).toBe(0);
  });

  it("avertit quand de la TVA est facturee sans numero intracommunautaire", () => {
    const doc = buildInvoiceDocument(INVOICE, { ...SELLER, tvaNumber: null }, NOW);

    expect(doc.legalMentions).not.toContain(VAT_EXEMPT_MENTION);
    expect(doc.warnings).toEqual(expect.arrayContaining([expect.stringContaining("numero de TVA")]));
  });
});

describe("buildInvoiceDocument — reglement", () => {
  it("affiche le reste du quand la facture est partiellement reglee", () => {
    const doc = buildInvoiceDocument({ ...INVOICE, paidAmount: "1000" }, SELLER, NOW);

    expect(doc.paidAmount).toBe(1000);
    expect(doc.remaining).toBe(1292);
    expect(doc.payment.some((l) => l.includes("reste du"))).toBe(true);
  });

  it("ne descend jamais sous zero si le paiement depasse le total", () => {
    const doc = buildInvoiceDocument({ ...INVOICE, paidAmount: "99999" }, SELLER, NOW);

    expect(doc.remaining).toBe(0);
  });

  it("porte les coordonnees bancaires du vendeur", () => {
    const doc = buildInvoiceDocument(INVOICE, SELLER, NOW);

    expect(doc.payment.some((l) => l.includes("FR7616798000010000123456789"))).toBe(true);
    expect(doc.payment.some((l) => l.includes("QNTOFRP1XXX"))).toBe(true);
  });

  it("date la facture du jour quand la date de creation manque", () => {
    const doc = buildInvoiceDocument({ ...INVOICE, createdAt: null }, SELLER, NOW);

    expect(doc.issueDate).toEqual(NOW);
  });
});

describe("toWinAnsiText", () => {
  it("remplace l'espace fine insecable des montants par une espace WinAnsi", () => {
    // Sans ce remplacement, pdfkit (polices standard, encodage WinAnsi) dessine
    // U+202F comme une barre oblique: la facture affichait "1 /800,00 EUR".
    const formatted = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(1800);
    expect(formatted).toContain(" ");

    const safe = toWinAnsiText(formatted);
    expect(safe).not.toContain(" ");
    expect(safe).toBe("1 800,00 €");
  });

  it("conserve les caracteres que WinAnsi connait", () => {
    expect(toWinAnsiText("SAS — capital 10 000 EUR")).toBe("SAS — capital 10 000 EUR");
    expect(toWinAnsiText("Echeance à 30 jours (n° 7)")).toBe("Echeance à 30 jours (n° 7)");
  });

  it("ramene les tirets absents de WinAnsi au trait d'union", () => {
    expect(toWinAnsiText("FAC‑2026‒0007")).toBe("FAC-2026-0007");
  });
});

describe("renderInvoicePdf", () => {
  it("ne laisse aucun caractere hors WinAnsi atteindre la page", async () => {
    const doc = buildInvoiceDocument(INVOICE, SELLER, NOW);
    const pdf = await renderInvoicePdf(doc);
    const drawn = drawnText(pdf);

    expect(drawn).toContain("Agent de Bureau SAS");
    expect(drawn).toContain("SIRET 90123456700018");
    expect(drawn).toContain("Durand Travaux");
    // Le montant doit se lire "1 920,00", jamais "1 /920,00".
    expect(drawn).toMatch(/1.920,00/);
    expect(drawn).not.toContain("/920,00");
    expect(drawn).toContain("Penalites de retard");
  });

  it("produit un PDF valide et non vide", async () => {
    const doc = buildInvoiceDocument(INVOICE, SELLER, NOW);
    const pdf = await renderInvoicePdf(doc);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-8).toString("latin1")).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("pagine sans erreur une facture a nombreuses lignes", async () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      description: `Ligne ${i + 1} — prestation detaillee sur plusieurs mots pour occuper la colonne`,
      quantity: 2,
      unitPrice: 75.5,
      taxRate: 20,
    }));
    const doc = buildInvoiceDocument({ ...INVOICE, items }, SELLER, NOW);
    const pdf = await renderInvoicePdf(doc);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(doc.lines).toHaveLength(120);
  });

  it("produit quand meme le PDF d'une facture incomplete", async () => {
    const doc = buildInvoiceDocument({ ...INVOICE, items: [] }, { name: "Minimal" }, NOW);
    const pdf = await renderInvoicePdf(doc);

    expect(doc.warnings.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("invoiceFileName", () => {
  it("derive un nom de fichier sur du texte de reference arbitraire", () => {
    expect(invoiceFileName("FAC-2026-0007")).toBe("facture-FAC-2026-0007.pdf");
    expect(invoiceFileName('FAC "2026"/07')).toBe("facture-FAC-2026-07.pdf");
    expect(invoiceFileName("")).toBe("facture-sans-reference.pdf");
  });

  it("ne laisse pas une reference sortir du nom de fichier", () => {
    // Une reference est saisie par l'utilisateur: elle ne doit pouvoir ni
    // traverser un repertoire, ni casser l'en-tete Content-Disposition.
    const name = invoiceFileName("../../etc/passwd");

    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).not.toContain('"');
  });
});
