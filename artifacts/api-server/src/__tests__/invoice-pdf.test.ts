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
/** Tous les flux du PDF, decompresses, dans l'ordre du fichier. */
function fluxDecompresses(pdf: Buffer): string[] {
  const flux: string[] = [];
  let curseur = 0;
  for (;;) {
    // `endstream` contient `stream`: chercher naivement le mot suivant faisait
    // repartir le balayage au milieu du marqueur de fin et decoupait des flux
    // de treize octets qui n'existent pas. Le mot ne compte que s'il n'est pas
    // precede de « end ».
    let start = pdf.indexOf("stream", curseur);
    while (start > 2 && pdf.subarray(start - 3, start).toString("latin1") === "end") {
      start = pdf.indexOf("stream", start + 6);
    }
    if (start === -1) break;
    const end = pdf.indexOf("endstream", start);
    if (end === -1) break;
    let from = start + "stream".length;
    while (pdf[from] === 13 || pdf[from] === 10) from++;
    let to = end;
    while (pdf[to - 1] === 10 || pdf[to - 1] === 13) to--;
    try {
      flux.push(inflateSync(pdf.subarray(from, to)).toString("latin1"));
    } catch {
      // Flux non compresse (une police embarquee, par exemple): sans interet ici.
    }
    curseur = end + 1;
  }
  return flux;
}

/**
 * Table `ToUnicode` du document: identifiant de glyphe -> caractere.
 *
 * Depuis que les polices sont incorporees (PDF/A-3b, voir facturx-pdf.test.ts),
 * le texte n'est plus ecrit en clair dans la page: il est ecrit en NUMEROS DE
 * GLYPHE, propres au sous-ensemble de police embarque. La table ToUnicode est
 * ce qui permet de revenir au texte — c'est elle qu'un lecteur utilise pour le
 * copier-coller et la recherche, et c'est donc elle qui decide si une facture
 * est exploitable par l'administration ou seulement par l'oeil.
 *
 * La lire ici fait d'une pierre deux coups: le test retrouve le texte dessine,
 * et il echoue si la table disparait — c'est-a-dire si les factures deviennent
 * des images de texte sans le dire.
 */
function tablesToUnicode(pdf: Buffer): Map<number, string>[] {
  const tables: Map<number, string>[] = [];
  for (const flux of fluxDecompresses(pdf)) {
    if (!flux.includes("beginbfchar") && !flux.includes("beginbfrange")) continue;
    const table = new Map<number, string>();
    tables.push(table);

    for (const bloc of flux.split("beginbfchar").slice(1)) {
      const corps = bloc.split("endbfchar")[0];
      for (const [, glyphe, uni] of corps.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        table.set(parseInt(glyphe, 16), String.fromCodePoint(parseInt(uni.slice(0, 4), 16)));
      }
    }

    // `bfrange` a deux formes, et pdfkit emploie la seconde:
    //   <debut> <fin> <base>            — les codes se suivent
    //   <debut> <fin> [<u1> <u2> ...]   — un code par glyphe, dans l'ordre
    // Ne lire que la premiere rendait une table vide, donc un texte vide, donc
    // un test qui ne verifiait plus rien.
    for (const bloc of flux.split("beginbfrange").slice(1)) {
      const corps = bloc.split("endbfrange")[0];

      for (const [, debut, , liste] of corps.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
        const premier = parseInt(debut, 16);
        const codes = [...liste.matchAll(/<([0-9a-fA-F]+)>/g)].map(([, u]) => u);
        codes.forEach((u, i) => table.set(premier + i, String.fromCodePoint(parseInt(u.slice(0, 4), 16))));
      }

      for (const [, debut, fin, uni] of corps.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const base = parseInt(uni.slice(0, 4), 16);
        for (let g = parseInt(debut, 16); g <= parseInt(fin, 16); g++) {
          if (!table.has(g)) table.set(g, String.fromCodePoint(base + g - parseInt(debut, 16)));
        }
      }
    }
  }
  return tables;
}

/**
 * Le texte dessine sur la page, police par police.
 *
 * Chaque police incorporee a SA propre numerotation de glyphes et donc sa
 * propre table: le glyphe 3 n'est pas la meme lettre en romain et en gras.
 * Fusionner les tables melangeait les deux et rendait le gras illisible —
 * « Agent de Bureau SAS » ressortait en « SA —cap aitl 1ta0S0 ».
 *
 * Associer chaque `Tf` a son objet de police demanderait de reconstruire le
 * graphe d'objets du PDF. On s'en passe: le texte est decode avec CHAQUE table,
 * et les versions sont concatenees. Une assertion `toContain` retrouve donc sa
 * phrase sous la bonne table, et les assertions negatives sont faites sur des
 * motifs qu'aucun decodage errone ne peut produire.
 */
function drawnText(pdf: Buffer): string {
  const tables = tablesToUnicode(pdf);
  const contenu = fluxDecompresses(pdf).find((f) => f.includes("Tm")) ?? "";

  return tables
    .map((table) =>
      contenu
        .split("Tm")
        .map((segment) =>
          [...segment.matchAll(/<([0-9a-fA-F]+)>/g)]
            .map(([, hex]) => {
              // Deux octets par glyphe: c'est ainsi que pdfkit ecrit une police
              // TrueType incorporee.
              let mot = "";
              for (let i = 0; i + 4 <= hex.length; i += 4) {
                mot += table.get(parseInt(hex.slice(i, i + 4), 16)) ?? "";
              }
              return mot;
            })
            .join(""),
        )
        .join("\n"),
    )
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
