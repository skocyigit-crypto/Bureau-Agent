---
name: Webhook manual retry — single executor
description: Why a manual "replay/retry" of a queued delivery must re-queue for the background worker instead of also sending from the HTTP path.
---

# Manual retry must delegate to the single worker executor

A user-triggered "retry/replay" of a persisted delivery/job must NOT execute the
send from the HTTP request path. Re-queue it (atomic conditional UPDATE: status
back to the retry state, `nextRetryAt = now`, `attempts = 0`, clear error/response
fields) and let the existing background retry worker be the ONLY executor.

**Why:** The retry worker already has a "stale-pending" crash-recovery net that
picks up `pending` rows whose `createdAt` is older than a threshold. A manual
retry that resets an old `failed` row back to `pending` produces a row that looks
exactly like a crashed-pending row (old `createdAt` + `pending`). So the worker's
net grabs it at the same time the HTTP path fires its own immediate send →
**duplicate outbound delivery** + conflicting attempt-counter writes. There is no
per-row claim/lock around the send, so two executors = two POSTs.

**How to apply:**
- Re-queue into the *retry* state (not `pending`) with `nextRetryAt = now` so the
  worker's stale-pending net doesn't apply and only the normal due-retry branch
  picks it up.
- Guard the UPDATE with `WHERE id + tenant + status IN (retryable states)` so
  concurrent clicks converge on one row and a `success` row can't be resurrected.
- The worker's single-tick guard (one tick at a time) then guarantees exactly one
  executor. Trade-off accepted: replay fires on the next tick (≤ tick interval),
  not instantly.
- Mono-instance only. Multi-instance deployment would need a DB-level claim/lease
  (the in-memory tick guard is process-local).
