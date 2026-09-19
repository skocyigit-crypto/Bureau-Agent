/**
 * La double authentification ne disparait pas quand on n'a pas pu lire son etat.
 *
 * L'ecran de securite n'affirmait rien de faux — c'etait deja acquis — mais il
 * se taisait completement : ni badge, ni bouton « Activer », ni signe qu'il
 * s'etait passe quelque chose. Un utilisateur venu justement pour activer le
 * second facteur en repartait en concluant que le produit ne le propose pas.
 *
 * Deux exigences, donc, et elles tiennent ensemble : ne rien affirmer, et ne
 * pas laisser l'utilisateur sans issue.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "pages", "settings", "tab-securite.tsx"),
  "utf8",
);

describe("l'etat inconnu de la double authentification", () => {
  it("est retenu sur les deux chemins d'echec", () => {
    expect(
      SOURCE.split("setMfaEtatInconnu(true)").length - 1,
      "un refus du serveur et une erreur reseau doivent tous deux le lever",
    ).toBe(2);
  });

  it("est efface avant chaque nouvelle lecture", () => {
    expect(
      SOURCE.split("setMfaEtatInconnu(false)").length - 1,
      "sans remise a zero, l'avertissement survit a une lecture qui a reussi",
    ).toBe(1);
  });

  it("n'affirme ni « activee » ni « desactivee »", () => {
    // Le badge reste conditionne a `mfa`, qui n'est pose que sur une lecture
    // reussie. Un etat de securite affirme a tort est pire que pas d'etat.
    expect(SOURCE).toMatch(/\{mfa && \(\s*<Badge/);
  });

  it("laisse une issue: un controle qui relance la lecture", () => {
    const bloc = SOURCE.slice(SOURCE.indexOf("{!mfa && mfaEtatInconnu"));
    expect(bloc.slice(0, 400)).toContain("onClick={loadMfaStatus}");
    expect(bloc.slice(0, 400)).toContain("settingsSecurite.account.mfaStatusUnknown");
  });

  it("le libelle existe dans les six langues", () => {
    for (const langue of ["fr", "en", "es", "de", "tr", "ar"]) {
      const json = JSON.parse(
        readFileSync(join(import.meta.dirname, "..", "i18n", "locales", `${langue}.json`), "utf8"),
      );
      expect(
        json.settingsSecurite?.account?.mfaStatusUnknown,
        `libelle manquant en ${langue}: la cle brute s'afficherait telle quelle`,
      ).toBeTruthy();
    }
  });
});
