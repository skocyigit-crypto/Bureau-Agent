/**
 * Consentement KVKK au suivi de localisation (`lib/location-consent.ts`).
 *
 * Le suivi de presence est permanent et n'a pas d'interrupteur: l'ecran
 * d'information KVKK est la seule barriere avant qu'il ne demarre. Ce
 * consentement est donc personnel.
 *
 * Il etait conserve sous une cle GLOBALE a l'appareil, jamais effacee a la
 * deconnexion. Sur un appareil partage — poste d'accueil, tablette d'equipe,
 * telephone repris par un collegue — le suivi du deuxieme utilisateur demarrait
 * sans qu'il ait jamais vu l'information, sur la foi du consentement d'un
 * autre. Ces tests figent le cloisonnement par utilisateur et la disparition de
 * l'ancienne cle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
let throwOnRead = false;

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      if (throwOnRead) throw new Error("storage indisponible");
      return store.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

const {
  kvkkAckKey,
  hasAcknowledgedKvkk,
  acknowledgeKvkkFor,
  purgeLegacyKvkkAck,
} = await import("../location-consent");

beforeEach(() => {
  store.clear();
  throwOnRead = false;
});

describe("cloisonnement par utilisateur", () => {
  it("n'accorde le consentement qu'a l'utilisateur qui l'a donne", async () => {
    await acknowledgeKvkkFor(1);

    expect(await hasAcknowledgedKvkk(1)).toBe(true);
    // Regression centrale: B ne doit pas heriter du consentement de A.
    expect(await hasAcknowledgedKvkk(2)).toBe(false);
  });

  it("retrouve le consentement d'un utilisateur qui revient", async () => {
    await acknowledgeKvkkFor(1);
    await acknowledgeKvkkFor(2);
    // On ne refait pas accepter quelqu'un sans raison.
    expect(await hasAcknowledgedKvkk(1)).toBe(true);
    expect(await hasAcknowledgedKvkk(2)).toBe(true);
  });

  it("utilise une cle distincte par utilisateur", () => {
    expect(kvkkAckKey(1)).not.toBe(kvkkAckKey(2));
  });
});

describe("refus par defaut", () => {
  it("repond false sans utilisateur identifie", async () => {
    expect(await hasAcknowledgedKvkk(null)).toBe(false);
    expect(await hasAcknowledgedKvkk(undefined)).toBe(false);
  });

  it("n'enregistre rien sans utilisateur identifie", async () => {
    await acknowledgeKvkkFor(null);
    expect(store.size).toBe(0);
  });

  it("repond false quand le stockage est illisible", async () => {
    // En cas de doute on remontre l'information plutot que de demarrer un
    // suivi permanent non consenti.
    await acknowledgeKvkkFor(1);
    throwOnRead = true;
    expect(await hasAcknowledgedKvkk(1)).toBe(false);
  });
});

describe("ancienne cle globale", () => {
  it("est supprimee, car elle vaut consentement pour n'importe qui", async () => {
    store.set("location:kvkk-acknowledged-v1", "1");
    await purgeLegacyKvkkAck();
    expect(store.has("location:kvkk-acknowledged-v1")).toBe(false);
  });

  it("ne confere plus de consentement a personne", async () => {
    store.set("location:kvkk-acknowledged-v1", "1");
    expect(await hasAcknowledgedKvkk(1)).toBe(false);
  });

  it("est sans effet quand elle n'existe pas", async () => {
    await expect(purgeLegacyKvkkAck()).resolves.toBeUndefined();
  });
});
