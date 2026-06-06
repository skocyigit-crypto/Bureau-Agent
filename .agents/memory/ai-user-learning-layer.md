---
name: Per-user AI learning layer
description: The agent learns per-employee (not just per-org); how the shared context block and its cache must behave.
---

There are TWO learning dimensions, both deterministic (no AI calls):
- **Org-wide** — `ai_learned_preferences` + `ai_recurring_patterns`.
- **Per-employee** — `ai_user_profile_facts` (org+userId NOT NULL), mined per
  user from `audit_logs` (active hours, work domains/resources),
  `tasks.createdBy` (task themes), `calls.createdBy` (recurring contacts).

`buildLearnedContextBlock(orgId, userId?)` composes org block + (optional)
personal block. It is the single injection point for ALL AI surfaces.

**Why / how to apply:**
- Cache is keyed by the STRING `${orgId}:${uid}` (uid=0 = org-only, the
  back-compat path for callers that pass no user). Any new per-identity
  segmentation must extend this key, and `invalidateContextCache(orgId)` MUST
  prefix-purge every `${orgId}:*` variant — deleting a single key leaks stale
  personalization to other users.
- To personalize a new AI call site, pass the acting `userId` (e.g. assistant
  uses `ctx.userId`). Without it you silently get org-only behavior.
- Per-user stale purge uses the same sql-concat `notInArray` trick as the org
  miner; separator KEY_SEP must stay U+001F (NOT U+0000 — Postgres rejects NUL
  at runtime only). See postgres-composite-key-purge.md.
- Mining/context are fail-soft (return "" / per-user try/catch); never let a
  learning failure break an AI request or the daily cron.
