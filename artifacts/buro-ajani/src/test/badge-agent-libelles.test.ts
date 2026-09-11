/**
 * Les libelles d'agents existent en double: une fois cote serveur
 * (`services/tache-ia.ts`), une fois cote ecran (`pages/tasks.tsx`). Ce
 * fichier verifie qu'ils ne divergent pas.
 *
 * Le doublon est assume — l'ecran ne doit pas dependre d'un module serveur
 * pour afficher un mot — mais il se paie: en ajoutant l'agent
 * `analyse-reunion` cote serveur, la copie de l'ecran a ete oubliee. Le badge
 * ne tombait pas en panne pour autant, il affichait `analyse-reunion` tel
 * quel. C'est le pire des deux mondes: assez casse pour etre laid, assez
 * vivant pour que personne ne le signale.
 *
 * Le test compare les CLES, pas les textes. Un libelle peut legitimement etre
 * formule autrement a l'ecran; un agent absent, jamais.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");

function lire(rel: string): string {
  return readFileSync(join(RACINE, rel), "utf8");
}

/**
 * Cles d'un objet litteral `const <nom>...= { "a": ..., "b": ... }`.
 *
 * L'extraction est textuelle a dessein: importer le module serveur depuis un
 * test d'interface tirerait toute la base de donnees derriere lui.
 */
function clesDuLitteral(source: string, nom: string): string[] {
  const i = source.indexOf(nom);
  if (i === -1) throw new Error(`« ${nom} » introuvable`);
  const debut = source.indexOf("{", i);
  let profondeur = 0;
  let fin = debut;
  for (let k = debut; k < source.length; k += 1) {
    if (source[k] === "{") profondeur += 1;
    else if (source[k] === "}") {
      profondeur -= 1;
      if (profondeur === 0) { fin = k; break; }
    }
  }
  const bloc = source.slice(debut, fin + 1);
  return [...bloc.matchAll(/"([a-z-]+)"\s*:/g)].map((m) => m[1]).sort();
}

describe("les libelles d'agents ne divergent pas", () => {
  const serveur = lire("artifacts/api-server/src/services/tache-ia.ts");
  const ecran = lire("artifacts/buro-ajani/src/pages/tasks.tsx");

  it("l'extraction trouve bien des agents", () => {
    // Garde-fou du test: si la forme du fichier change et que l'extraction
    // rend deux listes vides, la comparaison passerait pour rien.
    expect(clesDuLitteral(serveur, "LIBELLE_AGENT").length).toBeGreaterThanOrEqual(9);
  });

  it("chaque agent connu du serveur a un libelle a l'ecran", () => {
    expect(
      clesDuLitteral(ecran, "LIBELLE_AGENT"),
      "un agent sans libelle s'affiche sous son identifiant brut dans le badge",
    ).toEqual(clesDuLitteral(serveur, "LIBELLE_AGENT"));
  });

  it("la liste fermee des agents et les libelles se correspondent", () => {
    // `AGENTS` est la liste fermee des agents autorises a creer une tache;
    // `LIBELLE_AGENT` est ce qu'on en montre. Un agent present dans l'une et
    // absent de l'autre est soit muet (pas de libelle), soit fantome (un
    // libelle pour un agent que rien ne peut plus produire).
    //
    // Les cles de `AGENTS` ne sont pas entre guillemets: on en extrait les
    // VALEURS, qui sont les identifiants reellement ecrits en base.
    const bloc = serveur.slice(serveur.indexOf("AGENTS = {"), serveur.indexOf("} as const;"));
    const identifiants = [...bloc.matchAll(/: "([a-z-]+)"/g)].map((m) => m[1]).sort();

    expect(identifiants.length, "extraction vide: la forme de AGENTS a change").toBeGreaterThanOrEqual(9);
    expect(identifiants).toEqual(clesDuLitteral(serveur, "LIBELLE_AGENT"));
  });
});
