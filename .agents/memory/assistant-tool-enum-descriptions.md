---
name: Assistant tool enum descriptions
description: Why assistant LLM-tool descriptions that list enum values must stay canonical (and be enum-validated)
---

# Assistant tool enum descriptions must be canonical

Assistant tools (`assistant-tools.ts`) expose a `description` (and per-property
`description`) that the LLM reads to decide what values to pass. When a tool
applies that arg via `eq(column, arg)` (e.g. `list_prospects` → `stage`,
`list_tasks` → `status`), a non-canonical value in the description makes the LLM
emit a literal that matches **0 rows** — a silent failure typecheck can't catch.
For `create_*` tools the same stale description can persist an invalid literal
into a plain-text column.

**Why:** descriptions drifted from the real DB enum (e.g. `qualifie`/`propose`
instead of canonical `qualification`/`proposition`; `contact`/`negociation`
missing). The column is `text`, so bad values are accepted and only surface as
"nothing shows up" / rows that never match UI filters.

**How to apply:**
- Treat any enum list inside a tool `description` as a contract with the DB enum.
  Cross-check against the server route's `STAGES`/status const and the web page's
  options before trusting it.
- For write tools (`create_*`), don't rely on the description — add
  `{ kind: "string", enum: [...] as const }` to that tool's `fields` entry so an
  out-of-set value is rejected at runtime (the field validator already supports
  `enum`).
- Canonical sets (verified): prospects.stage = nouveau, contact, qualification,
  proposition, negociation, gagne, perdu. tasks.status / calls.status: see
  task-status-enum.md.

## Sibling risk: bulk-operations validation whitelists

`bulk-operations.ts` has one inline status/stage whitelist per route
(`!["..."].includes(x)`). These are a SECOND copy of each domain enum and drift
from the canonical route/schema set: a route accepted an orphan literal that no
read query matches (silent bad write), and `/bulk/prospects/stage` had no
whitelist at all (wrote arbitrary stage). When changing any domain enum, audit
the matching bulk route too — they don't share a constant.
