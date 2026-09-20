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
    // ON REGARDE L'IMBRICATION, PAS LES COMPTEURS.
    //
    // Cette assertion comparait le NOMBRE d'occurrences de `if (res.ok)` au
    // nombre de `put(`. Une egalite de comptages ne dit rien de la structure :
    //
    //     if (res.ok) { /* rien */ }
    //     c.put(request, clone);
    //
    // laisse les deux compteurs a un, passe le test, et remet en cache le 502
    // servi pendant un deploiement — qui devient alors la page hors ligne,
    // dont l'utilisateur ne sort qu'en vidant les donnees du site.
    //
    // On verifie donc que chaque ecriture est PRECEDEE d'un `res.ok` que rien
    // n'a referme entre-temps.
    const ecritures = [...sw.matchAll(/(?:caches?\.[\w.]*|c|cache)\.put\(/g)];
    expect(ecritures.length, "aucune ecriture de cache lue: ce controle ne prouve rien").toBeGreaterThan(1);

    const nues: string[] = [];
    for (const m of ecritures) {
      const avant = sw.slice(Math.max(0, m.index! - 200), m.index!);
      const dernierTest = avant.lastIndexOf("if (res.ok)");
      if (dernierTest < 0) { nues.push(avant.trim().slice(-60)); continue; }
      // Entre le test et l'ecriture, une accolade fermante seule signifie que
      // la branche s'est refermee: l'ecriture est alors hors du test.
      const entre = avant.slice(dernierTest + "if (res.ok)".length);
      if (/\}\s*$/m.test(entre.trim())) nues.push(entre.trim().slice(0, 80));
    }
    expect(nues, `ecriture de cache hors du test res.ok: ${nues.join(" | ")}`).toEqual([]);
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
