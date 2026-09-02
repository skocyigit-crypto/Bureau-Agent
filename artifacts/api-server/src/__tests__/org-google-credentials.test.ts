/**
 * Identifiants OAuth par organisation: ce qui doit tenir, c'est que le secret
 * ne ressorte jamais. Il entre chiffre, il est relu par `resolveGoogleCredentials`
 * cote serveur, et aucune reponse d'API ne le contient.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../lib/google-auth";

const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "org-google-credentials.ts"), "utf8");

describe("chiffrement des secrets clients", () => {
  it("rend exactement ce qui a ete chiffre", () => {
    const secret = "GOCSPX-abcdefghijklmnopqrstuvwxyz";

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("ne laisse pas le secret lisible dans la valeur stockee", () => {
    const secret = "GOCSPX-secret-tres-reconnaissable";
    const stored = encryptSecret(secret);

    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("GOCSPX");
    // iv:tag:donnees, en hexadecimal.
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
  });

  it("produit un chiffre different a chaque ecriture du meme secret", () => {
    // Sinon deux organisations partageant le meme secret seraient reconnaissables
    // par comparaison directe des colonnes.
    const secret = "GOCSPX-identique";

    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("refuse un contenu altere au lieu de renvoyer n'importe quoi", () => {
    const stored = encryptSecret("GOCSPX-integre");
    const [iv, tag, data] = stored.split(":");
    const tampered = `${iv}:${tag}:${data.slice(0, -2)}00`;

    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("surface de la route", () => {
  it("ne renvoie jamais le secret, meme masque", () => {
    // La reponse ne doit contenir que la presence et l'identifiant public.
    expect(ROUTE).not.toMatch(/clientSecret\s*[,}]/);
    expect(ROUTE).not.toContain("clientSecretEnc:");
    expect(ROUTE).toContain("clientIdMasked");
  });

  it("valide la forme de l'identifiant client avant d'ecrire", () => {
    const pattern = /^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i;

    expect(pattern.test("123456789-abcdef.apps.googleusercontent.com")).toBe(true);
    for (const invalid of ["", "abc", "123-abc.example.com", "https://evil.test", "123-abc.apps.googleusercontent.com.evil.test"]) {
      expect(pattern.test(invalid), invalid).toBe(false);
    }
  });

  it("reste reserve aux administrateurs de l'organisation", () => {
    const guards = ROUTE.match(/requireRole\("administrateur", "super_admin"\)/g) ?? [];

    // Les trois verbes (GET, PUT, DELETE) doivent porter la garde.
    expect(guards).toHaveLength(3);
  });

  it("borne chaque acces a l'organisation de la session", () => {
    const uses = ROUTE.match(/getOrgId\(req\)/g) ?? [];

    expect(uses).toHaveLength(3);
    expect(ROUTE).not.toMatch(/body\??\.\s*organisationId/);
  });
});
