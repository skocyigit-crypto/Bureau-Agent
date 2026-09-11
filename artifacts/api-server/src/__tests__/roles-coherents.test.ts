/**
 * Les roles nommes par l'attribution doivent etre des roles que le produit
 * sait creer.
 *
 * Le defaut d'origine n'empechait rien de fonctionner, et c'est pourquoi il a
 * dure: `PREFERENCES` visait « comptable », « commercial », « technicien »,
 * « chef_chantier ». Aucune route n'accepte ces valeurs — l'inscription
 * refuse en 400, l'invitation retombe sur `agent`. L'attribution tombait donc
 * toujours sur le repli suivant, qui etait le bon destinataire.
 *
 * Le degat etait ailleurs: `parDefaut` valait vrai en permanence pour trois
 * natures sur cinq, et `creerTacheIa` en tire une phrase ajoutee a la
 * description — « adressee au role « agent » faute de destinataire plus
 * specifique ». Chaque tache commerciale et de chantier s'excusait d'une
 * attribution qui etait pourtant la bonne, et la seule possible.
 *
 * Une liste de preferences qui nomme des roles inexistants ne decrit pas le
 * produit: elle decrit celui qu'on imaginait.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ROLES_REELS } from "../services/attribution-role";

const SRC = join(import.meta.dirname, "..");

function lire(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** Les listes `validRoles = [...]` telles que les routes les ecrivent. */
function rolesAcceptes(rel: string): string[][] {
  return [...lire(rel).matchAll(/validRoles = \[([^\]]*)\]/g)].map((m) =>
    [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort(),
  );
}

describe("les roles de l'attribution existent vraiment", () => {
  it("chaque role vise par une nature est un role reel", () => {
    const source = lire("services/attribution-role.ts");
    const bloc = source.slice(
      source.indexOf("const PREFERENCES"),
      source.indexOf("JAMAIS_ATTRIBUABLE"),
    );
    const vises = [...new Set([...bloc.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))];

    expect(vises.length, "extraction vide: la forme de PREFERENCES a change").toBeGreaterThanOrEqual(3);
    expect(
      vises.filter((r) => !(ROLES_REELS as readonly string[]).includes(r)),
      "ces roles sont vises par l'attribution mais aucune route ne sait les creer",
    ).toEqual([]);
  });

  it("la liste des roles reels correspond a ce que les routes acceptent", () => {
    // `auth.ts` est la reference: c'est lui qui refuse en 400. `invitations.ts`
    // n'offre pas `super_admin` — on ne s'invite pas patron — donc on verifie
    // qu'il est un SOUS-ENSEMBLE, pas l'egalite.
    const attendu: string[] = [...ROLES_REELS].sort();
    const auth = rolesAcceptes("routes/auth.ts");
    expect(auth.length, "aucune liste validRoles trouvee dans auth.ts").toBeGreaterThanOrEqual(1);
    for (const liste of auth) expect(liste).toEqual(attendu);

    for (const liste of rolesAcceptes("routes/invitations.ts")) {
      expect(liste.filter((r) => !attendu.includes(r))).toEqual([]);
    }
  });
});
