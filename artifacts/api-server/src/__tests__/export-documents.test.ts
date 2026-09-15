/**
 * Les documents produits doivent s'ouvrir — et contenir des nombres.
 *
 * L'agent IA propose « je vous prepare le tableau » et rend un fichier. Ce
 * fichier part chez un comptable, un client, un maitre d'ouvrage. Deux facons
 * de se tromper ici ne se voient pas du tout a la relecture du code:
 *
 *   1. Le fichier porte la bonne extension mais n'est pas du bon format. Le
 *      destinataire double-clique et voit « fichier endommage » — le produit
 *      a l'air cassé chez quelqu'un d'autre que le client.
 *
 *   2. Le tableur s'ouvre parfaitement, mais chaque montant y est du TEXTE.
 *      Rien ne signale l'erreur: les chiffres sont la, alignes, lisibles. Ce
 *      n'est qu'en tirant une somme que le comptable obtient zero. C'est la
 *      raison d'etre du test sur le type des cellules: `cellToString` est
 *      appele sur tout ce qui n'est ni nombre ni booleen, et il suffit de
 *      retirer cette condition pour transformer toute la comptabilite d'une
 *      organisation en chaines de caracteres.
 *
 * Les autres tests portent sur les contraintes d'Excel que personne ne connait
 * par coeur (nom de feuille: 31 caracteres, pas de `[ ] : * ? / \`, unique dans
 * le classeur) et sur les garde-fous de taille, qui protegent la memoire du
 * serveur quand une specification part en vrille.
 */
import { describe, expect, it } from "vitest";

import {
  buildExcelBase64,
  buildPdfBase64,
  buildPptxBase64,
  buildWordBase64,
  DOCX_MIME,
  PDF_MIME,
  PPTX_MIME,
  XLSX_MIME,
} from "../services/document-export";

/** Les formats Office sont des archives ZIP: elles commencent par « PK ». */
const SIGNATURE_ZIP = Buffer.from([0x50, 0x4b]);

function octets(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

describe("les fichiers produits sont reellement du format annonce", () => {
  it("le classeur Excel est une archive ZIP ouvrable", async () => {
    const doc = await buildExcelBase64({ columns: ["Poste"], rows: [["Enduit"]] }, "devis");
    const buf = octets(doc.base64);
    expect(buf.subarray(0, 2).equals(SIGNATURE_ZIP)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(doc.mimeType).toBe(XLSX_MIME);
  });

  it("le document Word est une archive ZIP ouvrable", async () => {
    const doc = await buildWordBase64(
      { title: "Compte rendu", blocks: [{ type: "paragraph", text: "Reunion de chantier." }] },
      "compte-rendu",
    );
    const buf = octets(doc.base64);
    expect(buf.subarray(0, 2).equals(SIGNATURE_ZIP)).toBe(true);
    expect(doc.mimeType).toBe(DOCX_MIME);
  });

  it("le PDF commence par sa signature et se termine proprement", async () => {
    const doc = await buildPdfBase64(
      { title: "Attestation", blocks: [{ type: "paragraph", text: "Travaux receptionnes." }] },
      "attestation",
    );
    const buf = octets(doc.base64);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Un PDF tronque s'ouvre parfois, et parfois pas: la marque de fin est ce
    // qui distingue un fichier complet d'un flux coupe en cours d'ecriture.
    expect(buf.subarray(-1024).toString("latin1")).toContain("%%EOF");
    expect(doc.mimeType).toBe(PDF_MIME);
  });

  it("la presentation est une archive ZIP ouvrable", async () => {
    const doc = await buildPptxBase64(
      { title: "Chantier", slides: [{ title: "Avancement", bullets: ["Gros oeuvre termine"] }] },
      "presentation",
    );
    const buf = octets(doc.base64);
    expect(buf.subarray(0, 2).equals(SIGNATURE_ZIP)).toBe(true);
    expect(doc.mimeType).toBe(PPTX_MIME);
  });
});

describe("les nombres restent des nombres dans le tableur", () => {
  it("un montant n'est pas ecrit comme du texte", async () => {
    // Le defaut invisible: le fichier s'ouvre, les chiffres s'affichent, et
    // toute somme rend zero. On relit donc le classeur produit et on exige que
    // la cellule soit de type numerique (`t: "n"`), pas chaine (`t: "s"`).
    const doc = await buildExcelBase64(
      { columns: ["Poste", "Montant"], rows: [["Enduit", 1234.56]] },
      "montants",
    );
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const cellule = ws["B2"];
    expect(cellule, "la cellule du montant est absente du classeur relu").toBeDefined();
    expect(cellule.t, "le montant a ete ecrit en texte: aucune somme ne fonctionnera").toBe("n");
    expect(cellule.v).toBeCloseTo(1234.56, 2);
  });

  it("un booleen reste un booleen", async () => {
    const doc = await buildExcelBase64({ columns: ["Solde"], rows: [[true]] }, "booleens");
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(ws["A2"].t).toBe("b");
  });

  it("le texte reste du texte", async () => {
    const doc = await buildExcelBase64({ columns: ["Poste"], rows: [["Enduit"]] }, "texte");
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    expect(wb.Sheets[wb.SheetNames[0]]["A2"].t).toBe("s");
  });
});

describe("les noms de feuilles respectent les regles d'Excel", () => {
  it("les caracteres interdits sont retires", async () => {
    // Excel refuse d'ouvrir un classeur dont une feuille contient `[ ] : * ? / \`.
    const doc = await buildExcelBase64(
      { sheets: [{ name: "Lot 3 : plomberie [2026]", rows: [["x"]] }] },
      "feuilles",
    );
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    expect(wb.SheetNames[0]).not.toMatch(/[\\/?*[\]:]/);
    expect(wb.SheetNames[0]).toContain("plomberie");
  });

  it("un nom trop long est coupe a 31 caracteres", async () => {
    const doc = await buildExcelBase64(
      { sheets: [{ name: "a".repeat(60), rows: [["x"]] }] },
      "long",
    );
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31);
  });

  it("deux feuilles homonymes sont departagees", async () => {
    // Sans cela, la seconde ecrase la premiere: le classeur s'ouvre, une
    // feuille de donnees a simplement disparu.
    const doc = await buildExcelBase64(
      {
        sheets: [
          { name: "Lot 1", rows: [["a"]] },
          { name: "Lot 1", rows: [["b"]] },
          { name: "lot 1", rows: [["c"]] },
        ],
      },
      "homonymes",
    );
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    expect(wb.SheetNames.length).toBe(3);
    expect(new Set(wb.SheetNames.map((n) => n.toLowerCase())).size).toBe(3);
  });

  it("une feuille sans nom en recoit un", async () => {
    const doc = await buildExcelBase64({ sheets: [{ rows: [["x"]] }] }, "anonyme");
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    expect(wb.SheetNames[0].trim().length).toBeGreaterThan(0);
  });
});

describe("le nom de fichier", () => {
  it("recoit l'extension du format", async () => {
    const doc = await buildExcelBase64({ rows: [["x"]] }, "rapport");
    expect(doc.fileName).toBe("rapport.xlsx");
  });

  it("ne double pas une extension deja correcte", async () => {
    const doc = await buildExcelBase64({ rows: [["x"]] }, "rapport.xlsx");
    expect(doc.fileName).toBe("rapport.xlsx");
  });

  it("corrige une extension qui ment sur le format", async () => {
    // Un .docx qui contient un classeur est refuse par Word ET par Excel.
    const doc = await buildExcelBase64({ rows: [["x"]] }, "rapport.docx");
    expect(doc.fileName).toBe("rapport.xlsx");
  });

  it("un nom vide ne produit pas un fichier sans nom", async () => {
    const doc = await buildWordBase64({ blocks: [] }, "   ");
    expect(doc.fileName).toBe("document.docx");
  });
});

describe("les garde-fous de taille", () => {
  it("un classeur de vingt-et-une feuilles est refuse", async () => {
    const sheets = Array.from({ length: 21 }, (_, i) => ({ name: `F${i}`, rows: [["x"]] }));
    await expect(buildExcelBase64({ sheets }, "trop")).rejects.toThrow(/feuilles/i);
  });

  it("une feuille de plus de cinq mille lignes est refusee", async () => {
    const rows = Array.from({ length: 5001 }, () => ["x"]);
    await expect(buildExcelBase64({ rows }, "trop")).rejects.toThrow(/lignes/i);
  });

  it("une ligne de plus de cent colonnes est refusee", async () => {
    const row = Array.from({ length: 101 }, () => "x");
    await expect(buildExcelBase64({ rows: [row] }, "trop")).rejects.toThrow(/colonnes/i);
  });

  it("une cellule demesuree est coupee, pas rejetee", async () => {
    // Couper plutot que refuser: un texte trop long vient d'une extraction
    // automatique, et perdre tout le document pour une cellule serait pire.
    const doc = await buildExcelBase64({ rows: [["y".repeat(40000)]] }, "coupe");
    const XLSX = await import("xlsx");
    const wb = XLSX.read(octets(doc.base64), { type: "buffer" });
    expect(String(wb.Sheets[wb.SheetNames[0]]["A1"].v).length).toBeLessThanOrEqual(32000);
  });
});

describe("les specifications invalides", () => {
  it("un document Word sans blocs est refuse explicitement", async () => {
    await expect(
      buildWordBase64({ title: "x" } as never, "invalide"),
    ).rejects.toThrow(/blocks/i);
  });

  it("une specification Excel qui n'est pas un objet est refusee", async () => {
    await expect(buildExcelBase64(null as never, "invalide")).rejects.toThrow(/invalide/i);
  });

  it("un bloc inconnu est ignore sans faire tomber le document", async () => {
    // L'IA produit ces specifications: un type inattendu doit couter un bloc,
    // pas le document entier.
    const doc = await buildWordBase64(
      {
        blocks: [
          { type: "paragraph", text: "Avant" },
          { type: "inconnu", text: "?" } as never,
          { type: "paragraph", text: "Apres" },
        ],
      },
      "tolerant",
    );
    expect(octets(doc.base64).subarray(0, 2).equals(SIGNATURE_ZIP)).toBe(true);
  });
});
