/**
 * Generation de documents bureautiques (Excel .xlsx et Word .docx) a partir de
 * specifications structurees. Pendant que `document-ai.ts` LIT les fichiers
 * Office (xlsx/mammoth), ce module les CREE. Aucune dependance externe ni compte
 * client requis : fonctionne pour chaque organisation des l'installation.
 *
 * Les builders renvoient le contenu en base64 + nom de fichier + type MIME, prets
 * a etre passes a `ingestDocument` (validation type/taille, scan antivirus,
 * insertion dans la bibliotheque de documents avec lien de telechargement).
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Garde-fous contre les specifications abusives (memoire / taille fichier).
const MAX_SHEETS = 20;
const MAX_ROWS = 5000;
const MAX_COLS = 100;
const MAX_BLOCKS = 2000;
const MAX_CELL_LEN = 32000;
const MAX_SLIDES = 200;
const MAX_BULLETS = 100;

export interface ExcelSheetSpec {
  name?: string;
  columns?: Array<string | number>;
  rows?: Array<Array<string | number | boolean | null>>;
}

export interface ExcelSpec {
  /** Plusieurs feuilles, OU utilisez columns/rows a la racine pour une feuille unique. */
  sheets?: ExcelSheetSpec[];
  columns?: Array<string | number>;
  rows?: Array<Array<string | number | boolean | null>>;
}

export type WordBlock =
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "paragraph"; text: string }
  | { type: "table"; columns?: string[]; rows: Array<Array<string | number>> };

export interface WordSpec {
  title?: string;
  blocks: WordBlock[];
}

/** Le PDF reutilise le meme modele de blocs que Word (titre + heading/paragraph/table). */
export type PdfBlock = WordBlock;
export interface PdfSpec {
  title?: string;
  blocks: PdfBlock[];
}

export interface PptxSlideSpec {
  title?: string;
  /** Liste a puces. */
  bullets?: string[];
  /** Paragraphes simples (sans puce). */
  paragraphs?: string[];
  /** Tableau optionnel sur la diapositive. */
  table?: { columns?: Array<string | number>; rows: Array<Array<string | number>> };
}

export interface PptxSpec {
  /** Diapositive de titre optionnelle (grand texte centre). */
  title?: string;
  subtitle?: string;
  slides: PptxSlideSpec[];
}

export interface BuiltDocument {
  base64: string;
  fileName: string;
  mimeType: string;
}

function ensureExtension(name: string, ext: ".xlsx" | ".docx" | ".pdf" | ".pptx"): string {
  const trimmed = (name || "").trim() || "document";
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(ext)) return trimmed;
  // Retire une eventuelle mauvaise extension office avant d'ajouter la bonne.
  const stripped = trimmed.replace(/\.(xlsx|xls|docx|doc|pdf|pptx|ppt)$/i, "");
  return `${stripped}${ext}`;
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : String(v);
  return s.length > MAX_CELL_LEN ? s.slice(0, MAX_CELL_LEN) : s;
}

function normalizeSheets(spec: ExcelSpec): ExcelSheetSpec[] {
  let sheets: ExcelSheetSpec[];
  if (Array.isArray(spec.sheets) && spec.sheets.length > 0) {
    sheets = spec.sheets;
  } else {
    sheets = [{ name: "Feuille1", columns: spec.columns, rows: spec.rows }];
  }
  if (sheets.length > MAX_SHEETS) {
    throw new Error(`Trop de feuilles (max ${MAX_SHEETS}).`);
  }
  return sheets;
}

/** Construit un classeur Excel (.xlsx) en base64. */
export async function buildExcelBase64(spec: ExcelSpec, fileName: string): Promise<BuiltDocument> {
  if (!spec || typeof spec !== "object") {
    throw new Error("Specification Excel invalide (objet attendu).");
  }
  const sheets = normalizeSheets(spec);

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  sheets.forEach((sheet, idx) => {
    const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    if (rows.length > MAX_ROWS) {
      throw new Error(`Trop de lignes (max ${MAX_ROWS}).`);
    }

    const aoa: Array<Array<string | number | boolean | null>> = [];
    if (columns.length > 0) {
      if (columns.length > MAX_COLS) throw new Error(`Trop de colonnes (max ${MAX_COLS}).`);
      aoa.push(columns.map((c) => cellToString(c)));
    }
    for (const row of rows) {
      const cells = Array.isArray(row) ? row : [row];
      if (cells.length > MAX_COLS) throw new Error(`Trop de colonnes (max ${MAX_COLS}).`);
      aoa.push(
        cells.map((c) => (typeof c === "number" || typeof c === "boolean" ? c : cellToString(c))),
      );
    }
    if (aoa.length === 0) aoa.push([""]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Nom de feuille: <=31 chars, sans caracteres interdits, unique.
    let name = (sheet.name || `Feuille${idx + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Feuille${idx + 1}`;
    let suffix = 1;
    while (usedNames.has(name.toLowerCase())) {
      name = `${name.slice(0, 28)}_${suffix++}`;
    }
    usedNames.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return {
    base64: Buffer.from(buf).toString("base64"),
    fileName: ensureExtension(fileName, ".xlsx"),
    mimeType: XLSX_MIME,
  };
}

/** Construit un document Word (.docx) en base64. */
export async function buildWordBase64(spec: WordSpec, fileName: string): Promise<BuiltDocument> {
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.blocks)) {
    throw new Error("Specification Word invalide (champ 'blocks' attendu).");
  }
  if (spec.blocks.length > MAX_BLOCKS) {
    throw new Error(`Trop de blocs (max ${MAX_BLOCKS}).`);
  }

  const docx = await import("docx");
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } = docx;

  const headingFor = (level?: 1 | 2 | 3) => {
    switch (level) {
      case 2: return HeadingLevel.HEADING_2;
      case 3: return HeadingLevel.HEADING_3;
      default: return HeadingLevel.HEADING_1;
    }
  };

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];

  if (spec.title && typeof spec.title === "string") {
    children.push(new Paragraph({ text: cellToString(spec.title), heading: HeadingLevel.TITLE }));
  }

  for (const block of spec.blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "heading") {
      children.push(new Paragraph({ text: cellToString(block.text), heading: headingFor(block.level) }));
    } else if (block.type === "paragraph") {
      const text = cellToString(block.text);
      // Respecte les sauts de ligne explicites a l'interieur d'un paragraphe.
      const runs = text.split("\n").map((line, i) =>
        new TextRun({ text: line, break: i > 0 ? 1 : 0 }),
      );
      children.push(new Paragraph({ children: runs }));
    } else if (block.type === "table") {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (rows.length > MAX_ROWS) throw new Error(`Trop de lignes de tableau (max ${MAX_ROWS}).`);
      const tableRows: InstanceType<typeof TableRow>[] = [];
      const header = Array.isArray(block.columns) ? block.columns : [];
      if (header.length > 0) {
        if (header.length > MAX_COLS) throw new Error(`Trop de colonnes (max ${MAX_COLS}).`);
        tableRows.push(new TableRow({
          children: header.map((c) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: cellToString(c), bold: true })] })],
          })),
        }));
      }
      for (const row of rows) {
        const cells = Array.isArray(row) ? row : [row];
        if (cells.length > MAX_COLS) throw new Error(`Trop de colonnes (max ${MAX_COLS}).`);
        tableRows.push(new TableRow({
          children: cells.map((c) => new TableCell({
            children: [new Paragraph({ text: cellToString(c) })],
          })),
        }));
      }
      if (tableRows.length > 0) {
        children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      }
    }
  }

  if (children.length === 0) {
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({ sections: [{ children: children as any }] });
  const buf = await Packer.toBuffer(doc);
  return {
    base64: Buffer.from(buf).toString("base64"),
    fileName: ensureExtension(fileName, ".docx"),
    mimeType: DOCX_MIME,
  };
}

/** Construit un document PDF (.pdf) en base64 via pdfkit (polices standard, accents FR ok). */
export async function buildPdfBase64(spec: PdfSpec, fileName: string): Promise<BuiltDocument> {
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.blocks)) {
    throw new Error("Specification PDF invalide (champ 'blocks' attendu).");
  }
  if (spec.blocks.length > MAX_BLOCKS) {
    throw new Error(`Trop de blocs (max ${MAX_BLOCKS}).`);
  }

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: 50, size: "A4" });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const usablePageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  const ensureSpace = (needed: number) => {
    if (doc.y + needed > bottom) doc.addPage();
  };

  if (spec.title && typeof spec.title === "string") {
    doc.font("Helvetica-Bold").fontSize(20).text(cellToString(spec.title), { align: "center" });
    doc.moveDown(0.8);
  }

  const headingSize = (level?: 1 | 2 | 3) => (level === 3 ? 12 : level === 2 ? 14 : 16);

  for (const block of spec.blocks) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "heading") {
      doc.moveDown(0.4);
      ensureSpace(28);
      doc.font("Helvetica-Bold").fontSize(headingSize(block.level)).text(cellToString(block.text), left, doc.y, { width: usableWidth });
      doc.moveDown(0.3);
    } else if (block.type === "paragraph") {
      doc.font("Helvetica").fontSize(11);
      const text = cellToString(block.text);
      ensureSpace(doc.heightOfString(text || " ", { width: usableWidth }));
      doc.text(text, left, doc.y, { width: usableWidth });
      doc.moveDown(0.5);
    } else if (block.type === "table") {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (rows.length > MAX_ROWS) throw new Error(`Trop de lignes de tableau (max ${MAX_ROWS}).`);
      const header = Array.isArray(block.columns) ? block.columns : [];
      const nCols = Math.max(header.length, ...rows.map((r) => (Array.isArray(r) ? r.length : 1)), 1);
      if (nCols > MAX_COLS) throw new Error(`Trop de colonnes (max ${MAX_COLS}).`);
      const colWidth = usableWidth / nCols;
      const padding = 4;

      const drawRow = (cells: Array<string | number>, isHeader: boolean) => {
        doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(10);
        const cellWidth = colWidth - padding * 2;
        const texts = Array.from({ length: nCols }, (_, i) => cellToString(cells[i]));
        const rowHeight =
          Math.max(...texts.map((t) => doc.heightOfString(t || " ", { width: cellWidth }))) + padding * 2;
        // Une ligne ne peut pas depasser la hauteur utile d'une page: rejet clair
        // plutot qu'un rendu casse a cheval sur deux pages.
        if (rowHeight > usablePageHeight) {
          throw new Error("Contenu d'une cellule de tableau trop volumineux pour une page PDF.");
        }
        // Garantit que toute la ligne tient sur la page courante avant de dessiner.
        if (doc.y + rowHeight > bottom) doc.addPage();
        const y = doc.y;
        texts.forEach((t, i) => {
          const x = left + i * colWidth;
          doc.rect(x, y, colWidth, rowHeight).strokeColor("#cccccc").lineWidth(0.5).stroke();
          // height + ellipsis empechent pdfkit de paginer automatiquement au milieu
          // d'une cellule (ce qui desynchroniserait le curseur et les bordures).
          doc.fillColor("#000000").text(t, x + padding, y + padding, {
            width: cellWidth,
            height: rowHeight - padding * 2,
            ellipsis: true,
          });
        });
        doc.y = y + rowHeight;
      };

      doc.moveDown(0.2);
      if (header.length > 0) drawRow(header, true);
      for (const row of rows) drawRow(Array.isArray(row) ? row : [row], false);
      doc.moveDown(0.5);
    }
  }

  doc.end();
  const buf = await finished;
  return {
    base64: buf.toString("base64"),
    fileName: ensureExtension(fileName, ".pdf"),
    mimeType: PDF_MIME,
  };
}

/** Construit une presentation PowerPoint (.pptx) en base64 via pptxgenjs (16:9). */
export async function buildPptxBase64(spec: PptxSpec, fileName: string): Promise<BuiltDocument> {
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.slides)) {
    throw new Error("Specification PowerPoint invalide (champ 'slides' attendu).");
  }
  if (spec.slides.length > MAX_SLIDES) {
    throw new Error(`Trop de diapositives (max ${MAX_SLIDES}).`);
  }

  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in (16:9)
  const W = 13.33;
  const margin = 0.6;
  const contentW = W - margin * 2;

  // Diapositive de titre optionnelle.
  if (spec.title && typeof spec.title === "string") {
    const s = pptx.addSlide();
    s.addText(cellToString(spec.title), {
      x: margin, y: 2.6, w: contentW, h: 1.5, fontSize: 40, bold: true, align: "center",
    });
    if (spec.subtitle && typeof spec.subtitle === "string") {
      s.addText(cellToString(spec.subtitle), {
        x: margin, y: 4.1, w: contentW, h: 0.8, fontSize: 20, align: "center", color: "666666",
      });
    }
  }

  for (const slideSpec of spec.slides) {
    if (!slideSpec || typeof slideSpec !== "object") continue;
    const s = pptx.addSlide();
    let y = margin;

    if (slideSpec.title && typeof slideSpec.title === "string") {
      s.addText(cellToString(slideSpec.title), {
        x: margin, y, w: contentW, h: 0.9, fontSize: 28, bold: true,
      });
      y += 1.1;
    }

    const bullets = Array.isArray(slideSpec.bullets) ? slideSpec.bullets.slice(0, MAX_BULLETS) : [];
    if (bullets.length > 0) {
      s.addText(
        bullets.map((b) => ({ text: cellToString(b), options: { bullet: true } })),
        { x: margin, y, w: contentW, h: 4.5, fontSize: 18, valign: "top" },
      );
      y += 4.6;
    }

    const paragraphs = Array.isArray(slideSpec.paragraphs) ? slideSpec.paragraphs.slice(0, MAX_BULLETS) : [];
    if (paragraphs.length > 0) {
      s.addText(
        paragraphs.map((p, i) => ({ text: cellToString(p), options: { breakLine: i < paragraphs.length - 1 } })),
        { x: margin, y, w: contentW, h: 4.5, fontSize: 16, valign: "top" },
      );
      y += 4.6;
    }

    const table = slideSpec.table;
    if (table && Array.isArray(table.rows)) {
      if (table.rows.length > MAX_ROWS) throw new Error(`Trop de lignes de tableau (max ${MAX_ROWS}).`);
      const header = Array.isArray(table.columns) ? table.columns : [];
      if (header.length > MAX_COLS) throw new Error(`Trop de colonnes (max ${MAX_COLS}).`);
      const tableRows: Array<Array<{ text: string; options?: Record<string, unknown> }>> = [];
      if (header.length > 0) {
        tableRows.push(header.map((c) => ({ text: cellToString(c), options: { bold: true, fill: "EEEEEE" } })));
      }
      for (const row of table.rows) {
        const cells = Array.isArray(row) ? row : [row];
        if (cells.length > MAX_COLS) throw new Error(`Trop de colonnes (max ${MAX_COLS}).`);
        tableRows.push(cells.map((c) => ({ text: cellToString(c) })));
      }
      if (tableRows.length > 0) {
        s.addTable(tableRows, {
          x: margin, y: Math.min(y, 6), w: contentW,
          border: { type: "solid", pt: 0.5, color: "CCCCCC" },
          fontSize: 12, valign: "middle",
        });
      }
    }
  }

  // pptxgenjs renvoie une chaine base64 avec outputType "base64".
  const base64 = (await pptx.write({ outputType: "base64" })) as string;
  return {
    base64,
    fileName: ensureExtension(fileName, ".pptx"),
    mimeType: PPTX_MIME,
  };
}
