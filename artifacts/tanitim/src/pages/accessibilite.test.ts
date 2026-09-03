import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Declaration d'accessibilite — l'accord entre ce qui est annonce et ce qui
 * est mesure.
 *
 * La declaration est un artefact legal: elle doit decrire l'etat REEL. Son
 * piege propre est qu'elle se perime toute seule. Elle n'annonce pas une
 * intention mais un constat, et un constat vieillit — dans les deux sens.
 * Corriger une barriere rend la page trop pessimiste; relever un plafond de
 * test la rend fausse dans l'autre sens, le sens qui engage la societe.
 *
 * Ni l'un ni l'autre ne se voit: la page continue de s'afficher, aucun type ne
 * casse, aucun rendu ne bouge. C'est exactement la forme de defaut que ce
 * depot corrige a coups de cliquet plutot qu'a coups de vigilance.
 *
 * Ce test relie donc les deux fichiers. Les chiffres annonces au public
 * viennent de `a11y-budget.test.ts` cote application cliente; si ces plafonds
 * bougent, la declaration doit bouger avec eux, et c'est ici que le refus
 * tombe. Il ne mesure pas l'accessibilite — l'autre test s'en charge. Il
 * verifie qu'on n'a pas ecrit au public autre chose que ce qu'on mesure.
 */

const PAGE = path.join(import.meta.dirname, "accessibilite.tsx");
const BUDGETS = path.resolve(
  import.meta.dirname,
  "../../../buro-ajani/src/test/a11y-budget.test.ts",
);

describe("declaration d'accessibilite", () => {
  const page = fs.readFileSync(PAGE, "utf8");

  it("reste adossee au cliquet qui mesure l'application", () => {
    // Si ce fichier est deplace, le test doit tomber plutot que sauter en
    // silence: une verification qui ne verifie plus rien est pire qu'absente.
    expect(fs.existsSync(BUDGETS), `budget introuvable: ${BUDGETS}`).toBe(true);
  });

  it("n'annonce aucun bouton-icone nomme tant que le budget n'est pas a zero", () => {
    const budgets = fs.readFileSync(BUDGETS, "utf8");
    const m = budgets.match(/const UNNAMED_BUDGET = (\d+);/);
    expect(m, "UNNAMED_BUDGET introuvable").not.toBeNull();

    // La page affirme au public que l'application n'a plus un seul
    // bouton-icone anonyme. Cette phrase n'est vraie que si le plafond vaut
    // zero: a un plafond de 1, elle devient une fausse declaration.
    if (Number(m![1]) !== 0) {
      expect.fail(
        `UNNAMED_BUDGET vaut ${m![1]}, mais la declaration annonce qu'aucun ` +
          "bouton-icone n'est depourvu de nom. Corrigez les boutons, ou " +
          "retirez cette affirmation de accessibilite.tsx.",
      );
    }
    expect(page).toContain("aucun n'en est dépourvu");
  });

  it("annonce le meme nombre de cibles sous 24px que le budget mesure", () => {
    const budgets = fs.readFileSync(BUDGETS, "utf8");
    const m = budgets.match(/const UNDERSIZED_BUDGET = (\d+);/);
    expect(m, "UNDERSIZED_BUDGET introuvable").not.toBeNull();

    // Le chiffre est ecrit en toutes lettres dans la page, parce qu'une
    // declaration se lit. Le test le retraduit pour pouvoir comparer.
    const ECRIT: Record<string, string> = {
      "0": "Aucune cible",
      "1": "Une cible de pointage reste",
      "2": "Deux cibles de pointage restent",
    };
    const attendu = ECRIT[m![1]];
    expect(
      attendu,
      `budget de ${m![1]} cibles: ajoutez sa formulation a ce test et a la page`,
    ).toBeDefined();
    expect(
      page.includes(attendu),
      `la declaration doit annoncer « ${attendu} » sous 24 × 24 pixels, ` +
        `puisque le budget mesure vaut ${m![1]}`,
    ).toBe(true);
  });

  it("ne revendique pas un taux de conformite qui n'a pas ete mesure", () => {
    // Un taux suppose un audit RGAA sur l'echantillon obligatoire. Aucun n'a
    // ete mene; l'annoncer serait une fausse declaration, plus grave que
    // l'absence de page.
    expect(page).toContain("non conforme");
    expect(page).toMatch(/taux de conformité[^.]*n'est[^.]*pas/);
    expect(page).not.toMatch(/conforme à \d+\s?%|taux de conformité de \d/);
  });
});
