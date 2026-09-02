/**
 * Facture PDF A4 conforme au droit francais (Faz C de la chaine Vente).
 *
 * Deux etages volontairement separes:
 *   1. `buildInvoiceDocument` — PUR: assemble le modele du document (identite
 *      vendeur, acheteur, lignes, ventilation TVA, mentions legales
 *      obligatoires, avertissements). Aucune I/O, aucun pdfkit: c'est cette
 *      fonction que les tests verrouillent, parce que la conformite d'une
 *      facture tient a ce qui DOIT y figurer, pas a sa mise en page.
 *   2. `renderInvoicePdf` — dessine ce modele avec pdfkit (deja une dependance
 *      du serveur, cf. services/document-export.ts: aucune nouvelle librairie).
 *
 * Les montants ne sont jamais repris tels quels depuis la base: ils sont
 * recalcules a partir des lignes par `computeInvoiceTotals`, la seule source de
 * verite monetaire du projet. Une facture ancienne dont les totaux stockes
 * auraient derive affiche donc le calcul correct.
 *
 * Mentions obligatoires couvertes: art. L441-9 du Code de commerce et art. 242
 * nonies A de l'annexe II au CGI (identification des parties, numero et date,
 * designation/quantite/prix unitaire, taux et montant de TVA par taux, totaux
 * HT/TVA/TTC, date d'echeance, penalites de retard, indemnite forfaitaire de
 * 40 EUR, escompte), plus les mentions speciales autoliquidation (art. 283-2
 * nonies du CGI) et franchise en base (art. 293 B du CGI).
 */

import { computeInvoiceTotals, type InvoiceLine, type VatBreakdownEntry } from "./invoice-totals";

/** Profil vendeur, tel que stocke sur `organisations`. */
export interface InvoiceSeller {
  name?: string | null;
  legalForm?: string | null;
  capital?: string | null;
  address?: string | null;
  siret?: string | null;
  tvaNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  bankName?: string | null;
  bankIban?: string | null;
  bankBic?: string | null;
  invoiceFooter?: string | null;
}

/** Facture, telle que stockee sur `factures_client`. */
export interface InvoiceRecord {
  reference: string;
  title?: string | null;
  clientName: string;
  clientCompany?: string | null;
  clientAddress?: string | null;
  clientEmail?: string | null;
  items?: Array<{ description?: string; quantity?: number | string; unitPrice?: number | string; taxRate?: number | string }> | null;
  paidAmount?: string | number | null;
  currency?: string | null;
  isAutoliquidation?: boolean | null;
  dueDate?: Date | string | null;
  createdAt?: Date | string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  conditions?: string | null;
}

export interface InvoiceDocument {
  reference: string;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  seller: { name: string; lines: string[] };
  buyer: { name: string; lines: string[] };
  lines: InvoiceLine[];
  vatBreakdown: VatBreakdownEntry[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  remaining: number;
  payment: string[];
  legalMentions: string[];
  notes: string[];
  footer: string | null;
  /** Donnees obligatoires absentes: la facture reste emise, mais non conforme. */
  warnings: string[];
}

// Mentions imposees par le Code de commerce / le CGI. Texte fige ici pour que
// les tests puissent verrouiller leur presence mot pour mot.
export const LATE_PENALTY_MENTION =
  "Penalites de retard : taux d'interet applique par la Banque centrale europeenne a son operation de refinancement la plus recente, majore de 10 points de pourcentage (art. L441-10 du Code de commerce).";
export const RECOVERY_INDEMNITY_MENTION =
  "Indemnite forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 EUR (art. D441-5 du Code de commerce).";
export const NO_DISCOUNT_MENTION =
  "Escompte pour paiement anticipe : neant.";
export const AUTOLIQUIDATION_MENTION =
  "Autoliquidation — art. 283-2 nonies du CGI : la TVA est due par le preneur, aucune TVA n'est facturee.";
export const VAT_EXEMPT_MENTION =
  "TVA non applicable, art. 293 B du CGI.";

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Decoupe une adresse multiligne en lignes affichables. */
function addressLines(value: unknown): string[] {
  const raw = clean(value);
  if (!raw) return [];
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Assemble le modele du document. Fonction PURE: memes entrees, meme sortie.
 * `now` est injectable pour que les tests ne dependent pas de l'horloge.
 */
export function buildInvoiceDocument(
  invoice: InvoiceRecord,
  seller: InvoiceSeller,
  now: Date = new Date(),
): InvoiceDocument {
  const autoliquidation = !!invoice.isAutoliquidation;
  const totals = computeInvoiceTotals(invoice.items ?? [], { autoliquidation });
  const currency = clean(invoice.currency) ?? "EUR";
  const issueDate = toDate(invoice.createdAt) ?? now;
  const dueDate = toDate(invoice.dueDate);

  const paidRaw = typeof invoice.paidAmount === "number"
    ? invoice.paidAmount
    : parseFloat(String(invoice.paidAmount ?? "0").replace(",", "."));
  const paidAmount = Number.isFinite(paidRaw) && paidRaw > 0 ? paidRaw : 0;
  const remaining = Math.max(Math.round((totals.totalAmount - paidAmount) * 100) / 100, 0);

  const warnings: string[] = [];

  // --- Vendeur -------------------------------------------------------------
  const sellerName = clean(seller.name) ?? "";
  if (!sellerName) warnings.push("La denomination sociale du vendeur est absente.");

  const sellerLines: string[] = [];
  const formAndCapital = [clean(seller.legalForm), clean(seller.capital) ? `capital ${clean(seller.capital)}` : null]
    .filter(Boolean).join(" — ");
  if (formAndCapital) sellerLines.push(formAndCapital);
  sellerLines.push(...addressLines(seller.address));
  if (!clean(seller.address)) warnings.push("L'adresse du siege du vendeur est absente.");

  const siret = clean(seller.siret);
  if (siret) sellerLines.push(`SIRET ${siret}`);
  else warnings.push("Le SIRET du vendeur est absent (mention obligatoire).");

  const tvaNumber = clean(seller.tvaNumber);
  if (tvaNumber) sellerLines.push(`TVA intracommunautaire ${tvaNumber}`);

  const contact = [clean(seller.phone), clean(seller.email)].filter(Boolean).join(" — ");
  if (contact) sellerLines.push(contact);

  // --- Acheteur ------------------------------------------------------------
  const buyerName = clean(invoice.clientCompany) ?? clean(invoice.clientName) ?? "";
  const buyerLines: string[] = [];
  if (clean(invoice.clientCompany) && clean(invoice.clientName)) {
    buyerLines.push(clean(invoice.clientName)!);
  }
  buyerLines.push(...addressLines(invoice.clientAddress));
  if (!clean(invoice.clientAddress)) warnings.push("L'adresse du client est absente (mention obligatoire).");
  const buyerEmail = clean(invoice.clientEmail);
  if (buyerEmail) buyerLines.push(buyerEmail);

  // --- Reglement -----------------------------------------------------------
  const payment: string[] = [];
  if (dueDate) payment.push(`Date d'echeance : ${formatDate(dueDate)}`);
  else warnings.push("La date d'echeance de reglement est absente (mention obligatoire).");
  const method = clean(invoice.paymentMethod);
  if (method) payment.push(`Moyen de paiement : ${method}`);
  const iban = clean(seller.bankIban);
  if (iban) {
    const bank = [clean(seller.bankName), `IBAN ${iban}`, clean(seller.bankBic) ? `BIC ${clean(seller.bankBic)}` : null]
      .filter(Boolean).join(" — ");
    payment.push(bank);
  }
  if (paidAmount > 0) {
    payment.push(`Deja regle : ${formatMoney(paidAmount, currency)} — reste du : ${formatMoney(remaining, currency)}`);
  }

  // --- Mentions legales ----------------------------------------------------
  const legalMentions: string[] = [];
  if (autoliquidation) legalMentions.push(AUTOLIQUIDATION_MENTION);
  // Franchise en base: pas de numero de TVA ET aucune TVA facturee. En
  // autoliquidation la TVA est aussi nulle, mais la mention applicable est
  // celle de l'art. 283-2 nonies, pas celle de l'art. 293 B.
  if (!autoliquidation && !tvaNumber && totals.taxAmount === 0) {
    legalMentions.push(VAT_EXEMPT_MENTION);
  }
  if (!autoliquidation && !tvaNumber && totals.taxAmount > 0) {
    warnings.push("De la TVA est facturee sans numero de TVA intracommunautaire renseigne.");
  }
  legalMentions.push(LATE_PENALTY_MENTION, RECOVERY_INDEMNITY_MENTION, NO_DISCOUNT_MENTION);

  if (totals.lines.length === 0) warnings.push("La facture ne comporte aucune ligne.");

  const notes = [clean(invoice.conditions), clean(invoice.notes)].filter((v): v is string => v != null);

  return {
    reference: invoice.reference,
    issueDate,
    dueDate,
    currency,
    seller: { name: sellerName, lines: sellerLines },
    buyer: { name: buyerName, lines: buyerLines },
    lines: totals.lines,
    vatBreakdown: totals.vatBreakdown,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    paidAmount,
    remaining,
    payment,
    legalMentions,
    notes,
    footer: clean(seller.invoiceFooter),
    warnings,
  };
}

/**
 * Rend une chaine sure pour les polices standard de pdfkit (encodage WinAnsi).
 * Indispensable pour les montants: `Intl` separe les milliers par une espace
 * fine insecable (U+202F) qui n'existe PAS en WinAnsi — pdfkit la remplace
 * alors par une barre oblique, et la facture affiche "1 /800,00 EUR" au lieu
 * de "1 800,00 EUR". On ramene ces espaces exotiques a l'espace insecable
 * ordinaire (U+00A0), qui, elle, existe.
 */
export function toWinAnsiText(value: string): string {
  return value
    // Espaces typographiques absentes de WinAnsi -> espace insecable ordinaire.
    .replace(/[      ⁠﻿]/g, " ")
    // Tirets absents de WinAnsi -> trait d union. Le demi-cadratin (U+2013) et
    // le cadratin (U+2014) y figurent, eux, et sont conserves tels quels.
    .replace(/[‐‑‒−]/g, "-");
}

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(value);
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(value);
}

function formatRate(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)} %`;
}

/** Dessine le modele en PDF A4. Retourne le fichier complet en memoire. */
export async function renderInvoicePdf(model: InvoiceDocument): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: 45, size: "A4" });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = doc.page.height - doc.page.margins.bottom;
  // pdfkit dessine avec les polices standard (WinAnsi): tout texte passe par
  // `toWinAnsiText`, sinon une espace fine insecable sort en barre oblique.
  const drawText = (value: string, ...rest: any[]) => (doc as any).text(toWinAnsiText(String(value)), ...rest);

  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottom) doc.addPage();
  };

  // --- En-tete: vendeur a gauche, facture a droite -------------------------
  const headerTop = doc.y;
  doc.font("Helvetica-Bold").fontSize(14);
  drawText(model.seller.name, left, headerTop, { width: width * 0.55 });
  doc.font("Helvetica").fontSize(9).fillColor("#444444");
  for (const line of model.seller.lines) drawText(line, { width: width * 0.55 });
  const sellerBottom = doc.y;

  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(20);
  drawText("FACTURE", left + width * 0.6, headerTop, { width: width * 0.4, align: "right" });
  doc.font("Helvetica").fontSize(10);
  drawText(`N° ${model.reference}`, { width: width * 0.4, align: "right" });
  drawText(`Emise le ${formatDate(model.issueDate)}`, { width: width * 0.4, align: "right" });
  if (model.dueDate) {
    drawText(`Echeance ${formatDate(model.dueDate)}`, { width: width * 0.4, align: "right" });
  }

  doc.y = Math.max(sellerBottom, doc.y) + 18;

  // --- Acheteur ------------------------------------------------------------
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#666666");
  drawText("FACTURE A", left, doc.y);
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(11);
  drawText(model.buyer.name, left, doc.y + 2);
  doc.font("Helvetica").fontSize(9).fillColor("#444444");
  for (const line of model.buyer.lines) drawText(line);
  doc.fillColor("#000000");
  doc.y += 16;

  // --- Lignes --------------------------------------------------------------
  const cols = [
    { key: "description", label: "Designation", width: width * 0.46, align: "left" as const },
    { key: "quantity", label: "Qte", width: width * 0.1, align: "right" as const },
    { key: "unitPrice", label: "PU HT", width: width * 0.16, align: "right" as const },
    { key: "taxRate", label: "TVA", width: width * 0.1, align: "right" as const },
    { key: "total", label: "Total HT", width: width * 0.18, align: "right" as const },
  ];

  const drawHeaderRow = () => {
    const y = doc.y;
    doc.rect(left, y, width, 18).fill("#f1f5f9");
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9);
    let x = left;
    for (const col of cols) {
      drawText(col.label, x + 4, y + 5, { width: col.width - 8, align: col.align });
      x += col.width;
    }
    doc.fillColor("#000000");
    doc.y = y + 18;
  };

  drawHeaderRow();
  doc.font("Helvetica").fontSize(9);
  for (const line of model.lines) {
    const cells = [
      line.description || "—",
      formatQuantity(line.quantity),
      formatMoney(line.unitPrice, model.currency),
      formatRate(line.taxRate),
      formatMoney(line.total, model.currency),
    ];
    const descHeight = doc.heightOfString(cells[0], { width: cols[0].width - 8 });
    const rowHeight = Math.max(descHeight + 8, 18);
    if (doc.y + rowHeight > bottom) {
      doc.addPage();
      drawHeaderRow();
      doc.font("Helvetica").fontSize(9);
    }
    const y = doc.y;
    let x = left;
    cells.forEach((cell, i) => {
      drawText(cell, x + 4, y + 4, { width: cols[i].width - 8, align: cols[i].align, height: rowHeight - 6, ellipsis: i !== 0 });
      x += cols[i].width;
    });
    doc.moveTo(left, y + rowHeight).lineTo(right, y + rowHeight).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    doc.y = y + rowHeight;
  }

  // --- Ventilation de TVA + totaux ----------------------------------------
  ensureSpace(120);
  doc.y += 12;
  const totalsLeft = left + width * 0.5;
  const totalsWidth = width * 0.5;
  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
    const y = doc.y;
    drawText(label, totalsLeft, y, { width: totalsWidth * 0.55 });
    drawText(value, totalsLeft + totalsWidth * 0.55, y, { width: totalsWidth * 0.45, align: "right" });
    doc.y = y + (bold ? 16 : 13);
  };

  totalRow("Total HT", formatMoney(model.subtotal, model.currency));
  for (const entry of model.vatBreakdown) {
    totalRow(`TVA ${formatRate(entry.taxRate)} sur ${formatMoney(entry.base, model.currency)}`, formatMoney(entry.amount, model.currency));
  }
  totalRow("Total TVA", formatMoney(model.taxAmount, model.currency));
  totalRow("Total TTC", formatMoney(model.totalAmount, model.currency), true);
  if (model.paidAmount > 0) {
    totalRow("Deja regle", formatMoney(model.paidAmount, model.currency));
    totalRow("Reste du", formatMoney(model.remaining, model.currency), true);
  }

  // --- Reglement, notes, mentions -----------------------------------------
  doc.y += 10;
  const block = (title: string, lines: string[], size = 9) => {
    if (lines.length === 0) return;
    ensureSpace(18 + lines.length * 12);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#666666");
    drawText(title, left, doc.y, { width });
    doc.font("Helvetica").fontSize(size).fillColor("#000000");
    for (const line of lines) drawText(line, { width });
    doc.y += 8;
  };

  block("REGLEMENT", model.payment);
  block("CONDITIONS", model.notes);
  block("MENTIONS LEGALES", model.legalMentions, 8);

  if (model.footer) {
    ensureSpace(30);
    doc.font("Helvetica").fontSize(8).fillColor("#666666");
    drawText(model.footer, left, doc.y, { width, align: "center" });
    doc.fillColor("#000000");
  }

  doc.end();
  return finished;
}

/**
 * Nom de fichier propose au telechargement. La reference est saisie par
 * l'utilisateur: on ne garde que des caracteres inoffensifs, ni separateur de
 * chemin, ni point (donc pas de `..`), ni guillemet qui casserait l'en-tete
 * Content-Disposition.
 */
export function invoiceFileName(reference: string): string {
  const safe = String(reference ?? "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return `facture-${safe || "sans-reference"}.pdf`;
}
