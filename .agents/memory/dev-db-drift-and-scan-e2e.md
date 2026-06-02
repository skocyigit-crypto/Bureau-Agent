---
name: Dev DB drift + bulk-scan cancel e2e
description: Footguns when syncing the dev DB schema and when driving the document bulk-scan cancel flow via the testing skill.
---

# Drizzle push rename footgun
Running `pnpm --filter @workspace/db run push` (drizzle-kit push) prompts an
ambiguous resolver: "Is agent_proposals created or renamed from user_sessions?".
Answering "rename" is DESTRUCTIVE — it would drop the live `user_sessions`
table (sessions/auth). The prompt is non-TTY-friendly and can silently abort the
push without applying changes.
**Why:** the dev DB has drifted from `lib/db/src/schema` (new tables/cols never
pushed), so push sees a new table and offers a rename of an unrelated one.
**How to apply:** for targeted needs, prefer additive `ALTER TABLE ... ADD
COLUMN IF NOT EXISTS` matching the schema. For a full sync, choose "create
table" (never rename) and keep `user_sessions` intact.

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
