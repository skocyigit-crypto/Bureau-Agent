---
name: Domain status enums (tasks, calls) canonical values
description: The one true tasks.status / calls.status enums and the silent-zero trap from wrong literals.
---

Canonical `tasks.status` enum is `en_attente | en_cours | termine | annule`
(masculine), enforced by the API Zod contract and matched by the DB ground truth.

Canonical `calls.status` enum is FRENCH: `repondu | manque | messagerie` (plus
`direction` `entrant | sortant`). English literals (`missed`, `answered`,
`voicemail`, `incoming`, `outgoing`) used directly against `callsTable.status`
silently return 0 (e.g. missedRate stuck at 0%, anomaly alerts never firing,
empty executive-summary KPIs). The ONLY correct place for English is the API
query-param mapping layer (e.g. calls.ts maps `?status=missed` → `'manque'`
before querying) — never inside a `sql` filter or `eq()` on the column.

**Why:** Legacy/feminine variants (`terminee`, `annulee`), and old aliases
(`a_faire`, `todo`) drift in over time. Because Postgres just returns no rows for
a non-matching literal, a wrong literal fails *silently*: read queries return 0
completed tasks, `!=`/`NOT IN` filters overcount "open" tasks, and writes persist
rows the UI/filters can never match. Typecheck does NOT catch these (literals are
plain strings inside `sql` templates or `eq()`), so they survive until someone
notices wrong analytics.

**How to apply:** Any task-status code path — `eq(tasksTable.status, ...)`,
`sql\`${tasksTable.status} = '...'\``, inserts/updates, AI tool descriptions that
drive a `status` filter param, and frontend dropdowns that POST a status — must use
the canonical four. Grep `terminee|annulee|a_faire|'todo'` near task code when
auditing. Two deliberate exceptions to leave alone: invoice/subscription statuses
legitimately use `annulee`/`payee`/etc (different domain), and ai-commandant's
defensive `or(eq(status,'termine'), eq(status,'terminee'))` harmlessly matches both
spellings.
