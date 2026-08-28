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
 * SQL/Secret Manager). Disponible des que ANTHROPIC_VERTEX_PROJECT_ID est
 * defini, mais ce n'est pas seul ce qui decide: voir `getAnthropicMode()`, ou
 * une cle API directe est prioritaire.
 *
 * Prerequis manuel (non automatisable): les modeles Claude doivent d'abord
 * etre actives dans Vertex AI Model Garden (acceptation des conditions
 * Anthropic), console.cloud.google.com/vertex-ai/model-garden -> chercher
 * "Claude" -> Enable, pour chaque modele voulu.
 */
function isVertexConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_VERTEX_PROJECT_ID);
}

function isProxyConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  );
}

export type AnthropicMode = "vertex" | "proxy" | "direct" | "none";

/**
 * Voie de credentials effectivement utilisee, resolue a chaud (aucun cache) —
 * c'est la meme fonction qui pilote `getAnthropic()` et qui alimente
 * `/api/ai/status`, pour que le diagnostic affiche ne puisse pas diverger de
 * ce que le client fait reellement.
 *
 * ORDRE DE PRIORITE — la cle directe passe AVANT Vertex.
 *
 * Vertex etait prioritaire, et c'etait un piege: sur ce projet, Vertex est
 * configure mais inutilisable (Sonnet 4.6 renvoie 404 "not found or your
 * project does not have access", Opus 4.8 renvoie 429 "Quota exceeded ...
 * base model: anthropic-claude-opus-4-8" — quota par defaut a zero). Comme
 * Vertex gagnait, definir ANTHROPIC_API_KEY ne changeait rien: il n'existait
 * aucun moyen de contourner un Vertex mort sans supprimer la variable Vertex.
 *
 * Desormais: une cle API explicitement fournie l'emporte, Vertex reste le mode
 * par defaut quand aucune cle n'est definie (voie GCP sans compte Anthropic).
 * `ANTHROPIC_PROVIDER=vertex|proxy|direct` force le choix si besoin.
 */
export function getAnthropicMode(): AnthropicMode {
  const forced = process.env.ANTHROPIC_PROVIDER?.trim().toLowerCase();
  if (forced === "vertex") return isVertexConfigured() ? "vertex" : "none";
  if (forced === "proxy") return isProxyConfigured() ? "proxy" : "none";
  if (forced === "direct") {
    return process.env.ANTHROPIC_API_KEY ? "direct" : "none";
  }

  if (process.env.ANTHROPIC_API_KEY) return "direct";
  if (isProxyConfigured()) return "proxy";
  if (isVertexConfigured()) return "vertex";
  return "none";
}

export function getAnthropic(): AnthropicLike {
  if (!_anthropic) {
    const mode = getAnthropicMode();

    if (mode === "vertex") {
      _anthropic = new AnthropicVertex({
        projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
        region: process.env.ANTHROPIC_VERTEX_REGION || "us-east5",
      }) as unknown as Anthropic;
      return _anthropic;
    }

    if (mode === "none") {
      throw new Error(
        "Anthropic credentials missing. Set ANTHROPIC_API_KEY (or AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY for the Replit AI proxy, or ANTHROPIC_VERTEX_PROJECT_ID to use Vertex AI). ANTHROPIC_PROVIDER can force one of vertex|proxy|direct.",
      );
    }

    _anthropic = new Anthropic({
      apiKey:
        mode === "proxy"
          ? process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY!
          : process.env.ANTHROPIC_API_KEY!,
      ...(mode === "proxy"
        ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
        : {}),
    });
  }
  return _anthropic;
}

// Verifie via la fiche modele reelle dans Vertex AI Model Garden (console,
// 2026-07-14): l'ID de modele Vertex utilise le MEME format a tirets que
// l'API Anthropic directe (ex: "claude-opus-4-8", pas "claude-opus-4.8" —
// une hypothese initiale basee sur une recherche web s'est averee fausse).
// Donc pas de conversion de format necessaire.
//
// Deux corrections restent necessaires, dans cet ordre:
//
// 1. Modeles RETIRES (partout, pas seulement sur Vertex). Anthropic a retire
//    Claude 3.5 / 3.7 / 3 Opus le 19/02/2026 : tout appel avec ces IDs renvoie
//    un 404 `not_found_error`, indistinguable cote UI d'une "cle invalide".
//    Le test de cle BYOK pingait justement "claude-3-5-haiku-latest" et
//    declarait donc invalides des cles parfaitement valides. On remappe ces
//    IDs vers leur successeur au lieu de laisser partir un 404.
// 2. Alias "-latest" (specifique Vertex) : Vertex n'accepte pas les alias
//    mouvants, il faut un identifiant de version explicite.
const RETIRED_MODEL_MAP: Record<string, string> = {
  "claude-3-5-haiku-latest": "claude-haiku-4-5",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5",
  "claude-3-5-sonnet-latest": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20240620": "claude-sonnet-4-6",
  "claude-3-7-sonnet-latest": "claude-sonnet-4-6",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4-6",
  "claude-3-opus-latest": "claude-opus-4-8",
  "claude-3-opus-20240229": "claude-opus-4-8",
  "claude-3-sonnet-20240229": "claude-sonnet-4-6",
  "claude-2.1": "claude-sonnet-4-6",
  "claude-2.0": "claude-sonnet-4-6",
};

// Alias mouvants encore servis par l'API directe mais refuses par Vertex.
const VERTEX_MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5-latest": "claude-haiku-4-5",
  "claude-sonnet-4-6-latest": "claude-sonnet-4-6",
  "claude-opus-4-8-latest": "claude-opus-4-8",
};

export function resolveClaudeModelId(model: string): string {
  const live = RETIRED_MODEL_MAP[model] ?? model;
  // On se cale sur le mode EFFECTIF, pas sur la simple presence des variables
  // Vertex: depuis que la cle directe est prioritaire, un projet peut avoir
  // ANTHROPIC_VERTEX_PROJECT_ID defini tout en parlant a l'API directe.
  if (getAnthropicMode() !== "vertex") return live;
  return VERTEX_MODEL_MAP[live] ?? live;
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
