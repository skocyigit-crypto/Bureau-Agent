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
