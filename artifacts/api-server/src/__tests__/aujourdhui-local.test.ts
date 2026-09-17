// Production en UTC (Cloud Run) : sans cela, un poste regle sur Paris masquerait le defaut.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { jourLocal } from "../lib/jour-local";

const ARTIFACTS = join(import.meta.dirname, "..", "..", "..");
const RACINES = ["api-server/src", "buro-ajani/src", "mobile/app", "mobile/lib"];
// « Aujourd'hui » derive de l'instant present, ou la cle de jour d'un evenement
// cote client. Une date deja stockee (colonne DATE, releve bancaire) n'est pas visee.
const MOTIF = /(new Date\(\)|\bnow|Date\.now\(\)[^)]*\)|startDate\)?)\.(toISOString\(\)\.)?(slice\(0, ?10\)|split\("T"\)\[0\])/;
// Usages legitimes : un NOM de fichier, un identifiant de lot, une date de taux de change.
// `cutoff` : borne de recherche web, un jour d'ecart est sans effet.
// `projet.startDate` : le formulaire enregistre la date a minuit UTC et la relit
// de meme — aller-retour coherent (verifie le 17/09).
const CONTEXTE_OK = /filename|download|fileName|Content-Disposition|runId|dayBucket|stamp|rate[,:]|json\.date|cutoff|projet\.(start|end)Date/;
// Corriges dans une PR ouverte (#173). Le test echoue quand la ligne disparait :
// l'exception se retire alors d'ici, elle ne reste pas en place par oubli.
const EN_COURS_AILLEURS = [
  ["api-server/src/routes/workspace.ts", 'const reportDate = date || new Date().toISOString().split("T")[0];'],
  ["api-server/src/routes/workspace.ts", 'const todayStr = now.toISOString().split("T")[0];'],
  ["buro-ajani/src/pages/reports.tsx", 'useState(new Date().toISOString().split("T")[0]);'],
] as const;

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === "__tests__" ? [] : fichiers(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("jourLocal (serveur)", () => {
  it("00h30 a Paris en ete est deja le lendemain de la date UTC", () => {
    expect(jourLocal(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
    expect(new Date("2026-07-14T22:30:00Z").toISOString().slice(0, 10)).toBe("2026-07-14");
  });
  it("hiver : 23h30 UTC = 00h30 Paris", () => expect(jourLocal(new Date("2026-01-09T23:30:00Z"))).toBe("2026-01-10"));
  it("milieu de journee : identique", () => expect(jourLocal(new Date("2026-07-15T10:00:00Z"))).toBe("2026-07-15"));
  it("un autre fuseau reste possible", () => expect(jourLocal(new Date("2026-07-15T02:00:00Z"), "America/New_York")).toBe("2026-07-14"));
});

describe("aucun « aujourd'hui » calcule en UTC dans les trois applications", () => {
  const trouves: string[] = [];
  for (const r of RACINES) {
    for (const f of fichiers(join(ARTIFACTS, r))) {
      readFileSync(f, "utf8").split(/\r?\n/).forEach((ligne, i) => {
        if (MOTIF.test(ligne) && !CONTEXTE_OK.test(ligne) && !/^\s*(\*|\/\/)/.test(ligne)) trouves.push(`${relative(ARTIFACTS, f).split("\\").join("/")}:${i + 1}  ${ligne.trim()}`);
      });
    }
  }
  it("on a bien parcouru les applications (garde contre un test vide)", () => {
    expect(fichiers(join(ARTIFACTS, "buro-ajani/src")).length).toBeGreaterThan(100);
  });
  it("pas d'usage hors liste", () => {
    const hors = trouves.filter((t) => !EN_COURS_AILLEURS.some(([f, l]) => t.startsWith(f) && t.endsWith(l)));
    expect(hors).toEqual([]);
  });
  for (const [f, l] of EN_COURS_AILLEURS) {
    it(`exception encore justifiee : ${f}`, () => {
      expect(readFileSync(join(ARTIFACTS, f), "utf8"), "corrige : retirer cette exception").toContain(l);
    });
  }
});
