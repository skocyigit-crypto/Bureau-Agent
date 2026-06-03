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

// Garde-fous contre les specifications abusives (memoire / taille fichier).
const MAX_SHEETS = 20;
const MAX_ROWS = 5000;
const MAX_COLS = 100;
const MAX_BLOCKS = 2000;
const MAX_CELL_LEN = 32000;

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

export interface BuiltDocument {
  base64: string;
  fileName: string;
  mimeType: string;
}

function ensureExtension(name: string, ext: ".xlsx" | ".docx"): string {
  const trimmed = (name || "").trim() || "document";
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(ext)) return trimmed;
  // Retire une eventuelle mauvaise extension office avant d'ajouter la bonne.
  const stripped = trimmed.replace(/\.(xlsx|xls|docx|doc)$/i, "");
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
