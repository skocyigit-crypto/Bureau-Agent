import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mentions legales — completude des mentions obligatoires.
 *
 * Verifie sur service-public.gouv.fr (fiche F31228, base LCEN art. 6 et 19) :
 * le numero d'immatriculation au RCS et le TELEPHONE de l'hebergeur sont
 * obligatoires. Le SIRET ne remplace pas le RCS, et l'hebergeur doit etre
 * identifie par nom, adresse ET telephone. Le defaut de mentions legales est
 * puni d'un an d'emprisonnement et 75 000 € d'amende.
 *
 * Ces valeurs sont des faits propres a la societe — extrait Kbis pour le RCS,
 * contrat pour l'hebergeur — donc elles ne peuvent pas etre devinees. Les
 * emplacements ont ete prepares avec des marqueurs visibles, et ce test bloque
 * la mise en ligne tant qu'ils n'ont pas ete remplaces: une page legale
 * affichant « à completer » en production est un defaut plus visible encore
 * que la mention manquante.
 *
 * POUR DEBLOQUER: remplacer les deux marqueurs dans mentions-legales.tsx par
 * les valeurs reelles. Ce test redevient vert immediatement.
 */

const read = (file: string) =>
  fs.readFileSync(path.resolve(import.meta.dirname, file), "utf8");

const source = read("mentions-legales.tsx");

/**
 * Toutes les pages legales passent par la meme porte: aucune ne doit atteindre
 * la production avec un marqueur non renseigne. Les CGV et la declaration
 * d'accessibilite en contiennent aussi — decisions commerciales pour les unes,
 * date de publication et resultat d'audit pour l'autre.
 */
const LEGAL_PAGES = [
  "mentions-legales.tsx",
  "cgv.tsx",
  "accessibilite.tsx",
] as const;

describe("pages legales", () => {
  it("ne laisse aucun marqueur a completer en production", () => {
    const offenders: string[] = [];
    for (const file of LEGAL_PAGES) {
      for (const marker of read(file).match(/<<[^>]*(à completer|à decider)[^>]*>>/g) ?? []) {
        offenders.push(`${file}: ${marker}`);
      }
    }
    expect(offenders, `Valeurs non renseignees:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("mentions legales", () => {

  it("identifie l'editeur par son immatriculation au RCS", () => {
    // Le SIRET identifie l'etablissement, pas l'immatriculation au registre.
    expect(source).toMatch(/RCS\s*:/);
  });

  it("identifie l'hebergeur par nom, adresse et telephone", () => {
    expect(source).toContain("Google Cloud EMEA Limited");
    expect(source).toContain("Dublin");
    expect(source).toMatch(/Téléphone\s*:/);
  });

  it("conserve les mentions deja presentes", () => {
    // Filet contre une regression par reecriture de la page.
    for (const mention of ["SIRET", "TVA intracommunautaire", "Directeur de la publication"]) {
      expect(source, `mention manquante: ${mention}`).toContain(mention);
    }
  });
});
