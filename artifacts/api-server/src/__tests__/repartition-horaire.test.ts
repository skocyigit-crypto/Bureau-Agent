import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { heureDePointe, repartirParHeure } from "../services/repartition-horaire";

const lire = (f: string) => readFileSync(join(import.meta.dirname, "..", "routes", f), "utf8");
const DASH = lire("dashboard.ts");

describe("repartirParHeure", () => {
  it("rend toujours 24 heures ordonnees", () => {
    const r = repartirParHeure([]);
    expect(r).toHaveLength(24);
    expect(r.map((h) => h.hour)).toEqual([...Array(24).keys()]);
  });
  it("place chaque ligne a son heure", () => {
    const r = repartirParHeure([{ hour: 10, total: 5, answered: 4, missed: 1 }]);
    expect(r[10]).toEqual({ hour: 10, total: 5, answered: 4, missed: 1 });
    expect(r[9]!.total).toBe(0);
  });
  it("convertit les chaines rendues par le pilote", () => {
    expect(repartirParHeure([{ hour: "23", total: "2", answered: "1", missed: "0" }])[23]!.total).toBe(2);
  });
  it("ignore une heure hors bornes", () => {
    const r = repartirParHeure([{ hour: 24, total: 9, answered: 0, missed: 0 }]);
    expect(r).toHaveLength(24);
    expect(r.every((h) => h.total === 0)).toBe(true);
  });
  it("accepte l'heure 0", () => expect(repartirParHeure([{ hour: 0, total: 3, answered: 0, missed: 0 }])[0]!.total).toBe(3));
});

describe("heureDePointe", () => {
  it("sans appel : -1, pas « 0h00 »", () => expect(heureDePointe(new Array(24).fill(0))).toBe(-1));
  it("distribution vide : -1", () => expect(heureDePointe([])).toBe(-1));
  it("trouve le maximum", () => expect(heureDePointe([0, 1, 7, 3])).toBe(2));
  it("pic reel a minuit reste 0", () => expect(heureDePointe([4, 1])).toBe(0));
});

describe("les routes", () => {
  it("hourly-performance ne fait plus 24 requetes en serie", () => {
    const i = DASH.indexOf('"/dashboard/hourly-performance"');
    expect(DASH.slice(i, i + 1500)).not.toContain("for (let h = 0; h < 24; h++)");
  });
  it("le pulse ne remplit plus des zeros en silence", () => expect(DASH).not.toContain("catch { for (let i = 0; i < 24; i++)"));
  it("aucune heure ni jour n'est extrait en UTC de session", () => {
    for (const f of ["dashboard.ts", "ai-analysis.ts", "ai-agents.ts", "../services/ai-learning.ts"]) {
      const s = lire(f);
      // Toute extraction non suivie du fuseau, quelle que soit la mise en forme.
      expect(s, f).not.toMatch(/extract\(hour from \$\{\w+\.\w+\}(?! at time zone 'Europe\/Paris')/i);
      expect(s, f).not.toMatch(/to_char\(\$\{\w+\.\w+\}(?! at time zone 'Europe\/Paris')/);
      expect(s, f).not.toContain("EXTRACT(DOW FROM created_at)");
    }
  });
});
