/**
 * Aucune page ne doit interdire le zoom pince.
 *
 * `user-scalable=no` et `maximum-scale=1` empechent l'agrandissement sur
 * telephone. C'est une violation directe du critere WCAG 2.2 1.4.4
 * (Redimensionnement du texte, niveau AA), repris par l'EN 301 549 et le
 * RGAA — donc par l'Acte europeen sur l'accessibilite.
 *
 * Etat trouve en production: le site vitrine respectait la regle et portait
 * meme un commentaire l'expliquant; l'APPLICATION, celle que les clients
 * ouvrent tous les jours, gardait `user-scalable=no`. La regle etait connue et
 * appliquee a un seul endroit — c'est exactement ce qu'un test rend
 * impossible.
 *
 * Et ce n'est pas qu'une case a cocher: les utilisateurs de ce produit
 * consultent leurs chantiers sur un telephone, dehors, en plein soleil,
 * souvent sans lunettes. Ne pas pouvoir agrandir un montant ou une adresse est
 * un obstacle reel.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Les pages HTML servies aux utilisateurs, application et vitrine. */
const PAGES = [
  ["application", join(import.meta.dirname, "..", "..", "index.html")],
  ["vitrine", join(import.meta.dirname, "..", "..", "..", "tanitim", "index.html")],
] as const;

function viewport(html: string): string {
  const m = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/i);
  // Garde-fou: sans balise viewport du tout, le test passerait a vide alors
  // que la page serait illisible sur telephone.
  expect(m, "aucune balise viewport trouvee").not.toBeNull();
  return m![1];
}

describe.each(PAGES)("%s", (_nom, chemin) => {
  const html = readFileSync(chemin, "utf8");

  it("n'interdit pas le zoom", () => {
    const contenu = viewport(html);
    expect(
      /user-scalable\s*=\s*no/i.test(contenu),
      "user-scalable=no empeche l'agrandissement (WCAG 2.2 - 1.4.4, niveau AA)",
    ).toBe(false);
  });

  it("ne plafonne pas l'agrandissement", () => {
    const contenu = viewport(html);
    const plafond = contenu.match(/maximum-scale\s*=\s*([\d.]+)/i);
    // Un plafond est tolere s'il laisse au moins le quintuple, seuil retenu
    // par le critere. En pratique on n'en met aucun.
    if (plafond) {
      expect(
        Number(plafond[1]),
        "maximum-scale limite l'agrandissement sous le seuil de 500 %",
      ).toBeGreaterThanOrEqual(5);
    }
  });
});
