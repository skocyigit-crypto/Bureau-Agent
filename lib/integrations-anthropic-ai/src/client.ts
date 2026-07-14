import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

let _anthropic: Anthropic | null = null;

// Vertex AI expose Claude via le meme contrat `.messages.create()` que
// l'API Anthropic directe (AnthropicVertex est concu comme un remplacement
// direct) — les deux types sont donc utilisables de facon interchangeable
// par tous les appelants existants.
type AnthropicLike = Anthropic | AnthropicVertex;

/**
 * Mode Vertex AI (pas de cle Anthropic separee — utilise les Application
 * Default Credentials du projet GCP courant, memes credentials que Cloud
 * SQL/Secret Manager). Choisi quand ANTHROPIC_VERTEX_PROJECT_ID est defini.
 *
 * Prerequis manuel (non automatisable): les modeles Claude doivent d'abord
 * etre actives dans Vertex AI Model Garden (acceptation des conditions
 * Anthropic), console.cloud.google.com/vertex-ai/model-garden -> chercher
 * "Claude" -> Enable, pour chaque modele voulu.
 */
function isVertexConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_VERTEX_PROJECT_ID);
}

export function getAnthropic(): AnthropicLike {
  if (!_anthropic) {
    if (isVertexConfigured()) {
      _anthropic = new AnthropicVertex({
        projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
        region: process.env.ANTHROPIC_VERTEX_REGION || "us-east5",
      }) as unknown as Anthropic;
      return _anthropic;
    }

    const proxyBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    const proxyKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    const directKey = process.env.ANTHROPIC_API_KEY;

    const usingProxy = Boolean(proxyBase && proxyKey);
    const apiKey = usingProxy ? proxyKey! : directKey || proxyKey;

    if (!apiKey) {
      throw new Error(
        "Anthropic API key missing. Set ANTHROPIC_API_KEY (or AI_INTEGRATIONS_ANTHROPIC_API_KEY when using the Replit AI proxy, or ANTHROPIC_VERTEX_PROJECT_ID to use Vertex AI instead).",
      );
    }

    _anthropic = new Anthropic({
      apiKey,
      ...(usingProxy ? { baseURL: proxyBase } : {}),
    });
  }
  return _anthropic;
}

// Verifie via la fiche modele reelle dans Vertex AI Model Garden (console,
// 2026-07-14): l'ID de modele Vertex utilise le MEME format a tirets que
// l'API Anthropic directe (ex: "claude-opus-4-8", pas "claude-opus-4.8" —
// une hypothese initiale basee sur une recherche web s'est averee fausse).
// Donc pas de conversion de format necessaire. Seul cas reel a corriger:
// les alias "-latest" (ex: "claude-3-5-haiku-latest"), que Vertex n'accepte
// pas — il faut un identifiant de version explicite.
const VERTEX_MODEL_MAP: Record<string, string> = {
  "claude-3-5-haiku-latest": "claude-haiku-4-5",
};

export function resolveClaudeModelId(model: string): string {
  if (!isVertexConfigured()) return model;
  return VERTEX_MODEL_MAP[model] ?? model;
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    return (getAnthropic() as any)[prop];
  },
});

// Fabrique BYOK : construit un client Anthropic avec la cle API d'une
// organisation (API Anthropic directe, sans le proxy IA Replit).
export function createAnthropicClient(apiKey: string): Anthropic {
  if (!apiKey) throw new Error("createAnthropicClient: apiKey requis.");
  return new Anthropic({ apiKey });
}
