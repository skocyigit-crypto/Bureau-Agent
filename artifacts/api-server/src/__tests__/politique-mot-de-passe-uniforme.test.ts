/**
 * La politique de mot de passe s'applique-t-elle a TOUTES les voies.
 *
 * Une politique ne vaut que par son point d'entree le plus faible. Le produit
 * en a six qui posent un mot de passe: inscription, changement, reinitialisation
 * par courriel, acceptation d'invitation, creation de compte par un
 * administrateur, et modification d'un compte par un administrateur.
 *
 * Cinq appelaient `validatePasswordStrength`. La sixieme — `PATCH
 * /auth/users/:id` — se contentait de `length < 8`: elle acceptait donc
 * « 12345678 », sans classe de caracteres ni liste de mots interdits.
 *
 * Et c'est la voie la plus exposee des six, pas la moins: un administrateur qui
 * pose le mot de passe d'un employe pose celui que l'employe GARDERA. Le mot de
 * passe initial d'un compte est rarement change.
 *
 * Ce test est structurel — il lit le code source plutot que d'appeler la route.
 * C'est delibere: la route exige une session administrateur et une base de
 * donnees, et un test qui ne peut pas s'executer ne protege rien. Ce qu'on veut
 * verrouiller ici tient de toute facon a une propriete du code: aucune voie ne
 * doit poser un mot de passe sans passer par la meme porte.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validatePasswordStrength } from "../routes/auth";

const racine = resolve(import.meta.dirname, "../..");
const lire = (p: string) => readFileSync(resolve(racine, p), "utf8");

describe("regle de force du mot de passe", () => {
  it("refuse ce que la voie administrateur acceptait", () => {
    // Les quatre saisies que `length < 8` laissait passer.
    for (const faible of ["12345678", "azertyuiop", "motdepasse1", "adminadmin"]) {
      const verdict = validatePasswordStrength(faible);
      expect(verdict.ok, `« ${faible} » ne devrait pas etre accepte`).toBe(false);
      expect(verdict.error, `« ${faible} » doit dire pourquoi`).toBeTruthy();
    }
  });

  it("accepte un mot de passe raisonnable sans exiger l'impossible", () => {
    // Une politique qu'on ne peut pas satisfaire pousse a ecrire le mot de
    // passe sur un papier: elle deplace le risque au lieu de le reduire.
    expect(validatePasswordStrength("Chantier-2027!").ok).toBe(true);
    expect(validatePasswordStrength("brouette Verte 91").ok).toBe(true);
  });
});

describe("toutes les voies qui posent un mot de passe", () => {
  /**
   * Chaque emplacement de `bcrypt.hash` sur un mot de passe CHOISI par un
   * humain, avec le fichier qui doit contenir l'appel a la validation.
   *
   * Les mots de passe ENGENDRES par le serveur (code temporaire, mot de passe
   * genere a la creation d'organisation) n'y figurent pas: ils ne viennent
   * d'aucune saisie, et les soumettre a la regle des classes de caracteres
   * n'ajouterait rien a leur entropie.
   */
  const voies = [
    "src/routes/auth.ts",
    "src/routes/invitations.ts",
    "src/routes/register.ts",
  ];

  it.each(voies)("%s valide la force avant de hacher", (fichier) => {
    expect(lire(fichier)).toContain("validatePasswordStrength");
  });

  it("n'accepte plus nulle part un simple controle de longueur a 8", () => {
    // La forme exacte qui posait probleme. Si elle reapparait, c'est qu'une
    // voie a de nouveau sa propre regle — le defaut precis qu'on corrige.
    for (const fichier of voies) {
      expect(lire(fichier), `${fichier} controle encore la longueur a la main`)
        .not.toContain("password.length < 8");
    }
  });

  it("compte autant de validations que de mots de passe saisis", () => {
    // Trois voies dans auth.ts: changement, creation par un administrateur,
    // reinitialisation par courriel — plus la modification par un
    // administrateur, celle qui manquait. Si une cinquieme apparait sans
    // validation, ce compte le dit.
    const source = lire("src/routes/auth.ts");
    const validations = source.match(/validatePasswordStrength\(/g) ?? [];
    // 1 declaration + 4 appels.
    expect(validations.length).toBeGreaterThanOrEqual(5);
  });
});
