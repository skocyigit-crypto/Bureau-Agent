/**
 * Isolation du cache des agents experts par contexte appris (par utilisateur).
 *
 * Les 10 agents experts injectent désormais le profil personnel de l'acteur
 * (style d'écriture / focus) dans leur prompt via `buildLearnedContextBlock`.
 * Le contexte appris diffère d'un utilisateur à l'autre : il est donc inclus
 * dans `input.learned` de la clé de cache (`buildAiCacheKey`) pour qu'une sortie
 * personnalisée d'un utilisateur NE puisse PAS être resservie à un autre via une
 * collision de cache.
 *
 * Cette suite verrouille cet invariant de sécurité (fuite inter-utilisateur)
 * sans toucher à la base : on reproduit la forme exacte de `input` utilisée
 * dans `ai-agents.ts` et on vérifie le partitionnement.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { buildAiCacheKey } from "../services/ai-cache";

const ROUTE = "/ai/agents/drh";
const ORG = 42;
const DAY = "2026-06-06";
const DATA_HASH = JSON.stringify({ calls: 12, tasks: 3 }).slice(0, 400);

// Forme identique à l'`input` de l'agentCacheKey dans ai-agents.ts.
function agentKey(learned: string) {
  return buildAiCacheKey({
    route: ROUTE,
    organisationId: ORG,
    input: { day: DAY, dataHash: DATA_HASH, goal: "", council: true, learned, research: "" },
  });
}

describe("ai-agents — partitionnement du cache par contexte appris", () => {
  it("deux contextes appris différents ⇒ clés de cache différentes (pas de fuite inter-utilisateur)", () => {
    const userA = "\n=== PROFIL DE L'UTILISATEUR ===\nStyle: messages courts, vouvoiement.";
    const userB = "\n=== PROFIL DE L'UTILISATEUR ===\nStyle: messages longs, tutoiement, emojis.";
    expect(agentKey(userA)).not.toBe(agentKey(userB));
  });

  it("même contexte appris ⇒ même clé (réutilisation du cache préservée pour le même utilisateur)", () => {
    const learned = "\n=== PROFIL DE L'UTILISATEUR ===\nStyle: ton sobre.";
    expect(agentKey(learned)).toBe(agentKey(learned));
  });

  it("contexte appris (utilisateur) vs vide (cron/org) ⇒ clés différentes", () => {
    const personal = "\n=== PROFIL DE L'UTILISATEUR ===\nStyle: ton sobre.";
    expect(agentKey(personal)).not.toBe(agentKey(""));
  });

  it("le contexte appris fait partie de la clé, pas seulement org/route", () => {
    // Même org, même route, même jour : seul `learned` change -> la clé DOIT changer.
    const k1 = agentKey("focus: recouvrement");
    const k2 = agentKey("focus: prospection");
    expect(k1).not.toBe(k2);
    // Sanity: le préfixe route/org reste stable.
    expect(k1.startsWith(`${ROUTE}:${ORG}:`)).toBe(true);
    expect(k2.startsWith(`${ROUTE}:${ORG}:`)).toBe(true);
  });
});
