import Anthropic from "@anthropic-ai/sdk";

let _anthropic: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const proxyBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    const proxyKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    const directKey = process.env.ANTHROPIC_API_KEY;

    const usingProxy = Boolean(proxyBase && proxyKey);
    const apiKey = usingProxy ? proxyKey! : directKey || proxyKey;

    if (!apiKey) {
      throw new Error(
        "Anthropic API key missing. Set ANTHROPIC_API_KEY (or AI_INTEGRATIONS_ANTHROPIC_API_KEY when using the Replit AI proxy).",
      );
    }

    _anthropic = new Anthropic({
      apiKey,
      ...(usingProxy ? { baseURL: proxyBase } : {}),
    });
  }
  return _anthropic;
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
