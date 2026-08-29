import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Accessibilite des ecrans d'authentification.
 *
 * Les bascules « afficher / masquer le mot de passe » de la connexion, de la
 * reinitialisation et de l'inscription etaient des boutons en icone seule,
 * sans nom accessible et sortis de l'ordre de tabulation par `tabIndex={-1}`.
 * Deux barrieres de niveau A, sur le seul chemin par lequel on entre dans le
 * produit:
 *
 *  - WCAG 2.2 4.1.2 (Nom, role et valeur): un lecteur d'ecran annoncait
 *    « bouton », sans indiquer ce qu'il fait ni son etat. Un utilisateur non
 *    voyant ne pouvait pas verifier ce qu'il venait de saisir.
 *  - WCAG 2.2 2.1.1 (Clavier): retire du parcours de tabulation, le bouton
 *    etait tout simplement inatteignable sans souris.
 *
 * Verification statique, comme le reste de cette suite: la regression se
 * reintroduit par copier-coller du meme motif, et c'est cela qu'on bloque.
 */

const PAGES = ["login.tsx", "register.tsx"] as const;

function readPage(file: string): string {
  return fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "pages", file),
    "utf8",
  );
}

describe("bascules afficher/masquer le mot de passe", () => {
  it("reste atteignable au clavier sur toutes les pages d'authentification", () => {
    for (const file of PAGES) {
      expect(readPage(file), `${file} retire un controle du parcours clavier`)
        .not.toContain("tabIndex={-1}");
    }
  });

  it("porte un nom accessible qui suit l'etat affiche/masque", () => {
    for (const file of PAGES) {
      const source = readPage(file);
      const toggles = source.split("setShowPassword(!showPassword)").length - 1;
      expect(toggles, `${file} devrait contenir au moins une bascule`).toBeGreaterThan(0);

      const labels = source.split(
        'aria-label={showPassword ? t("common.hidePassword") : t("common.showPassword")}',
      ).length - 1;
      expect(labels, `${file}: ${toggles} bascule(s), ${labels} nom(s) accessible(s)`)
        .toBe(toggles);
    }
  });

  it("expose son etat au lieu de le laisser deviner", () => {
    for (const file of PAGES) {
      const source = readPage(file);
      const toggles = source.split("setShowPassword(!showPassword)").length - 1;
      const pressed = source.split("aria-pressed={showPassword}").length - 1;
      expect(pressed, `${file}: ${toggles} bascule(s), ${pressed} aria-pressed`)
        .toBe(toggles);
    }
  });

  it("masque l'icone decorative, dont le nom du bouton porte deja le sens", () => {
    for (const file of PAGES) {
      const source = readPage(file);
      // Sans aria-hidden, l'icone peut etre annoncee en plus du nom du bouton.
      expect(source).toContain('<EyeOff className="w-4 h-4" aria-hidden="true" />');
      expect(source).toContain('<Eye className="w-4 h-4" aria-hidden="true" />');
    }
  });
});

describe("traductions du nom accessible", () => {
  const LOCALES_DIR = path.resolve(import.meta.dirname, "..", "i18n", "locales");

  it("existe dans toutes les langues livrees", () => {
    // Une langue manquante afficherait la cle brute comme nom accessible —
    // « common.showPassword » lu a voix haute n'aide personne.
    const files = fs
      .readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const json = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as { common?: Record<string, string> };
      for (const key of ["showPassword", "hidePassword"]) {
        const value = json.common?.[key];
        expect(typeof value, `${file}: common.${key} manquant`).toBe("string");
        expect(value!.trim().length, `${file}: common.${key} vide`).toBeGreaterThan(0);
      }
    }
  });
});
