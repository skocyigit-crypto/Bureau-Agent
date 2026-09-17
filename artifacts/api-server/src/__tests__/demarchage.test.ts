/**
 * Le demarchage telephonique a change de regime il y a cinq semaines.
 *
 * LE CHANGEMENT
 *
 * Loi n° 2025-594 du 30 juin 2025, en vigueur depuis le 11 AOUT 2026 :
 * appeler un CONSOMMATEUR a des fins de prospection sans son consentement
 * prealable est desormais interdit. Le regime passe de l'opt-out a l'opt-in,
 * et Bloctel n'a plus d'objet. Amende : 375 000 EUR pour une personne morale.
 *
 * CE QUE LE PRODUIT FAISAIT — MESURE DU 16/09
 *
 * Ni `contacts` ni `prospects` ne portaient la moindre notion de consentement
 * ou d'opposition. Les 21 fichiers contenant le mot « consentement »
 * concernaient tous OAuth ou l'inscription — aucun la prospection. Le produit
 * comptait pourtant les appels (`totalCalls`, `lastCallAt`), tenait un
 * pipeline de prospects et proposait des relances.
 *
 * Il ne savait pas non plus distinguer un particulier d'un professionnel :
 * `category` est un texte libre dont la valeur par defaut est « autre ». Or
 * c'est cette distinction qui commande la regle.
 *
 * LES QUATRE REGIMES, TESTES UN PAR UN
 *
 *                    telephone                    email / SMS
 *   particulier      consentement prealable       consentement prealable
 *   professionnel    interet legitime             opposition (opt-out)
 *
 * Le B2B echappe a l'opt-in de L223-1: le tester est aussi important que de
 * tester l'interdiction, parce qu'un module qui bloquerait tout rendrait le
 * produit inutilisable et serait desactive.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import { compterBloques, evaluerDemarchage } from "../services/demarchage";

const PARTICULIER = { typePersonne: "particulier" };
const PRO = { typePersonne: "professionnel" };

describe("le consommateur, au telephone", () => {
  it("sans consentement, l'appel est interdit", () => {
    // LE CHANGEMENT DU 11 AOUT 2026. Avant, il suffisait de ne pas figurer
    // sur Bloctel.
    const v = evaluerDemarchage(PARTICULIER, "telephone");
    expect(v.autorise).toBe(false);
    expect(v.motif).toMatch(/11 aout 2026/);
    expect(v.reference).toBe("C. conso. art. L223-1");
  });

  it("le motif cite la loi, pour etre verifiable", () => {
    expect(evaluerDemarchage(PARTICULIER, "telephone").motif).toContain("2025-594");
  });

  it("avec consentement, l'appel est permis", () => {
    // L'erreur symetrique compte: un module qui bloque meme le cas legitime
    // finit par etre contourne ou desactive.
    const v = evaluerDemarchage({ ...PARTICULIER, prospectionConsent: "accorde" }, "telephone");
    expect(v.autorise).toBe(true);
    expect(v.aVerifier).toBe(false);
  });

  it("Bloctel est explicitement declare sans objet", () => {
    // Le reflexe « il n'est pas sur Bloctel donc je peux appeler » est
    // exactement ce qui expose aujourd'hui.
    expect(evaluerDemarchage(PARTICULIER, "telephone").motif).toMatch(/Bloctel/);
  });
});

describe("le professionnel garde son regime", () => {
  it("l'appel reste permis sans consentement prealable", () => {
    // Le B2B echappe a l'opt-in de L223-1 et repose sur l'interet legitime.
    const v = evaluerDemarchage(PRO, "telephone");
    expect(v.autorise).toBe(true);
    expect(v.reference).toBe("RGPD art. 6.1.f");
  });

  it("le motif dit pourquoi la regle ne s'applique pas", () => {
    expect(evaluerDemarchage(PRO, "telephone").motif).toMatch(/ne vise que les consommateurs/i);
  });

  it("l'email professionnel suit le regime d'opposition", () => {
    const v = evaluerDemarchage(PRO, "email");
    expect(v.autorise).toBe(true);
    expect(v.reference).toBe("CPCE art. L34-5");
  });

  it("l'email vers un consommateur exige toujours un consentement", () => {
    // Regime anterieur au changement de 2026, et inchange: l'opt-in
    // electronique B2C existe depuis longtemps.
    expect(evaluerDemarchage(PARTICULIER, "email").autorise).toBe(false);
  });
});

describe("l'opposition prime sur tout", () => {
  it("un professionnel qui s'oppose ne peut plus etre appele", () => {
    // Le droit d'opposition s'exerce a tout moment, y compris quand la base
    // legale est l'interet legitime.
    const v = evaluerDemarchage({ ...PRO, prospectionOppositionAt: "2026-09-01T00:00:00Z" }, "telephone");
    expect(v.autorise).toBe(false);
    expect(v.reference).toBe("RGPD art. 21");
  });

  it("elle prime meme sur un consentement anterieur", () => {
    // Un consentement ancien ne neutralise pas une opposition posterieure.
    const v = evaluerDemarchage(
      { ...PARTICULIER, prospectionConsent: "accorde", prospectionOppositionAt: "2026-09-01T00:00:00Z" },
      "telephone",
    );
    expect(v.autorise).toBe(false);
    expect(v.motif).toMatch(/prime sur tout consentement/i);
  });

  it("une date d'opposition illisible n'est pas prise pour une opposition", () => {
    // Prudence inverse: bloquer sur une valeur corrompue retirerait un
    // contact legitime du pipeline sans que personne ne comprenne pourquoi.
    const v = evaluerDemarchage({ ...PRO, prospectionOppositionAt: "pas-une-date" }, "telephone");
    expect(v.autorise).toBe(true);
  });

  it("un refus explicite bloque, sans opposition formelle", () => {
    const v = evaluerDemarchage({ ...PRO, prospectionConsent: "refuse" }, "telephone");
    expect(v.autorise).toBe(false);
    expect(v.reference).toBe("RGPD art. 7");
  });
});

describe("le type inconnu est traite comme un particulier, et signale", () => {
  it("un contact sans type renseigne ne peut pas etre appele", () => {
    // LE DEFAUT PRUDENT. Se tromper dans ce sens coute un appel non passe;
    // dans l'autre, une amende a six chiffres.
    const v = evaluerDemarchage({}, "telephone");
    expect(v.autorise).toBe(false);
    expect(v.aVerifier).toBe(true);
    expect(v.motif).toMatch(/non renseigne/i);
  });

  it("une valeur de type fantaisiste est traitee comme inconnue", () => {
    // `category` etant un texte libre, les valeurs inattendues sont la norme.
    const v = evaluerDemarchage({ typePersonne: "autre" }, "telephone");
    expect(v.autorise).toBe(false);
    expect(v.aVerifier).toBe(true);
  });

  it("avec consentement, l'appel passe mais le doute reste signale", () => {
    const v = evaluerDemarchage({ prospectionConsent: "accorde" }, "telephone");
    expect(v.autorise).toBe(true);
    expect(v.aVerifier).toBe(true);
    expect(v.motif).toMatch(/renseignez/i);
  });

  it("un professionnel renseigne ne declenche aucun doute", () => {
    expect(evaluerDemarchage(PRO, "telephone").aVerifier).toBe(false);
  });
});

describe("le comptage sur une liste", () => {
  it("compte les bloques et les incertains separement", () => {
    // Deux chiffres distincts: l'un se corrige en recueillant un
    // consentement, l'autre en renseignant une fiche.
    const { bloques, aVerifier } = compterBloques(
      [
        PRO,
        { ...PARTICULIER, prospectionConsent: "accorde" },
        PARTICULIER,
        {},
      ],
      "telephone",
    );
    expect(bloques).toBe(2);
    expect(aVerifier).toBe(1);
  });

  it("une liste vide ne produit aucun chiffre alarmant", () => {
    expect(compterBloques([], "telephone")).toEqual({ bloques: 0, aVerifier: 0 });
  });

  it("le canal change le resultat sur une meme liste", () => {
    // Un professionnel est joignable par les deux canaux, un particulier sans
    // consentement par aucun: c'est le meme contact qui change de statut.
    const liste = [PRO, PARTICULIER];
    expect(compterBloques(liste, "telephone").bloques).toBe(1);
    expect(compterBloques(liste, "email").bloques).toBe(1);
  });
});

describe("le verdict est branche sur la fiche contact", () => {
  it("la route de detail expose les deux canaux", async () => {
    // Un module de regles que rien n'appelle ne protege personne: c'est le
    // mode de panne recurrent de ce depot.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "contacts.ts"), "utf8");
    expect(source).toContain("services/demarchage");
    expect(source).toContain('telephone: evaluerDemarchage(contact, "telephone")');
    expect(source).toContain('email: evaluerDemarchage(contact, "email")');
  });

  it("le verdict n'est pas stocke : la regle a change en aout et changera encore", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "contacts.ts"), "utf8");
    const i = source.indexOf("demarchage: {");
    const bloc = source.slice(Math.max(0, i - 500), i);
    expect(bloc).not.toContain("db.update(contactsTable)");
  });

  it("le consentement a sa propre route, pas un champ du PATCH generique", async () => {
    // Le schema du PATCH generique est genere a partir du contrat d'API: y
    // ajouter ces champs a la main serait efface a la generation suivante.
    // Et un consentement est un acte date dont la preuve incombe au
    // responsable de traitement.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "contacts.ts"), "utf8");
    expect(source).toContain('router.patch("/contacts/:id/demarchage"');
  });

  it("un consentement accorde est DATE, un refus efface la date", async () => {
    // Sans date, le consentement ne se demontre pas — et c'est au responsable
    // de traitement de le prouver.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "contacts.ts"), "utf8");
    expect(source).toContain('updates.prospectionConsentAt = prospectionConsent === "accorde" ? new Date() : null;');
  });

  it("une valeur de consentement inattendue est refusee", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "..", "routes", "contacts.ts"), "utf8");
    const i = source.indexOf("if (prospectionConsent !== undefined)");
    expect(source.slice(i, i + 300)).toContain("status(400)");
  });
});
