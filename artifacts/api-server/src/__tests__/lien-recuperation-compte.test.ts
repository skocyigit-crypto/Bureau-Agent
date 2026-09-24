/**
 * Les liens qui font ENTRER quelqu'un dans le produit doivent tenir, meme
 * quand la configuration est fautive.
 *
 * Trouve en comparant les variables de la production a ce que le code en
 * attend: `APP_BASE_PATH` y vaut la CHAINE `"undefined"` — une variable
 * JavaScript non definie poussee telle quelle, dont Cloud Run a garde le mot.
 *
 * Les quatre points qui construisent un lien ecrivaient
 * `process.env.APP_BASE_PATH ?? ""`. `??` ne rattrape que la valeur
 * `undefined`; le MOT « undefined » traverse. D'ou, en production:
 *
 *     https://app.agentdebureau.frundefined?reset_token=...
 *
 * Un domaine qui n'existe pas. Les quatre points sont la reinitialisation de
 * mot de passe, la verification d'adresse, les invitations et les invitations
 * d'organisation: tout ce qui permet d'entrer ou de revenir.
 *
 * Rien ne pouvait le signaler de l'interieur. Les comptes en place
 * fonctionnent, aucune requete n'echoue, aucune erreur n'est journalisee. Seul
 * celui qui a oublie son mot de passe reste dehors — et il n'a personne a qui
 * le dire, puisque c'est justement l'acces qui lui manque.
 *
 * Retirer la variable repare aujourd'hui; ce test empeche que demain une autre
 * faute de configuration coupe la recuperation de compte.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { cheminBaseApp } from "../lib/chemin-base-app";

const RACINE = "https://app.agentdebureau.fr";

describe("le prefixe de chemin", () => {
  const ABSENTS: Array<[string | undefined, string]> = [
    ["undefined", "la valeur exacte trouvee en production"],
    ["null", "l'autre mot que produit une variable vide"],
    ["  ", "des espaces"],
    ["", "une chaine vide"],
    [undefined, "la variable absente"],
    ["/", "une barre seule, qui doublerait le slash"],
  ];

  it.each(ABSENTS)("%s est traite comme absent (%s)", (valeur) => {
    expect(cheminBaseApp(valeur)).toBe("");
  });

  it.each([
    ["/buro-ajani", "/buro-ajani"],
    ["buro-ajani", "/buro-ajani"],
    ["/buro-ajani/", "/buro-ajani"],
  ])("%s reste un vrai prefixe (-> %s)", (entree, attendu) => {
    // La garde doit rester une garde: un prefixe legitime doit survivre, sinon
    // on remplacerait une panne par une autre.
    expect(cheminBaseApp(entree)).toBe(attendu);
  });
});

describe("le lien de reinitialisation", () => {
  it("ne porte plus le mot « undefined »", () => {
    const lien = `${RACINE}${cheminBaseApp("undefined")}?reset_token=XXXX`;

    expect(lien).toBe(`${RACINE}?reset_token=XXXX`);
    expect(lien).not.toContain("undefined");
  });

  it("l'ancienne formule produisait bien une adresse morte", () => {
    // Contre-epreuve: sans elle, rien ne dirait que ce test protege d'un
    // defaut reel plutot qu'il ne decrit un comportement de toujours.
    const ancien = `${RACINE}${process.env.APP_BASE_PATH_FICTIF ?? "undefined"}?reset_token=XXXX`;
    expect(ancien).toBe("https://app.agentdebureau.frundefined?reset_token=XXXX");
  });
});

describe("les quatre points d'entree", () => {
  const FICHIERS = [
    "routes/auth.ts",
    "routes/invitations.ts",
    "routes/organisations.ts",
  ];

  it.each(FICHIERS)("%s ne lit plus la variable directement", (rel) => {
    const source = readFileSync(join(import.meta.dirname, "..", rel), "utf8");
    expect(
      /process\.env\.APP_BASE_PATH/.test(source),
      "la variable est relue sans garde: la faute de configuration repasse",
    ).toBe(false);
    expect(source).toContain("cheminBaseApp");
  });
});
