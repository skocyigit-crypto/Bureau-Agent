/**
 * Tout lien envoye par courriel doit mener quelque part.
 *
 * Le courriel de fin d'essai — celui qui porte la conversion, le seul moment ou
 * l'on demande au client de payer — pointait vers `${APP_URL}/settings`. Cette
 * route n'existe pas: la page de reglages est `/parametres`. Le bouton
 * « Voir les plans » menait donc a une page introuvable, et le bandeau in-app
 * pointait deja, lui, au bon endroit — les deux chemins avaient diverge sans
 * que rien ne le signale.
 *
 * Une application a une seule page (SPA) rend ce defaut invisible aux
 * verifications naives: le serveur renvoie 200 avec `index.html` pour
 * n'importe quel chemin, et c'est le routeur du navigateur qui affiche
 * ensuite « page introuvable ». Interroger l'URL en HTTP ne prouve donc RIEN.
 * On compare les deux sources.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EMAIL = fs.readFileSync(
  path.resolve(__dirname, "../services/email.ts"),
  "utf8",
);

const APP = fs.readFileSync(
  path.resolve(__dirname, "../../../buro-ajani/src/App.tsx"),
  "utf8",
);

/** Les chemins que le routeur de l'application declare servir. */
const ROUTES = new Set([...APP.matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1]));

/** Les chemins que les courriels envoient. */
const LIENS = [
  ...new Set(
    [...EMAIL.matchAll(/\$\{APP_URL\}(\/[A-Za-z0-9/_-]*)/g)].map((m) => m[1]),
  ),
];

/** wouter accepte `/x/:id`: on compare aussi le premier segment. */
function servi(lien: string): boolean {
  const base = lien.split("?")[0].replace(/\/$/, "") || "/";
  if (ROUTES.has(base)) return true;
  const segment = "/" + base.split("/")[1];
  return [...ROUTES].some((r) => r === segment || r.startsWith(segment + "/:"));
}

describe("liens des courriels", () => {
  it("le routeur a bien ete lu", () => {
    // Garde-fou du test: si l'extraction casse, tout passerait pour valide.
    expect(ROUTES.size, "aucune route extraite de App.tsx").toBeGreaterThan(20);
    expect(LIENS.length, "aucun lien extrait de email.ts").toBeGreaterThan(0);
  });

  for (const lien of LIENS) {
    it(`${lien} est servi par le routeur`, () => {
      expect(
        servi(lien),
        `aucune route ne sert « ${lien} ». Le client cliquerait dans son courriel ` +
        "et tomberait sur une page introuvable — sans que le serveur signale quoi que ce soit, " +
        "puisqu'une SPA renvoie 200 sur n'importe quel chemin.",
      ).toBe(true);
    });
  }
});
