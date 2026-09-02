import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Bascule entre fournisseurs IA.
 *
 * Le 1er septembre 2026 toutes les fonctions IA de l'application se sont
 * arretees d'un coup. Aucun bug: les credits prepayes du compte Gemini etaient
 * epuises et l'API repondait `429 RESOURCE_EXHAUSTED`. Anthropic et OpenAI
 * etaient configures en production et disponibles — mais chaque appel partait
 * directement sur Gemini, sans recours.
 *
 * Le message d'erreur reel est reproduit tel quel plus bas: c'est la forme
 * exacte qu'il faut reconnaitre, et une classification approximative
 * laisserait passer la panne suivante.
 */

// Mocks des trois fournisseurs. Ils remplacent l'appel reseau; chaque test
// decide qui echoue et comment.
const geminiCall = vi.fn();
const anthropicCall = vi.fn();
const openaiCall = vi.fn();

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: (...a: any[]) => geminiCall(...a) } },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: (...a: any[]) => anthropicCall(...a) } },
  resolveClaudeModelId: (m: string) => m,
}));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: (...a: any[]) => openaiCall(...a) } } },
}));

// Le quota et les statistiques d'usage touchent la base; ce test porte sur la
// logique de bascule et ne doit pas exiger un Postgres pour s'executer.
vi.mock("../services/ai-quota", () => ({
  assertAiQuota: vi.fn(),
  invalidateQuotaCache: vi.fn(),
}));

// La bascule ne decide plus seule quelle cle utiliser: `ai-key-policy` dit qui
// paie et `ai-providers` construit le client. Ici, aucune organisation n a de
// cle propre -> credit plateforme, c est-a-dire les singletons moques ci-dessus.
vi.mock("../services/ai-key-policy", () => ({
  resolveAiAccess: vi.fn().mockResolvedValue({
    source: "platform",
    payerOrgId: null,
    providers: {},
    platformReason: "public-surface",
  }),
}));
vi.mock("../services/ai-utils", () => ({
  recordAiUsage: vi.fn().mockResolvedValue(undefined),
  extractGeminiTokens: (r: any) => ({
    input: r?.usageMetadata?.promptTokenCount ?? 0,
    output: r?.usageMetadata?.candidatesTokenCount ?? 0,
    total: 0,
  }),
  extractAnthropicTokens: (m: any) => ({
    input: m?.usage?.input_tokens ?? 0,
    output: m?.usage?.output_tokens ?? 0,
    total: 0,
  }),
  extractOpenAITokens: (r: any) => ({
    input: r?.usage?.prompt_tokens ?? 0,
    output: r?.usage?.completion_tokens ?? 0,
    total: 0,
  }),
  geminiActualModel: (_r: any, m: string) => m,
  GEMINI_FLASH_MODEL: "gemini-flash-latest",
  ANTHROPIC_MODEL: "claude-sonnet-5",
}));
vi.mock("../services/ai-providers", () => ({
  // Aucune organisation n'a de cle propre dans ces tests: les constructeurs
  // rendent les singletons plateforme, c'est-a-dire les mocks reseau ci-dessus.
  getOrgGeminiClient: async () => (await import("@workspace/integrations-gemini-ai")).ai,
  getOrgOpenAIClient: async () => (await import("@workspace/integrations-openai-ai-server")).openai,
  getOrgAnthropicClient: async () => (await import("@workspace/integrations-anthropic-ai")).anthropic,
  // Meme regle que l'implementation reelle: 401/403 ou cle refusee.
  isAiAuthKeyError: (err: any) => {
    const s = Number(err?.status ?? err?.statusCode);
    if (s === 401 || s === 403) return true;
    return /api key not valid|invalid api key|unauthorized/i.test(String(err?.message ?? ""));
  },
}));

const {
  generateText,
  isAiCapacityError,
  shouldFailover,
  providerOrder,
  fromGeminiContents,
  stripCodeFences,
  generateContentFallback,
} = await import("../services/ai-failover");

/** L'erreur exacte relevee en production le 1er septembre 2026. */
const CREDITS_DEPLETED = Object.assign(
  new Error(
    "Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.",
  ),
  { status: 429, error: { code: 429, status: "RESOURCE_EXHAUSTED" } },
);

beforeEach(() => {
  geminiCall.mockReset();
  anthropicCall.mockReset();
  openaiCall.mockReset();
  delete process.env.AI_PROVIDER_ORDER;
});

afterEach(() => {
  delete process.env.AI_PROVIDER_ORDER;
});

describe("classification des erreurs", () => {
  it("reconnait le credit epuise qui a coupe l'IA en production", () => {
    expect(isAiCapacityError(CREDITS_DEPLETED)).toBe(true);
    expect(shouldFailover(CREDITS_DEPLETED)).toBe(true);
  });

  it("reconnait les autres formes d'indisponibilite", () => {
    expect(isAiCapacityError({ status: 429 })).toBe(true);
    expect(isAiCapacityError({ status: 503 })).toBe(true);
    expect(isAiCapacityError({ status: 529 })).toBe(true); // Anthropic surcharge
    expect(isAiCapacityError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isAiCapacityError(new Error("You exceeded your current quota"))).toBe(true);
    expect(isAiCapacityError(new Error("The model is overloaded"))).toBe(true);
    expect(isAiCapacityError(new Error("rate limit reached"))).toBe(true);
  });

  it("bascule aussi sur une cle refusee", () => {
    // Une cle revoquee rend le fournisseur inutilisable exactement comme un
    // credit epuise: le recours est le meme.
    expect(shouldFailover({ status: 401 })).toBe(true);
    expect(shouldFailover(new Error("API key not valid"))).toBe(true);
  });

  it("ne bascule PAS sur une erreur de requete", () => {
    // Basculer ne reparerait rien et masquerait un vrai defaut.
    expect(isAiCapacityError(new Error("Invalid JSON payload"))).toBe(false);
    expect(shouldFailover(new Error("Invalid JSON payload"))).toBe(false);
    expect(shouldFailover({ status: 400 })).toBe(false);
  });
});

describe("ordre des fournisseurs", () => {
  it("essaie Gemini, puis Anthropic, puis OpenAI par defaut", () => {
    expect(providerOrder()).toEqual(["gemini", "anthropic", "openai"]);
  });

  it("se laisse reordonner sans redeploiement", () => {
    process.env.AI_PROVIDER_ORDER = "anthropic,gemini";
    expect(providerOrder()).toEqual(["anthropic", "gemini", "openai"]);
  });

  it("garde en secours les fournisseurs omis", () => {
    // Une liste incomplete ne doit pas priver l'application d'un recours
    // disponible: OpenAI reste en dernier plutot que d'etre exclu.
    process.env.AI_PROVIDER_ORDER = "anthropic";
    expect(providerOrder()).toEqual(["anthropic", "gemini", "openai"]);
  });

  it("ignore une valeur incomprehensible", () => {
    process.env.AI_PROVIDER_ORDER = "mistral,llama";
    expect(providerOrder()).toEqual(["gemini", "anthropic", "openai"]);
  });
});

describe("conversion des invites", () => {
  it("traduit la forme Gemini vers une forme portable", () => {
    expect(
      fromGeminiContents([
        { role: "user", parts: [{ text: "bonjour" }] },
        { role: "model", parts: [{ text: "salut" }] },
      ]),
    ).toEqual([
      { role: "user", text: "bonjour" },
      { role: "assistant", text: "salut" },
    ]);
  });

  it("retire les blocs de code autour du JSON", () => {
    // Gemini respecte `responseMimeType`; les autres encadrent volontiers. Sans
    // ce nettoyage, le JSON ne serait invalide qu'en repli — donc au pire
    // moment, et seulement pendant une panne.
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("bascule effective", () => {
  const opts = { orgId: null, prompt: "Bonjour", route: "/test" } as const;

  it("passe a Anthropic quand Gemini n'a plus de credit", async () => {
    geminiCall.mockRejectedValue(CREDITS_DEPLETED);
    anthropicCall.mockResolvedValue({
      content: [{ type: "text", text: "reponse de secours" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const res = await generateText({ ...opts });

    expect(res.provider).toBe("anthropic");
    expect(res.text).toBe("reponse de secours");
    expect(geminiCall).toHaveBeenCalledTimes(1);
    // Immediat: on ne rejoue pas le fournisseur epuise.
    expect(openaiCall).not.toHaveBeenCalled();
  });

  it("va jusqu'a OpenAI si les deux premiers sont indisponibles", async () => {
    geminiCall.mockRejectedValue(CREDITS_DEPLETED);
    anthropicCall.mockRejectedValue(Object.assign(new Error("overloaded"), { status: 529 }));
    openaiCall.mockResolvedValue({
      choices: [{ message: { content: "troisieme fournisseur" } }],
      usage: { prompt_tokens: 8, completion_tokens: 4 },
    });

    const res = await generateText({ ...opts });

    expect(res.provider).toBe("openai");
    expect(res.text).toBe("troisieme fournisseur");
  });

  it("n'appelle personne d'autre quand le premier repond", async () => {
    geminiCall.mockResolvedValue({ text: "reponse directe" });

    const res = await generateText({ ...opts });

    expect(res.provider).toBe("gemini");
    expect(anthropicCall).not.toHaveBeenCalled();
    expect(openaiCall).not.toHaveBeenCalled();
  });

  it("traite une reponse vide comme un echec du fournisseur", async () => {
    // Rendre une chaine vide a l'appelant reviendrait a annoncer un succes
    // qui casse en aval, la ou un autre fournisseur aurait pu repondre.
    geminiCall.mockResolvedValue({ text: "   " });
    anthropicCall.mockResolvedValue({
      content: [{ type: "text", text: "vraie reponse" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const res = await generateText({ ...opts });
    expect(res.provider).toBe("anthropic");
  });

  it("remonte une erreur de requete sans essayer les autres", async () => {
    geminiCall.mockRejectedValue(new Error("Invalid JSON payload received"));

    await expect(generateText({ ...opts })).rejects.toThrow(/Invalid JSON payload/);
    expect(anthropicCall).not.toHaveBeenCalled();
  });

  it("sert une reponse a la forme Gemini quand le client partage bascule", async () => {
    /**
     * Une soixantaine de sites appellent directement le client Gemini partage
     * et lisent `response.text`, `usageMetadata` et le modele marque. Le repli
     * de fournisseur est pose sur ce client (comme le repli de modele l'etait
     * deja), donc la reponse de secours doit se faire passer pour une reponse
     * Gemini — sinon la bascule casserait chez chaque appelant.
     */
    anthropicCall.mockResolvedValue({
      content: [{ type: "text", text: "reponse compatible" }],
      usage: { input_tokens: 12, output_tokens: 7 },
    });

    const res = await generateContentFallback({
      model: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ text: "bonjour" }] }],
    });

    expect(res.text).toBe("reponse compatible");
    expect(res.usageMetadata.promptTokenCount).toBe(12);
    expect(res.usageMetadata.candidatesTokenCount).toBe(7);
    expect(res.usageMetadata.totalTokenCount).toBe(19);
  });

  it("marque le fournisseur reel pour que la consommation soit bien attribuee", async () => {
    // Les appelants passent encore `provider: "gemini"` sans savoir qu'une
    // bascule a eu lieu. C'est ce prefixe que recordAiUsage lit pour porter la
    // consommation au bon compte; sans lui, la depense d'un fournisseur serait
    // facturee a un autre.
    anthropicCall.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const res = await generateContentFallback({
      model: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ text: "x" }] }],
    });

    const tag = res[Symbol.for("workspace.geminiActualModel")];
    expect(tag).toMatch(/^anthropic:/);
  });

  it("ne rappelle pas Gemini dans le repli", async () => {
    // Gemini vient d'echouer: le reessayer ferait patienter pour rien.
    anthropicCall.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await generateContentFallback({
      model: "gemini-flash-latest",
      contents: [{ role: "user", parts: [{ text: "x" }] }],
    });

    expect(geminiCall).not.toHaveBeenCalled();
  });

  it("cesse de rappeler un fournisseur durablement en panne", async () => {
    /**
     * Sans cela, chaque appel repayait un aller-retour vers un compte dont on
     * savait deja qu'il etait vide: environ une seconde perdue par reponse,
     * mesuree en production, pour un refus certain.
     *
     * Le module garde son etat entre les tests: on le recharge pour partir
     * d'une ardoise propre (meme raison que dans cron-registry-sequential).
     */
    vi.resetModules();
    const fresh = await import("../services/ai-failover");

    geminiCall.mockRejectedValue(CREDITS_DEPLETED);
    anthropicCall.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    // Trois echecs installent la panne.
    for (let i = 0; i < 3; i++) {
      await fresh.generateText({ orgId: null, prompt: "x", route: "/t" });
    }
    const appelsApres3 = geminiCall.mock.calls.length;
    expect(appelsApres3).toBe(3);

    expect(fresh.providerHealth().find((p) => p.provider === "gemini")?.tripped).toBe(true);

    // Les appels suivants ne le sollicitent plus en premier.
    await fresh.generateText({ orgId: null, prompt: "x", route: "/t" });
    await fresh.generateText({ orgId: null, prompt: "x", route: "/t" });
    expect(
      geminiCall.mock.calls.length,
      "le fournisseur en panne est encore appele a chaque requete",
    ).toBe(appelsApres3);
  });

  it("garde le fournisseur ecarte en dernier recours, sans le retirer", async () => {
    // S'il etait retire, une panne simultanee des trois ne laisserait personne
    // a appeler — alors que l'un d'eux est peut-etre revenu entre-temps.
    vi.resetModules();
    const fresh = await import("../services/ai-failover");

    geminiCall.mockRejectedValue(CREDITS_DEPLETED);
    anthropicCall.mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    openaiCall.mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));

    for (let i = 0; i < 3; i++) {
      await expect(fresh.generateText({ orgId: null, prompt: "x", route: "/t" })).rejects.toThrow();
    }

    // Tous ecartes. Gemini revient: il doit quand meme etre essaye.
    geminiCall.mockResolvedValue({ text: "revenu" });
    const res = await fresh.generateText({ orgId: null, prompt: "x", route: "/t" });
    expect(res.text).toBe("revenu");
  });

  it("dit ce qui a echoue quand plus personne ne repond", async () => {
    geminiCall.mockRejectedValue(CREDITS_DEPLETED);
    anthropicCall.mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    openaiCall.mockRejectedValue(Object.assign(new Error("rate limit"), { status: 429 }));

    await expect(generateText({ ...opts })).rejects.toThrow(/Tous les fournisseurs IA sont indisponibles/);
  });
});
