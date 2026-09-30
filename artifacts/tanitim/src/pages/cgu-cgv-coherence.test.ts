/**
 * Les CGU ne contredisent pas les CGV sur le prix et ses conditions.
 *
 * Revue de vendabilite du 30/09 : les CGU annoncaient un preavis de 30 jours
 * pour une revision de prix, les CGV 60 jours. Face a deux clauses
 * contradictoires, l'interpretation favorable au client prevaut (C. civ.
 * art. 1190) et les CGV sont le socle de la negociation commerciale (C. com.
 * L441-1) : les conditions de vente ne se repetent plus dans les CGU, elles y
 * renvoient.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CGU = readFileSync(join(import.meta.dirname, "cgu.tsx"), "utf8");
const CGV = readFileSync(join(import.meta.dirname, "cgv.tsx"), "utf8");

describe("CGU / CGV", () => {
  it("les CGU ne fixent aucun preavis de revision de prix", () => {
    expect(CGU).not.toMatch(/pr[ée]avis de \d+ jours/i);
  });
  it("les CGU renvoient aux CGV pour les conditions de vente", () => {
    expect(CGU).toMatch(/href="\/cgv"/);
  });
  it("les CGV portent bien le preavis de soixante jours", () => {
    expect(CGV).toMatch(/soixante \(60\) jours/);
  });
});
