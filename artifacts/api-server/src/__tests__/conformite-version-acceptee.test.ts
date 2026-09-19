import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { etatConformite } from "../services/conformite-juridique";

/**
 * Une acceptation vaut pour la version qu'elle porte.
 *
 * Mesure du 18/09, en publiant les CGV 1.1 (article 8, facturation
 * electronique) : trois routes ne lisaient que le TYPE du document.
 *
 *  - `/legal/compliance` affichait « conforme », en vert, une organisation qui
 *    n'avait jamais vu le texte en vigueur — l'ecran meme qui sert a savoir
 *    qui relancer ;
 *  - `/legal/org/:id` affichait « accepte » pour un document perime ;
 *  - `/legal/accept` repondait 409 « deja accepte » en visant la version
 *    PRECEDENTE : publier une version nouvelle la rendait inacceptable, et le
 *    defaut se serait manifeste comme une impossibilite de se mettre en
 *    conformite.
 *
 * L'enjeu n'est pas cosmetique : une clause que le client n'a pas pu connaitre
 * avant de commander lui est inopposable (C. civ. 1119), et c'est l'editeur
 * qui en supporte le risque.
 */

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const legal = readFileSync(join(RACINE, "artifacts", "api-server", "src", "routes", "legal.ts"), "utf8");

const DOCS = {
  cgu: { version: "1.0", mandatory: true },
  cgv: { version: "1.1", mandatory: true },
  dpa: { version: "1.0", mandatory: false },
};

describe("etat de conformite", () => {
  it("l'acceptation de la version en vigueur suffit", () => {
    const e = etatConformite(DOCS, [
      { documentType: "cgu", documentVersion: "1.0" },
      { documentType: "cgv", documentVersion: "1.1" },
    ]);
    expect(e.conforme).toBe(true);
    expect(e.manquants).toEqual([]);
  });

  it("une acceptation d'une version anterieure ne vaut pas", () => {
    const e = etatConformite(DOCS, [
      { documentType: "cgu", documentVersion: "1.0" },
      { documentType: "cgv", documentVersion: "1.0" },
    ]);
    expect(e.conforme, "CGV 1.0 declarees suffisantes pour les CGV 1.1").toBe(false);
    expect(e.manquants).toEqual(["cgv"]);
  });

  it("une version absente ne vaut pour aucune version en vigueur", () => {
    const e = etatConformite(DOCS, [{ documentType: "cgv", documentVersion: null }]);
    expect(e.manquants).toContain("cgv");
  });

  it("un document non obligatoire ne rend pas non conforme", () => {
    const e = etatConformite(DOCS, [
      { documentType: "cgu", documentVersion: "1.0" },
      { documentType: "cgv", documentVersion: "1.1" },
    ]);
    expect(e.manquants).not.toContain("dpa");
    expect(e.conforme).toBe(true);
  });

  it("le compteur a jour ignore les acceptations perimees", () => {
    const e = etatConformite(DOCS, [
      { documentType: "cgu", documentVersion: "1.0" },
      { documentType: "cgv", documentVersion: "1.0" },
      { documentType: "dpa", documentVersion: "1.0" },
    ]);
    expect(e.aJour, "le pourcentage ne doit pas remonter grace a un texte perime").toBe(2);
  });

  it("un type inconnu n'est pas compte", () => {
    const e = etatConformite(DOCS, [{ documentType: "inconnu", documentVersion: "1.1" }]);
    expect(e.aJour).toBe(0);
    expect(e.manquants).toEqual(["cgu", "cgv"]);
  });

  it("aucune acceptation : tous les obligatoires manquent", () => {
    const e = etatConformite(DOCS, []);
    expect(e.manquants).toEqual(["cgu", "cgv"]);
    expect(e.conforme).toBe(false);
  });

  it("plusieurs acceptations du meme document : la bonne version l'emporte", () => {
    const e = etatConformite(DOCS, [
      { documentType: "cgv", documentVersion: "1.0" },
      { documentType: "cgv", documentVersion: "1.1" },
      { documentType: "cgu", documentVersion: "1.0" },
    ]);
    expect(e.conforme).toBe(true);
  });
});

describe("les routes appliquent la meme regle", () => {
  it("l'ecran de conformite passe par le service", () => {
    expect(legal, "regle reecrite dans la route: les deux finiront par diverger").toMatch(/etatConformite\(LEGAL_DOCUMENTS/);
  });

  it("l'acceptation ne bute plus sur une version perimee", () => {
    expect(
      legal,
      "sans ce critere, publier une version nouvelle la rend inacceptable (409)",
    ).toMatch(/eq\(legalAgreementsTable\.documentVersion, docDef\.version\)/);
  });

  it("accept-all compare le couple (type, version)", () => {
    expect(legal).toMatch(/dejaAJour/);
  });

  it("la fiche d'une organisation distingue « perime » de « accepte »", () => {
    expect(legal).toMatch(/"outdated"/);
  });
});

describe("les CGV publiees portent la version que le code annonce", () => {
  it("la version enregistree a l'inscription est celle des CGV en vigueur", () => {
    const schema = readFileSync(
      join(RACINE, "lib", "db", "src", "schema", "legal-agreements.ts"), "utf8",
    );
    const bloc = schema.slice(schema.indexOf("cgv: {"));
    expect(bloc, "l'article 8 a ete ajoute sans changer de version").toMatch(/version: "1\.1"/);
  });
});

/**
 * L'ecran doit savoir dire « perime ». Sans cela, le nouveau statut retombait
 * dans la branche « en attente »: l'action proposee etait la bonne, mais
 * l'encadre de preuve continuait d'afficher un coche vert et « accepte par »,
 * c'est-a-dire l'affirmation exacte que le statut vient de retirer.
 */
describe("l'ecran super-admin montre la peremption", () => {
  const page = readFileSync(
    join(RACINE, "artifacts", "buro-ajani", "src", "pages", "organisations.tsx"), "utf8",
  );

  it("le type admet le statut perime", () => {
    expect(page).toMatch(/"accepted" \| "outdated" \| "pending"/);
  });

  it("l'encadre de preuve cesse d'afficher un coche vert", () => {
    expect(page, "une preuve perimee affichee en vert dit le contraire du statut").toMatch(
      /doc\.status === "outdated" \? "bg-amber-50/,
    );
  });

  it("il nomme la version acceptee et la version en vigueur", () => {
    expect(page).toMatch(/outdatedNotice/);
  });

  it("les deux libelles existent dans les six langues", () => {
    for (const langue of ["fr", "en", "tr", "de", "es", "ar"]) {
      const j = JSON.parse(readFileSync(
        join(RACINE, "artifacts", "buro-ajani", "src", "i18n", "locales", `${langue}.json`), "utf8",
      ));
      const d = j.organisationsPage?.legalDetail;
      expect(d?.outdated, `traduction manquante: ${langue}`).toBeTruthy();
      expect(d?.outdatedNotice, `notice manquante: ${langue}`).toBeTruthy();
    }
  });
});
