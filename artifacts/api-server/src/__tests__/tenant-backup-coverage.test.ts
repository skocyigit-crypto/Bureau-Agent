/**
 * La sauvegarde d'un locataire couvre-t-elle vraiment ses donnees ?
 *
 * `tenant-backup.ts` annonce, en tete de `TENANT_TABLES`: « Cette liste EST le
 * perimetre de la sauvegarde: une table absente est une donnee que le client ne
 * recupere pas. `tenant-backup-coverage.test.ts` la compare au schema et
 * echoue des qu'une table tenant est ajoutee sans etre couverte ici. »
 *
 * Ce fichier n'existait pas. La garantie etait ecrite, pas implementee — et
 * c'est la pire forme d'absence: quiconque ajoute une table lit ce commentaire,
 * croit qu'un test le rattrapera, et ne verifie rien. Au moment d'ecrire ces
 * lignes, deux tables portant `organisation_id` manquaient effectivement.
 *
 * Le test compare donc la liste au SCHEMA, source unique de verite. Toute
 * exclusion doit etre nommee ici, avec sa raison: une exclusion tacite est
 * indistinguable d'un oubli.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TENANT_TABLES } from "../services/tenant-backup";

/**
 * Tables portant `organisation_id` mais volontairement hors sauvegarde.
 *
 * `organisation_backups` contient les sauvegardes elles-memes. L'inclure
 * ferait grossir chaque sauvegarde de toutes les precedentes, a chaque
 * execution — la table la plus lourde du schema, recopiee en boucle.
 */
const EXCLUSIONS_JUSTIFIEES = new Set(["organisation_backups"]);

const SCHEMA_DIR = path.resolve(__dirname, "../../../../lib/db/src/schema");

/**
 * Toutes les tables du schema qui portent une colonne `organisation_id`.
 *
 * `pgTable\(\s*"` et non `pgTable\("`: plusieurs tables sont declarees avec le
 * nom sur la ligne SUIVANTE. Une premiere version exigeait la meme ligne, ne
 * voyait donc pas ces tables, et les signalait a la fois comme « absentes du
 * schema » et « non couvertes » — deux accusations fausses. Un controle qui se
 * trompe apprend a etre ignore.
 *
 * La borne du bloc s'arrete au prochain `export const`: certaines definitions
 * se terminent par `]);` (index) et non `});`, et chercher `});` faisait
 * deborder le bloc sur la table suivante.
 */
function tablesDuLocataire(): string[] {
  const trouvees: string[] = [];
  for (const f of fs.readdirSync(SCHEMA_DIR).filter((x) => x.endsWith(".ts"))) {
    const src = fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8");
    for (const m of src.matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)) {
      const debut = m.index ?? 0;
      const suivant = src.indexOf("\nexport const", debut + 1);
      const bloc = src.slice(debut, suivant < 0 ? undefined : suivant);
      if (/organisation_id/.test(bloc)) trouvees.push(m[1]);
    }
  }
  return trouvees;
}

describe("perimetre de la sauvegarde de locataire", () => {
  it("le schema a bien ete lu", () => {
    // Garde-fou: si l'extraction casse, tout passerait pour couvert.
    const t = tablesDuLocataire();
    expect(t.length, "aucune table tenant extraite du schema").toBeGreaterThan(50);
    expect(TENANT_TABLES.length, "TENANT_TABLES est vide").toBeGreaterThan(50);
  });

  it("couvre toutes les tables portant organisation_id", () => {
    const couvertes = new Set<string>(TENANT_TABLES as readonly string[]);
    const manquantes = tablesDuLocataire()
      .filter((t) => !couvertes.has(t))
      .filter((t) => !EXCLUSIONS_JUSTIFIEES.has(t));

    expect(
      manquantes,
      "ces tables portent organisation_id sans etre sauvegardees: le client ne les " +
      "recupere pas dans son export et ne les retrouve pas apres une restauration. " +
      "Ajoutez-les a TENANT_TABLES, ou nommez l'exclusion dans EXCLUSIONS_JUSTIFIEES " +
      "avec sa raison — une exclusion tacite est indistinguable d'un oubli.",
    ).toEqual([]);
  });

  it("ne liste pas de table absente du schema", () => {
    // L'inverse compte aussi: une table renommee ou supprimee laisserait une
    // entree morte, et la sauvegarde echouerait au moment le moins opportun.
    const reelles = new Set(tablesDuLocataire());
    const fantomes = (TENANT_TABLES as readonly string[]).filter((t) => !reelles.has(t));
    expect(
      fantomes,
      "ces tables sont listees pour la sauvegarde mais n'existent plus dans le schema",
    ).toEqual([]);
  });
});
