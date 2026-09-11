/**
 * Une operation groupee doit annoncer ce qu'elle a fait, pas ce qu'on lui a
 * demande.
 *
 * Chaque route de ce fichier filtre sur l'organisation:
 * `where(organisationId = ..., id IN (...))`. Un identifiant appartenant a
 * quelqu'un d'autre ne correspond a aucune ligne et disparait en silence —
 * c'est le comportement voulu, la garde multi-tenant fait son travail.
 *
 * La reponse, elle, rendait `ids.length`: le nombre d'identifiants ENVOYES.
 * Mesure du 2026-09-12 sur l'application en fonctionnement, cinq identifiants
 * envoyes dont trois valides: la reponse annoncait « 5 ». Apres correction,
 * « 3 ».
 *
 * L'ecart n'etait pas anodin: il valait exactement ce que la garde de securite
 * avait refuse. L'application affirmait donc avoir touche des donnees qu'elle
 * n'avait pas le droit de toucher — et l'utilisateur repartait en croyant son
 * travail fait.
 *
 * Ce test porte sur la FORME plutot que sur le comportement, a dessein: il y a
 * trente-deux routes, elles se ressemblent toutes, et c'est precisement dans
 * ce genre de repetition qu'une regression passe inapercue.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "routes", "bulk-operations.ts"),
  "utf8",
);

describe("les operations groupees disent la verite", () => {
  it("le fichier contient bien les routes attendues", () => {
    // Garde-fou: si le fichier etait renomme ou vide, les assertions suivantes
    // passeraient sans rien lire.
    expect((SOURCE.match(/router\.post\(/g) ?? []).length).toBeGreaterThanOrEqual(30);
  });

  it("aucune reponse n'annonce le nombre d'identifiants envoyes", () => {
    const menteuses = [...SOURCE.matchAll(/(updated|deleted):\s*ids\.length/g)].map((m) => m[0]);
    expect(
      menteuses,
      "ces reponses annoncent le nombre demande, pas le nombre reellement touche",
    ).toEqual([]);
  });

  it("chaque reponse s'appuie sur le resultat de la requete", () => {
    // Deux formes legitimes: `affectees(...)` pour une mise a jour (rowCount),
    // et `.length` des lignes rendues pour une suppression (`returning()`).
    const reponses = [...SOURCE.matchAll(/(?:updated|deleted):\s*([^,}]+)/g)].map((m) => m[1].trim());
    expect(reponses.length).toBeGreaterThanOrEqual(30);
    for (const r of reponses) {
      expect(
        /^affectees\(/.test(r) || /\.length$/.test(r),
        `reponse suspecte: « ${r} »`,
      ).toBe(true);
    }
  });

  it("le repli sur le nombre demande reste un repli", () => {
    // `affectees` retombe sur `demandes.length` quand le pilote ne rend pas de
    // `rowCount`. C'est voulu — une reponse approximative vaut mieux qu'une
    // reponse vide — mais cela ne doit pas devenir le chemin normal.
    expect(SOURCE).toContain("typeof n === \"number\" ? n : demandes.length");
  });
});
