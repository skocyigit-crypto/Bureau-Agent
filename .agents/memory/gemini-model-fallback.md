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
- `recordAiUsage` still logs the *requested* model name, not the fallback actually used
  (minor accounting inaccuracy, left as-is).
