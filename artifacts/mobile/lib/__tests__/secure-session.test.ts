/**
 * Persistance de la session mobile (`lib/secure-session.ts`).
 *
 * Ce module decide si l'utilisateur reste connecte et si la tache de fond de
 * localisation peut s'authentifier. Deux defauts y etaient reunis, tous deux
 * declenches par le meme etat tres ordinaire — telephone en poche, ecran
 * verrouille — dans lequel `expo-secure-store` refuse l'acces :
 *
 *  1. ACCESSIBILITE. Les ecritures utilisaient le defaut `WHEN_UNLOCKED`,
 *     illisible ecran verrouille. La tache de fond de
 *     `contexts/LocationContext.tsx` lit le token exactement dans cet etat :
 *     elle n'en obtenait jamais et aucun ping de position n'etait envoye. La
 *     fonctionnalite etait inerte precisement quand elle sert.
 *
 *  2. ORDRE DE MIGRATION. Le slot AsyncStorage en clair etait purge AVANT que
 *     l'ecriture chiffree soit confirmee. AsyncStorage n'etant pas chiffre, sa
 *     purge reussit meme verrouille alors que l'ecriture SecureStore echoue :
 *     le token disparaissait des deux emplacements et la session etait perdue
 *     definitivement.
 *
 * Les tests ci-dessous simulent le coffre verrouille, qui est la seule
 * condition sous laquelle ces deux bugs se manifestent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const LEGACY_KEY = "adb_api_token_v1";
const SECURE_KEY = "adb_api_token_secure_v1";
const UPGRADE_KEY = "adb_secure_accessibility_v2";
const AFTER_FIRST_UNLOCK = "after-first-unlock";

/** Etat du coffre chiffre simule. */
const vault = new Map<string, { value: string; accessible?: string }>();
/** Etat d'AsyncStorage simule (non chiffre : lisible meme verrouille). */
const plain = new Map<string, string>();
/** Quand true, toute operation SecureStore echoue — appareil verrouille. */
let vaultLocked = false;

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK,
  WHEN_UNLOCKED: "when-unlocked",
  getItemAsync: async (key: string) => {
    if (vaultLocked) throw new Error("User interaction is not allowed.");
    return vault.get(key)?.value ?? null;
  },
  setItemAsync: async (key: string, value: string, opts?: { keychainAccessible?: string }) => {
    if (vaultLocked) throw new Error("User interaction is not allowed.");
    vault.set(key, { value, accessible: opts?.keychainAccessible });
  },
  deleteItemAsync: async (key: string) => {
    if (vaultLocked) throw new Error("User interaction is not allowed.");
    vault.delete(key);
  },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => plain.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      plain.set(key, value);
    },
    removeItem: async (key: string) => {
      plain.delete(key);
    },
  },
}));

vi.mock("@/lib/api-config", () => ({ SESSION_STORAGE_KEY: LEGACY_KEY }));

const { loadSessionToken, saveSessionToken, clearSessionToken } = await import(
  "../secure-session"
);

beforeEach(() => {
  vault.clear();
  plain.clear();
  vaultLocked = false;
});

describe("accessibilite du trousseau", () => {
  it("ecrit le token en AFTER_FIRST_UNLOCK, pas au defaut verrouille", () => {
    return saveSessionToken("tok-1").then(() => {
      expect(vault.get(SECURE_KEY)?.accessible).toBe(AFTER_FIRST_UNLOCK);
    });
  });

  it("reecrit une seule fois un token existant ecrit avec l'ancien defaut", async () => {
    // Installation existante : entree presente sans accessibilite explicite.
    vault.set(SECURE_KEY, { value: "tok-legacy-accessible" });

    expect(await loadSessionToken()).toBe("tok-legacy-accessible");
    expect(vault.get(SECURE_KEY)?.accessible).toBe(AFTER_FIRST_UNLOCK);
    expect(plain.get(UPGRADE_KEY)).toBe("1");

    // Deuxieme passage : le marqueur empeche une reecriture a chaque demarrage.
    vault.set(SECURE_KEY, { value: "tok-legacy-accessible", accessible: undefined });
    await loadSessionToken();
    expect(vault.get(SECURE_KEY)?.accessible).toBeUndefined();
  });

  it("n'echoue pas si la montee de version est impossible", async () => {
    // Le chargement a deja reussi : une reecriture ratee ne doit rien casser.
    vault.set(SECURE_KEY, { value: "tok-2" });
    plain.set(UPGRADE_KEY, ""); // valeur vide => marqueur absent
    expect(await loadSessionToken()).toBe("tok-2");
  });
});

describe("migration du slot en clair", () => {
  it("migre vers le coffre puis purge le slot en clair", async () => {
    plain.set(LEGACY_KEY, "tok-migre");

    expect(await loadSessionToken()).toBe("tok-migre");
    expect(vault.get(SECURE_KEY)?.value).toBe("tok-migre");
    expect(vault.get(SECURE_KEY)?.accessible).toBe(AFTER_FIRST_UNLOCK);
    expect(plain.has(LEGACY_KEY)).toBe(false);
  });

  it("accepte le format JSON historique { token }", async () => {
    plain.set(LEGACY_KEY, JSON.stringify({ token: "tok-json" }));
    expect(await loadSessionToken()).toBe("tok-json");
    expect(vault.get(SECURE_KEY)?.value).toBe("tok-json");
  });

  it("CONSERVE le slot en clair si le coffre refuse l'ecriture", async () => {
    // Regression centrale : appareil verrouille pendant la migration.
    plain.set(LEGACY_KEY, "tok-survivant");
    vaultLocked = true;

    // La session en cours continue de fonctionner...
    expect(await loadSessionToken()).toBe("tok-survivant");
    // ...et la seule copie restante n'a pas ete detruite.
    expect(plain.get(LEGACY_KEY)).toBe("tok-survivant");

    // Une fois l'appareil deverrouille, la migration aboutit.
    vaultLocked = false;
    expect(await loadSessionToken()).toBe("tok-survivant");
    expect(vault.get(SECURE_KEY)?.value).toBe("tok-survivant");
    expect(plain.has(LEGACY_KEY)).toBe(false);
  });

  it("ne leve jamais quand le coffre est indisponible", async () => {
    plain.set(LEGACY_KEY, "tok-x");
    vaultLocked = true;
    // La tache de fond appelle ce module ; une exception y annulerait le job.
    await expect(loadSessionToken()).resolves.toBe("tok-x");
  });

  it("nettoie une valeur en clair inexploitable sans la migrer", async () => {
    plain.set(LEGACY_KEY, "{ ceci n'est pas du JSON");
    expect(await loadSessionToken()).toBeNull();
    expect(plain.has(LEGACY_KEY)).toBe(false);
    expect(vault.has(SECURE_KEY)).toBe(false);
  });
});

describe("lecture et nettoyage", () => {
  it("rend le token du coffre en priorite", async () => {
    vault.set(SECURE_KEY, { value: "tok-coffre", accessible: AFTER_FIRST_UNLOCK });
    plain.set(LEGACY_KEY, "tok-clair");
    expect(await loadSessionToken()).toBe("tok-coffre");
    // Le slot en clair n'est pas touche tant que le coffre repond.
    expect(plain.get(LEGACY_KEY)).toBe("tok-clair");
  });

  it("purge une entree de coffre corrompue au lieu de boucler", async () => {
    vault.set(SECURE_KEY, { value: "{ json casse" });
    expect(await loadSessionToken()).toBeNull();
    expect(vault.has(SECURE_KEY)).toBe(false);
  });

  it("rend null quand rien n'est stocke", async () => {
    expect(await loadSessionToken()).toBeNull();
  });

  it("efface les deux emplacements a la deconnexion", async () => {
    vault.set(SECURE_KEY, { value: "tok" });
    plain.set(LEGACY_KEY, "tok");
    await clearSessionToken();
    expect(vault.has(SECURE_KEY)).toBe(false);
    expect(plain.has(LEGACY_KEY)).toBe(false);
  });

  it("efface le slot en clair meme si le coffre est indisponible", async () => {
    plain.set(LEGACY_KEY, "tok");
    vaultLocked = true;
    await expect(clearSessionToken()).resolves.toBeUndefined();
    expect(plain.has(LEGACY_KEY)).toBe(false);
  });
});
