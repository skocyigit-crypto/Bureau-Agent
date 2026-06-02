# Memory Index

- [Security middleware stack](security-middleware-stack.md) — /api threatDetection blocks URLs/base64 (bypass per-route); global express.json is 1mb (mount higher limit before it).
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
