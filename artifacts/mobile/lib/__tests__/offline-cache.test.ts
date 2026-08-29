/**
 * Cloisonnement du cache hors-ligne par utilisateur.
 *
 * Regression couverte: sur un appareil partage, le cache ecrit sous des cles
 * globales (`contacts_list`, `dashboard_summary`...) n'etait jamais purge a la
 * deconnexion, si bien que le compte suivant voyait les donnees du precedent.
 * Ces tests figent les deux garanties qui l'empechent: une cle par utilisateur,
 * et une purge complete du prefixe a la deconnexion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getAllKeys: async () => [...store.keys()],
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
    removeItem: async (key: string) => {
      store.delete(key);
    },
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
  },
}));

const {
  scopedCacheKey,
  clearAllOfflineCaches,
  purgeLegacyCacheKey,
  saveCachedProfile,
  loadCachedProfile,
} = await import("../offline-cache");

beforeEach(() => {
  store.clear();
});

describe("scopedCacheKey", () => {
  it("isole deux utilisateurs sur la meme cle logique", () => {
    expect(scopedCacheKey(1, "contacts_list")).not.toBe(scopedCacheKey(2, "contacts_list"));
  });

  it("reste stable pour un meme couple (utilisateur, cle)", () => {
    expect(scopedCacheKey(7, "tasks_list")).toBe(scopedCacheKey(7, "tasks_list"));
  });

  it("prefixe toujours l'espace de noms du cache", () => {
    expect(scopedCacheKey(7, "tasks_list").startsWith("adb_cache_v1:")).toBe(true);
  });
});

describe("clearAllOfflineCaches", () => {
  it("efface les entrees de tous les utilisateurs", async () => {
    store.set(scopedCacheKey(1, "contacts_list"), "[]");
    store.set(scopedCacheKey(2, "calls_list"), "[]");
    await clearAllOfflineCaches();
    expect(store.size).toBe(0);
  });

  it("ne touche pas aux cles hors cache (session, preferences)", async () => {
    store.set("adb_api_token_v1", "tok");
    store.set("location:kvkk-acknowledged-v1", "1");
    store.set(scopedCacheKey(1, "contacts_list"), "[]");
    await clearAllOfflineCaches();
    expect([...store.keys()].sort()).toEqual([
      "adb_api_token_v1",
      "location:kvkk-acknowledged-v1",
    ]);
  });

  it("est sans effet quand il n'y a rien a purger", async () => {
    await expect(clearAllOfflineCaches()).resolves.toBeUndefined();
  });
});

describe("purgeLegacyCacheKey", () => {
  it("supprime l'entree globale ecrite par l'ancien schema", async () => {
    store.set("contacts_list", '[{"id":1}]');
    await purgeLegacyCacheKey("contacts_list");
    expect(store.has("contacts_list")).toBe(false);
  });
});

describe("profil mis en cache", () => {
  it("relit le profil enregistre", async () => {
    await saveCachedProfile({ id: 7, email: "a@b.fr" });
    expect(await loadCachedProfile()).toEqual({ id: 7, email: "a@b.fr" });
  });

  it("rend null quand rien n'est stocke", async () => {
    expect(await loadCachedProfile()).toBeNull();
  });

  it("rend null sur une entree corrompue plutot qu'un profil bancal", async () => {
    store.set("adb_cache_v1:__session__:profile", "{ pas du json");
    expect(await loadCachedProfile()).toBeNull();
  });

  it("disparait avec le reste du cache a la deconnexion", async () => {
    // Le profil vit sous le prefixe de cache precisement pour etre efface
    // par la purge existante: un appareil partage ne doit pas garder le
    // profil du compte precedent.
    await saveCachedProfile({ id: 7 });
    await clearAllOfflineCaches();
    expect(await loadCachedProfile()).toBeNull();
  });
});
