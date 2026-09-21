/**
 * Deux non-conformites RGAA relevees le 21/09/2026, corrigees ici.
 *
 *  - 7.1 / WCAG 2.1.1 : une fiche contact ne s'ouvrait qu'a la souris. La
 *    ligne du tableau et la carte portaient un `onClick`, sans element
 *    focalisable : au clavier, aucun contact n'etait atteignable. Et les cases
 *    de selection n'avaient pas de nom — « case a cocher, non cochee », sans
 *    dire quel contact.
 *  - 11.10 / WCAG 3.3.1 : a l'inscription, le message d'erreur s'affichait en
 *    tete du formulaire, sans que le champ fautif porte d'etat d'erreur ni de
 *    lien vers le message.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");
const lire = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const CONTACTS = lire("pages", "contacts.tsx");
const INSCRIPTION = lire("pages", "register.tsx");
const LANGUES = ["fr", "en", "tr", "es", "de", "ar"];

describe("un contact s'ouvre au clavier", () => {
  it("le nom est un lien vers la fiche, dans le tableau comme dans les cartes", () => {
    const liens = CONTACTS.match(/<Link href=\{`\/contacts\/\$\{contact\.id\}`\}/g) ?? [];
    // Au moins le tableau et les cartes (le fichier en contenait deja un ailleurs).
    expect(liens.length).toBeGreaterThanOrEqual(3);
  });

  it("le lien ne declenche pas une seconde navigation par la ligne", () => {
    // La ligne garde son clic souris ; sans stopPropagation, les deux
    // naviguent a la fois.
    const i = CONTACTS.indexOf("<Link href={`/contacts/${contact.id}`}");
    expect(CONTACTS.slice(i, i + 200)).toContain("e.stopPropagation()");
  });

  it("le lien montre son focus", () => {
    const i = CONTACTS.indexOf("<Link href={`/contacts/${contact.id}`}");
    expect(CONTACTS.slice(i, i + 300)).toMatch(/focus-visible:ring/);
  });

  it("plus aucun nom de contact n'est un simple texte", () => {
    expect(CONTACTS).not.toMatch(/<div className="font-(medium|semibold) text-foreground">\{contact\.firstName\} \{contact\.lastName\}<\/div>/);
  });
});

describe("chaque case de selection dit qui elle selectionne", () => {
  it("les cases par contact portent un nom", () => {
    // Decoupe jusqu'a la fin de balise, et non par [^>]* : « () => » contient un chevron.
    const cases = CONTACTS.split("<Checkbox checked={selectedIds.has(contact.id)}")
      .slice(1)
      .map((x) => x.slice(0, x.indexOf("/>")));
    expect(cases.length).toBe(2);
    for (const c of cases) expect(c).toContain('aria-label={t("contacts.selectOne"');
  });

  it("la case « tout selectionner » aussi", () => {
    const i = CONTACTS.indexOf("onCheckedChange={toggleSelectAll}");
    expect(CONTACTS.slice(i, i + 120)).toContain('aria-label={t("contacts.selectAll")}');
  });

  for (const l of LANGUES) {
    it(`${l} : les deux libelles existent et nomment le contact`, () => {
      const j = JSON.parse(lire("i18n", "locales", `${l}.json`)) as { contacts: Record<string, string> };
      expect(j.contacts.selectOne).toContain("{{name}}");
      expect(j.contacts.selectAll?.trim()).toBeTruthy();
    });
  }
});

describe("a l'inscription, l'erreur est reliee au champ", () => {
  it("le message a un identifiant et s'annonce", () => {
    expect(INSCRIPTION).toContain('<Alert id="register-erreur"');
    // Le composant Alert pose role="alert".
    expect(lire("components", "ui", "alert.tsx")).toContain('role="alert"');
  });

  it("le champ fautif porte aria-invalid et pointe vers le message", () => {
    expect(INSCRIPTION).toMatch(/"aria-invalid": true as const, "aria-describedby": "register-erreur"/);
  });

  for (const id of ["orgName", "firstName", "lastName", "regEmail", "regPhone", "regPassword", "regConfirmPassword", "acceptTerms"]) {
    it(`${id} recoit l'etat d'erreur`, () => {
      expect(INSCRIPTION).toContain(`id="${id}"`);
      expect(INSCRIPTION).toContain(`{...etatErreur("${id}")}`);
    });
  }

  it("chaque erreur de validation designe son champ", () => {
    // Aucun setError(t("register.errX")) ne doit subsister pour une erreur
    // qui concerne un champ precis ; seule l'erreur serveur reste generale.
    const generales = INSCRIPTION.match(/setError\(t\("register\.err[A-Za-z]+"\)\)/g) ?? [];
    expect(generales).toEqual(['setError(t("register.errServer"))']);
  });

  it("le focus va au champ a corriger", () => {
    expect(INSCRIPTION).toMatch(/document\.getElementById\(id\)\?\.focus\(\)/);
  });
});
