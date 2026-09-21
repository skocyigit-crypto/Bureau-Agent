/**
 * Trois non-conformites RGAA relevees par l'audit du 21/09/2026, corrigees ici.
 *
 *  - 8.6 / WCAG 2.4.2 : toutes les pages portaient le meme titre ;
 *  - 11.2 / WCAG 2.5.3 : sur la connexion et l'inscription, un `aria-label`
 *    reprenant le texte d'exemple REMPLACAIT l'etiquette visible comme nom
 *    accessible — une personne qui pilote a la voix en disant « Adresse
 *    e-mail » ne touchait pas le champ ;
 *  - 11.13 / WCAG 1.3.5 : prenom, nom, organisation et telephone de
 *    l'inscription sans `autocomplete`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOM_PRODUIT, titreDePage } from "@/lib/titre-page";

const PAGES = join(import.meta.dirname, "..", "pages");
const lire = (f: string) => readFileSync(join(PAGES, f), "utf8");

const MENU = [
  { name: "Tableau de bord", href: "/" },
  { name: "Contacts", href: "/contacts" },
  { name: "Import de contacts", href: "/contacts/import" },
  { name: "Appels", href: "/appels" },
];

describe("chaque page a son titre", () => {
  it("l'accueil porte le nom du tableau de bord", () => {
    expect(titreDePage("/", MENU)).toBe(`Tableau de bord – ${NOM_PRODUIT}`);
  });

  it("une page du menu porte son nom", () => {
    expect(titreDePage("/appels", MENU)).toBe(`Appels – ${NOM_PRODUIT}`);
  });

  it("une fiche herite du nom de sa rubrique", () => {
    expect(titreDePage("/contacts/42", MENU)).toBe(`Contacts – ${NOM_PRODUIT}`);
  });

  it("l'entree la plus precise l'emporte", () => {
    expect(titreDePage("/contacts/import", MENU)).toBe(`Import de contacts – ${NOM_PRODUIT}`);
  });

  it("« / » ne capture pas toutes les adresses", () => {
    // Sinon chaque page inconnue s'appellerait « Tableau de bord ».
    expect(titreDePage("/inconnue", MENU)).toBe(NOM_PRODUIT);
  });

  it("un prefixe de nom ne suffit pas", () => {
    // « /appels-sortants » n'est pas une sous-page de « /appels ».
    expect(titreDePage("/appels-sortants", MENU)).toBe(NOM_PRODUIT);
  });

  it("le Layout pose le titre", () => {
    const layout = readFileSync(join(import.meta.dirname, "..", "components", "layout.tsx"), "utf8");
    expect(layout).toMatch(/titreDePage\(location, navGroups\.flatMap/);
    expect(layout).toMatch(/document\.title = titrePage/);
  });

  it("la connexion et l'inscription, hors Layout, posent le leur", () => {
    expect(lire("login.tsx")).toMatch(/document\.title = `\$\{t\("login\.signIn"\)\}/);
    expect(lire("register.tsx")).toMatch(/document\.title = `\$\{t\("register\.title"\)\}/);
  });
});

describe("le nom accessible est l'etiquette visible", () => {
  for (const f of ["login.tsx", "register.tsx"]) {
    it(`${f} : aucun champ etiquete ne porte d'aria-label qui la remplace`, () => {
      const s = lire(f);
      const ids = [...s.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1]!);
      expect(ids.length, "aucune etiquette trouvee: le releve est casse").toBeGreaterThan(1);
      const fautifs = ids.filter((id) => {
        const i = s.indexOf(`id="${id}"`);
        const debut = s.lastIndexOf("<Input", i);
        return debut >= 0 && /aria-label=/.test(s.slice(debut, i));
      });
      expect(fautifs, `aria-label qui remplace l'etiquette visible: ${fautifs.join(", ")}`).toEqual([]);
    });
  }
});

describe("l'inscription aide la saisie des donnees personnelles", () => {
  const s = lire("register.tsx");
  const attendus: Array<[string, string]> = [
    ["orgName", "organization"], ["firstName", "given-name"], ["lastName", "family-name"],
    ["regEmail", "email"], ["regPhone", "tel"],
  ];
  for (const [id, ac] of attendus) {
    it(`${id} : autocomplete="${ac}"`, () => {
      const i = s.indexOf(`id="${id}"`);
      expect(i, `${id} introuvable`).toBeGreaterThan(0);
      expect(s.slice(i, s.indexOf("/>", i))).toContain(`autoComplete="${ac}"`);
    });
  }
});
