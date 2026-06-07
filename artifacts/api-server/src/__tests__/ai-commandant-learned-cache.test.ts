/**
 * Régression : injection du contexte appris dans les endpoints de génération IA
 * du « Commandant » + empreinte (`fingerprintLearned`) dans LEUR clé de cache.
 *
 * Invariant verrouillé (cf. .agents/memory/ai-council-and-agent-learning.md) :
 * tout prompt qui injecte le bloc de contexte appris DOIT plier son empreinte
 * dans la clé de cache IA. Sinon, après un vote 👍/👎 ou un recompute, le bloc
 * appris change mais l'ancienne sortie reste servie jusqu'à l'expiration du TTL —
 * l'apprentissage paraît cassé.
 *
 * Cette suite reproduit la forme EXACTE de l'`input` de chaque route cachée du
 * Commandant (call-smart-response, email-smart-reply, smart-search, analyze-text,
 * execute-command, weekly-digest) et vérifie que, à entrée métier constante, seul
 * un changement du contexte appris suffit à changer la clé. Aucune dépendance DB.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { buildAiCacheKey } from "../services/ai-cache";
import { fingerprintLearned } from "../services/ai-learning";

const ORG = 7;
const USER = 99;

// Deux états du bloc appris : « avant » et « après » un vote / recompute.
const LEARNED_BEFORE =
  "\n=== CE QUE TU AS APPRIS ===\nPréférence: réponses courtes, vouvoiement.";
const LEARNED_AFTER =
  "\n=== CE QUE TU AS APPRIS ===\nPréférence: réponses détaillées, tutoiement, emojis.";

// Reproduit la forme d'`input` de chaque route cachée du Commandant.
// `learned` y est branché sur l'empreinte du bloc appris, comme dans ai-commandant.ts.
const ROUTE_INPUT: Record<string, (learned: string) => Record<string, unknown>> = {
  "/commandant/call-smart-response": (learned) => ({
    callId: 1, callerPhone: "0102030405", callerName: "Dupont",
    callDirection: "entrant", contactId: 3, openTasks: 2, overdueInvoices: 1,
    recentCalls: 4, learned,
  }),
  "/commandant/email-smart-reply": (learned) => ({
    emailFrom: "client@ex.fr", emailSubject: "Devis", emailBodyHash: "bonjour…",
    tone: "professionnel", contactId: 3, learned,
  }),
  "/commandant/smart-search": (learned) => ({
    query: "facture impayée",
    ids: { c: [1, 2], t: [3], e: [], i: [4], p: [] },
    learned,
  }),
  "/commandant/analyze-text": (learned) => ({
    analysisType: "summary", text: "Texte à résumer.", learned,
  }),
  "/commandant/execute-command": (learned) => ({
    command: "Résume-moi la situation",
    ctx: { openTasks: 2, overdueTasks: 1 },
    learned,
  }),
  "/commandant/weekly-digest": (learned) => ({
    day: "2026-06-07", weekData: { appels: { total: 12 } },
    agentScores: [{ id: "drh", score: 80 }], crossIssues: 0, learned,
  }),
};

function keyFor(route: string, learnedBlock: string, userId?: number): string {
  return buildAiCacheKey({
    route,
    organisationId: ORG,
    userId,
    input: ROUTE_INPUT[route](fingerprintLearned(learnedBlock)),
  });
}

describe("Commandant — l'empreinte du contexte appris partitionne le cache", () => {
  for (const route of Object.keys(ROUTE_INPUT)) {
    // Les routes en flux (stream) partitionnent aussi par utilisateur.
    const userId = route === "/commandant/call-smart-response" || route === "/commandant/email-smart-reply"
      ? undefined
      : USER;

    it(`${route} : un contexte appris modifié ⇒ clé différente (régénère après vote/recompute)`, () => {
      const before = keyFor(route, LEARNED_BEFORE, userId);
      const after = keyFor(route, LEARNED_AFTER, userId);
      expect(before).not.toBe(after);
      // Sanity : le préfixe route/org reste stable (seul `learned` a bougé).
      expect(before.startsWith(`${route}:${ORG}:`)).toBe(true);
      expect(after.startsWith(`${route}:${ORG}:`)).toBe(true);
    });

    it(`${route} : contexte appris identique ⇒ même clé (réutilisation du cache préservée)`, () => {
      expect(keyFor(route, LEARNED_BEFORE, userId)).toBe(keyFor(route, LEARNED_BEFORE, userId));
    });
  }

  it("fingerprintLearned : un bloc appris vide vs non vide ⇒ empreintes différentes", () => {
    expect(fingerprintLearned("")).toBe("none");
    expect(fingerprintLearned(LEARNED_BEFORE)).not.toBe(fingerprintLearned(""));
    expect(fingerprintLearned(LEARNED_BEFORE)).not.toBe(fingerprintLearned(LEARNED_AFTER));
  });

  it("même empreinte ⇒ même résultat (déterministe, donc cache stable pour un état appris donné)", () => {
    expect(fingerprintLearned(LEARNED_AFTER)).toBe(fingerprintLearned(LEARNED_AFTER));
  });
});
