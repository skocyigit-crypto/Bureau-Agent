---
name: Dev DB drift + bulk-scan cancel e2e
description: Footguns when syncing the dev DB schema and when driving the document bulk-scan cancel flow via the testing skill.
---

# Drizzle push rename footgun
Running `pnpm --filter @workspace/db run push` (drizzle-kit push) once prompted
an ambiguous resolver: "Is agent_proposals created or renamed from
user_sessions?". Answering "rename" is DESTRUCTIVE — it would drop the live
`user_sessions` table (sessions/auth). NOTE: `drizzle.config.ts` now sets
`tablesFilter: ["!user_sessions"]`, which removes this rename prompt entirely —
never remove that filter.
**Why:** the dev DB has drifted from `lib/db/src/schema` (new tables/cols never
pushed), so push sees a new table and (without the filter) offers a rename of an
unrelated one.
**How to apply:** for targeted needs, additive `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS`. For a full sync, run `push-force`; with the filter, new tables
(agent_proposals, bulk_scan_jobs) are created and `user_sessions` stays intact.

# A drifted DB makes `push-force` STALL — handle it with pre-push ensure scripts
`drizzle-kit push --force` against a DB that drifted from `lib/db/src/schema`
STILL stalls/fails (the `--force` flag does NOT skip these; a non-TTY stdin
silently aborts the whole apply, creating nothing). Two recurring causes, now
fixed reproducibly by idempotent pre-push scripts wired into `push`/`push-force`
(not at app boot — that would be unsafe self-heal DDL):
- **UNIQUE-constraint "truncate?" prompt** on populated tables — the diff is keyed
  on constraint NAME, and legacy DBs use Postgres' `<t>_<c>_key` while drizzle
  expects `<t>_<c>_unique`. `ensure-unique-constraint-names` renames `_key`→
  `_unique` so the diff is a no-op.
- **FK rejected on orphan rows** (Postgres 23503) — child rows referencing a
  missing parent block the FK ADD. `ensure-fk-orphans` cleans them per the
  schema's `onDelete` (set-null → NULL, cascade → DELETE); for append-only
  `audit_logs` it drops the no_update trigger first, which the post-push
  `ensure-audit-append-only` reinstalls. `verify-schema-sync` then asserts the
  required tables/columns exist and `user_sessions` survived.
**Why:** these are legacy-drift artifacts; the SAME blockers hit prod, but fix
prod ONLY via the Replit Publish flow (never prod DDL scripts).
**How to apply:** new legacy-drift FK orphans → add the table/onDelete to
`ensure-fk-orphans.sql`. New required objects → add to `verify-schema-sync.mjs`.

# Org rows can't be deleted (append-only audit)
`DELETE FROM organisations WHERE id=...` fails: it cascades into
`license_audit_log`, which has an append-only trigger that forbids DELETE.
**How to apply:** when cleaning up seeded test orgs, delete documents /
users / subscriptions but leave the organisation row (and its audit rows). A few
inert empty test-org shells will accumulate; that's expected, not a bug.

# Driving the bulk-scan cancel flow in a live e2e (testing skill)
The "Tout analyser" scan has NO artificial delay and (with no VirusTotal/Safe
Browsing keys) is heuristic-only: ~3-4ms per document, one SSE progress
broadcast per doc (~270 events/sec). The Cancel button ("Annuler l'analyse")
appears synchronously on click but is cleared by the terminal SSE event.
**Why it's fiddly:** the testing agent's per-action latency is ~10-11s, so a
small seed finishes before it can click cancel; a huge seed (10000) floods the
React page with SSE updates and can lose the Playwright notebook mid-run.
**How to apply:** seed ~6000 unscanned docs (scan_verdict NULL, file_content
NOT NULL, UNIQUE base64 content so none are skipped as reuse) — long enough to
stay running through the cancel click, light enough to avoid the SSE flood.
