/**
 * Cloisonnement multi-tenant du cache IA (fuite démo/test patron <-> client licencié).
 *
 * Invariant de sécurité : une réponse IA mise en cache ne doit JAMAIS pouvoir
 * être resservie à une autre organisation. La clé de cache inclut l'organisationId.
 *
 * Cas limite couvert ici : si l'organisationId est ABSENT (bug en amont — une route
 * IA qui oublierait de passer l'org), on ne doit PAS retomber sur un seau partagé
 * "noorg" commun. `buildAiCacheKey` génère alors une clé UNIQUE par appel, de sorte
 * que deux requêtes sans org ne partagent jamais la même entrée.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it, beforeEach } from "vitest";
import {
  buildAiCacheKey,
  getCached,
  setCached,
  getOrCompute,
  clearAiCache,
  AI_CACHE_TTL,
} from "../services/ai-cache";

const ROUTE = "/ai/analyze";
const INPUT = { text: "Bonjour, pouvez-vous résumer mes appels ?" };

describe("ai-cache — cloisonnement multi-tenant", () => {
  it("deux organisations différentes ⇒ clés différentes (même prompt)", () => {
    const a = buildAiCacheKey({ route: ROUTE, organisationId: 1, input: INPUT });
    const b = buildAiCacheKey({ route: ROUTE, organisationId: 2, input: INPUT });
    expect(a).not.toBe(b);
  });

  it("même organisation + même prompt ⇒ même clé (cache réutilisable)", () => {
    const a = buildAiCacheKey({ route: ROUTE, organisationId: 7, input: INPUT });
    const b = buildAiCacheKey({ route: ROUTE, organisationId: 7, input: INPUT });
    expect(a).toBe(b);
  });

  it("organisationId absent ⇒ clé UNIQUE par appel (jamais de seau partagé 'noorg')", () => {
    const a = buildAiCacheKey({ route: ROUTE, input: INPUT });
    const b = buildAiCacheKey({ route: ROUTE, input: INPUT });
    // Deux requêtes sans org NE doivent PAS partager la même entrée de cache.
    expect(a).not.toBe(b);
    expect(a).not.toBe(
      buildAiCacheKey({ route: ROUTE, organisationId: null, input: INPUT }),
    );
  });

  it("préfixe route:org stable pour une org réelle (invalidateOrg fonctionne)", () => {
    const key = buildAiCacheKey({ route: ROUTE, organisationId: 99, input: INPUT });
    // invalidateOrg(99) cible le segment ":99:" ; il doit être présent tel quel.
    expect(key.includes(":99:")).toBe(true);
  });
});

describe("ai-cache — sémantique réelle hit/miss (cloisonnement)", () => {
  beforeEach(() => clearAiCache());

  it("org A et org B avec le même prompt ne partagent JAMAIS la valeur en cache", () => {
    const keyA = buildAiCacheKey({ route: ROUTE, organisationId: 1, input: INPUT });
    const keyB = buildAiCacheKey({ route: ROUTE, organisationId: 2, input: INPUT });
    setCached(keyA, { reply: "secret de l'org 1" }, AI_CACHE_TTL.SHORT);
    // L'org 2 ne doit RIEN trouver : aucune fuite inter-tenant.
    expect(getCached(keyB)).toBeNull();
    expect(getCached(keyA)).toEqual({ reply: "secret de l'org 1" });
  });

  it("missing-org : clé construite une fois ⇒ hit local possible (getOrCompute)", async () => {
    let calls = 0;
    const key = buildAiCacheKey({ route: ROUTE, input: INPUT });
    const compute = async () => {
      calls++;
      return { reply: "calculé" };
    };
    const first = await getOrCompute(key, AI_CACHE_TTL.SHORT, compute);
    const second = await getOrCompute(key, AI_CACHE_TTL.SHORT, compute);
    expect(first).toEqual({ reply: "calculé" });
    expect(second).toEqual({ reply: "calculé" });
    expect(calls).toBe(1); // la même clé réutilisée dans la requête est un hit
  });

  it("missing-org : clé reconstruite à chaque appel ⇒ TOUJOURS un miss (jamais partagé)", async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      return { reply: `n${calls}` };
    };
    // Deux "requêtes" distinctes sans org reconstruisent chacune leur clé.
    const k1 = buildAiCacheKey({ route: ROUTE, input: INPUT });
    await getOrCompute(k1, AI_CACHE_TTL.SHORT, compute);
    const k2 = buildAiCacheKey({ route: ROUTE, input: INPUT });
    await getOrCompute(k2, AI_CACHE_TTL.SHORT, compute);
    expect(calls).toBe(2); // aucune réutilisation entre requêtes sans org
  });
});
