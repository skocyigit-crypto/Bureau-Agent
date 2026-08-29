/**
 * Deverrouillage biometrique (`lib/biometric.ts`).
 *
 * Le module garde le couple e-mail/mot de passe de l'utilisateur dans le
 * trousseau. Une incoherence d'etat n'y produit pas une erreur visible mais un
 * comportement trompeur: soit l'application propose un deverrouillage adosse a
 * des identifiants perimes, soit elle affirme avoir tout efface alors que le
 * mot de passe est toujours la.
 *
 * Trois defauts couverts ici, tous lies a des ecritures/suppressions
 * partielles — le coffre peut echouer sur une operation et pas sur la suivante:
 *
 *  1. `disableBiometric` enchainait ses trois suppressions dans un seul `try`.
 *     Un echec sur la premiere laissait le mot de passe ET le drapeau: l'app
 *     se croyait encore protegee avec des identifiants cences supprimes.
 *  2. `enableBiometric` pouvait laisser un identifiant orphelin apres un echec
 *     a mi-parcours.
 *  3. `refreshBiometricCredentials` pouvait laisser une paire desaccordee
 *     (nouvel e-mail, ancien mot de passe) — la boucle "invite biometrique
 *     puis echec serveur" que cette fonction existe justement pour empecher.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const EMAIL_KEY = "adb_bio_email_v1";
const PASSWORD_KEY = "adb_bio_password_v1";
const FLAG_KEY = "adb_bio_enabled_v1";

const vault = new Map<string, string>();
/** Cles dont toute ecriture/suppression doit echouer (coffre capricieux). */
const failingKeys = new Set<string>();
let authSucceeds = true;
let hasHardware = true;
let isEnrolled = true;

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  getItemAsync: async (key: string) => vault.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (failingKeys.has(key)) throw new Error(`keychain write refused: ${key}`);
    vault.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (failingKeys.has(key)) throw new Error(`keychain delete refused: ${key}`);
    vault.delete(key);
  },
}));

vi.mock("expo-local-authentication", () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
  hasHardwareAsync: async () => hasHardware,
  isEnrolledAsync: async () => isEnrolled,
  supportedAuthenticationTypesAsync: async () => [2],
  authenticateAsync: async () => ({ success: authSucceeds }),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const {
  enableBiometric,
  disableBiometric,
  isBiometricEnabled,
  getBiometricCredentials,
  refreshBiometricCredentials,
  getBiometricCapability,
} = await import("../biometric");

beforeEach(() => {
  vault.clear();
  failingKeys.clear();
  authSucceeds = true;
  hasHardware = true;
  isEnrolled = true;
});

describe("activation", () => {
  it("stocke les identifiants et le drapeau apres une biometrie reussie", async () => {
    expect(await enableBiometric("a@b.fr", "secret")).toBe(true);
    expect(vault.get(EMAIL_KEY)).toBe("a@b.fr");
    expect(vault.get(PASSWORD_KEY)).toBe("secret");
    expect(await isBiometricEnabled()).toBe(true);
  });

  it("n'ecrit rien si la biometrie echoue", async () => {
    authSucceeds = false;
    expect(await enableBiometric("a@b.fr", "secret")).toBe(false);
    expect(vault.size).toBe(0);
  });

  it("refuse quand aucune biometrie n'est enrolee", async () => {
    isEnrolled = false;
    expect(await enableBiometric("a@b.fr", "secret")).toBe(false);
    expect(vault.size).toBe(0);
  });

  it("ne laisse aucun identifiant orphelin apres un echec a mi-parcours", async () => {
    failingKeys.add(PASSWORD_KEY);
    expect(await enableBiometric("a@b.fr", "secret")).toBe(false);
    // L'e-mail avait pu etre ecrit avant l'echec: il doit avoir ete repris.
    expect(vault.has(EMAIL_KEY)).toBe(false);
    expect(await isBiometricEnabled()).toBe(false);
  });
});

describe("desactivation", () => {
  it("efface identifiants et drapeau", async () => {
    await enableBiometric("a@b.fr", "secret");
    await disableBiometric();
    expect(vault.size).toBe(0);
    expect(await isBiometricEnabled()).toBe(false);
  });

  it("desactive la fonctionnalite meme si une suppression echoue", async () => {
    // Regression centrale: l'enchainement dans un seul `try` s'arretait a la
    // premiere erreur, laissant mot de passe ET drapeau en place.
    await enableBiometric("a@b.fr", "secret");
    failingKeys.add(EMAIL_KEY);

    await disableBiometric();

    expect(await isBiometricEnabled()).toBe(false);
    expect(vault.has(PASSWORD_KEY)).toBe(false);
    // Et plus rien ne doit etre propose a l'utilisateur.
    expect(await getBiometricCredentials()).toBeNull();
  });

  it("est idempotent", async () => {
    await expect(disableBiometric()).resolves.toBeUndefined();
    await expect(disableBiometric()).resolves.toBeUndefined();
  });
});

describe("lecture des identifiants", () => {
  it("rend le couple apres une biometrie reussie", async () => {
    await enableBiometric("a@b.fr", "secret");
    expect(await getBiometricCredentials()).toEqual({
      email: "a@b.fr",
      password: "secret",
    });
  });

  it("rend null si la biometrie echoue", async () => {
    await enableBiometric("a@b.fr", "secret");
    authSucceeds = false;
    expect(await getBiometricCredentials()).toBeNull();
  });

  it("rend null quand la fonctionnalite n'est pas activee", async () => {
    expect(await getBiometricCredentials()).toBeNull();
  });
});

describe("rafraichissement apres changement de mot de passe", () => {
  it("met a jour le couple stocke", async () => {
    await enableBiometric("a@b.fr", "ancien");
    await refreshBiometricCredentials("a@b.fr", "nouveau");
    expect(vault.get(PASSWORD_KEY)).toBe("nouveau");
  });

  it("ne fait rien si la biometrie n'est pas activee", async () => {
    await refreshBiometricCredentials("a@b.fr", "nouveau");
    expect(vault.size).toBe(0);
  });

  it("desactive plutot que de laisser une paire desaccordee", async () => {
    await enableBiometric("a@b.fr", "ancien");
    failingKeys.add(PASSWORD_KEY);

    await refreshBiometricCredentials("neuf@b.fr", "nouveau");

    // Sans cela: e-mail neuf + mot de passe ancien => invite biometrique
    // suivie d'un refus serveur, en boucle et sans explication.
    expect(await isBiometricEnabled()).toBe(false);
    expect(await getBiometricCredentials()).toBeNull();
  });
});

describe("detection materielle", () => {
  it("annonce indisponible sans materiel", async () => {
    hasHardware = false;
    expect(await getBiometricCapability()).toEqual({ available: false, label: "" });
  });

  it("nomme la reconnaissance faciale quand elle est supportee", async () => {
    expect(await getBiometricCapability()).toEqual({
      available: true,
      label: "Face ID",
    });
  });
});
