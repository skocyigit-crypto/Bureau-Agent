/**
 * Aucun traceur d'audience sans consentement.
 *
 * Le bandeau cookies du site est INFORMATIF, par choix : le site ne pose que
 * des traceurs strictement necessaires, que l'article 82 de la loi
 * Informatique et Libertes dispense de consentement (lignes directrices CNIL
 * du 17/09/2020). Ce choix ne tient que tant qu'aucun traceur de mesure
 * d'audience ou de publicite n'est appele.
 *
 * Le 21/09/2026, `FloatingCallbackButton` appelait encore `gtag`, `dataLayer`,
 * `plausible` et `umami` « s'ils existent ». Aucun n'etait charge — mais le
 * jour ou quelqu'un ajoute Google Analytics, le bouton aurait envoye des
 * evenements sans que personne ait consenti, et le bandeau informatif serait
 * devenu faux sans qu'une ligne ne change. L'appel a ete retire.
 *
 * Un traceur reviendra peut-etre ; il devra alors passer par un vrai
 * recueil de consentement, et ce controle devra etre revu EXPLICITEMENT.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const ARBRES = [
  join(RACINE, "artifacts", "tanitim", "src"),
  join(RACINE, "artifacts", "buro-ajani", "src"),
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.name === "node_modules" || e.name === "dist") return [];
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p) ? [p] : [];
  });
}

/** Le code seul: une explication qui NOMME un traceur n'est pas un appel. */
function sansCommentaires(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const TRACEURS: Array<[string, RegExp]> = [
  ["Google Analytics (gtag)", /\bgtag\s*\(|\.gtag\b/],
  ["Google Tag Manager (dataLayer)", /\bdataLayer\b/],
  ["Plausible", /\bplausible\s*\(|\.plausible\b/],
  ["Umami", /\bumami\b/],
  ["Meta Pixel", /\bfbq\s*\(/],
  ["Matomo", /\b_paq\b/],
];

const FICHIERS = ARBRES.flatMap(sources);
/** Lu une seule fois: relire sept cents fichiers par test frolait le delai. */
const CODE = new Map(FICHIERS.map((f) => [f, sansCommentaires(readFileSync(f, "utf8"))]));

describe("aucun traceur d'audience sans consentement", () => {
  it("le releve trouve bien des sources", () => {
    // Une liste vide rendrait les controles suivants vrais sans rien lire.
    expect(FICHIERS.length).toBeGreaterThan(50);
  });

  for (const [nom, motif] of TRACEURS) {
    it(`aucun appel a ${nom}`, () => {
      const fautifs = FICHIERS.filter((f) => motif.test(CODE.get(f)!))
        .map((f) => f.slice(RACINE.length + 1).replace(/\\/g, "/"));
      expect(
        fautifs,
        `${nom} appele sans recueil de consentement — le bandeau informatif devient faux: ${fautifs.join(", ")}`,
      ).toEqual([]);
    });
  }

  it("aucun script tiers dans les pages HTML servies", () => {
    for (const html of ["artifacts/tanitim/index.html", "artifacts/buro-ajani/index.html"]) {
      const s = readFileSync(join(RACINE, html), "utf8");
      const tiers = [...s.matchAll(/<script[^>]+src=["'](https?:)?\/\/[^"']+/g)].map((m) => m[0]);
      expect(tiers, `${html}: script tiers charge`).toEqual([]);
    }
  });

  it("le bouton de rappel ne mesure plus rien", () => {
    const s = readFileSync(
      join(RACINE, "artifacts", "tanitim", "src", "components", "FloatingCallbackButton.tsx"),
      "utf8",
    );
    expect(s).not.toMatch(/trackFabEvent/);
  });
});
