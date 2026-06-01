# Memory Index

- [Security middleware stack](security-middleware-stack.md) — /api threatDetection blocks URLs/base64 (bypass per-route); global express.json is 1mb (mount higher limit before it).
- [Cron cadence durability](cron-cadence-durability.md) — once-per-period crons must persist last-run in DB (not in-memory Map) or restarts cause duplicate sends; advance ts only on success.
- [Global super-admin guard regression](global-super-admin-guard.md) — `router.use(requireSuperAdmin, subRouter)` w/o path gates the whole client API; only super_admin reaches routes after it.
- [External security scan engines](security-scan-engines.md) — URL (Safe Browsing) + file (VirusTotal hash-lookup) layered on heuristics, fail-soft; only scan-document route uses async full scan.
