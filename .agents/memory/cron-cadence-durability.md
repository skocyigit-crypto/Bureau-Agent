---
name: Cron cadence durability
description: Why scheduled-email/cron cadence state must be persisted in the DB, not held in memory
---

# Cron cadence must be persisted, not in-memory

Any cron that enforces a "send at most once per period" cadence (weekly digest,
trial warning, quota warning, billing catch-up) must store its last-run marker in
the database, keyed per entity (e.g. `organisations.lastSecurityDigestAt`), and gate
the next run on that persisted timestamp.

**Why:** An in-memory `Map<id, lastSentAt>` resets on every server restart/deploy.
With a short startup tick, every opted-in row becomes eligible again after restart,
producing duplicate emails within the intended window. Architect review repeatedly
flagged this until cadence moved to a persisted timestamp with a true `>= 7 day`
gate (null timestamp = eligible).

**How to apply:**
- Gate eligibility on `now - persisted_ts >= WINDOW` (null => eligible).
- Advance the persisted timestamp ONLY on success, so a failed send retries next tick
  (at-least-once). Failure path must not write the timestamp.
- Daily tick + short startup tick are fine once the gate reads the persisted value.
- This is at-least-once, not exactly-once: rare crash/multi-instance races can still
  double-send. Add a DB lease/transactional outbox only if exactly-once is required.

## Two persistence styles — pick by side-effect type

- **Side-effecting / non-idempotent** (emails, webhooks): advance marker ONLY on
  success (above). Retry-friendly; risk is a duplicate, not a miss.
- **Idempotent recompute** (e.g. ai-learning daily cycle: preferences + patterns +
  per-user profiles): prefer a **lease-at-claim** — a single atomic
  `UPDATE organisations SET marker=now() WHERE actif AND (marker IS NULL OR marker < cutoff) RETURNING id`,
  then process only the returned ids. Advancing the marker at *selection* (not after
  the work) is what kills restart-amplified churn: without it, a 90s startup tick
  re-runs the FULL recompute for every org on every deploy (frequent on Replit). The
  same UPDATE...RETURNING is the multi-instance race guard (second instance no longer
  matches the cadence filter). Tradeoff: an org claimed just before a crash waits one
  window (~20h) before retry — acceptable because the recompute is idempotent and
  cheap to skip once.
- **Why a ~20h window + ~6h tick (not 24h interval):** decouples cadence from a
  process staying alive exactly 24h; ticks catch up missed windows after downtime
  while the persisted marker still caps it to ~once/day per org.
- When adding such a per-org marker column, also register it in
  `lib/db/scripts/verify-schema-sync.mjs` REQUIRED_COLUMNS so drift is caught, and
  remember prod gets it via Replit Publish (never direct DDL).
