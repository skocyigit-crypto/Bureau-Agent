---
name: DB pool exhaustion from cron fan-out + transient-retry
description: Why per-org count fan-out exhausts the pool under concurrent crons, and the retry rule for transient connection drops.
---

# DB pool exhaustion (cron fan-out) + transient connection retry

Background cron jobs that do per-entity fan-out (e.g. N separate count queries
per organisation via `Promise.all`) multiply pool checkouts. With several crons
ticking concurrently this saturates the fixed pool (max=20) and surfaces as
`timeout exceeded when trying to connect`. Serverless Postgres also drops idle
connections, surfacing as `Connection terminated unexpectedly`, which can abort a
whole cron cycle at its top-level query.

**Rule 1 — collapse fan-out.** Prefer one `count(*) FILTER (WHERE ...)::int` per
table over many isolated count queries. Same outputs, ~Nx fewer concurrent
checkouts and round-trips. `FILTER` returns a row even at zero — read
`rows[0]?.field ?? 0`.

**Rule 2 — retry ONLY transient connection errors, ONLY on idempotent reads.**
The canonical helper is `withDbRetry(fn, {attempts, baseDelayMs, label})`
(`artifacts/api-server/src/lib/db-retry.ts`). It retries by pg connection-class
codes (57P01/08006/08003/08001/08004) + network codes (ECONNRESET etc.) +
message patterns, and recurses into `err.cause` because drizzle wraps the driver
error. Never wrap writes (would risk double-write); wrap the read paths only.

**Why:** the DB pool config (keepAlive, statement/lock timeouts, `pool.on('error')`)
was already sound — the failures came from query concurrency and transient drops,
not pool misconfiguration. Do not bump pool size as a first reflex; reduce
fan-out and retry transients instead.

**How to apply:** when a new cron/batch reads many rows, count with FILTER and
wrap each idempotent read in `withDbRetry`. If you see connect-timeout or
"Connection terminated" in cron logs, look for fan-out before touching the pool.
