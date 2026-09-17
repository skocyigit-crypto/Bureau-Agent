import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ecartPoints, moyenneOuNull, taux, variationPourcent } from "../services/comparaison-hebdo";

const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "dashboard.ts"), "utf8");

describe("comparaison hebdomadaire : zero n'est pas inconnu", () => {
  it("taux sans denominateur rend null, pas 0 %", () => expect(taux(0, 0)).toBeNull());
  it("taux mesure arrondi au dixieme", () => expect(taux(2, 3)).toBe(66.7));
  it("taux de 0 sur 10 reste une mesure : 0", () => expect(taux(0, 10)).toBe(0));
  it("variation depuis zero rend null (de 0 a 50 n'est pas 0 %)", () => expect(variationPourcent(50, 0)).toBeNull());
  it("variation stable rend 0", () => expect(variationPourcent(40, 40)).toBe(0));
  it("hausse positive, baisse negative", () => {
    expect(variationPourcent(60, 40)).toBe(50);
    expect(variationPourcent(20, 40)).toBe(-50);
  });
  it("variation avec un terme inconnu rend null", () => {
    expect(variationPourcent(null, 10)).toBeNull();
    expect(variationPourcent(10, null)).toBeNull();
  });
  it("ecart en points, null si un taux manque", () => {
    expect(ecartPoints(80, 75.5)).toBe(4.5);
    expect(ecartPoints(null, 75)).toBeNull();
  });
  it("moyenne sans ligne rend null", () => expect(moyenneOuNull("12", 0)).toBeNull());
  it("moyenne SQL en chaine convertie", () => expect(moyenneOuNull("42.5", 3)).toBe(42.5));
  it("la route n'invente plus le pic 9h / lundi", () => {
    expect(ROUTE).not.toMatch(/\?\?\s*9\b/);
    expect(ROUTE).not.toContain('?? "Lun"');
  });
});
