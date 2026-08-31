import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ce que le service worker met en cache, l'utilisateur le revoit.
 *
 * C'est ce qui rend ses erreurs particulierement penibles: une mauvaise
 * reponse stockee est reservie ensuite, et l'utilisateur ne s'en sort qu'en
 * vidant lui-meme les donnees du site. Deux defauts corriges ici:
 *
 *   1. La branche navigation stockait TOUTE reponse, sans verifier `res.ok`
 *      (la branche des assets, elle, le verifiait). Un 502 servi pendant un
 *      deploiement devenait le repli hors ligne, et remplacait la derniere
 *      page valide.
 *
 *   2. En mode stale-while-revalidate, la requete de rafraichissement n'est
 *      attendue par personne quand une copie est deja en cache. Hors ligne,
 *      son rejet remontait en "unhandled rejection" a chaque asset — le genre
 *      de bruit que ce fichier evite deja explicitement ailleurs (cf. le
 *      commentaire sur les requetes `chrome-extension:`).
 */

const sw = readFileSync(
  join(import.meta.dirname, "..", "..", "public", "sw.js"),
  "utf8",
);

describe("mise en cache", () => {
  it("ne stocke jamais une reponse en echec", () => {
    // Les deux branches qui ecrivent dans le cache doivent tester `res.ok`.
    const puts = [...sw.matchAll(/cache[s]?\s*\.?\s*put\(|c\.put\(/g)];
    expect(puts.length).toBeGreaterThan(0);
    const okChecks = [...sw.matchAll(/if \(res\.ok\)/g)];
    expect(okChecks.length, "une branche ecrit dans le cache sans verifier res.ok").toBe(puts.length);
  });

  it("laisse l'API hors du cache", () => {
    // Une reponse d'API mise en cache donnerait des donnees perimees
    // indetectables: l'utilisateur verrait un ancien etat en se croyant a jour.
    expect(sw).toMatch(/url\.pathname\.includes\("\/api\/"\)/);
    expect(sw).toMatch(/url\.pathname\.includes\("\/api\/sync\/events"\)/);
  });

  it("ignore les schemes que le Cache Storage refuse", () => {
    expect(sw).toMatch(/url\.protocol !== "http:" && url\.protocol !== "https:"/);
  });
});

describe("rafraichissement en arriere-plan", () => {
  it("ne laisse pas de rejet non gere", () => {
    expect(sw).toMatch(/fresh\.catch\(\(\) => \{\}\)/);
  });
});

describe("cycle de vie", () => {
  it("purge les anciens caches a l'activation", () => {
    // Sans cela, une version fautive resterait servie indefiniment.
    expect(sw).toMatch(/keys\.filter\(\(k\) => k !== CACHE_NAME\)/);
    expect(sw).toMatch(/caches\.delete\(k\)/);
  });

  it("porte un nom de cache versionne", () => {
    // Changer le comportement de cache sans changer le nom laisserait les
    // entrees fautives en place chez ceux qui les ont deja.
    expect(sw).toMatch(/^const CACHE_NAME = "adb-cache-v\d+";/m);
  });
});
