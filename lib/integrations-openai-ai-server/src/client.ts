import OpenAI from "openai";

let _openai: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_openai) {
    const proxyBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const proxyKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const directKey = process.env.OPENAI_API_KEY;

    const usingProxy = Boolean(proxyBase && proxyKey);
    const apiKey = usingProxy ? proxyKey! : directKey || proxyKey;

    if (!apiKey) {
      throw new Error(
        "OpenAI API key missing. Set OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY when using the Replit AI proxy).",
      );
    }

    _openai = new OpenAI({
      apiKey,
      ...(usingProxy ? { baseURL: proxyBase } : {}),
    });
  }
  return _openai;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (getOpenAI() as any)[prop];
  },
});

// Fabrique BYOK : construit un client OpenAI avec la cle API d'une organisation
// (API OpenAI directe api.openai.com, sans le proxy IA Replit / sans baseURL).
export function createOpenAIClient(apiKey: string): OpenAI {
  if (!apiKey) throw new Error("createOpenAIClient: apiKey requis.");
  return new OpenAI({ apiKey });
}
