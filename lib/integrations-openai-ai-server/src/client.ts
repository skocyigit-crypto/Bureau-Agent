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
