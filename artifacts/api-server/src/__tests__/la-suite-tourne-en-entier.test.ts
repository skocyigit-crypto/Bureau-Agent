/**
 * Une suite verte parce que la moitie n'a pas tourne.
 *
 * Tous les controles de ce depot reposent sur une hypothese jamais verifiee :
 * qu'ils ont ETE EXECUTES. Un `it.only` egare suffit a la casser — vitest ne
 * lance alors que ce test-la dans son fichier, le reste disparait, et le
 * rapport dit « 1 passed ». La porte est verte, le fichier est vert, et
 * quarante assertions n'ont rien mesure.
 *
 * Le cas n'est pas theorique : un `.only` laisse apres une seance de mise au
 * point est l'oubli le plus banal qui soit, et c'est precisement celui que
 * personne ne voit passer en relecture — il ressemble a du code de test
 * normal.
 *
 * Ce controle est la reponse a une observation d'une session voisine
 * (assise-next-8e, 20/09) : chez elle, une execution de CI rendait `SUCCESS`
 * alors que 539 tests de base de donnees etaient silencieusement sautes. Ce
 * qui l'a rattrapee n'etait pas un test, mais un garde-fou sur la TAILLE de ce
 * qui tourne. Le meme raisonnement s'applique ici.
 *
 * Trois interdits, et un plancher :
 *
 *  - `.only` — interdit partout, sans exception possible ;
 *  - `.skip` inconditionnel — un test desactive qu'on croit actif ;
 *  - `skipIf` / `runIf` sans explication — legitimes (une ressource externe
 *    absente), mais ils doivent dire POURQUOI, sinon on ne sait pas si la
 *    condition est encore vraie ;
 *  - le nombre de fichiers de test ne s'effondre pas — un motif de recherche
 *    modifie, un dossier renomme, et la moitie de la suite cesse d'etre
 *    ramassee sans que rien ne rougisse.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** La racine du depot, depuis `artifacts/api-server/src/__tests__`. */
const RACINE = join(import.meta.dirname, "..", "..", "..", "..");

/** Les arbres ou vivent des tests, tous produits confondus. */
const ARBRES = [
  join(RACINE, "artifacts", "api-server", "src"),
  join(RACINE, "artifacts", "buro-ajani", "src"),
  join(RACINE, "artifacts", "mobile", "lib"),
  join(RACINE, "artifacts", "tanitim", "src"),
  join(RACINE, "lib"),
];

function fichiersDeTest(dir: string): string[] {
  let entrees;
  try {
    entrees = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entrees.flatMap((e) => {
    const p = join(dir, e.name);
    if (e.name === "node_modules" || e.name === "dist") return [];
    if (e.isDirectory()) return fichiersDeTest(p);
    return /\.test\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

const TOUS = ARBRES.flatMap(fichiersDeTest);

/**
 * Le code, commentaires retires.
 *
 * Premiere version de ce controle : il comptait les `.only` cites dans SON
 * PROPRE en-tete, celui qui explique pourquoi ils sont interdits. Un controle
 * qui crie au loup sur sa propre explication finit desactive.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Le bloc de commentaire de tete d'un fichier, s'il y en a un. */
function enTete(source: string): string {
  const m = /^\s*\/\*[\s\S]*?\*\//.exec(source);
  return m?.[0] ?? "";
}

/**
 * Plancher du nombre de fichiers de test.
 *
 * 372 au 20/09. Le plancher est pose nettement en dessous pour qu'un
 * regroupement legitime de fichiers ne le fasse pas tomber, et assez haut pour
 * qu'une moitie disparue le fasse tomber tout de suite. A RELEVER quand le
 * depot grossit franchement, jamais a baisser pour faire passer une suppression.
 */
const PLANCHER_FICHIERS = 300;

const court = (p: string) => p.slice(RACINE.length + 1).replace(/\\/g, "/");

describe("aucun test n'est desactive a l'insu de tout le monde", () => {
  it("le releve trouve bien des fichiers de test", () => {
    // Sans ce garde-fou, un parcours casse rendrait les assertions suivantes
    // vraies sur une liste vide — le defaut exact que ce fichier combat.
    expect(TOUS.length, "aucun fichier de test ramasse: le parcours est casse").toBeGreaterThan(50);
  });

  it("aucun `.only` nulle part", () => {
    const fautifs: string[] = [];
    for (const f of TOUS) {
      const lignes = sansCommentaires(readFileSync(f, "utf8")).split(/\r?\n/);
      lignes.forEach((l, i) => {
        if (/\b(?:describe|it|test)\.only\b/.test(l)) fautifs.push(`${court(f)}:${i + 1}`);
      });
    }
    expect(
      fautifs,
      `\`.only\` laisse dans un fichier: le reste du fichier ne tourne plus, et le rapport reste vert. ${fautifs.join(", ")}`,
    ).toEqual([]);
  });

  it("aucun `.skip` inconditionnel", () => {
    const fautifs: string[] = [];
    for (const f of TOUS) {
      const lignes = sansCommentaires(readFileSync(f, "utf8")).split(/\r?\n/);
      lignes.forEach((l, i) => {
        if (/\b(?:describe|it|test)\.skip\b/.test(l)) fautifs.push(`${court(f)}:${i + 1}`);
      });
    }
    expect(
      fautifs,
      `test desactive qu'on croit actif: ${fautifs.join(", ")}`,
    ).toEqual([]);
  });

  it("chaque `skipIf` dit pourquoi", () => {
    // Un saut conditionnel est legitime — une cle d'API absente, un service
    // externe. Mais sans explication, personne ne sait si la condition est
    // encore vraie, ni ce qui n'est plus mesure.
    const nus: string[] = [];
    for (const f of TOUS) {
      const source = readFileSync(f, "utf8");
      const lignes = source.split(/\r?\n/);
      lignes.forEach((l, i) => {
        if (!/\b(?:describe|it|test)\.(?:skipIf|runIf)\b/.test(l)) return;
        // L'explication vaut qu'elle soit juste au-dessus OU dans l'en-tete du
        // fichier — la seconde est meme la meilleure, et c'est celle que
        // `stripe-live-e2e.test.ts` emploie. Une fenetre de quinze lignes la
        // ratait : encore un controle qui criait au loup sur du code exemplaire.
        const avant = lignes.slice(Math.max(0, i - 15), i).join("\n");
        const explique = /\/\/|\*/.test(avant)
          || /saut[eé]|skip|absent|sans cl[eé]|cl[eé] test|configur/i.test(enTete(source));
        if (!explique) nus.push(`${court(f)}:${i + 1}`);
      });
    }
    expect(nus, `saut conditionnel sans explication: ${nus.join(", ")}`).toEqual([]);
  });

  it("la suite ne s'effondre pas en nombre de fichiers", () => {
    expect(
      TOUS.length,
      `${TOUS.length} fichiers de test ramasses, plancher ${PLANCHER_FICHIERS}. ` +
        "Un motif de recherche modifie ou un dossier renomme fait disparaitre des " +
        "fichiers sans qu'aucun test ne rougisse: la suite reste verte parce " +
        "qu'une partie n'a pas tourne.",
    ).toBeGreaterThanOrEqual(PLANCHER_FICHIERS);
  });

  it("et chaque produit garde ses propres tests", () => {
    // Un plancher global serait satisfait par un seul produit bien fourni.
    const parArbre = ARBRES.map((a) => ({ ou: court(a), combien: fichiersDeTest(a).length }));
    const vides = parArbre.filter((x) => x.combien === 0).map((x) => x.ou);
    expect(vides, `produit sans aucun test: ${vides.join(", ")}`).toEqual([]);
  });
});
