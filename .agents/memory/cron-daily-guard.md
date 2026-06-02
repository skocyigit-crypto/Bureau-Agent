---
name: Cron once-per-day guards derived from output rows
description: Why row-derived "already ran today" guards silently re-run on zero-output ticks, and the fix.
---

# Cron once-per-day / dedup guards must not rely solely on output rows

Several background crons (autonomous-secretary, app-audit) decide "already ran
today for this org" by checking whether a row they would have written exists
(e.g. a finding/proposal with `runId = auto-YYYY-MM-DD`).

**Problem:** when a tick legitimately produces *zero* rows (AI returns no
findings, or everything is deduped away), no marker row is written, so the next
hourly tick re-runs the whole org — repeated AI calls and wasted work. The guard
only works once the org has at least one output row for the day.

**Fix applied (app-audit-cron):** pair the durable row-based check with an
in-memory `attemptedToday = { runId, orgIds:Set }` guard, reset when the day's
`runId` changes. Mark an org attempted **after a successful run** (even with zero
rows) so transient errors still retry next tick. On process restart the durable
row check takes over as soon as any row exists for the day.

**Why:** "max once/day/org" must be true even on empty result days; otherwise
cost scales with tick frequency, not with actual work.

**How to apply:** any new periodic per-org/per-entity cron whose dedup key is an
output row needs a complementary attempted-marker (in-memory for cost control,
or a dedicated run-log row if cross-restart durability on empty runs matters).

## Related: dedup keys must be self-generated, not LLM-supplied
In app-audit, findings dedup on `sourceRef`. The LLM can omit it, which would
bypass dedup entirely. Always synthesize a stable fallback server-side
(`kind-area-slug(title)`) before using it as a dedup key. Same idea for the
linked `agent_proposals` sourceRef (prefixed `audit:`).
