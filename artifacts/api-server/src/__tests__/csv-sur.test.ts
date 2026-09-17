import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { celluleCsv, documentCsv, ligneCsv } from "../lib/csv";
import { validerNote } from "../services/note-interne";

const ROUTES = join(import.meta.dirname, "..", "routes");

/** Lecteur CSV minimal (RFC 4180, separateur `;`) pour relire ce qu'on ecrit. */
function relire(csv: string): string[][] {
  const t = csv.replace(/^\uFEFF/, "");
  const lignes: string[][] = []; let ligne: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ";") { ligne.push(cell); cell = ""; }
    else if (c === "\r" && t[i + 1] === "\n") { ligne.push(cell); lignes.push(ligne); ligne = []; cell = ""; i++; }
    else cell += c;
  }
  if (cell || ligne.length) { ligne.push(cell); lignes.push(ligne); }
  return lignes;
}

describe("injection de formule neutralisee", () => {
  for (const attaque of ["=HYPERLINK(\"http://x\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
    it(`« ${JSON.stringify(attaque)} » est prefixe d'une apostrophe`, () => {
      expect(relire(celluleCsv(attaque))[0]![0]!.startsWith("'")).toBe(true);
    });
  }
  it("un montant negatif reste un nombre", () => {
    expect(celluleCsv("-120.50")).toBe('"-120.50"');
    expect(celluleCsv("-120,50")).toBe('"-120,50"');
    expect(celluleCsv(-3)).toBe("-3");
  });
  it("un texte ordinaire est intact", () => expect(relire(celluleCsv("Dupont BTP"))[0]).toEqual(["Dupont BTP"]));
});

describe("format lisible par Excel en France", () => {
  it("separateur point-virgule", () => expect(ligneCsv(["a", "b"])).toBe('"a";"b"'));
  it("un point-virgule dans une cellule ne cree pas de colonne", () => {
    expect(relire(ligneCsv(["a;b", "c"]))[0]).toEqual(["a;b", "c"]);
  });
  it("guillemets et retours a la ligne preserves", () => {
    expect(relire(ligneCsv(['il a dit "oui"', "l1\nl2"]))[0]).toEqual(['il a dit "oui"', "l1\nl2"]);
  });
  it("document : BOM, CRLF, en-tete puis lignes", () => {
    const d = documentCsv(["Nom", "Montant"], [["Été", "-5"], [null, 3]]);
    expect(d.startsWith("\uFEFF")).toBe(true);
    expect(d).toContain("\r\n");
    expect(relire(d)).toEqual([["Nom", "Montant"], ["Été", "-5"], ["", "3"]]);
  });
  it("vide, booleen, date", () => {
    expect(celluleCsv(null)).toBe("");
    expect(celluleCsv(true)).toBe('Oui');
    expect(celluleCsv(new Date("2026-01-02T03:04:05Z"))).toBe('"2026-01-02T03:04:05.000Z"');
  });
});

describe("tous les exports passent par l'ecrivain sur", () => {
  const fichiers = readdirSync(ROUTES).filter((f) => f.endsWith(".ts"));
  const avecCsv = fichiers.filter((f) => {
    // Un export, pas une liste de types MIME : un en-tete Content-Type CSV est pose.
    const s = readFileSync(join(ROUTES, f), "utf8");
    return /"Content-Type"[,:] "text\/csv/.test(s);
  });
  it("on les a bien trouves (garde contre un test vide)", () => expect(avecCsv.length).toBeGreaterThanOrEqual(15));
  for (const f of avecCsv) {
    it(`${f} n'a plus d'echappement maison`, () => {
      const s = readFileSync(join(ROUTES, f), "utf8");
      expect(s).toContain('from "../lib/csv"');
      expect(s).not.toMatch(/replace\(\/"\/g, '""'\)/);
      expect(s).not.toMatch(/\.join\(","\)/);
      // Mutation survivante mesuree : un `escape` maison d'une autre forme passait.
      // Toute fonction d'echappement locale est interdite, quelle qu'en soit la forme.
      expect(s).not.toMatch(/const escape = \(/);
      if (/\bescape\(/.test(s)) expect(s).toContain("const escape = celluleCsv;");
    });
  }
});

describe("notes internes", () => {
  const src = readFileSync(join(ROUTES, "notes-internes.ts"), "utf8");
  it("l'auteur vient de la session (req.user n'existe pas)", () => {
    expect(src).not.toContain("(req as any).user");
    expect(src.match(/req\.session\?\.userId/g)?.length).toBe(2);
  });
  it("contenu non texte : 400, pas 500", () => expect(validerNote({ content: 42 }, false).ok).toBe(false));
  it("mise a jour vers un contenu vide refusee", () => expect(validerNote({ content: "   " }, true).ok).toBe(false));
  it("mise a jour sans contenu acceptee", () => expect(validerNote({ pinned: true }, true)).toEqual({ ok: true, champs: { pinned: true } }));
  it("etiquettes non textuelles refusees", () => expect(validerNote({ content: "x", tags: [{}] }, false).ok).toBe(false));
  it("etiquettes nettoyees et dedoublonnees", () => {
    const r = validerNote({ content: "x", tags: [" a ", "a", ""] }, false);
    expect(r.ok && r.champs.tags).toEqual(["a"]);
  });
  it("contenu trop long refuse", () => expect(validerNote({ content: "x".repeat(20_001) }, false).ok).toBe(false));
  it("creation : valeurs par defaut explicites", () => {
    expect(validerNote({ content: " note " }, false)).toEqual({ ok: true, champs: { content: "note", color: "default", pinned: false, tags: [] } });
  });
  it("pinned « false » en texte n'epingle pas", () => {
    const r = validerNote({ content: "x", pinned: "false" }, false);
    expect(r.ok && r.champs.pinned).toBe(false);
  });
});
