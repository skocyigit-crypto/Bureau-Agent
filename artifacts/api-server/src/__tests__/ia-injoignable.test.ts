/**
 * Quand le fournisseur de modeles ne repond pas, ce serveur va bien.
 *
 * Mesure le 18/09 (banc local, puis integration continue): sans acces au
 * fournisseur — credit epuise, cle revoquee, panne chez lui, reseau sortant
 * coupe — chaque route IA repondait 500 « Erreur de l'Intelligence Centrale ».
 * Sur la PAGE D'ACCUEIL, le client voyait donc une erreur serveur rouge alors
 * que toute l'application fonctionnait.
 *
 * Deux reponses differentes, parce que l'attente n'est pas la meme:
 *   - accueil (analyse de fond, personne ne l'a demandee): 200 avec un drapeau
 *     explicite, l'ecran affiche « momentanement indisponible »;
 *   - fonctions demandees (brouillon d'e-mail, analyse): 503 — repondre « tout
 *     va bien » a quelqu'un qui attend un texte serait un mensonge.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { fournisseurInjoignable } from "../services/ai-guard";

/** L'erreur telle que `fetch` la produit quand la connexion n'aboutit pas. */
function echecReseau(code: string): Error {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error("connect"), { code });
  return err;
}

describe("reconnaitre un fournisseur injoignable", () => {
  it("connexion refusee", () => {
    expect(fournisseurInjoignable(echecReseau("ECONNREFUSED"))).toBe(true);
  });

  it("nom introuvable (DNS)", () => {
    expect(fournisseurInjoignable(echecReseau("ENOTFOUND"))).toBe(true);
  });

  it("delai depasse", () => {
    expect(fournisseurInjoignable(echecReseau("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
  });

  it("requete abandonnee", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(fournisseurInjoignable(err)).toBe(true);
  });

  it("« fetch failed » sans cause (la cause se perd parfois en chemin)", () => {
    expect(fournisseurInjoignable(new TypeError("fetch failed"))).toBe(true);
  });

  it("la cause peut etre imbriquee", () => {
    const profond = new Error("appel IA");
    (profond as { cause?: unknown }).cause = echecReseau("ECONNRESET");
    expect(fournisseurInjoignable(profond)).toBe(true);
  });

  it("un JSON invalide rendu par le modele n'est PAS un probleme de reseau", () => {
    // Le masquer derriere « indisponible » cacherait un vrai defaut du produit.
    expect(fournisseurInjoignable(new SyntaxError("Unexpected token < in JSON"))).toBe(false);
  });

  it("un refus applicatif du fournisseur non plus", () => {
    expect(fournisseurInjoignable(new Error("400 Bad Request: prompt too long"))).toBe(false);
  });

  it("une erreur de base de donnees non plus", () => {
    expect(fournisseurInjoignable(Object.assign(new Error("Failed query"), { code: "23505" }))).toBe(false);
  });

  it("ni null, ni undefined, ni une chaine", () => {
    expect([fournisseurInjoignable(null), fournisseurInjoignable(undefined), fournisseurInjoignable("panne")]).toEqual([false, false, false]);
  });

  it("une chaine de causes circulaire ne fait pas boucler", () => {
    const a = new Error("a");
    const b = new Error("b");
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    expect(fournisseurInjoignable(a)).toBe(false);
  });
});

describe("ce que les routes en font", () => {
  const SOURCE = new URL("../routes/ai-analysis.ts", import.meta.url);

  it("l'accueil repond 200 avec un drapeau, pas une erreur", async () => {
    const texte = await (await import("node:fs/promises")).readFile(SOURCE, "utf8");
    expect(texte).toMatch(/iaIndisponible: true, code: "ia_injoignable"/);
  });

  it("les autres routes IA passent par la garde commune", async () => {
    const texte = await (await import("node:fs/promises")).readFile(SOURCE, "utf8");
    const gardes = texte.match(/if \(respondAiError\(error, res\)\) return;/g) ?? [];
    expect(gardes.length, "chaque bloc catch d'une route IA doit consulter la garde").toBeGreaterThanOrEqual(10);
  });
});
