import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Le client rendu a l'appelant porte-t-il la cle du bon payeur ?
 *
 * C'est le point exact ou la fonction « apportez votre cle » etait rompue: la
 * politique pouvait bien designer l'organisation, si le module qui construit le
 * client ne recevait pas ce verdict, l'appel repartait sur le singleton de la
 * plateforme. Ces tests verifient le passage de relais, pas le reseau.
 */

const resolveAiAccess = vi.fn();
const getOrgGeminiClient = vi.fn();
const getOrgEmbeddingClient = vi.fn();
const callOrgGemini = vi.fn();

vi.mock("../services/ai-key-policy", () => ({
  resolveAiAccess: (...a: any[]) => resolveAiAccess(...a),
}));
vi.mock("../services/ai-providers", () => ({
  getOrgGeminiClient: (...a: any[]) => getOrgGeminiClient(...a),
  getOrgEmbeddingClient: (...a: any[]) => getOrgEmbeddingClient(...a),
  getOrgOpenAIClient: vi.fn(),
  getOrgAnthropicClient: vi.fn(),
  callOrgGemini: (...a: any[]) => callOrgGemini(...a),
  callOrgEmbedding: vi.fn(),
}));

const { aiForOrg, embeddingAiForOrg, callAiForOrg } = await import("../services/ai-client");

beforeEach(() => {
  resolveAiAccess.mockReset();
  getOrgGeminiClient.mockReset().mockResolvedValue({ tag: "client" });
  getOrgEmbeddingClient.mockReset().mockResolvedValue({ tag: "embed" });
  callOrgGemini.mockReset().mockResolvedValue("resultat");
});

describe("aiForOrg", () => {
  it("construit le client avec l'organisation designee comme payeur", async () => {
    resolveAiAccess.mockResolvedValue({ source: "own", payerOrgId: 42, providers: { gemini: true } });
    await aiForOrg(42);
    expect(getOrgGeminiClient).toHaveBeenCalledWith(42);
  });

  it("passe null — pas l'orgId — quand c'est la plateforme qui paie", async () => {
    // Le piege: transmettre `orgId` ici ferait silencieusement utiliser la cle
    // du client alors que la politique a decide l'inverse (ou l'inverse).
    resolveAiAccess.mockResolvedValue({ source: "platform", payerOrgId: null, providers: {} });
    await aiForOrg(42);
    expect(getOrgGeminiClient).toHaveBeenCalledWith(null);
  });

  it("ne construit aucun client quand la politique refuse", async () => {
    const refus = Object.assign(new Error("cle requise"), { status: 402 });
    resolveAiAccess.mockRejectedValue(refus);
    await expect(aiForOrg(42)).rejects.toThrow("cle requise");
    expect(getOrgGeminiClient).not.toHaveBeenCalled();
  });

  it("demande la politique a chaque appel: une cle ajoutee ne doit pas attendre un redemarrage", async () => {
    resolveAiAccess.mockResolvedValue({ source: "platform", payerOrgId: null, providers: {} });
    await aiForOrg(42);
    resolveAiAccess.mockResolvedValue({ source: "own", payerOrgId: 42, providers: { gemini: true } });
    await aiForOrg(42);
    expect(getOrgGeminiClient).toHaveBeenNthCalledWith(1, null);
    expect(getOrgGeminiClient).toHaveBeenNthCalledWith(2, 42);
  });
});

describe("embeddingAiForOrg", () => {
  it("suit la meme regle que le client de generation", async () => {
    resolveAiAccess.mockResolvedValue({ source: "own", payerOrgId: 7, providers: { gemini: true } });
    await embeddingAiForOrg(7);
    expect(getOrgEmbeddingClient).toHaveBeenCalledWith(7);
  });
});

describe("callAiForOrg", () => {
  it("delegue au chemin qui rejoue sur la plateforme si la cle du client est revoquee", async () => {
    resolveAiAccess.mockResolvedValue({ source: "own", payerOrgId: 42, providers: { gemini: true } });
    const fn = vi.fn();
    await expect(callAiForOrg(42, fn)).resolves.toBe("resultat");
    expect(callOrgGemini).toHaveBeenCalledWith(42, fn);
  });
});
