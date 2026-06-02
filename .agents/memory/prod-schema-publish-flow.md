---
name: Production schema changes & the user_sessions rename trap
description: How prod schema changes actually reach production here, and the legacy user_sessions table that makes drizzle-kit push --force destructive.
---

# Production schema changes go through Publish, not direct DDL

Replit's managed Postgres makes the **production** DB read-only to the agent's
`executeSql({ environment: "production" })` — DDL there always fails. The ONLY
supported way to change prod schema is the **Publish flow**: it introspects the
dev DB and the prod DB, diffs them, and applies the diff to prod on publish.

**How to apply a schema change so it reaches prod:**
1. Edit the schema source of truth (`lib/db/src/schema/*.ts`).
2. Make the **dev** DB match (via safe additive SQL or the dev-side push).
3. Verify the feature in dev.
4. Tell the user to **re-publish** — that carries dev→prod.

Do NOT write migrate-prod scripts, deploy-build `db:push` hooks, or startup DDL.

**Why:** tasks sometimes claim "dev was already synced, only prod needs it" — do
not trust that. Re-check the dev DB; it has been found missing the columns/table
the task assumed were present.

# The user_sessions → agent_proposals rename landmine

The dev DB carries a **legacy `user_sessions` table** (had live rows) that is NOT
in the schema source (auth is stateless/bearer per `users.ts`). `post-merge.sh`
runs `pnpm --filter db push-force` = `drizzle-kit push --force`. When a NEW table
(e.g. `agent_proposals`) is added to the schema while `user_sessions` is still an
orphan in the DB, drizzle-kit guesses an ambiguous **rename `user_sessions →
agent_proposals`** and `--force` applies it non-interactively — destroying session
rows and mis-creating the new table.

**How to apply safely:** create the new table in dev with explicit additive SQL
(`CREATE TABLE IF NOT EXISTS …`, `ADD COLUMN IF NOT EXISTS …`) BEFORE any
push-force runs. Once the table already exists, the rename ambiguity disappears.
The Publish flow (dev-DB vs prod-DB diff) is unaffected by this trap because both
DBs keep `user_sessions`, so it sees only an additive new table.
