/**
 * Un statut ecrit a la main dans du SQL brut ne previent pas quand il est faux.
 *
 * Les statuts d'appel sont stockes en francais: `manque`, `repondu`. L'API
 * traduit le filtre public `missed` vers `manque` (`routes/calls.ts`), et tout
 * le depot interroge `manque` — sauf une requete du tableau de bord, qui
 * demandait `status = 'missed'`.
 *
 * Elle ne renvoyait donc jamais rien. L'alerte « ce client insiste », qui se
 * declenche quand le meme numero a ete manque plusieurs fois en vingt-quatre
 * heures, ne s'est jamais affichee. Un client qui rappelle apres plusieurs
 * appels manques est precisement celui qu'on risque de perdre: c'est le seul
 * cas que cette alerte existait pour attraper.
 *
 * Rien ne pouvait le signaler. La requete est valide, elle s'execute sans
 * erreur, elle rend zero ligne — et zero ligne ressemble a « tout va bien ».
 *
 * D'ou ce test. Avec l'ORM, une colonne mal orthographiee ne compile pas; en
 * SQL brut, une VALEUR mal orthographiee ne se voit nulle part. On verifie
 * donc que toute comparaison ecrite a la main sur `status` utilise une valeur
 * que le produit emploie reellement.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

/**
 * Les valeurs de statut employees ailleurs dans le depot, via l'ORM.
 *
 * On ne les code pas en dur ici: la liste est deduite de ce que le code fait
 * vraiment, donc elle suit le produit au lieu de le contredire.
 */
function valeursConnues(): Set<string> {
  const connues = new Set<string>();
  for (const chemin of fichiers(SRC)) {
    const source = readFileSync(chemin, "utf8");
    // Comparaison via l'ORM: `eq(table.status, "x")`.
    for (const [, v] of source.matchAll(/eq\(\s*\w+\.status\s*,\s*"([a-z_]+)"\s*\)/g)) connues.add(v);
    // Ecriture: `status: "x"` — dans un insert, un update, ou une constante.
    // Sans cette seconde source, le controle signalait des valeurs
    // parfaitement reelles d'autres tables (`success`, `en_retard`) au seul
    // motif qu'elles n'etaient jamais comparees par `eq`. Un controle qui
    // crie a tort finit ignore, et emporte ses vraies trouvailles avec lui.
    for (const [, v] of source.matchAll(/\bstatus:\s*"([a-z_]+)"/g)) connues.add(v);
  }
  return connues;
}

/**
 * Le code sans ses commentaires, les lignes conservees.
 *
 * Les blocs et les lignes commentes sont remplaces par des espaces plutot que
 * supprimes: les numeros de ligne rapportes restent ainsi ceux du fichier
 * reel, et le message d'erreur reste utilisable tel quel.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, avant) => avant + " ".repeat(m.length - avant.length));
}

function fichiers(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
    else if (/\.ts$/.test(entree) && !entree.includes(".test.")) trouves.push(chemin);
  }
  return trouves;
}

describe("les statuts ecrits en SQL brut existent vraiment", () => {
  const connues = valeursConnues();

  it("trouve bien des statuts employes par l'ORM", () => {
    // Garde-fou: si l'extraction rendait un ensemble vide, tout passerait.
    expect(connues.size, "aucun statut trouve: la forme du code a change").toBeGreaterThan(5);
  });

  it("aucune comparaison SQL brute n'invente une valeur", () => {
    const inconnues: string[] = [];

    for (const chemin of fichiers(SRC)) {
      // Les commentaires sont retires AVANT l'examen. Sans cela, le controle
      // signalait `services/invoice-status.ts:8` — une phrase de documentation
      // qui raconte precisement le defaut corrige ici. Accuser un commentaire
      // d'expliquer un bug est la meilleure facon de faire desactiver un test.
      const source = sansCommentaires(readFileSync(chemin, "utf8"));
      // `status = 'x'` dans une chaine SQL ecrite a la main.
      for (const m of source.matchAll(/\bstatus\s*=\s*'([a-z_]+)'/g)) {
        if (!connues.has(m[1])) {
          const ligne = source.slice(0, m.index).split("\n").length;
          inconnues.push(`${chemin.slice(SRC.length + 1)}:${ligne} -> status = '${m[1]}'`);
        }
      }
    }

    expect(
      inconnues,
      `ces valeurs ne sont employees nulle part ailleurs: la requete s'executera sans erreur et ne rendra jamais rien. Valeurs connues: ${[...connues].sort().join(", ")}`,
    ).toEqual([]);
  });
});
