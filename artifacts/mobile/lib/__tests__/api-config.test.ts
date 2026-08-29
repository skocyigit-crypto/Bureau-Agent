/**
 * Resolution de l'URL d'API (`lib/api-config.ts`).
 *
 * Ce module s'evalue a l'import: si aucune source d'URL n'est configuree il
 * leve immediatement, plutot que de laisser des requetes partir vers
 * `https://undefined` et echouer sur une erreur DNS opaque. Ce choix de
 * "echouer tot" est le comportement le plus important a figer — le supprimer
 * ne casserait rien en developpement, ou la variable est toujours presente, et
 * ne se manifesterait qu'en production.
 *
 * Chaque cas recharge le module avec un environnement different, l'URL etant
 * capturee une seule fois a l'evaluation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const ENV_KEYS = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_DOMAIN"] as const;

/** Recharge api-config avec exactement l'environnement fourni. */
async function loadWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  vi.resetModules();
  return import("../api-config");
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("derivation de l'URL de base", () => {
  it("prefere EXPO_PUBLIC_API_URL", async () => {
    const m = await loadWith({
      EXPO_PUBLIC_API_URL: "https://api.exemple.fr",
      EXPO_PUBLIC_DOMAIN: "ignore.fr",
    });
    expect(m.API_BASE).toBe("https://api.exemple.fr");
  });

  it("retire le slash final pour ne pas produire d'URL a double slash", async () => {
    const m = await loadWith({ EXPO_PUBLIC_API_URL: "https://api.exemple.fr///" });
    expect(m.API_BASE).toBe("https://api.exemple.fr");
    expect(m.apiUrl("/api/contacts")).toBe("https://api.exemple.fr/api/contacts");
  });

  it("retombe sur EXPO_PUBLIC_DOMAIN en ajoutant le schema", async () => {
    const m = await loadWith({ EXPO_PUBLIC_DOMAIN: "dev.exemple.fr" });
    expect(m.API_BASE).toBe("https://dev.exemple.fr");
  });

  it("traite la chaine \"undefined\" comme une absence de configuration", async () => {
    // Cas reel: un template shell qui interpole une variable vide produit
    // litteralement "undefined" — c'est l'origine des `https://undefined`.
    await expect(loadWith({ EXPO_PUBLIC_DOMAIN: "undefined" })).rejects.toThrow(
      /Aucune URL d'API configuree/,
    );
  });

  it("ignore une valeur uniquement composee d'espaces", async () => {
    await expect(loadWith({ EXPO_PUBLIC_API_URL: "   " })).rejects.toThrow(
      /Aucune URL d'API configuree/,
    );
  });

  it("leve a l'import quand rien n'est configure", async () => {
    await expect(loadWith({})).rejects.toThrow(/Aucune URL d'API configuree/);
  });
});

describe("construction des URLs", () => {
  it("ajoute le slash manquant quel que soit l'appelant", async () => {
    const m = await loadWith({ EXPO_PUBLIC_API_URL: "https://api.exemple.fr" });
    expect(m.apiUrl("api/contacts")).toBe("https://api.exemple.fr/api/contacts");
    expect(m.apiUrl("/api/contacts")).toBe("https://api.exemple.fr/api/contacts");
  });
});

describe("constantes partagees", () => {
  it("expose une origine fixe pour la verification CSRF", async () => {
    // Un build natif n'envoie pas d'Origin: sans cet en-tete, tout POST — la
    // connexion comprise — serait rejete en 403 une fois l'app installee.
    const m = await loadWith({ EXPO_PUBLIC_API_URL: "https://api.exemple.fr" });
    expect(m.MOBILE_APP_ORIGIN).toBe("https://agentdebureau.fr");
  });

  it("garde la cle de session stable entre deux deploiements", async () => {
    // Une faute de frappe ici deconnecte silencieusement tout le parc.
    const m = await loadWith({ EXPO_PUBLIC_API_URL: "https://api.exemple.fr" });
    expect(m.SESSION_STORAGE_KEY).toBe("adb_api_token_v1");
  });
});
