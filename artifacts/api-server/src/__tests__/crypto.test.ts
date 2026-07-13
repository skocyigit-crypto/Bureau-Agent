/**
 * Tests de regression du chiffrement au repos (lib/crypto).
 *
 * Ce module est la couche CANONIQUE de chiffrement AES-256-GCM utilisee pour
 * tout secret persiste (secrets de signature webhook, cles API sortantes,
 * secrets d'integration). Une regression silencieuse ici exposerait des
 * secrets ou rendrait des secrets stockes indechiffrables. Cette suite
 * verrouille :
 *   1. l'aller-retour chiffre/dechiffre (incluant Unicode et chaine vide) ;
 *   2. la non-correlation (deux chiffrements du meme clair different) ;
 *   3. l'echec authentifie en cas d'alteration (tag GCM) ;
 *   4. le passthrough d'une valeur jamais chiffree (tolerance migration) ;
 *   5. le rejet d'un blob malforme/tronque ;
 *   6. le format de version stable `enc:v1:`.
 */
import { beforeAll, describe, expect, it } from "vitest";

// Cle de chiffrement deterministe et stable pour les tests (>= 16 caracteres).
beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = "test-data-encryption-key-0123456789";
});

// Import APRES avoir fixe l'environnement (le module lit process.env a l'appel,
// mais on reste prudent quant a l'ordre).
const cryptoMod = await import("../lib/crypto");
const { encryptSensitiveData, decryptSensitiveData, isEncrypted, hashSensitiveData } =
  cryptoMod;

describe("lib/crypto — chiffrement au repos AES-256-GCM", () => {
  it("aller-retour : redonne le texte clair d'origine", () => {
    const secret = "sk_live_AbCdEf1234567890";
    const enc = encryptSensitiveData(secret);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptSensitiveData(enc)).toBe(secret);
  });

  it("aller-retour : gere l'Unicode et les caracteres speciaux", () => {
    const secret = "clé-secrète-éàü-🔐-\n\t\"quotes\"";
    expect(decryptSensitiveData(encryptSensitiveData(secret))).toBe(secret);
  });

  it("aller-retour : gere la chaine vide", () => {
    const enc = encryptSensitiveData("");
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSensitiveData(enc)).toBe("");
  });

  it("non-correlation : deux chiffrements du meme clair different", () => {
    const a = encryptSensitiveData("meme-valeur");
    const b = encryptSensitiveData("meme-valeur");
    expect(a).not.toBe(b);
    expect(decryptSensitiveData(a)).toBe("meme-valeur");
    expect(decryptSensitiveData(b)).toBe("meme-valeur");
  });

  it("alteration : un octet modifie fait echouer le dechiffrement (tag GCM)", () => {
    const enc = encryptSensitiveData("valeur-a-proteger");
    const raw = Buffer.from(enc.slice("enc:v1:".length), "base64");
    raw[raw.length - 1] ^= 0xff; // corrompt le dernier octet du ciphertext
    const tampered = `enc:v1:${raw.toString("base64")}`;
    expect(() => decryptSensitiveData(tampered)).toThrow();
  });

  it("passthrough : une valeur jamais chiffree est rendue telle quelle", () => {
    expect(decryptSensitiveData("valeur-en-clair")).toBe("valeur-en-clair");
    expect(isEncrypted("valeur-en-clair")).toBe(false);
  });

  it("malforme : un blob tronque est rejete avec une erreur claire", () => {
    const tooShort = `enc:v1:${Buffer.from("court").toString("base64")}`;
    expect(() => decryptSensitiveData(tooShort)).toThrow(
      /corrompues ou tronquees/,
    );
  });

  it("hashSensitiveData : sha256 hex deterministe", () => {
    const h1 = hashSensitiveData("abc");
    const h2 = hashSensitiveData("abc");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSensitiveData("abd")).not.toBe(h1);
  });
});
