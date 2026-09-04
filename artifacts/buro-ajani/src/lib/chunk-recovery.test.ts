import { describe, expect, it } from "vitest";

import {
  MAX_RELOADS_PER_SESSION,
  RELOAD_COOLDOWN_MS,
  isChunkLoadError,
  shouldAutoReload,
} from "./chunk-recovery";

/**
 * Le symptome signale: certains onglets s'ouvrent, d'autres affichent
 * « rechargez ou reessayez ». Cause: apres un deploiement, les fichiers des
 * pages changent de nom et les anciens disparaissent.
 *
 * Le garde-fou precedent posait un drapeau une fois pour toute la session.
 * Il empechait bien la boucle, mais il condamnait aussi la session: le
 * deuxieme deploiement de la journee retombait sur l'ecran d'erreur. Ces
 * tests fixent les deux moities de la regle.
 */

describe("reconnaissance de l'echec de chargement", () => {
  it("reconnait les formulations des differents navigateurs", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://app/assets/x-9f2.js",
      "Importing a module script failed.",
      "Loading chunk 42 failed.",
      "error loading dynamically imported module",
    ]) {
      expect(isChunkLoadError(message), message).toBe(true);
    }
  });

  it("ne prend pas une panne applicative ordinaire pour un chunk manquant", () => {
    for (const message of [
      "Cannot read properties of undefined (reading 'map')",
      "Network request failed",
      "organisationId is required",
    ]) {
      expect(isChunkLoadError(message), message).toBe(false);
    }
  });
});

describe("regle de rechargement automatique", () => {
  it("recharge au premier echec de la session", () => {
    expect(shouldAutoReload(1_000_000, null, 0)).toBe(true);
  });

  it("ne recharge pas deux fois coup sur coup: ce serait une boucle", () => {
    const now = 1_000_000;
    expect(shouldAutoReload(now + RELOAD_COOLDOWN_MS - 1, now, 1)).toBe(false);
  });

  it("recharge a nouveau apres le delai — un second deploiement doit se rattraper", () => {
    const now = 1_000_000;
    // C'est precisement ce que l'ancien drapeau « une fois par session »
    // interdisait, et pourquoi l'utilisateur voyait l'ecran d'erreur.
    expect(shouldAutoReload(now + RELOAD_COOLDOWN_MS + 1, now, 1)).toBe(true);
  });

  it("abandonne apres quelques tentatives: le probleme n'est plus un deploiement", () => {
    const now = 1_000_000;
    expect(shouldAutoReload(now + 10 * RELOAD_COOLDOWN_MS, now, MAX_RELOADS_PER_SESSION)).toBe(false);
  });
});
