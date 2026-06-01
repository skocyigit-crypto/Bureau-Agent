# Memory Index

- [Security middleware stack](security-middleware-stack.md) — /api threatDetection blocks URLs/base64 (bypass per-route); global express.json is 1mb (mount higher limit before it).
- [Global super-admin guard](global-super-admin-guard.md) — never `router.use(requireSuperAdmin, xRouter)` (leaks to ALL routes, 403s clients); path-scope it. Recheck after backoffice merges.
- [Cron cadence durability](cron-cadence-durability.md) — "once per period" crons must persist last-run marker in DB, not in-memory (resets on restart → dup sends).
- [Security scan engines](security-scan-engines.md) — file/URL scanning engine setup and fallbacks.
- [executeSql error surfacing](executesql-error-surfacing.md) — sandbox executeSql returns SQL errors in `.output`, does NOT throw; assert via row counts, not try/catch.
- [Proactive autonomy engine](proactive-autonomy-engine.md) — deterministic no-AI detectors → proactive_suggestions; DB partial-unique dedupe on pending; opt-in cron per org.
