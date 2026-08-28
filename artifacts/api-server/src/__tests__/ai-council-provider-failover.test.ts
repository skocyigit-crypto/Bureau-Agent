/**
 * Regression : une panne de quota chez UN fournisseur ne doit pas couper le
 * conseil IA entier.
 *
 * `hedgedCouncil` interrompt toute la course des que `isQuotaErr(err)` est vrai.
 * L'intention est de s'arreter net quand l'ORGANISATION a depasse son budget IA
 * mensuel (`AiQuotaExceededError`, levee par `assertAiQuota`) : dans ce cas,
 * interroger un autre fournisseur ne ferait que depenser davantage.
 *
 * Le test portait sur la sous-chaine "quota" du message d'erreur, ce qui
 * confondait ce cas avec les erreurs de quota cote FOURNISSEUR — dont le
 * message contient lui aussi le mot. Consequences mesurees sur ce projet :
 *
 *   - Vertex AI : "Quota exceeded for aiplatform.googleapis.com/
 *     online_prediction_input_tokens_per_minute_per_base_model with base model:
 *     anthropic-claude-opus-4-8" (quota par defaut a zero) ;
 *   - Gemini : "Quota exceeded" sur 429.
 *
 * Chacune faisait echouer la requete entiere alors que les autres fournisseurs
 * repondaient normalement : le hedging, dont le seul but est d'absorber la
 * panne d'un fournisseur, se retournait contre lui-meme.
 *
 * Ce test verrouille la distinction : type de l'erreur, pas contenu du message.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
// `lib/db` exige DATABASE_URL des l'import, et la chaine d'imports y mene via
// ai-quota. Aucune requete n'est emise ici : une URL factice suffit a satisfaire
// le garde, ce qui rend la suite executable sans base (en CI la vraie URL est
// deja definie et prend le pas).
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://unused:unused@127.0.0.1:1/unused";

import { describe, expect, it } from "vitest";
// Imports DYNAMIQUES, apres les affectations d'environnement ci-dessus. Des
// imports statiques seraient hisses en tete de module (semantique ESM) et
// s'evalueraient AVANT elles : `lib/db` leverait alors sur DATABASE_URL absent.
// Meme precaution que dans gemini-model-fallback.test.ts.
const { AiQuotaExceededError } = await import("../services/ai-quota");
const { isQuotaErr } = await import("../routes/ai-commandant");

describe("conseil IA — interruption reservee au quota de l'organisation", () => {
  it("interrompt sur le quota IA de l'organisation", () => {
    // Le budget de l'org est epuise : insister coute de l'argent pour rien.
    expect(isQuotaErr(new AiQuotaExceededError("cost", 51.2, 50))).toBe(true);
    expect(isQuotaErr(new AiQuotaExceededError("calls", 1001, 1000))).toBe(true);
  });

  it("n'interrompt PAS sur une erreur de quota cote fournisseur", () => {
    // Messages reels releves en production — tous contiennent "quota" et
    // faisaient donc tomber le conseil entier avec l'ancien test par sous-chaine.
    const providerFailures = [
      "Quota exceeded for aiplatform.googleapis.com/online_prediction_input_tokens_per_minute_per_base_model with base model: anthropic-claude-opus-4-8.",
      "Quota exceeded",
      "429 RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details.",
      "Rate limit reached for gpt-5.2 in organization org-xxx on tokens per min (TPM)",
      "You have reached your API usage limits: your organization has crossed its monthly API usage threshold.",
    ];
    for (const message of providerFailures) {
      expect(isQuotaErr(new Error(message)), message.slice(0, 48)).toBe(false);
    }
  });

  it("n'interrompt pas non plus sur les pannes ordinaires", () => {
    expect(isQuotaErr(new Error("Connection terminated"))).toBe(false);
    expect(isQuotaErr(new Error("The operation was aborted"))).toBe(false);
    expect(isQuotaErr(undefined)).toBe(false);
    expect(isQuotaErr(null)).toBe(false);
    // Un objet qui imite seulement le message ne doit pas suffire : c'est le
    // type qui fait foi, sinon la confusion d'origine revient par la fenetre.
    expect(isQuotaErr({ message: "Quota IA mensuel atteint" })).toBe(false);
  });
});
