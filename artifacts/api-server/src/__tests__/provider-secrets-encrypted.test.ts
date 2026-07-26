/**
 * Invariant: TOUT champ de fournisseur declare `secret: true` est chiffre au
 * repos — pour les fournisseurs IA (BYOK: cle Gemini/OpenAI/Anthropic du
 * client) comme pour les fournisseurs e-mail.
 *
 * Pourquoi le figer: la liste des champs a chiffrer etait tenue a la main,
 * separee de la declaration `configFields`. Aujourd'hui les deux coincident
 * (seul `apiKey` est secret partout), mais un fournisseur ajoute plus tard avec
 * un second secret (mot de passe SMTP, secret de signature) serait tombe en
 * clair dans la base sans qu'aucun test, aucun type et aucune revue ne le
 * signale. La liste est desormais derivee de `configFields`; ce test verifie
 * que la derivation couvre reellement chaque fournisseur declare.
 *
 * On verifie aussi que le chiffrement est idempotent: les routes fusionnent la
 * config existante (deja chiffree) avec les champs modifies avant de re-chiffrer
 * — un double chiffrement rendrait la cle du client inutilisable.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
  // Hors production, lib/crypto se rabat sur SESSION_SECRET.
  process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "cle-de-test-suffisamment-longue";
});

import { isEncrypted, decryptSensitiveData } from "../lib/crypto";
import { getSupportedAiProviders, encryptAiConfig } from "../services/ai-providers";
import { getSupportedEmailProviders, encryptEmailConfig } from "../services/email-providers";

const CASES = [
  { label: "IA", providers: getSupportedAiProviders, encrypt: encryptAiConfig },
  { label: "e-mail", providers: getSupportedEmailProviders, encrypt: encryptEmailConfig },
] as const;

describe.each(CASES)("fournisseurs $label — secrets chiffres au repos", ({ providers, encrypt }) => {
  const all = providers();

  it("declare au moins un fournisseur", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all.map((p) => [p.name, p] as const))("%s: chaque champ secret est chiffre", (_name, provider) => {
    const secretFields = provider.configFields.filter((f) => f.secret);
    expect(secretFields.length).toBeGreaterThan(0);

    const config: Record<string, string> = {};
    for (const f of provider.configFields) config[f.key] = `valeur-${f.key}`;

    const stored = encrypt(config);

    for (const f of secretFields) {
      expect(isEncrypted(stored[f.key]), `${provider.name}.${f.key} doit etre chiffre`).toBe(true);
      expect(decryptSensitiveData(stored[f.key])).toBe(`valeur-${f.key}`);
    }
    // Les champs non secrets (adresse expediteur...) restent lisibles: ils sont
    // affiches dans l'interface et servent de filtre.
    for (const f of provider.configFields.filter((x) => !x.secret)) {
      expect(stored[f.key]).toBe(`valeur-${f.key}`);
    }
  });

  it("est idempotent (les routes re-chiffrent une config deja chiffree)", () => {
    const provider = all[0];
    const secretKey = provider.configFields.find((f) => f.secret)!.key;

    const once = encrypt({ [secretKey]: "sk-secret" });
    const twice = encrypt(once);

    expect(twice[secretKey]).toBe(once[secretKey]);
    expect(decryptSensitiveData(twice[secretKey])).toBe("sk-secret");
  });
});
