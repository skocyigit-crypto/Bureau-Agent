import { logger } from "../lib/logger";

/**
 * Source de verite unique pour les noms de modeles Gemini par defaut.
 *
 * Google retire regulierement les anciennes versions de modeles ; un nom
 * code en dur a ~30 endroits casse silencieusement (UNSUPPORTED_MODEL) des
 * qu'une version est retiree. Centraliser ici permet de migrer en une ligne
 * (ou via variable d'environnement, sans redeploiement de code).
 *
 * Exceptions intentionnelles laissees telles quelles (modeles specialises
 * qui ne suivent pas ce cycle) :
 *   - `routes/voice-live.ts` : modeles Gemini Live "native-audio" (voix
 *     conversationnelle temps reel), avec leur propre logique de fallback.
 */
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL || "gemini-2.5-pro";

/**
 * Modeles de repli (fallback) utilises automatiquement quand un modele Gemini
 * a ete retire par Google (UNSUPPORTED_MODEL / "not found for API version").
 *
 * On vise par defaut les alias roulants "*-latest" de Google : ils pointent
 * toujours vers la derniere version stable et ne sont donc jamais retires.
 * Surchargeable par variable d'environnement, comme les constantes ci-dessus,
 * pour pouvoir migrer sans redeploiement de code.
 */
export const GEMINI_FLASH_FALLBACK_MODEL =
  process.env.GEMINI_FLASH_FALLBACK_MODEL || "gemini-flash-latest";
export const GEMINI_PRO_FALLBACK_MODEL =
  process.env.GEMINI_PRO_FALLBACK_MODEL || "gemini-pro-latest";

/**
 * Signatures d'erreurs renvoyees par l'API Gemini lorsqu'un nom de modele
 * n'est plus servi (version retiree, modele inconnu pour la version d'API).
 * Volontairement restreint pour ne pas confondre avec d'autres 404/erreurs.
 */
const MODEL_RETIRED_PATTERNS = [
  /UNSUPPORTED_MODEL/i,
  /not found for API version/i,
  /models\/[^\s]+ is not found/i,
  /model[^\n]{0,80}(?:not found|does not exist|is not available|is not supported|deprecated|retired)/i,
];

/** Detecte une erreur de retrait/inexistence de modele Gemini. */
export function isModelRetiredError(err: unknown): boolean {
  const msg =
    (err as any)?.message ||
    (() => {
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    })();
  return MODEL_RETIRED_PATTERNS.some((p) => p.test(msg));
}

/**
 * Renvoie le modele de repli pour un nom de modele Gemini donne, ou `null`
 * s'il n'y a pas de repli pertinent (modele non-Gemini, ou deja un fallback).
 */
export function fallbackGeminiModel(model: string | undefined | null): string | null {
  if (!model) return null;
  // Deja un modele de repli -> ne pas reboucler.
  if (model === GEMINI_PRO_FALLBACK_MODEL || model === GEMINI_FLASH_FALLBACK_MODEL) return null;
  if (model === GEMINI_PRO_MODEL) return GEMINI_PRO_FALLBACK_MODEL;
  if (model === GEMINI_FLASH_MODEL) return GEMINI_FLASH_FALLBACK_MODEL;
  // Heuristique pour les autres noms Gemini codes en dur ailleurs.
  if (/gemini/i.test(model)) {
    if (/flash/i.test(model)) return GEMINI_FLASH_FALLBACK_MODEL;
    if (/pro/i.test(model)) return GEMINI_PRO_FALLBACK_MODEL;
    return GEMINI_PRO_FALLBACK_MODEL;
  }
  return null;
}

/**
 * Evenement emis a chaque fois qu'un repli de modele Gemini se declenche
 * (modele primaire retire -> bascule sur le modele de repli). Sert a alerter
 * un administrateur (cf. `onGeminiModelFallback`).
 */
export interface GeminiFallbackEvent {
  from: string;
  to: string;
  kind: "generate" | "stream";
}

type GeminiFallbackListener = (event: GeminiFallbackEvent) => void;
let geminiFallbackListener: GeminiFallbackListener | null = null;

/**
 * Enregistre un observateur appele a chaque repli de modele Gemini. Permet de
 * decoupler la couche bas-niveau (`ai-utils`, qui ne connait que le logger) du
 * systeme d'alerte admin (suggestion proactive, cote `proactive-engine`), cable
 * au boot dans `index.ts`. Passer `null` pour retirer l'observateur.
 */
export function onGeminiModelFallback(listener: GeminiFallbackListener | null): void {
  geminiFallbackListener = listener;
}

/** Notifie l'observateur sans jamais casser l'appel IA en cas d'erreur. */
function notifyGeminiFallback(from: string, to: string, kind: "generate" | "stream"): void {
  const l = geminiFallbackListener;
  if (!l) return;
  try {
    l({ from, to, kind });
  } catch {
    // observateur defaillant : ne doit jamais impacter la generation.
  }
}

/**
 * Cle (Symbol) utilisee pour marquer une reponse / un chunk Gemini avec le nom
 * du modele qui a *reellement* servi la requete. Quand le repli automatique
 * bascule sur un modele de secours, le site d'appel ne connait que le modele
 * *demande* ; on attache donc le vrai modele a l'objet de reponse pour que la
 * journalisation d'usage (`recordAiUsage`) et l'estimation de cout refletent la
 * realite. Un Symbol est invisible pour `JSON.stringify`/`for..in`, donc il ne
 * pollue pas la serialisation de la reponse.
 */
const GEMINI_ACTUAL_MODEL_KEY = Symbol.for("workspace.geminiActualModel");

/** Marque un objet (reponse ou chunk Gemini) avec le modele reellement utilise. */
function tagActualModel<T>(obj: T, model: string): T {
  if (obj && typeof obj === "object") {
    try {
      (obj as any)[GEMINI_ACTUAL_MODEL_KEY] = model;
    } catch {
      /* objet gele / non extensible : on ignore */
    }
  }
  return obj;
}

/**
 * Renvoie le modele Gemini qui a reellement servi une reponse / un chunk.
 * Si l'objet n'a pas ete marque (aucun repli, ou objet non-objet), on retombe
 * sur `requested` (le modele demande == le modele utilise dans ce cas).
 */
export function geminiActualModel(obj: unknown, requested: string): string {
  const tagged = (obj as any)?.[GEMINI_ACTUAL_MODEL_KEY];
  return typeof tagged === "string" && tagged ? tagged : requested;
}

/** Wrappe un flux Gemini pour marquer chaque chunk avec le modele utilise. */
async function* tagStream(stream: AsyncIterable<any>, model: string): AsyncGenerator<any> {
  for await (const chunk of stream) {
    yield tagActualModel(chunk, model);
  }
}

/**
 * Execute un appel Gemini en reessayant une fois avec un modele de repli si le
 * modele demande a ete retire. `fn` recoit le nom de modele a utiliser. La
 * reponse est marquee avec le modele reellement utilise (voir `geminiActualModel`).
 */
export async function geminiGenerateWithFallback<T>(
  model: string | undefined | null,
  fn: (model: string) => Promise<T>,
): Promise<T> {
  const primary = model || GEMINI_PRO_MODEL;
  try {
    return tagActualModel(await fn(primary), primary);
  } catch (err) {
    const fb = fallbackGeminiModel(primary);
    if (fb && fb !== primary && isModelRetiredError(err)) {
      logger.warn(
        { from: primary, to: fb, err: (err as any)?.message || String(err) },
        "[ai-utils] Modele Gemini retire — nouvelle tentative avec le modele de repli",
      );
      notifyGeminiFallback(primary, fb, "generate");
      return tagActualModel(await fn(fb), fb);
    }
    throw err;
  }
}

let geminiFallbackInstalled = false;

/**
 * Installe (une seule fois) le repli automatique de modele sur le client Gemini
 * partage. En patchant `ai.models.generateContent` / `generateContentStream` au
 * boot, tous les sites d'appel (routes, services, ai-stream, call-processor...)
 * heritent du repli sans modification — un seul correctif couvre tout.
 *
 * Le client `voice-live.ts` cree sa propre instance `GoogleGenAI` (modeles
 * "native-audio" temps reel avec leur propre logique) et n'est donc pas touche.
 */
export async function installGeminiModelFallback(): Promise<void> {
  if (geminiFallbackInstalled) return;
  try {
    const mod: any = await import("@workspace/integrations-gemini-ai");
    const ai: any = mod?.ai;
    const models: any = ai?.models;
    if (!models || typeof models.generateContent !== "function") return;
    geminiFallbackInstalled = true;

    const origGen = models.generateContent.bind(models);
    models.generateContent = (params: any) =>
      geminiGenerateWithFallback(params?.model, (m) => origGen({ ...params, model: m }));

    if (typeof models.generateContentStream === "function") {
      const origStream = models.generateContentStream.bind(models);
      models.generateContentStream = async (params: any) => {
        const model = params?.model;
        const fb = fallbackGeminiModel(model);
        const make = (m: string) => origStream({ ...params, model: m });

        let stream: any;
        try {
          stream = await make(model);
        } catch (err) {
          if (fb && isModelRetiredError(err)) {
            logger.warn(
              { from: model, to: fb },
              "[ai-utils] Modele Gemini retire (stream) — repli sur le modele de fallback",
            );
            notifyGeminiFallback(model, fb, "stream");
            // Le repli a servi la requete : on marque chaque chunk avec `fb`.
            return tagStream(await make(fb), fb);
          }
          throw err;
        }

        if (!fb) return stream;

        // Certaines erreurs de retrait ne se manifestent qu'a la 1re iteration :
        // si rien n'a encore ete emis, on peut encore basculer sans risque.
        return (async function* () {
          const it = stream[Symbol.asyncIterator]();
          let first: IteratorResult<any>;
          try {
            first = await it.next();
          } catch (err) {
            if (isModelRetiredError(err)) {
              logger.warn(
                { from: model, to: fb },
                "[ai-utils] Modele Gemini retire (1er chunk) — repli sur le modele de fallback",
              );
              notifyGeminiFallback(model, fb, "stream");
              yield* tagStream(await make(fb), fb);
              return;
            }
            throw err;
          }
          if (first.done) return;
          yield first.value;
          while (true) {
            const next = await it.next();
            if (next.done) return;
            yield next.value;
          }
        })();
      };
    }

    logger.info("[ai-utils] Repli automatique de modele Gemini installe");
  } catch (err) {
    logger.warn({ err }, "[ai-utils] Installation du repli Gemini impossible");
  }
}

export function safeJsonParse<T>(rawText: string | undefined | null, fallback: T): T {
  if (!rawText) return fallback;
  const text = String(rawText).trim();
  if (!text) return fallback;

  try {
    return JSON.parse(text) as T;
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {}
  }

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch?.[0]) {
    try {
      return JSON.parse(objMatch[0]) as T;
    } catch {}
  }

  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch?.[0]) {
    try {
      return JSON.parse(arrMatch[0]) as T;
    } catch {}
  }

  return fallback;
}

const RETRYABLE_PATTERNS = [
  /rate.?limit/i,
  /timeout/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /503/,
  /502/,
  /504/,
  /overloaded/i,
  /unavailable/i,
  /aborted/i,
];

function isRetryable(err: unknown): boolean {
  const msg = (err as any)?.message || String(err);
  return RETRYABLE_PATTERNS.some((p) => p.test(msg));
}

export interface AiRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

export async function aiCallWithRetry<T>(fn: () => Promise<T>, opts: AiRetryOptions = {}): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 600, maxDelayMs = 4000, label = "ai-call" } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isRetryable(err)) {
        throw err;
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) + Math.floor(Math.random() * 200);
      logger.warn({ err: (err as any)?.message || err }, `[${label}] Tentative ${attempt + 1}/${maxRetries + 1} echouee, nouvelle tentative dans ${delay}ms:`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export interface AiPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, AiPricing> = {
  [GEMINI_PRO_MODEL]: { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  [GEMINI_FLASH_MODEL]: { inputPerMillion: 0.30, outputPerMillion: 2.50 },
  // Modeles de repli automatiques : meme tarif que leur modele d'origine pour
  // que l'estimation de cout reste juste apres un retrait de modele.
  [GEMINI_PRO_FALLBACK_MODEL]: { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  [GEMINI_FLASH_FALLBACK_MODEL]: { inputPerMillion: 0.30, outputPerMillion: 2.50 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "gpt-5.2": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-opus-4-7": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
};

export function estimateAiCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? { inputPerMillion: 0.5, outputPerMillion: 1.5 };
  return (inputTokens / 1_000_000) * p.inputPerMillion + (outputTokens / 1_000_000) * p.outputPerMillion;
}

export function extractGeminiTokens(response: any): { input: number; output: number; total: number } {
  const meta = response?.usageMetadata || {};
  const input = Number(meta.promptTokenCount ?? 0);
  const output = Number(meta.candidatesTokenCount ?? 0);
  const total = Number(meta.totalTokenCount ?? input + output);
  return { input, output, total };
}

export function extractOpenAITokens(response: any): { input: number; output: number; total: number } {
  const u = response?.usage || {};
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const output = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  const total = Number(u.total_tokens ?? input + output);
  return { input, output, total };
}

export function extractAnthropicTokens(message: any): { input: number; output: number; total: number } {
  const u = message?.usage || {};
  const input = Number(u.input_tokens ?? 0);
  const output = Number(u.output_tokens ?? 0);
  return { input, output, total: input + output };
}

export interface RecordAiUsageOpts {
  organisationId?: number | null;
  userId?: number | null;
  provider: "gemini" | "openai" | "anthropic" | string;
  model: string;
  route: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status?: "success" | "error";
  errorMessage?: string | null;
}

export function sanitizeAiErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).slice(0, 200);
  s = s.replace(/[\x00-\x1f\x7f]/g, " ");
  s = s.replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]");
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
  s = s.replace(/\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\b/g, "[uuid]");
  s = s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[jwt]");
  s = s.replace(/sk-[A-Za-z0-9]{20,}/g, "[apikey]");
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "[bearer]");
  s = s.replace(/https?:\/\/\S+/g, "[url]");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 200);
}

export async function recordAiUsage(opts: RecordAiUsageOpts): Promise<void> {
  if (!opts.organisationId) {
    logger.warn(`[ai-utils] Skipping AI usage record (no organisationId): route=${opts.route} model=${opts.model}`);
    return;
  }
  try {
    const { db, aiUsageTable } = await import("@workspace/db");
    const total = opts.inputTokens + opts.outputTokens;
    const cost = estimateAiCostUsd(opts.model, opts.inputTokens, opts.outputTokens);
    await db.insert(aiUsageTable).values({
      organisationId: opts.organisationId,
      userId: opts.userId ?? null,
      provider: opts.provider,
      model: opts.model,
      route: opts.route,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      totalTokens: total,
      estimatedCostUsd: cost,
      durationMs: opts.durationMs,
      status: opts.status ?? "success",
      errorMessage: sanitizeAiErrorMessage(opts.errorMessage),
    });
  } catch (err) {
    logger.error({ err: err }, "[ai-utils] Failed to record AI usage:");
  }
}

const RETENTION_DAYS = Number(process.env.AI_USAGE_RETENTION_DAYS ?? 180);
let purgeTimer: NodeJS.Timeout | null = null;

export async function purgeOldAiUsage(): Promise<number> {
  try {
    const { db, aiUsageTable } = await import("@workspace/db");
    const { lt } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000);
    const res = await db.delete(aiUsageTable).where(lt(aiUsageTable.createdAt, cutoff));
    const deleted = (res as any).rowCount ?? 0;
    if (deleted > 0) logger.info(`[ai-utils] Purge ai_usage: ${deleted} lignes supprimees (>${RETENTION_DAYS}j)`);
    return deleted;
  } catch (err) {
    logger.error({ err: err }, "[ai-utils] Purge ai_usage failed:");
    return 0;
  }
}

export function startAiUsagePurgeJob(): void {
  if (purgeTimer) return;
  setTimeout(() => { void purgeOldAiUsage(); }, 30_000);
  purgeTimer = setInterval(() => { void purgeOldAiUsage(); }, 24 * 60 * 60 * 1000);
  purgeTimer.unref?.();
  logger.info(`[ai-utils] Purge job started (retention: ${RETENTION_DAYS}j)`);
}

export function sanitizePromptInput(text: string | null | undefined, maxLen: number = 8000): string {
  if (!text) return "";
  return String(text)
    .replace(/\u0000/g, "")
    .replace(/```/g, "ʼʼʼ")
    .replace(/<\|[^>]*\|>/g, "")
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|messages?)/gi, "[contenu filtre]")
    .replace(/\bsystem\s*[:=]\s*/gi, "[contenu filtre] ")
    .replace(/\b(?:assistant|user)\s*[:=]\s*/gi, " ")
    .slice(0, maxLen);
}
