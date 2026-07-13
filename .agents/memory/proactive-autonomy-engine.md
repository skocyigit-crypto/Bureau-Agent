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

**Two-tier "always awake" cadence (by design, cost-driven):** the deterministic
watchman (this engine, no AI cost) ticks frequently — `PROACTIVE_TICK_MS`, default
10 min — to catch urgent items near-real-time. The expensive AI Council salvo
(`autonomous-secretary-cron`, ~3-4× cost since it fans out to 3 models) stays at
**once per day per org**. When the patron asks for agents to be "always awake",
speed up the watchman, NOT the AI salvo, unless they explicitly accept the cost.

**Watchman vs autonomous-secretary overlap is intentional, not duplication.** The
secretary (AI, once/day) drafts ready-to-approve actions into the agent-queue; the
watchman (deterministic, frequent) writes navigational nudges into
`proactive_suggestions`. The same concern can legitimately live in both (e.g. a
missed call → secretary drafts a follow-up email AND watchman nudges "rappeler").
**Why:** before adding a "new" agent capability, check whether the secretary's AI
prompt already covers it — many "marifetler" (call triage, meeting prep, inactive
re-engagement) already exist there; the genuine value-add is usually a *deterministic*
watchman version for reliability/timeliness, not a brand-new feature.

**Surface check before building a capability.** A capability needs a place to land.
Notably `factures_client` (client invoices) has **no client-facing UI route** — only
the super-admin backoffice (`/admin/factures-b2b`); the commercial layer (devis,
factures B2B, stock) lives there per the "Two-layer product" decision. So an
"invoice reminder" capability for the *client* product has nowhere to navigate —
confirm placement (client vs backoffice) before implementing finance features.
