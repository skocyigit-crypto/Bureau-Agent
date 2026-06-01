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
