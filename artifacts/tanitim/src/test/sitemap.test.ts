import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Une page servie mais absente du sitemap est invisible des moteurs.
 *
 * C'est deja arrive deux fois ici: la version turque de la politique de
 * confidentialite (`/gizlilik`), puis la declaration d'accessibilite
 * (`/accessibilite`). Les deux etaient en ligne et fonctionnelles — rien ne
 * signalait le probleme, puisque la page repond normalement quand on connait
 * son adresse. Seul un visiteur qui la cherche ne la trouve pas.
 *
 * Le cas de `/accessibilite` compte double: c'est une page reglementaire
 * (RGAA, directive (UE) 2016/2102), et une declaration d'accessibilite
 * introuvable ne remplit pas son role.
 *
 * Ce test compare donc les routes declarees a ce que le sitemap annonce. Il
 * echoue a l'ajout d'une route, ce qui est exactement le moment ou il faut y
 * penser.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const app = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
const sitemap = readFileSync(join(ROOT, "public", "sitemap.xml"), "utf8");

/** Routes statiques declarees dans le routeur (hors joker et parametres). */
const routes = [...app.matchAll(/path="(\/[a-z0-9-]*)"/g)]
  .map((m) => m[1])
  .filter((p, i, a) => a.indexOf(p) === i)
  .sort();

/** Chemins annonces par le sitemap. */
const listed = [...sitemap.matchAll(/<loc>https:\/\/agentdebureau\.fr([^<]*)<\/loc>/g)]
  .map((m) => m[1] || "/")
  .filter((p, i, a) => a.indexOf(p) === i)
  .sort();

describe("sitemap", () => {
  it("compare bien deux listes reelles", () => {
    // Sans ce garde-fou, une expression de recherche cassee viderait les deux
    // listes et TOUTES les comparaisons ci-dessous passeraient sans rien
    // verifier — le test resterait vert en laissant le defaut passer.
    expect(routes.length).toBeGreaterThanOrEqual(5);
    expect(listed.length).toBeGreaterThanOrEqual(5);
  });

  it("annonce toutes les routes servies", () => {
    const missing = routes.filter((r) => !listed.includes(r));
    expect(missing, `routes servies mais absentes du sitemap: ${missing.join(", ")}`).toEqual([]);
  });

  it("n'annonce aucune route qui n'existe pas", () => {
    // Une URL morte dans le sitemap fait perdre du credit au domaine et
    // envoie les visiteurs sur une page d'erreur.
    const ghosts = listed.filter((p) => !routes.includes(p));
    expect(ghosts, `annoncees dans le sitemap mais non routees: ${ghosts.join(", ")}`).toEqual([]);
  });

  it("couvre la declaration d'accessibilite", () => {
    // Obligation reglementaire: elle doit etre trouvable, pas seulement servie.
    expect(listed).toContain("/accessibilite");
  });

  it("reste un XML de sitemap valide", () => {
    expect(sitemap).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(sitemap).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
    // Autant de balises ouvrantes que de fermantes.
    const open = (sitemap.match(/<url>/g) ?? []).length;
    const close = (sitemap.match(/<\/url>/g) ?? []).length;
    expect(open).toBe(close);
    expect(open).toBe(listed.length);
  });

  it("est annonce par robots.txt", () => {
    const robots = readFileSync(join(ROOT, "public", "robots.txt"), "utf8");
    expect(robots).toContain("Sitemap: https://agentdebureau.fr/sitemap.xml");
  });
});
