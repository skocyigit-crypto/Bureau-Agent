---
name: executeSql error surfacing in the code sandbox
description: The sandbox executeSql callback returns SQL errors as text, it does not throw
---

When validating DB behavior from the code_execution sandbox, the `executeSql`
callback does NOT throw a JS exception on a SQL error. It resolves normally and
puts the Postgres error text inside the returned `.output` string (e.g.
`"Error in river service ... stderr=ERROR: duplicate key value violates unique
constraint ..."`).

**Why it matters:** a `try { await executeSql(badInsert) } catch {...}` block
will NEVER catch a constraint violation — the await succeeds, so a test that
relies on the catch branch will wrongly conclude the constraint "did not fire".

**How to apply:** to prove a constraint/uniqueness/trigger works, assert on
observable state (e.g. `SELECT count(*)` before/after) or inspect the returned
`.output` string for `ERROR:`. Do not rely on JS exception flow. For idempotent
inserts, `INSERT ... ON CONFLICT DO NOTHING` returns `"INSERT 0 0"` in `.output`
when the row was skipped.
