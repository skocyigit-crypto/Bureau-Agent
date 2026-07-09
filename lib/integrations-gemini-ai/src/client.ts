import { GoogleGenAI } from "@google/genai";

function resolveKeys() {
  const proxyBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const proxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const directKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return { proxyBase, proxyKey, directKey };
}

// Construction paresseuse (au premier usage, pas a l'import du module) —
// aligne ce client sur `getOpenAI()`/`getAnthropic()` dans les packages
// soeurs. Avant, ce module jetait de facon synchrone a l'IMPORT si
// GEMINI_API_KEY etait absent, ce qui pouvait faire crasher tout le
// processus au demarrage (ou tout module importé transitivement) meme
// pour un deploiement qui n'utilise pas Gemini ; les deux autres
// fournisseurs echouent seulement au premier appel reel.
let _ai: GoogleGenAI | null = null;

export function getGeminiAi(): GoogleGenAI {
  if (!_ai) {
    const { proxyBase, proxyKey, directKey } = resolveKeys();
    if (!proxyKey && !directKey) {
      throw new Error(
        "Gemini API key missing. Set GEMINI_API_KEY (or AI_INTEGRATIONS_GEMINI_API_KEY when using the Replit AI proxy).",
      );
    }
    const usingProxy = Boolean(proxyBase && proxyKey);
    _ai = new GoogleGenAI(
      usingProxy
        ? {
            apiKey: proxyKey!,
            httpOptions: {
              apiVersion: "",
              baseUrl: proxyBase!,
            },
          }
        : {
            apiKey: (directKey || proxyKey)!,
          },
    );
  }
  return _ai;
}

export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    return (getGeminiAi() as any)[prop];
  },
});

// Client dédié aux EMBEDDINGS. Le proxy IA Replit n'expose pas l'endpoint
// d'embeddings (`:batchEmbedContents` -> INVALID_ENDPOINT), on cible donc
// l'API Google directe avec une clé API. Si seule la clé proxy est présente,
// on retombe sur `ai` (les appels d'embedding échoueront alors explicitement,
// ce qui est préférable à un silence). Nécessite GEMINI_API_KEY pour les
// embeddings.
let _embeddingAi: GoogleGenAI | null = null;

export function getGeminiEmbeddingAi(): GoogleGenAI {
  if (!_embeddingAi) {
    const { directKey } = resolveKeys();
    _embeddingAi = directKey ? new GoogleGenAI({ apiKey: directKey }) : getGeminiAi();
  }
  return _embeddingAi;
}

export const embeddingAi = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    return (getGeminiEmbeddingAi() as any)[prop];
  },
});

// Fabrique BYOK : construit un client Gemini avec la cle API d'une organisation
// (API Google directe, sans le proxy IA Replit). Utilise par le resolver
// per-org cote serveur quand un client a configure sa propre cle.
export function createGeminiClient(apiKey: string): GoogleGenAI {
  if (!apiKey) throw new Error("createGeminiClient: apiKey requis.");
  return new GoogleGenAI({ apiKey });
}
