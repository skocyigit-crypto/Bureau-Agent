# Memory Index

- [At-rest secret encryption](at-rest-encryption.md) — all persisted secrets go through ONE canonical lib/crypto AES-256-GCM helper; require DATA_ENCRYPTION_KEY in prod (no SESSION_SECRET fallback); google-auth weak helper is dead BYOC code.

- [User terminology](user-terminology.md) — owner's word "Canvas" = the live talking AI avatar (@workspace/ai-avatar), NOT the design board or the assistant chat button.
- [Retiring a proactive detector](detector-retirement.md) — drop the type from DETECTOR_TYPES AND add to RETIRED_DETECTOR_TYPES so old pending rows self-resolve in all envs (esp. prod, no manual SQL).

- [Gemini model-retirement fallback](gemini-model-fallback.md) — boot-time singleton patch of ai.models retries on model-retired errors with env-overridable *-latest fallback; covers all call sites.
- [Security middleware stack](security-middleware-stack.md) — /api threatDetection blocks URLs/base64 (bypass per-route); global express.json is 1mb (mount higher limit before it).
- [Google connection model](google-connection-model.md) — all Google surfaces use per-user OAuth (google_oauth_tokens); never the shared Replit connector, never hardcoded status.
- [Google OAuth centralized](google-oauth-centralized.md) — ONE global env OAuth client for all tenants (envOnly), per-user token isolation, no credential UI; BYOC reverted.
- [Google OAuth redirect URI](google-oauth-redirect-uri.md) — prod callback must derive from REPLIT_DOMAINS (REPLIT_DEV_DOMAIN is dev-only) AND be registered in Google Cloud Console, else redirect_uri_mismatch.
- [Cron daily guards](cron-daily-guard.md) — row-derived "ran today" guards silently re-run on zero-output ticks; pair with in-memory attempted marker; self-generate dedup keys (don't trust LLM).
- [Talking AI avatar](talking-avatar.md) — DOM-only `@workspace/ai-avatar` lib for web; Expo duplicates viseme core + RN SVG; TTS must use on-device (local) voices only, fail closed.
- [Postgres composite-key purge](postgres-composite-key-purge.md) — recompute jobs must purge stale rows via sql-concat notInArray; separator must NOT be U+0000 (Postgres rejects NUL, fails only at runtime).
- [Global super-admin guard](global-super-admin-guard.md) — never `router.use(requireSuperAdmin, xRouter)` (leaks to ALL routes, 403s clients); path-scope it. Recheck after backoffice merges.
- [Cron cadence durability](cron-cadence-durability.md) — "once per period" crons must persist last-run marker in DB, not in-memory (resets on restart → dup sends).
- [Security scan engines](security-scan-engines.md) — file/URL scanning engine setup and fallbacks.
- [executeSql error surfacing](executesql-error-surfacing.md) — sandbox executeSql returns SQL errors in `.output`, does NOT throw; assert via row counts, not try/catch.
- [Proactive autonomy engine](proactive-autonomy-engine.md) — deterministic no-AI detectors → proactive_suggestions; DB partial-unique dedupe on pending; opt-in cron per org.
- [Document threat alerts](document-threat-alerts.md) — stored docs go "dangerous" only via re-scan endpoints; event-driven proactive suggestion alerts owners regardless of cron opt-in.
- [Prod schema & rename trap](prod-schema-publish-flow.md) — prod schema changes only via Publish (dev→prod diff), never direct DDL; legacy user_sessions makes push-force rename-destroy new tables — pre-create with additive SQL.
- [Dev DB drift + scan cancel e2e](dev-db-drift-and-scan-e2e.md) — drizzle push offers a DESTRUCTIVE user_sessions→agent_proposals rename (never accept); org delete blocked by append-only audit; seed ~6000 docs to e2e the bulk-scan cancel flow.
- [AI council anchor pattern](ai-council-anchor.md) — OpenAI/Anthropic always ~45s-timeout via proxy; use Gemini Flash as anchor + short grace + abort stragglers; never block on slow providers. Auto-run is in-memory (not restart-durable).
- [Web search via Gemini grounding + SSRF](web-search-grounding-ssrf.md) — in-app web search uses Gemini googleSearch grounding (no search API); resolve redirect URLs manual-mode on allowlisted Google hosts only, never fetch destinations (anti-SSRF).
- [AI Council + agent learning](ai-council-and-agent-learning.md) — agents consult Gemini+GPT+Claude in parallel (non-stream path only) + synthesis; cache key MUST include learned-context fingerprint and cache the full {text,models,synthesized} artifact or learning/provenance silently breaks.
- [Webhook session<->tenant binding](webhook-session-tenant-binding.md) — signature check alone doesn't prevent cross-tenant leaks; re-assert session.orgId === resolvedTenant.orgId each turn; set fulfilled flag only after DB write.
- [Tenant org NOT NULL hardening](tenant-org-not-null.md) — "0 nulls now" ≠ null invalid; some org_id inserts are legit null (payments/google_oauth_tokens/license_audit_log). Run api-server typecheck after schema NOT NULL changes.
- [Outbound webhook delivery](outbound-webhook-delivery.md) — tenant-URL delivery invariants: SSRF-check (DNS-resolve) every attempt, sign with per-attempt timestamp, atomic SQL failure-count/breaker.
- [Drizzle composite-FK ordering trap](drizzle-composite-fk-ordering.md) — composite FK needs unique() (not uniqueIndex); incremental push adds FK before UNIQUE & push-force swallows the error (exits 0); drop+recreate empty tables to fix; verify via pg_constraint.
- [Google tokens at rest](google-token-at-rest.md) — google_oauth_tokens access/refresh encrypted via lib/crypto; legacy plaintext migrates lazily on read (refresh never rewrites refresh_token).
- [Multi-tenant FK convention](tenant-fk-convention.md) — cross-entity FKs point at global PK (not composite); isolation is app-level (getOrgId at write time), so validate referenced row's org before persisting.
- [BTP / CREPI-OS scope](btp-crepios-scope.md) — red lines: autonomous SEPA, physical lock, OS/VLM desktop kernel. Buildable = human-approved suggestions in proactive-engine. Map onto existing tables; only `vehicules` is new.
- [Treasury cash-crunch risk brain](treasury-risk-brain.md) — cash-crunch MC must be path-based (cross-zero over horizon), not terminal-balance; MC-backed proactive detectors need hysteresis or they flap the engine's auto-resolve each tick.
- [Voice pending-action confirm](voice-pending-action-confirm.md) — confirm `accept` indices key into the READY subset only (not full action list); "mark complete" must re-guard `status IN open` at confirm, not just parse.
- [PDF generation with pdfkit](pdf-generation-pdfkit.md) — bufferPages+footers-after-content (never pageAdded → stack overflow); resolve non-hoisted pdfkit via createRequire from owning package; Helvetica handles French not Turkish.
- [Assistant write-tools confirmation gate](assistant-write-tools-confirmation.md) — new assistant tools that persist (rows/docs/email/media) must set requiresConfirmation + local try/catch; pass nested input as a JSON-string param.
