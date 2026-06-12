---
name: Expense auto-capture flow
description: How incoming receipts auto-flow into the depenses ledger; cost & idempotency constraints.
---

# Expense auto-capture (dépenses / gider defteri)

Incoming receipts (document uploads + Gmail attachment saves) fire a background
Document-AI analysis and, if `facture`/`note_frais` with a positive amount,
create a `depenses` row at status `en_attente` (review queue).

**Why it matters / non-obvious constraints:**
- **AI cost:** capture runs an LLM analyze on EVERY eligible upload/attachment
  (PDF/image/Excel/CSV). Gated by org toggle `expenseAutoCaptureEnabled`
  (default true) — keep that gate if adding new capture entry points, or cost
  fans out silently.
- **Idempotency is by `documentId`, not just dedupeHash.** Both the upload route
  and the Gmail route call `triggerExpenseCapture`; capture skips if a depense
  already exists for that documentId. So adding more trigger sites is safe.
- **Duplicate detection (vendor+TTC+date) WARNS, never blocks** — sets
  `duplicateOfId`, UI shows a badge, approval still allowed.
- **Treasury coupling:** approved + `a_payer` expenses are baked into
  treasury-risk Monte Carlo as DETERMINISTIC daily outflows (no randomness).
  The proactive cash-crunch cron picks this up automatically — no extra wiring.

**How to apply:** new capture sources → call `triggerExpenseCapture` (it does
MIME + org-toggle gating + fire-and-forget). New ledger consumers of "what's
owed" → query status=approuve AND payment_status=a_payer.
