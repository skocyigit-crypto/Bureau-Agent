/**
 * Generation de texte avec bascule automatique entre fournisseurs.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * Le 1er septembre 2026, toute l'IA de l'application s'est arretee. La cause
 * n'etait pas un bug: les credits prepayes du compte Gemini etaient epuises,
 * et l'API repondait `429 RESOURCE_EXHAUSTED`. Trois fournisseurs etaient
 * pourtant configures en production — Gemini, Anthropic, OpenAI — mais chaque
 * appel partait directement sur Gemini, sans recours. Le probleme de
 * facturation d'un fournisseur a donc coupe la totalite des fonctions IA.
 *
 * Deux defauts se combinaient:
 *
 *   1. Le helper `aiGenerate` etait recopie a l'identique dans cinq fichiers,
 *      chacun appelant Gemini en dur. Aucun endroit ou ajouter un recours.
 *   2. `isAiAuthKeyError` ne reconnaissait que les erreurs d'AUTHENTIFICATION
 *      (401/403, cle invalide). Un credit epuise (429) ou un fournisseur
 *      surcharge (503) n'etait pas vu comme une raison de basculer.
 *
 * CE QUE FAIT CE MODULE
 *
 * Un seul point de passage, qui essaie les fournisseurs dans l'ordre et passe
 * au suivant des que l'un ne peut pas servir. La bascule est immediate: aucun
 * delai d'attente, aucune reprise sur le meme fournisseur — quand un compte
 * n'a plus de credit, reessayer ne sert a rien et fait patienter l'utilisateur
 * pour rien.
 *
 * CE QU'IL NE FAIT PAS
 *
 * Il ne masque que l'indisponibilite d'un fournisseur. Une erreur de requete
 * (prompt malforme, modele inexistant) remonte telle quelle: basculer
 * n'aiderait pas, et avaler l'erreur cacherait un vrai defaut.
 */
import { logger } from "../lib/logger";
import { assertAiQuota, invalidateQuotaCache } from "./ai-quota";
import {
  recordAiUsage,
  extractGeminiTokens,
  extractAnthropicTokens,
  extractOpenAITokens,
  geminiActualModel,
  GEMINI_FLASH_MODEL,
  ANTHROPIC_MODEL,
} from "./ai-utils";
import { isAiAuthKeyError } from "./ai-providers";

export type AiProviderName = "gemini" | "anthropic" | "openai";

const DEFAULT_ORDER: AiProviderName[] = ["gemini", "anthropic", "openai"];

/**
 * Ordre d'essai des fournisseurs, surchargeable sans redeployer le code
 * (`AI_PROVIDER_ORDER=anthropic,gemini`). Utile quand on sait qu'un
 * fournisseur restera indisponible plusieurs jours: le mettre en dernier
 * evite de payer un aller-retour perdu a chaque appel.
 */
export function providerOrder(): AiProviderName[] {
  const raw = process.env.AI_PROVIDER_ORDER;
  if (!raw) return DEFAULT_ORDER;
  const parsed = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is AiProviderName => p === "gemini" || p === "anthropic" || p === "openai");
  // Les fournisseurs omis restent en secours, apres ceux demandes: une liste
  // incomplete ne doit pas priver l'application d'un recours disponible.
  const rest = DEFAULT_ORDER.filter((p) => !parsed.includes(p));
  return parsed.length > 0 ? [...parsed, ...rest] : DEFAULT_ORDER;
}

/**
 * Le fournisseur ne peut pas servir maintenant: quota, credits epuises,
 * surcharge. Contrairement a une erreur de requete, un autre fournisseur a
 * toutes les chances de repondre.
 */
export function isAiCapacityError(err: any): boolean {
  const status = Number(
    err?.status ?? err?.statusCode ?? err?.response?.status ?? err?.error?.status ?? err?.error?.code,
  );
  if (status === 429 || status === 503 || status === 529) return true;
  const msg = String(err?.message ?? err?.error?.message ?? "").toLowerCase();
  return (
    msg.includes("resource_exhausted") ||
    msg.includes("credits are depleted") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("capacity") ||
    msg.includes("billing")
  );
}

/**
 * Le fournisseur a repondu, mais sans contenu exploitable.
 *
 * Traite comme une indisponibilite: rendre une chaine vide a l'appelant
 * reviendrait a annoncer un succes qui casse plus loin, alors qu'un autre
 * fournisseur aurait pu repondre.
 */
class EmptyResponseError extends Error {}

/** Raison suffisante pour essayer le fournisseur suivant. */
export function shouldFailover(err: any): boolean {
  return err instanceof EmptyResponseError || isAiCapacityError(err) || isAiAuthKeyError(err);
}

/** Message normalise, independant du fournisseur. */
interface PortableMessage {
  role: "user" | "assistant";
  text: string;
}

/** Convertit la forme Gemini (`contents`) vers la forme portable. */
export function fromGeminiContents(contents: any[]): PortableMessage[] {
  if (!Array.isArray(contents)) return [];
  return contents
    .map((c) => ({
      role: (c?.role === "model" ? "assistant" : "user") as "user" | "assistant",
      text: Array.isArray(c?.parts)
        ? c.parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("\n").trim()
        : "",
    }))
    .filter((m) => m.text.length > 0);
}

/**
 * Retire les cloture de bloc de code d'une reponse JSON.
 *
 * Gemini respecte `responseMimeType: application/json`; les deux autres ne
 * l'ont pas et encadrent volontiers le JSON de ```json. Sans ce nettoyage,
 * l'appelant recevrait du JSON invalide uniquement lors d'une bascule — une
 * panne qui n'apparaitrait qu'en secours, donc au pire moment.
 */
export function stripCodeFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export interface GenerateOptions {
  /**
   * Organisation appelante, ou `null` pour les surfaces publiques (la demo du
   * site vitrine) qui n'appartiennent a aucun client: il n'y a alors ni quota
   * a decompter ni usage a facturer, seulement la bascule a assurer.
   */
  orgId: number | null;
  /** Invite simple; ignore si `contents` est fourni. */
  prompt?: string;
  /** Forme Gemini, pour les appelants qui construisent un dialogue. */
  contents?: any[];
  /** Config Gemini (responseMimeType, temperature, maxOutputTokens...). */
  config?: Record<string, any>;
  /** Modele Gemini souhaite. Les autres fournisseurs utilisent le leur. */
  model?: string;
  /** Chemin enregistre dans les statistiques d'usage. */
  route: string;
}

export interface GenerateResult {
  text: string;
  provider: AiProviderName;
  model: string;
}

async function callGemini(opts: GenerateOptions, messages: PortableMessage[]): Promise<GenerateResult & { tokens: { input: number; output: number } }> {
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = opts.model ?? GEMINI_FLASH_MODEL;
  const contents = opts.contents ?? messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
  const response = await ai.models.generateContent({
    model,
    contents,
    ...(opts.config ? { config: opts.config } : {}),
  });
  const tokens = extractGeminiTokens(response);
  return {
    text: response.text ?? "",
    provider: "gemini",
    model: geminiActualModel(response, model),
    tokens,
  };
}

async function callAnthropic(opts: GenerateOptions, messages: PortableMessage[]): Promise<GenerateResult & { tokens: { input: number; output: number } }> {
  const { anthropic, resolveClaudeModelId } = await import("@workspace/integrations-anthropic-ai");
  const model = resolveClaudeModelId(ANTHROPIC_MODEL);
  const wantsJson = opts.config?.responseMimeType === "application/json";
  // Anthropic n'a pas d'equivalent de `responseMimeType`: on le demande dans
  // l'invite, et `stripCodeFences` rattrape le cas ou il encadre quand meme.
  const withJsonHint = wantsJson
    ? messages.map((m, i) =>
        i === messages.length - 1 ? { ...m, text: `${m.text}\n\nReponds UNIQUEMENT avec le JSON demande, sans texte autour ni bloc de code.` } : m,
      )
    : messages;
  const message = await anthropic.messages.create({
    model,
    max_tokens: Number(opts.config?.maxOutputTokens) || 4096,
    ...(opts.config?.temperature != null ? { temperature: Number(opts.config.temperature) } : {}),
    messages: withJsonHint.map((m) => ({ role: m.role, content: m.text })),
  });
  const block = (message as any)?.content?.[0];
  const raw = block?.type === "text" ? String(block.text ?? "") : "";
  const tokens = extractAnthropicTokens(message);
  return { text: wantsJson ? stripCodeFences(raw) : raw, provider: "anthropic", model, tokens };
}

async function callOpenAI(opts: GenerateOptions, messages: PortableMessage[]): Promise<GenerateResult & { tokens: { input: number; output: number } }> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const wantsJson = opts.config?.responseMimeType === "application/json";
  const response = await openai.chat.completions.create({
    model,
    ...(opts.config?.maxOutputTokens ? { max_completion_tokens: Number(opts.config.maxOutputTokens) } : {}),
    ...(wantsJson ? { response_format: { type: "json_object" as const } } : {}),
    messages: messages.map((m) => ({ role: m.role, content: m.text })),
  });
  const raw = String(response.choices?.[0]?.message?.content ?? "");
  const tokens = extractOpenAITokens(response);
  return { text: wantsJson ? stripCodeFences(raw) : raw, provider: "openai", model, tokens };
}

const CALLERS: Record<AiProviderName, (o: GenerateOptions, m: PortableMessage[]) => Promise<GenerateResult & { tokens: { input: number; output: number } }>> = {
  gemini: callGemini,
  anthropic: callAnthropic,
  openai: callOpenAI,
};

/**
 * Genere du texte en essayant les fournisseurs dans l'ordre.
 *
 * Le quota interne de l'organisation est verifie UNE fois, avant tout appel:
 * il compte des requetes facturees au client, pas des tentatives techniques.
 * Une bascule ne doit pas lui couter deux unites.
 */
export async function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  if (opts.orgId != null) await assertAiQuota(opts.orgId);

  const messages = opts.contents
    ? fromGeminiContents(opts.contents)
    : [{ role: "user" as const, text: String(opts.prompt ?? "") }];

  if (messages.length === 0) {
    throw new Error("generateText: aucune invite fournie.");
  }

  const order = providerOrder();
  const failures: string[] = [];

  for (const name of order) {
    const t0 = Date.now();
    try {
      const res = await CALLERS[name](opts, messages);
      if (!res.text.trim()) {
        throw new EmptyResponseError(`${name}: reponse vide`);
      }
      if (opts.orgId != null) {
        recordAiUsage({
        organisationId: opts.orgId,
        provider: res.provider,
        model: res.model,
        route: opts.route,
        inputTokens: res.tokens.input,
        outputTokens: res.tokens.output,
        durationMs: Date.now() - t0,
        }).catch(() => {});
        invalidateQuotaCache(opts.orgId);
      }
      if (name !== order[0]) {
        logger.warn(
          { route: opts.route, provider: name, apres: failures.join(" | ") },
          "[ai-failover] repli sur un autre fournisseur",
        );
      }
      return { text: res.text, provider: res.provider, model: res.model };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (!shouldFailover(err)) {
        // Erreur de requete: basculer n'aiderait pas et masquerait le defaut.
        throw err;
      }
      failures.push(`${name}: ${msg.slice(0, 160)}`);
      logger.warn({ route: opts.route, provider: name, err: msg.slice(0, 200) }, "[ai-failover] fournisseur indisponible");
    }
  }

  throw new Error(`Tous les fournisseurs IA sont indisponibles — ${failures.join(" | ")}`);
}

/** Cle utilisee par `geminiActualModel` pour lire le modele reellement servi. */
const ACTUAL_MODEL_KEY = Symbol.for("workspace.geminiActualModel");

/**
 * Repond a un appel `ai.models.generateContent` avec un AUTRE fournisseur,
 * dans la forme d'une reponse Gemini.
 *
 * Pourquoi cette forme: une soixantaine de sites appellent directement le
 * client Gemini partage et lisent `response.text`, `usageMetadata` et le
 * modele marque. Les reecrire un par un serait long et risque; le depot a
 * deja choisi l'autre voie — patcher le client une fois au demarrage pour que
 * tous en heritent (cf. `installGeminiModelFallback`). Cette fonction fournit
 * la reponse de secours a ce patch.
 *
 * Le modele est prefixe par le fournisseur (`anthropic:claude-...`) pour que
 * `recordAiUsage` attribue la consommation au bon compte: les appelants, eux,
 * passent toujours `provider: "gemini"` sans savoir qu'une bascule a eu lieu.
 */
export async function generateContentFallback(params: any): Promise<any> {
  const messages = fromGeminiContents(params?.contents ?? []);
  if (messages.length === 0) throw new Error("generateContentFallback: contenu vide");

  const opts: GenerateOptions = {
    orgId: null, // l'usage est enregistre par l'appelant, pas ici
    config: params?.config,
    model: params?.model,
    route: "gemini-compat",
  };

  const failures: string[] = [];
  for (const name of providerOrder()) {
    if (name === "gemini") continue; // c'est lui qui vient d'echouer
    try {
      const res = await CALLERS[name](opts, messages);
      if (!res.text.trim()) throw new EmptyResponseError(`${name}: reponse vide`);
      logger.warn({ provider: name, apres: failures.join(" | ") }, "[ai-failover] reponse servie par un autre fournisseur");
      const shaped: any = {
        text: res.text,
        usageMetadata: {
          promptTokenCount: res.tokens.input,
          candidatesTokenCount: res.tokens.output,
          totalTokenCount: res.tokens.input + res.tokens.output,
        },
      };
      shaped[ACTUAL_MODEL_KEY] = `${res.provider}:${res.model}`;
      return shaped;
    } catch (err: any) {
      if (!shouldFailover(err)) throw err;
      failures.push(`${name}: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }

  throw new Error(`Aucun fournisseur de secours disponible — ${failures.join(" | ")}`);
}
