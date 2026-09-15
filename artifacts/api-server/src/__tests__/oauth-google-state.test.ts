/**
 * Le retour d'autorisation Google lie les jetons a l'utilisateur QUI A LANCE
 * le flux — et a personne d'autre.
 *
 * LE DEFAUT
 *
 * Le callback est une route GET, sans jeton CSRF: c'est Google qui y renvoie
 * le navigateur. Le `state` signe existe precisement pour compenser cela — il
 * porte l'identite de celui qui a demande l'autorisation, et lui seul peut
 * etre produit par le serveur.
 *
 * L'ordre etait pourtant:
 *
 *     const userId = req.session?.userId ?? verified.userId;
 *
 * c'est-a-dire: la session prime, le state n'est qu'un repli. Ce qui annule
 * exactement la liaison que le state etablit.
 *
 * Le scenario:
 *
 *   1. l'attaquant lance le flux pour LUI, obtient un `code` Google valide et
 *      un `state` signe a son nom;
 *   2. il envoie a la victime un lien vers le callback portant SES `code` et
 *      `state`;
 *   3. la victime est connectee, son cookie part avec la navigation;
 *   4. `verified` designe l'attaquant, `req.session.userId` designe la
 *      victime — et c'est la session qui gagnait.
 *
 * Les jetons Google de l'ATTAQUANT etaient enregistres sur le compte de la
 * VICTIME. Tout ce que l'application pousse ensuite vers Google —
 * sauvegardes Drive, evenements d'agenda, messages — partait vers le compte
 * de l'attaquant. Rien n'apparaissait comme une erreur: la victime voyait
 * « Google connecte ».
 *
 * LA REGLE
 *
 * Le state fait autorite. Une session presente ne peut que le CONFIRMER; si
 * elle le contredit, ce n'est pas une preference a arbitrer, c'est un signe
 * d'attaque, et le callback refuse.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  OAUTH_STATE_TTL_MS,
  signOAuthState,
  verifyOAuthState,
} from "../routes/google-oauth";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "routes", "google-oauth.ts"),
  "utf8",
);

describe("le state signe fait autorite sur la session", () => {
  it("une session qui contredit le state fait refuser le callback", () => {
    // Le coeur du defaut. Verifie sur la source: le comportement exact
    // demanderait de simuler un aller-retour Google complet, ce qui
    // testerait surtout le simulacre.
    expect(
      /req\.session\?\.userId\s*&&\s*req\.session\.userId\s*!==\s*verified\.userId/.test(SOURCE),
      "aucune comparaison session/state: une session peut encore detourner " +
        "les jetons vers un autre compte.",
    ).toBe(true);
  });

  it("l'identite retenue vient du state, pas de la session", () => {
    // `req.session?.userId ?? verified.userId` est la forme exacte du defaut.
    expect(
      /const userId = req\.session\?\.userId \?\? verified\.userId/.test(SOURCE),
      "la session reprend la priorite sur le state signe.",
    ).toBe(false);
    expect(SOURCE).toContain("const userId = verified.userId;");
  });

  it("le refus est journalise avec les deux identites", () => {
    // Sans cela, une tentative d'attaque ne laisse aucune trace exploitable.
    const i = SOURCE.indexOf("callback refuse");
    expect(i).toBeGreaterThan(0);
    const bloc = SOURCE.slice(Math.max(0, i - 400), i + 200);
    expect(bloc).toContain("sessionUserId");
    expect(bloc).toContain("stateUserId");
  });

  it("un state absent ou illisible fait toujours refuser", () => {
    // Propriete deja en place, verrouillee: sans state valide, il n'y a
    // aucune identite a laquelle rattacher les jetons.
    expect(SOURCE).toContain("google_error=invalid_state");
  });
});

describe("la signature du state", () => {
  it("un state produit par le serveur se verifie", () => {
    const state = signOAuthState({ userId: 42, orgId: 7, services: ["gmail"] });
    const p = verifyOAuthState(state);
    expect(p).not.toBeNull();
    expect(p!.userId).toBe(42);
    expect(p!.orgId).toBe(7);
    expect(p!.services).toEqual(["gmail"]);
  });

  it("un state forge est rejete", () => {
    // Le role anti-CSRF: un tiers ne peut pas fabriquer un retour valide.
    const corps = Buffer.from(
      JSON.stringify({ userId: 1, orgId: 1, services: [], iat: Date.now(), nonce: "x" }),
    ).toString("base64url");
    expect(verifyOAuthState(`${corps}.signature-inventee`)).toBeNull();
  });

  it("une charge utile modifiee invalide la signature", () => {
    // Changer le `userId` apres coup est precisement ce qu'un attaquant
    // tenterait pour rattacher les jetons a quelqu'un d'autre.
    const state = signOAuthState({ userId: 42, orgId: 7, services: [] });
    const [corps, sig] = state.split(".");
    const modifie = JSON.parse(Buffer.from(corps, "base64url").toString());
    modifie.userId = 99;
    const nouveauCorps = Buffer.from(JSON.stringify(modifie)).toString("base64url");
    expect(verifyOAuthState(`${nouveauCorps}.${sig}`)).toBeNull();
  });

  it("un state sans separateur est rejete", () => {
    expect(verifyOAuthState("pas-de-point")).toBeNull();
    expect(verifyOAuthState("")).toBeNull();
  });

  it("un state expire est rejete", () => {
    // Un state ne doit servir qu'a un aller-retour immediat: en conserver un
    // valide des heures ouvre une fenetre de rejeu.
    const vieux = {
      userId: 42,
      orgId: 7,
      services: [],
      iat: Date.now() - OAUTH_STATE_TTL_MS - 1000,
      nonce: "abc",
    };
    const corps = Buffer.from(JSON.stringify(vieux)).toString("base64url");
    const crypto = require("node:crypto");
    const sig = crypto
      .createHmac("sha256", process.env.SESSION_SECRET)
      .update(corps)
      .digest("base64url");
    expect(verifyOAuthState(`${corps}.${sig}`)).toBeNull();
  });

  it("la duree de vie reste courte", () => {
    // Le chiffre lui-meme compte: une heure serait une autre decision.
    expect(OAUTH_STATE_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(OAUTH_STATE_TTL_MS).toBeGreaterThan(60 * 1000);
  });

  it("deux states consecutifs different", () => {
    // Le nonce empeche qu'un state observe une fois soit reutilisable a
    // l'identique.
    const a = signOAuthState({ userId: 42, orgId: 7, services: [] });
    const b = signOAuthState({ userId: 42, orgId: 7, services: [] });
    expect(a).not.toBe(b);
  });

  it("la comparaison de signature est a temps constant", () => {
    // Une comparaison naive laisse fuir la signature attendue par mesure du
    // temps de reponse. La propriete ne se mesure pas de maniere fiable en
    // test: on verrouille l'emploi de la primitive.
    expect(SOURCE).toContain("timingSafeEqual");
  });
});

describe("ce que le state transporte", () => {
  it("il porte l'organisation, pas seulement l'utilisateur", () => {
    // Sans elle, le callback devrait la deduire de la session — et
    // retomberait dans le defaut qu'on vient de corriger.
    const p = verifyOAuthState(signOAuthState({ userId: 1, orgId: 12, services: [] }));
    expect(p!.orgId).toBe(12);
  });

  it("une organisation absente reste absente, elle n'est pas inventee", () => {
    const p = verifyOAuthState(signOAuthState({ userId: 1, orgId: null, services: [] }));
    expect(p!.orgId).toBeNull();
  });

  it("l'organisation du state prime elle aussi sur la session", () => {
    expect(SOURCE).toContain("const orgId = verified.orgId ?? req.session?.organisationId ?? null;");
  });
});
