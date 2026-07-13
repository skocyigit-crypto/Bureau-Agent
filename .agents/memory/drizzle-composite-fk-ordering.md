---
name: Drizzle composite-FK ordering trap
description: Why a composite (multi-column) foreign key target fails on incremental drizzle-kit push but works on fresh create.
---

# Composite FK target: unique() constraint + fresh-create ordering

A composite foreign key (e.g. `webhook_deliveries(endpoint_id, organisation_id)` →
`webhook_endpoints(id, organisation_id)`, the multi-tenant integrity guard) needs the
referenced columns covered by a real UNIQUE **constraint** (`unique().on(...)`), NOT a
`uniqueIndex()`. Postgres rejects an FK whose target is only a unique *index*:
`there is no unique constraint matching given keys` / routine `transformFkeyCheckAttrs`.

**Why this bit twice:** even after switching to `unique()`, `drizzle-kit push` on an
EXISTING table (incremental ALTER) emits `ADD FOREIGN KEY` before `ADD UNIQUE`, so the FK
add fails. Worse, the `push-force` chain SWALLOWS it: drizzle-kit prints the Postgres error
but exits 0, the `&&`-chained `ensure-*`/verify steps still run, and the constraint is
silently NOT applied. "Changes applied" is the only success signal — grep for it, and
verify in `pg_constraint` afterward; do not trust a clean exit code.

**How to apply:**
- FK target columns → declare a named `unique()` constraint (not `uniqueIndex`).
- If push errors with `transformFkeyCheckAttrs` on a table that ALREADY exists and is
  empty: DROP the affected tables and re-push. Fresh CREATE orders the unique constraint
  before the dependent FK and applies cleanly. This also mirrors Replit's prod **Publish**
  flow (prod tables are created fresh, so the ordering trap does not occur there).
- Always confirm with `SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint`
  — never assume push applied a composite FK / check / unique just because the command returned 0.
