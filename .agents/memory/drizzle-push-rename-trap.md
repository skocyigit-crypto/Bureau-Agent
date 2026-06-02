---
name: Drizzle push interactive rename trap
description: Why `db run push` can offer a destructive table rename, and the safe workaround for adding a new table.
---

# Drizzle push interactive rename trap

`pnpm --filter @workspace/db run push` (drizzle-kit push) is **interactive** and can
silently propose a **destructive rename** when the live DB has pre-existing schema
drift. Observed: it prompted *"Is agent_proposals table created or renamed from
another table?"* and offered to rename the unrelated existing `user_sessions` table
into `agent_proposals`. Accepting that would have wrecked an unrelated table.

**Why:** drizzle-kit can't tell a brand-new table from a renamed one, so when several
tables differ between schema and DB at once it asks per-table with arrow-key prompts.
Pre-existing drift (tables defined in `lib/db/src/schema` but never pushed) drags your
unrelated change into the same interactive session.

**How to apply:** When adding a *new* table and `db run push` drops into an interactive
rename prompt, do NOT blindly confirm. Abort and create the new table with direct SQL
(via the database/executeSql sandbox) that mirrors the Drizzle column/index/FK
definitions exactly (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT`-safe FKs via
`DO $$ ... EXCEPTION WHEN duplicate_object`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`).
A later clean `push` will then see the table already matches. Verify column types with
`information_schema.columns` afterward. `db run push-force` is also unsafe here — it can
apply the wrong rename without asking.
