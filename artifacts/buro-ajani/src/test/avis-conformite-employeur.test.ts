/**
 * Les ecrans qui suivent des salaries menent l'employeur a ses obligations.
 *
 * Pointage, presence sur zone et rapports d'evaluation relevent du controle de
 * l'activite: consultation du CSE, information de chaque salarie, AIPD le cas
 * echeant. Le kit qui y aide existait mais aucun ecran n'y menait — or c'est
 * sur ces ecrans que l'employeur decide de s'en servir.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { URL_KIT_CONFORMITE } from "@/components/avis-conformite-employeur";

const SRC = join(import.meta.dirname, "..");
const RACINE = join(SRC, "..", "..", "..");
const lire = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const LANGUES = ["fr", "en", "tr", "es", "de", "ar"];

describe("l'avis est pose sur chaque ecran de suivi", () => {
  for (const page of ["checkins.tsx", "equipe-localisation.tsx", "performance.tsx"]) {
    it(`${page} affiche l'avis`, () => {
      const s = lire("pages", page);
      expect(s).toContain('from "@/components/avis-conformite-employeur"');
      expect(s).toMatch(/<AvisConformiteEmployeur \/>/);
    });
  }
});

describe("l'avis mene a une page qui existe", () => {
  it("l'adresse est celle de la page du site", () => {
    expect(URL_KIT_CONFORMITE).toBe("https://agentdebureau.fr/conformite-employeur");
    const app = readFileSync(join(RACINE, "artifacts", "tanitim", "src", "App.tsx"), "utf8");
    expect(app).toContain(`path="${new URL(URL_KIT_CONFORMITE).pathname}"`);
  });

  it("le lien s'ouvre a part, sans exposer l'application", () => {
    const s = lire("components", "avis-conformite-employeur.tsx");
    expect(s).toMatch(/target="_blank"/);
    expect(s).toMatch(/rel="noopener noreferrer"/);
  });
});

describe("l'avis est traduit dans chaque langue de l'application", () => {
  for (const l of LANGUES) {
    it(`${l} : titre, avis et lien`, () => {
      const j = JSON.parse(lire("i18n", "locales", `${l}.json`)) as Record<string, Record<string, string>>;
      const bloc = j.conformiteEmployeur;
      expect(bloc, `${l}: bloc absent`).toBeTruthy();
      for (const k of ["titre", "avis", "lien"]) expect(bloc![k]?.trim(), `${l}.${k} vide`).toBeTruthy();
      // Les trois obligations sont nommees, pas resumees en « conformez-vous ».
      expect(bloc!.avis).toMatch(/CSE/);
      expect(bloc!.avis).toMatch(/AIPD|DPIA/);
    });
  }
});
