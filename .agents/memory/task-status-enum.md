---
name: Task status canonical enum
description: The one true tasks.status enum and the silent-zero trap from legacy literals.
---

Canonical `tasks.status` enum is `en_attente | en_cours | termine | annule`
(masculine), enforced by the API Zod contract and matched by the DB ground truth.

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
