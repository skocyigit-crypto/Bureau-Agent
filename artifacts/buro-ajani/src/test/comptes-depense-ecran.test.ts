/**
 * L'ecran du plan comptable des depenses.
 *
 * Le serveur sait tenir le lien categorie -> compte ; sans ecran, personne ne
 * peut le renseigner, et le registre repart chez le comptable sans la colonne
 * qu'il attendait.
 *
 * Le point de FOND verifie ici : le plan propose ne doit pas s'appliquer tout
 * seul. Le compte juste depend du cabinet — dans le batiment, la
 * sous-traitance se ventile entre 604 et 611 selon le marche — et un reglage
 * ecrit sans que personne l'ait choisi se retrouve dans une comptabilite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const ECRAN = SRC("pages", "depenses.tsx");
const LANGUES = ["fr", "en", "es", "de", "tr", "ar"] as const;
const locale = (l: string) => JSON.parse(SRC("i18n", "locales", `${l}.json`)) as Record<string, any>;

describe("le plan se regle depuis l'ecran", () => {
  it("il lit et ecrit la route du serveur", () => {
    expect(ECRAN).toContain("/api/depenses/comptes");
    const i = ECRAN.indexOf("const enregistrerComptes");
    expect(i).toBeGreaterThan(0);
    const corps = ECRAN.slice(i, i + 1200);
    expect(corps).toContain('method: "PUT"');
    expect(corps).toContain('credentials: "include"');
  });

  it("le bouton est la ou l'on exporte le registre", () => {
    // C'est en preparant l'export pour le comptable qu'on se pose la question.
    const i = ECRAN.indexOf("depenses.comptes.button");
    const j = ECRAN.indexOf("depenses.export");
    expect(i).toBeGreaterThan(0);
    expect(Math.abs(i - j)).toBeLessThan(600);
  });

  it("n'envoie que les lignes portant un compte de charge", () => {
    const i = ECRAN.indexOf("const enregistrerComptes");
    expect(ECRAN.slice(i, i + 500)).toMatch(/filter\(\(\[, v\]\) => v\.compteCharge\.trim\(\)\)/);
  });

  it("un refus du serveur designe le champ fautif", () => {
    const i = ECRAN.indexOf("const enregistrerComptes");
    const corps = ECRAN.slice(i, i + 1400);
    expect(corps).toContain("issues?.[0]?.path");
    expect(corps).toContain("signalerChamp");
  });
});

describe("la proposition reste une proposition", () => {
  it("le bouton recopie dans le FORMULAIRE, il n'enregistre pas", () => {
    const i = ECRAN.indexOf("const appliquerPropose");
    expect(i).toBeGreaterThan(0);
    const corps = ECRAN.slice(i, i + 600);
    expect(corps).toContain("setComptes");
    expect(corps, "la proposition part directement au serveur").not.toContain("fetch(");
  });

  it("l'ecran dit que le comptable tranche", () => {
    expect(ECRAN).toContain("depenses.comptes.proposedHint");
    const fr = locale("fr").depenses.comptes.proposedHint;
    expect(fr).toMatch(/expert-comptable|comptable/i);
    expect(fr, "l'arbitrage 604/611 n'est pas explique").toMatch(/604/);
    expect(fr).toMatch(/611/);
  });
});

describe("accessibilite", () => {
  it("chaque champ porte un nom qui dit sa categorie", () => {
    expect(ECRAN).toContain('aria-label={t("depenses.comptes.chargeFor"');
    expect(ECRAN).toContain('aria-label={t("depenses.comptes.tvaFor"');
  });

  it("l'etiquette de la ligne est reliee au champ de charge", () => {
    expect(ECRAN).toMatch(/htmlFor=\{`compte-charge-\$\{cle\}`\}/);
    expect(ECRAN).toMatch(/<Input\s+id=\{`compte-charge-\$\{cle\}`\}/);
  });
});

describe("les libelles, dans les six langues", () => {
  const CLES = [
    "button", "title", "description", "loadProposed", "proposedHint",
    "chargePlaceholder", "tvaPlaceholder", "chargeFor", "tvaFor",
    "saved", "saveError", "loadError",
  ];

  for (const l of LANGUES) {
    it(`${l}`, () => {
      const c = locale(l).depenses?.comptes;
      expect(c, `depenses.comptes absent en ${l}`).toBeTruthy();
      for (const cle of CLES) expect(String(c[cle] ?? ""), `${l}.${cle}`).not.toBe("");
      expect(c.chargeFor).toContain("{{categorie}}");
      expect(c.tvaFor).toContain("{{categorie}}");
      expect(c.saved).toContain("{{count}}");
    });
  }
});
