import type { Response } from "express";
import { logger } from "../lib/logger";
import { assertAiQuota, invalidateQuotaCache, AiQuotaExceededError } from "./ai-quota";
import {
  recordAiUsage,
  extractGeminiTokens,
  extractOpenAITokens,
  extractAnthropicTokens,
  sanitizePromptInput,
  geminiActualModel,
  isRetryableAiError,
  GEMINI_PRO_MODEL,
  OPENAI_MODEL,
  ANTHROPIC_MODEL,
} from "./ai-utils";
import { getOrgGeminiClient, getOrgOpenAIClient, getOrgAnthropicClient } from "./ai-providers";

export interface SseStream {
  send: (event: string, data: unknown) => void;
  end: () => void;
  isClosed: () => boolean;
  signal: AbortSignal;
}

export function openSseStream(res: Response): SseStream {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`: connected\n\n`);

  let closed = false;
  const controller = new AbortController();

  const onClose = () => {
    if (closed) return;
    closed = true;
    try { controller.abort(); } catch {}
  };
  res.on("close", onClose);
  res.on("error", onClose);

  const heartbeat = setInterval(() => {
    if (closed) return;
    try { res.write(`: ping\n\n`); } catch { onClose(); }
  }, 15000);
  heartbeat.unref?.();

  return {
    send(event, data) {
      if (closed) return;
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        onClose();
      }
    },
    end() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      try { res.end(); } catch {}
    },
    isClosed() { return closed; },
    signal: controller.signal,
  };
}

export interface StreamOptions {
  prompt: string;
  systemPrompt?: string;
  organisationId?: number;
  route: string;
  signal: AbortSignal;
  onToken: (chunk: string) => void;
  geminiModel?: string;
  openaiModel?: string;
  anthropicModel?: string;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

export interface StreamResult {
  fullText: string;
  provider: "gemini" | "openai" | "anthropic";
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  aborted?: boolean;
}

export class StreamAbortedError extends Error {
  constructor(
    public readonly partial: StreamResult,
  ) {
    super("aborted");
    this.name = "StreamAbortedError";
  }
}

class StreamFailedError extends Error {
  constructor(public provider: string, message: string) { super(message); }
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  // `text.length / 4` est calibre sur l'anglais ASCII et SOUS-compte
  // fortement le francais/turc: les caracteres accentues (é, ç, ı, ş, ğ…)
  // occupent 2 octets UTF-8 et sont souvent decoupes en plusieurs
  // sous-tokens par les tokenizers. Pour l'application de quota (ou
  // sous-compter laisse depasser), on s'appuie sur la longueur en OCTETS
  // UTF-8 (qui suit bien mieux le nombre de tokens pour ces scripts) et on
  // pose un plancher base sur le nombre de mots (~1.3 token/mot) pour ne
  // pas sous-estimer les chaines courtes multi-octets.
  const byteLength = Buffer.byteLength(text, "utf8");
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const byteEstimate = byteLength / 4;
  const wordEstimate = words * 1.3;
  return Math.max(1, Math.ceil(Math.max(byteEstimate, wordEstimate)));
}

function persistUsage(
  organisationId: number | undefined,
  provider: "gemini" | "openai" | "anthropic",
  model: string,
  route: string,
  input: number,
  output: number,
  durationMs: number,
) {
  if (!organisationId) return;
  recordAiUsage({
    organisationId, provider, model, route,
    inputTokens: input, outputTokens: output, durationMs,
  }).catch(() => {});
  invalidateQuotaCache(organisationId);
}

export async function multiAiGenerateStream(opts: StreamOptions): Promise<StreamResult> {
  const {
    organisationId,
    route,
    signal,
    onToken,
    geminiModel = GEMINI_PRO_MODEL,
    openaiModel = OPENAI_MODEL,
    anthropicModel = ANTHROPIC_MODEL,
    maxOutputTokens,
    responseMimeType,
  } = opts;

  if (organisationId) await assertAiQuota(organisationId);

  const safePrompt = sanitizePromptInput(opts.prompt, 24000);
  const safeSystem = sanitizePromptInput(opts.systemPrompt, 8000);
  const promptForEstimate = (safeSystem ? safeSystem + "\n\n" : "") + safePrompt;

  const errors: string[] = [];
  const t0 = Date.now();

  const checkAbort = () => {
    if (signal.aborted) throw new Error("aborted");
  };

  // ── Gemini stream (1 nouvelle tentative si echec TRANSITOIRE et AVANT tout token) ──
  // On ne retente le MEME fournisseur que si rien n'a encore ete envoye au client
  // (sinon on dupliquerait le texte deja streame). Sinon on bascule sur OpenAI.
  let geminiEmittedAny = false;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      checkAbort();
      const ai = await getOrgGeminiClient(organisationId);
      const config: Record<string, unknown> = { abortSignal: signal };
      if (maxOutputTokens) config.maxOutputTokens = maxOutputTokens;
      if (responseMimeType) config.responseMimeType = responseMimeType;

      const stream: AsyncIterable<any> = await (ai as any).models.generateContentStream({
        model: geminiModel,
        contents: safeSystem
          ? [{ role: "user", parts: [{ text: safeSystem + "\n\n" + safePrompt }] }]
          : safePrompt,
        config,
      });

      let fullText = "";
      let lastChunk: any = null;
      let abortedDuring = false;
      try {
        for await (const chunk of stream) {
          if (signal.aborted) { abortedDuring = true; break; }
          lastChunk = chunk;
          const piece = typeof chunk?.text === "string" ? chunk.text
            : typeof chunk?.text === "function" ? chunk.text()
            : "";
          if (piece) {
            fullText += piece;
            geminiEmittedAny = true;
            onToken(piece);
          }
        }
      } catch (iterErr) {
        if (signal.aborted) abortedDuring = true;
        else throw iterErr;
      }

      if (abortedDuring) {
        const tokens = extractGeminiTokens(lastChunk);
        const actualModel = geminiActualModel(lastChunk, geminiModel);
        const inTok = tokens.input || estimateTokens(promptForEstimate);
        const outTok = tokens.output || estimateTokens(fullText);
        const durationMs = Date.now() - t0;
        persistUsage(organisationId, "gemini", actualModel, route, inTok, outTok, durationMs);
        throw new StreamAbortedError({
          fullText, provider: "gemini", model: actualModel,
          inputTokens: inTok, outputTokens: outTok, durationMs, aborted: true,
        });
      }

      if (!fullText || fullText.length < 2) {
        throw new StreamFailedError("gemini", "Empty Gemini stream");
      }

      const tokens = extractGeminiTokens(lastChunk);
      const actualModel = geminiActualModel(lastChunk, geminiModel);
      const durationMs = Date.now() - t0;
      persistUsage(organisationId, "gemini", actualModel, route, tokens.input, tokens.output, durationMs);
      return {
        fullText, provider: "gemini", model: actualModel,
        inputTokens: tokens.input, outputTokens: tokens.output, durationMs,
      };
    } catch (err: any) {
      if (err instanceof StreamAbortedError) throw err;
      if (err instanceof AiQuotaExceededError) throw err;
      if (signal.aborted) throw err;
      if (attempt === 0 && !geminiEmittedAny && isRetryableAiError(err)) {
        logger.warn({ err: err?.message ?? err }, "[ai-stream] Gemini echec transitoire avant tout token — nouvelle tentative");
        continue;
      }
      errors.push("Gemini: " + (err?.message ?? err));
      logger.warn({ err: err?.message ?? err }, "[ai-stream] Gemini stream failed, falling back");
      break;
    }
  }

  // ── OpenAI stream ──
  try {
    checkAbort();
    const openai = await getOrgOpenAIClient(organisationId);
    const stream: any = await (openai as any).chat.completions.create(
      {
        model: openaiModel,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          ...(safeSystem ? [{ role: "system" as const, content: safeSystem }] : []),
          { role: "user" as const, content: safePrompt },
        ],
      },
      { signal },
    );

    let fullText = "";
    let usage: any = null;
    let abortedDuring = false;
    try {
      for await (const chunk of stream) {
        if (signal.aborted) { abortedDuring = true; break; }
        const piece: string = chunk?.choices?.[0]?.delta?.content ?? "";
        if (piece) {
          fullText += piece;
          onToken(piece);
        }
        if (chunk?.usage) usage = chunk.usage;
      }
    } catch (iterErr: any) {
      if (signal.aborted || iterErr?.name === "APIUserAbortError") abortedDuring = true;
      else throw iterErr;
    }

    if (abortedDuring) {
      try { stream?.controller?.abort?.(); } catch {}
      const tokens = extractOpenAITokens({ usage });
      const inTok = tokens.input || estimateTokens(promptForEstimate);
      const outTok = tokens.output || estimateTokens(fullText);
      const durationMs = Date.now() - t0;
      persistUsage(organisationId, "openai", openaiModel, route, inTok, outTok, durationMs);
      throw new StreamAbortedError({
        fullText, provider: "openai", model: openaiModel,
        inputTokens: inTok, outputTokens: outTok, durationMs, aborted: true,
      });
    }

    if (!fullText || fullText.length < 2) {
      throw new StreamFailedError("openai", "Empty OpenAI stream");
    }

    const tokens = extractOpenAITokens({ usage });
    const durationMs = Date.now() - t0;
    persistUsage(organisationId, "openai", openaiModel, route, tokens.input, tokens.output, durationMs);
    return {
      fullText, provider: "openai", model: openaiModel,
      inputTokens: tokens.input, outputTokens: tokens.output, durationMs,
    };
  } catch (err: any) {
    if (err instanceof StreamAbortedError) throw err;
    if (err instanceof AiQuotaExceededError) throw err;
    if (signal.aborted) throw err;
    errors.push("OpenAI: " + (err?.message ?? err));
    logger.warn({ err: err?.message ?? err }, "[ai-stream] OpenAI stream failed, falling back");
  }

  // ── Anthropic stream ──
  try {
    checkAbort();
    const anthropic = await getOrgAnthropicClient(organisationId);
    const stream: any = (anthropic as any).messages.stream({
      model: anthropicModel,
      max_tokens: maxOutputTokens || 4096,
      ...(safeSystem ? { system: safeSystem } : {}),
      messages: [{ role: "user" as const, content: safePrompt }],
    });

    let fullText = "";
    let abortedDuring = false;

    const onAbort = () => {
      abortedDuring = true;
      try { stream.abort?.(); } catch {}
      try { stream.controller?.abort?.(); } catch {}
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    stream.on("text", (text: string) => {
      if (signal.aborted) return;
      if (text) {
        fullText += text;
        onToken(text);
      }
    });

    let finalMessage: any = null;
    try {
      finalMessage = await stream.finalMessage();
    } catch (finalErr: any) {
      if (signal.aborted || abortedDuring || finalErr?.name === "APIUserAbortError") {
        abortedDuring = true;
      } else {
        signal.removeEventListener("abort", onAbort);
        throw finalErr;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }

    if (abortedDuring) {
      const tokens = finalMessage ? extractAnthropicTokens(finalMessage) : { input: 0, output: 0 };
      const inTok = tokens.input || estimateTokens(promptForEstimate);
      const outTok = tokens.output || estimateTokens(fullText);
      const durationMs = Date.now() - t0;
      persistUsage(organisationId, "anthropic", anthropicModel, route, inTok, outTok, durationMs);
      throw new StreamAbortedError({
        fullText, provider: "anthropic", model: anthropicModel,
        inputTokens: inTok, outputTokens: outTok, durationMs, aborted: true,
      });
    }

    if (!fullText) {
      const block = finalMessage?.content?.[0];
      if (block?.type === "text") {
        fullText = block.text;
        onToken(fullText);
      }
    }
    if (!fullText) throw new StreamFailedError("anthropic", "Empty Anthropic stream");

    const tokens = extractAnthropicTokens(finalMessage);
    const durationMs = Date.now() - t0;
    persistUsage(organisationId, "anthropic", anthropicModel, route, tokens.input, tokens.output, durationMs);
    return {
      fullText, provider: "anthropic", model: anthropicModel,
      inputTokens: tokens.input, outputTokens: tokens.output, durationMs,
    };
  } catch (err: any) {
    if (err instanceof StreamAbortedError) throw err;
    if (err instanceof AiQuotaExceededError) throw err;
    if (signal.aborted) throw err;
    errors.push("Anthropic: " + (err?.message ?? err));
  }

  throw new Error(`Tous les fournisseurs IA ont echoue: ${errors.join("; ")}`);
}
