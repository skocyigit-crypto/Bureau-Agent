---
name: Per-org AI BYOK (bring-your-own-key)
description: How tenant-supplied AI API keys (Gemini/OpenAI/Anthropic) resolve and fail-soft back to platform keys.
---

# Per-organization AI BYOK

Orgs can configure their own AI provider keys, mirroring the email_providers /
telephony_providers per-tenant pattern (manual express Router + manual fetch
frontend, NOT OpenAPI codegen). Keys live in `ai_providers` table, encrypted at
rest with the same crypto helpers as email providers.

## Two-stage fallback is the whole point — both stages are required

A bad org key must NEVER block AI; it must fall back to the platform singleton.
There are TWO independent failure points and BOTH need a fallback:

1. **Acquisition** (`getOrgGeminiClient` / `getOrgOpenAIClient` / `getOrgAnthropicClient`
   / `getOrgEmbeddingClient`): falls back to the platform singleton when the org has
   no key OR when *constructing* the client throws.
2. **Runtime call** (`callOrgGemini` / `callOrgEmbedding`): a syntactically-valid but
   revoked/invalid key only fails at the network call (401/403, "API key not valid",
   "incorrect api key", "invalid x-api-key"). These wrappers run `fn(orgClient)` and,
   on an auth-key error (`isAiAuthKeyError`), replay once with the platform singleton.

**Why:** an early version only had stage 1. Single-client call sites
(assistant-engine, voice-receptionist, knowledge-base embed + answer) would hard-fail
for the whole org on a revoked key — there is no cross-provider fallback on those
paths. Code review flagged it as blocking.

**How to apply:** any NEW single-provider Gemini/embedding call site must go through
`callOrgGemini` / `callOrgEmbedding`, not the raw `getOrg*Client` + direct call.

## Deliberate non-fallback cases (do not "fix" these)

- **Quota / network errors are NOT auth errors** → `isAiAuthKeyError` returns false and
  they propagate. Rationale: don't bill the platform for a client's own quota overrun,
  and don't mask a genuine outage.
- **`ai-stream.ts` (multi-provider streaming) is intentionally left on acquisition-only
  fallback.** It already degrades across providers (gemini→openai→anthropic), so AI is
  never blocked there; wrapping a half-consumed stream for per-provider auth-retry is
  not worth the complexity. The single-client paths are the ones that needed the runtime
  wrapper.

## Routing / cache gotchas

- CRUD route is mounted at `/ai-providers` (NOT under the aiLimiter-rate-limited prefix),
  after `requireTenant`. All handlers org-scope via `getOrgId`.
- Decrypted keys are cached per-org with a 5min TTL; every create/update/delete calls
  `clearOrgAiClientsCache(orgId)`. A runtime auth-fallback does NOT clear the cache (the
  same bad key would just be re-read from DB); TTL handles eventual refresh.
