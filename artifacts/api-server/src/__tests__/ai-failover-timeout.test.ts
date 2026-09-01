import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { isAiTimeoutError, shouldFailover } from "../services/ai-failover";

/**
 * Un fournisseur MUET doit declencher la bascule, comme un fournisseur qui
 * refuse.
 *
 * Ce module a ete ecrit pour la panne du 1er septembre 2026 (credits Gemini
 * epuises, `429 RESOURCE_EXHAUSTED`), et ne reconnaissait donc que le REFUS:
 * quota, credits, surcharge, cle invalide. Or le meme jour, plus tard, Gemini
 * a cesse de repondre du tout — il expirait au bout de 15 s. Aucun de ces
 * echecs ne ressemblait a un manque de credit, donc aucun ne basculait: la
 * fonction retombait sur un resultat degrade sans IA, alors qu'Anthropic
 * repondait normalement.
 *
 * C'est le mode de panne le plus courant d'un service distant, et c'etait le
 * seul que la bascule ne couvrait pas.
 */

describe("fournisseur muet", () => {
  it("compte comme une indisponibilite, pas comme une erreur de requete", () => {
    // Message reel observe en production ce jour-la.
    const err = new Error("[gemini-insights] timeout after 15000ms");

    expect(isAiTimeoutError(err)).toBe(true);
    expect(shouldFailover(err), "un fournisseur muet n'a pas declenche la bascule").toBe(true);
  });

  it("couvre les formes usuelles d'un appel qui n'aboutit pas", () => {
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(shouldFailover(abort)).toBe(true);

    for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND"]) {
      const err = Object.assign(new Error("network"), { code });
      expect(shouldFailover(err), `code non couvert: ${code}`).toBe(true);
    }

    expect(shouldFailover(new Error("socket hang up"))).toBe(true);
  });

  it("laisse toujours passer une erreur de requete", () => {
    // La garde d'origine doit tenir: basculer sur une invite malformee
    // masquerait un vrai defaut au lieu de le montrer.
    const err = new Error("Invalid JSON payload received. Unknown name 'contnets'");

    expect(isAiTimeoutError(err)).toBe(false);
    expect(shouldFailover(err)).toBe(false);
  });

  it("ne confond pas un mot proche avec une expiration", () => {
    // « timeout » doit venir de l'echec, pas du sujet de la conversation.
    expect(isAiTimeoutError(new Error("Le modele a refuse: contenu sensible"))).toBe(false);
    expect(isAiTimeoutError(new Error("400 Bad Request"))).toBe(false);
  });

  it("conserve les raisons de bascule d'origine", () => {
    // Regression possible en elargissant la classification: ne pas perdre ce
    // pour quoi le module a ete ecrit.
    expect(shouldFailover(Object.assign(new Error("quota"), { status: 429 }))).toBe(true);
    expect(shouldFailover(new Error("credits are depleted"))).toBe(true);
    expect(shouldFailover(Object.assign(new Error("overloaded"), { status: 503 }))).toBe(true);
  });
});
