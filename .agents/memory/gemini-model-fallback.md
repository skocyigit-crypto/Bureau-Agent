---
name: Gemini model-retirement fallback
description: How automatic fallback to a live Gemini model works when Google retires a model name.
---

# Gemini model-retirement auto-fallback

The shared Gemini client (`ai` from `@workspace/integrations-gemini-ai`) is a single
singleton; every call site (routes, services, `ai-stream`, `call-processor`, and even
aliased destructures like `briefAi`/`meetAi`) imports the *same* object.

**The fix:** at server boot (`index.ts`), `installGeminiModelFallback()` (in
`services/ai-utils.ts`) monkey-patches `ai.models.generateContent` and
`generateContentStream` once. On a model-retirement error it retries with a fallback
model. Helpers in the same file: `isModelRetiredError`, `fallbackGeminiModel`,
`geminiGenerateWithFallback`.

**Why a singleton patch instead of editing each call site:** there are ~50 raw
`ai.models.generateContent(...)` sites across ~26 files. Patching the shared object once
is the only way "one fix covers all call sites" without churning every route.

**How to apply / gotchas:**
- Fallback model names are env-overridable: `GEMINI_PRO_FALLBACK_MODEL` /
  `GEMINI_FLASH_FALLBACK_MODEL`, defaulting to Google's rolling `*-latest` aliases
  (`gemini-pro-latest`, `gemini-flash-latest`) which are never retired.
- `voice-live.ts` is intentionally NOT covered — it builds its own `GoogleGenAI`
  instance for native-audio Live models with separate fallback logic.
- `aiCallWithRetry` only retries transient errors (rate-limit/timeout/5xx), NOT
  model-not-found — that's the gap this fallback fills; the two compose cleanly.
- Streaming: the patch wraps the async iterator so a retirement error on the *first*
  chunk (before anything is emitted) can still switch models; mid-stream errors can't.
- `recordAiUsage` now logs the model that *actually* served the request: the patch
  tags the response (non-streaming) / each chunk (streaming) with the real model via a
  `Symbol.for("workspace.geminiActualModel")` key; read it at usage sites with
  `geminiActualModel(responseOrChunk, requestedModel)` (falls back to requested when
  untagged, i.e. no fallback occurred). Any NEW Gemini `recordAiUsage` site must wrap
  its model arg the same way. Fallback aliases are in the `PRICING` table so cost
  estimates stay correct after a retirement. `meetings.ts` uses a raw REST fetch (not
  the patched singleton) so it has no fallback and is left as-is.

**Admin alerting on fallback:** `ai-utils` exposes an `onGeminiModelFallback(listener)`
hook (kept decoupled — ai-utils only knows the logger). At boot `index.ts` wires it to
`recordModelFallbackSuggestion` in `proactive-engine.ts`, which writes a `model_fallback`
proactive suggestion to the **super-admin org** (`agent-de-bureau-sas`) — the only org
that can change the env vars. Dedup is two-layer like document threats: in-memory
`alertedFallbackModels` Set (per retired model, kills per-request DB churn) + DB partial
unique index via `dedupeKey: model_fallback:<retiredModel>`. On DB failure the in-memory
guard is *removed* so a later request retries. `model_fallback` is NOT a `DETECTOR_TYPES`
member, so the cron never auto-resolves it — it stays until the admin acts.
