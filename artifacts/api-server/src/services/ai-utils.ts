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
      console.warn(`[${label}] Tentative ${attempt + 1}/${maxRetries + 1} echouee, nouvelle tentative dans ${delay}ms:`, (err as any)?.message || err);
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
  "gemini-2.5-flash": { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  "gemini-2.5-flash-preview-05-20": { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "gpt-5.2": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-sonnet-4-20250514": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
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
    console.warn(`[ai-utils] Skipping AI usage record (no organisationId): route=${opts.route} model=${opts.model}`);
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
    console.error("[ai-utils] Failed to record AI usage:", err);
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
    if (deleted > 0) console.info(`[ai-utils] Purge ai_usage: ${deleted} lignes supprimees (>${RETENTION_DAYS}j)`);
    return deleted;
  } catch (err) {
    console.error("[ai-utils] Purge ai_usage failed:", err);
    return 0;
  }
}

export function startAiUsagePurgeJob(): void {
  if (purgeTimer) return;
  setTimeout(() => { void purgeOldAiUsage(); }, 30_000);
  purgeTimer = setInterval(() => { void purgeOldAiUsage(); }, 24 * 60 * 60 * 1000);
  purgeTimer.unref?.();
  console.info(`[ai-utils] Purge job started (retention: ${RETENTION_DAYS}j)`);
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
