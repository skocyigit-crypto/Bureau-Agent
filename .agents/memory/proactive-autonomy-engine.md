---
name: Proactive autonomy engine (pillar A)
description: How the deterministic proactive-suggestion engine is structured and deduped
---

The proactive autonomy engine generates actionable suggestions for an org WITHOUT
any AI cost: deterministic detectors run on existing signals and write rows to
`proactive_suggestions` (org-scoped). It is opt-in per org via
`organisations.proactiveEngineEnabled`, runs on a cron (short startup tick + ~30min
tick), and broadcasts an SSE `dashboard` update when it creates/resolves rows.

**Dedupe is enforced at two layers — keep both:**
- App level: each detector emits a stable `dedupeKey` (e.g. `overdue_task:<id>`);
  the engine skips keys already pending.
- DB level: a **partial unique index** on `(organisation_id, dedupe_key) WHERE
  status='pending'` guarantees no duplicate active suggestion even under concurrent
  runs (cron + manual `/proactive/run`, or multi-instance). The insert uses
  `ON CONFLICT DO NOTHING` to stay idempotent. The partial predicate is essential:
  a resolved (done/dismissed) row with the same key must still be allowed.

**Auto-resolution:** stale pending rows whose underlying condition cleared are
flipped `pending -> done` (constrained to detector-owned types), so the list
self-cleans without user action.

**Org-wide settings are admin-gated:** `PATCH /proactive/settings` requires
`administrateur`+; an agent must not be able to disable org-wide monitoring.

**Why:** this is the foundation the learning layer (feedback up/down on suggestions)
builds on, so suggestion identity (dedupeKey) and feedback columns must stay stable.
