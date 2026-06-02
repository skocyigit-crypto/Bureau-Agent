/**
 * Verrouille l'attribution des couts IA quand un modele Gemini est retire.
 *
 * Quand Google retire un modele, le repli automatique (singleton patch installe
 * par `installGeminiModelFallback`) rejoue la requete sur un modele de secours
 * et *etiquette* la reponse / les chunks avec le modele qui a REELLEMENT servi
 * (via `Symbol.for("workspace.geminiActualModel")`). Les sites de journalisation
 * d'usage lisent cette etiquette avec `geminiActualModel(obj, requested)` afin
 * que `recordAiUsage` enregistre le bon modele et que `estimateAiCostUsd`
 * facture le bon tarif. Sans ces tests, un refactor pourrait re-attribuer
 * silencieusement la depense au modele *demande* (potentiellement un tarif
 * different) au lieu du modele de repli reellement utilise.
 *
 * Cette suite simule un retrait de modele sur le client Gemini PARTAGE (mocke)
 * puis verifie:
 *   - non-streaming  : l'usage enregistre le modele de repli (pas le demande) ;
 *   - streaming      : idem sur les chemins succes ET abort ;
 *   - estimateAiCostUsd applique le tarif du modele de repli ;
 *   - chemin normal (sans repli) : l'usage enregistre le modele demande.
 *
 * On force les constantes de modeles via variables d'environnement AVANT
 * l'import du module pour ne pas dependre des valeurs par defaut (qui migrent).
 */
process.env.GEMINI_PRO_MODEL = "gemini-2.5-pro";
process.env.GEMINI_FLASH_MODEL = "gemini-2.5-flash";
process.env.GEMINI_PRO_FALLBACK_MODEL = "gemini-pro-latest";
process.env.GEMINI_FLASH_FALLBACK_MODEL = "gemini-flash-latest";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Etat mutable partage par les factories vi.mock (hoistees en tete) ──
const { geminiState, rawGenerateContent, rawGenerateContentStream, recorded, insertValues, dbInsert } =
  vi.hoisted(() => {
    // Quels noms de modeles sont consideres "retires" par le client mocke.
    const geminiState = { retired: new Set<string>() };

    const retire = (model: string) =>
      new Error(`models/${model} is not found for API version v1beta, or is not supported for generateContent.`);

    // Reponse non-streaming type avec metadonnees d'usage.
    const rawGenerateContent = vi.fn(async (params: any) => {
      if (geminiState.retired.has(params?.model)) throw retire(params.model);
      return {
        text: "ok",
        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 600, totalTokenCount: 1800 },
      };
    });

    // Flux non-streaming type: 2 chunks portant chacun les metadonnees d'usage.
    const rawGenerateContentStream = vi.fn(async (params: any) => {
      if (geminiState.retired.has(params?.model)) throw retire(params.model);
      return (async function* () {
        const meta = { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 };
        yield { text: "Bonjour ", usageMetadata: meta };
        yield { text: "le monde", usageMetadata: meta };
      })();
    });

    // Capture des lignes ai_usage inserees (recordAiUsage -> db.insert().values()).
    const recorded: any[] = [];
    const insertValues = vi.fn(async (v: any) => {
      recorded.push(v);
    });
    const dbInsert = vi.fn(() => ({ values: insertValues }));

    return { geminiState, rawGenerateContent, rawGenerateContentStream, recorded, insertValues, dbInsert };
  });

// Le client Gemini partage. installGeminiModelFallback() patche CET objet, et
// ai-stream / la simulation call-processor importent le MEME objet -> le repli
// couvre tous les sites d'appel.
vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: rawGenerateContent, generateContentStream: rawGenerateContentStream } },
}));

// recordAiUsage importe @workspace/db dynamiquement: on capture l'insert.
vi.mock("@workspace/db", () => ({
  db: { insert: dbInsert },
  aiUsageTable: { __table: "ai_usage" },
}));

// ai-stream importe ai-quota: on neutralise quota + invalidation.
vi.mock("../services/ai-quota", () => ({
  assertAiQuota: vi.fn(async () => {}),
  invalidateQuotaCache: vi.fn(() => {}),
  AiQuotaExceededError: class AiQuotaExceededError extends Error {},
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  installGeminiModelFallback,
  geminiActualModel,
  estimateAiCostUsd,
  recordAiUsage,
  GEMINI_PRO_MODEL,
  GEMINI_PRO_FALLBACK_MODEL,
} from "../services/ai-utils";
import { multiAiGenerateStream, StreamAbortedError } from "../services/ai-stream";

const flush = () => new Promise((r) => setTimeout(r, 25));
const lastRecorded = () => recorded[recorded.length - 1];

beforeAll(async () => {
  // Installe (une seule fois) le repli sur le client Gemini mocke.
  await installGeminiModelFallback();
});

beforeEach(() => {
  geminiState.retired.clear();
  recorded.length = 0;
  rawGenerateContent.mockClear();
  rawGenerateContentStream.mockClear();
  insertValues.mockClear();
  dbInsert.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("estimateAiCostUsd — tarification du modele de repli", () => {
  it("facture le repli au meme tarif que son modele d'origine", () => {
    const requested = estimateAiCostUsd(GEMINI_PRO_MODEL, 1_000_000, 1_000_000);
    const fallback = estimateAiCostUsd(GEMINI_PRO_FALLBACK_MODEL, 1_000_000, 1_000_000);
    expect(fallback).toBe(requested);
  });

  it("n'utilise PAS le tarif par defaut (modele inconnu) pour le repli", () => {
    const fallback = estimateAiCostUsd(GEMINI_PRO_FALLBACK_MODEL, 1_000_000, 1_000_000);
    const unknown = estimateAiCostUsd("modele-inconnu-xyz", 1_000_000, 1_000_000);
    expect(fallback).not.toBe(unknown);
  });
});

describe("geminiActualModel — lecture de l'etiquette de modele reel", () => {
  it("retombe sur le modele demande quand l'objet n'est pas etiquete", () => {
    expect(geminiActualModel({}, GEMINI_PRO_MODEL)).toBe(GEMINI_PRO_MODEL);
    expect(geminiActualModel(null, GEMINI_PRO_MODEL)).toBe(GEMINI_PRO_MODEL);
    expect(geminiActualModel(undefined, GEMINI_PRO_MODEL)).toBe(GEMINI_PRO_MODEL);
  });
});

describe("singleton patch — non-streaming (pattern call-processor)", () => {
  it("etiquette la reponse avec le modele de repli quand le modele est retire", async () => {
    geminiState.retired.add(GEMINI_PRO_MODEL);
    const mod: any = await import("@workspace/integrations-gemini-ai");

    const response = await mod.ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: [{ role: "user", parts: [{ text: "salut" }] }],
    });

    // C'est exactement ce que fait call-processor: il lit le modele reel puis enregistre.
    const actualModel = geminiActualModel(response, GEMINI_PRO_MODEL);
    expect(actualModel).toBe(GEMINI_PRO_FALLBACK_MODEL);

    await recordAiUsage({
      organisationId: 7,
      provider: "gemini",
      model: actualModel,
      route: "call-processor",
      inputTokens: 1200,
      outputTokens: 600,
      durationMs: 10,
    });
    await flush();

    const row = lastRecorded();
    expect(row.model).toBe(GEMINI_PRO_FALLBACK_MODEL);
    expect(row.estimatedCostUsd).toBe(estimateAiCostUsd(GEMINI_PRO_FALLBACK_MODEL, 1200, 600));
  });

  it("enregistre le modele demande quand il n'y a pas de repli (chemin normal)", async () => {
    const mod: any = await import("@workspace/integrations-gemini-ai");

    const response = await mod.ai.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: [{ role: "user", parts: [{ text: "salut" }] }],
    });

    const actualModel = geminiActualModel(response, GEMINI_PRO_MODEL);
    expect(actualModel).toBe(GEMINI_PRO_MODEL);

    await recordAiUsage({
      organisationId: 7,
      provider: "gemini",
      model: actualModel,
      route: "call-processor",
      inputTokens: 1200,
      outputTokens: 600,
      durationMs: 10,
    });
    await flush();

    const row = lastRecorded();
    expect(row.model).toBe(GEMINI_PRO_MODEL);
    expect(row.estimatedCostUsd).toBe(estimateAiCostUsd(GEMINI_PRO_MODEL, 1200, 600));
  });
});

describe("multiAiGenerateStream — streaming", () => {
  it("enregistre le modele de repli sur le chemin succes apres un retrait", async () => {
    geminiState.retired.add(GEMINI_PRO_MODEL);
    const controller = new AbortController();
    const tokens: string[] = [];

    const res = await multiAiGenerateStream({
      prompt: "Bonjour",
      route: "stream-test",
      organisationId: 7,
      signal: controller.signal,
      onToken: (t) => tokens.push(t),
      geminiModel: GEMINI_PRO_MODEL,
    });
    await flush();

    expect(res.provider).toBe("gemini");
    expect(res.model).toBe(GEMINI_PRO_FALLBACK_MODEL);

    const row = lastRecorded();
    expect(row.model).toBe(GEMINI_PRO_FALLBACK_MODEL);
    expect(row.estimatedCostUsd).toBe(estimateAiCostUsd(GEMINI_PRO_FALLBACK_MODEL, row.inputTokens, row.outputTokens));
  });

  it("enregistre le modele de repli sur le chemin abort apres un retrait", async () => {
    geminiState.retired.add(GEMINI_PRO_MODEL);
    const controller = new AbortController();
    const tokens: string[] = [];

    // On annule des le premier token: la 2e iteration de la boucle voit l'abort.
    let aborted = false;
    const promise = multiAiGenerateStream({
      prompt: "Bonjour",
      route: "stream-test",
      organisationId: 7,
      signal: controller.signal,
      onToken: (t) => {
        tokens.push(t);
        if (!aborted) {
          aborted = true;
          controller.abort();
        }
      },
      geminiModel: GEMINI_PRO_MODEL,
    });

    await expect(promise).rejects.toBeInstanceOf(StreamAbortedError);
    await promise.catch((err) => {
      expect(err.partial.aborted).toBe(true);
      expect(err.partial.model).toBe(GEMINI_PRO_FALLBACK_MODEL);
    });
    await flush();

    const row = lastRecorded();
    expect(row.model).toBe(GEMINI_PRO_FALLBACK_MODEL);
    expect(row.estimatedCostUsd).toBe(estimateAiCostUsd(GEMINI_PRO_FALLBACK_MODEL, row.inputTokens, row.outputTokens));
  });

  it("enregistre le modele demande quand il n'y a pas de retrait (chemin normal)", async () => {
    const controller = new AbortController();
    const tokens: string[] = [];

    const res = await multiAiGenerateStream({
      prompt: "Bonjour",
      route: "stream-test",
      organisationId: 7,
      signal: controller.signal,
      onToken: (t) => tokens.push(t),
      geminiModel: GEMINI_PRO_MODEL,
    });
    await flush();

    expect(res.model).toBe(GEMINI_PRO_MODEL);

    const row = lastRecorded();
    expect(row.model).toBe(GEMINI_PRO_MODEL);
    expect(row.estimatedCostUsd).toBe(estimateAiCostUsd(GEMINI_PRO_MODEL, row.inputTokens, row.outputTokens));
  });
});
