# Memory Index

- [Security middleware stack](security-middleware-stack.md) — /api threatDetection blocks URLs/base64 (bypass per-route); global express.json is 1mb (mount higher limit before it).
- [Cron cadence durability](cron-cadence-durability.md) — once-per-period crons must persist last-run in DB (not in-memory Map) or restarts cause duplicate sends; advance ts only on success.
