---
name: Autonomous email inbox
description: How the autonomous Gmail agent surfaces reply drafts via proactive suggestions, and why it lives outside the deterministic engine.
---

# Autonomous email inbox (Gmail agent)

Background service scans each org's Gmail inbox, AI-triages, and creates
`email_reply_needed` proactive suggestions carrying a pre-generated, editable
reply draft in `actionPayload`. Approval-and-send only — NEVER auto-sends.

## Key decisions (non-obvious)

- **`email_reply_needed` is NOT in the proactive engine's `DETECTOR_TYPES`.** Its
  whole lifecycle (create / auto-resolve) lives in the autonomous-inbox scan, not
  in `runProactiveForOrg`.
  **Why:** the signal source is Gmail, not the DB tables the deterministic
  detectors read; mixing it into DETECTOR_TYPES would let the generic engine
  prune/own rows it can't actually evaluate.

- **Auto-resolve must NOT key off "absent from the scan sample".** The inbox scan
  fetches only a capped first page (`AUTONOMOUS_INBOX_SCAN_SIZE`, default 25, no
  pagination). A pending thread missing from that subset is NOT proof it was
  answered — in a busy inbox it just scrolled off. Resolve only after a DIRECT
  per-thread Gmail check (`threads.get`): last message has `SENT` label (we
  replied), thread has no `INBOX` message left (archived), or thread 404s
  (deleted). Threads still in INBOX with no reply stay pending. Skipped entirely
  when triage failed (answered-state unknown).

- **Gmail is per-user, the proactive engine is per-org.** A "scanning user" is
  picked per org (active user with `google_oauth_tokens`, preferring
  administrateur/super_admin). That same `scannedByUserId` is stored in the
  payload and reused for BOTH scanning and sending the approved reply (thread
  reply via In-Reply-To/References + threadId).

- **No DB last-run marker for the cron** (unlike send-crons). Because it never
  auto-sends, a re-scan after restart is idempotent: the pending unique index
  `(org, dedupeKey)` + ON CONFLICT DO NOTHING prevents duplicate suggestions; the
  only cost is one extra IA triage call (quota-bounded). An in-memory overlap
  guard is enough.

- **Send-reply route is authz- and race-sensitive.** Org-level suggestions are
  visible to ALL org users, but the reply is sent FROM the scanning user's Gmail
  (`scannedByUserId`, usually a manager). So send-reply must (a) authorize: allow
  only the mailbox owner OR a manager (administrateur/super_admin), else it's
  impersonated sending / privilege escalation; (b) claim atomically before
  sending — `UPDATE ... SET status='accepted' WHERE status='pending' RETURNING`,
  treat 0 rows as already-sent (409) — to stop double-send from two clicks/tabs;
  (c) on send failure, roll the status back to `pending` so the user can retry.

- **Suppression / learning reuse the existing loop.** Sending a reply =
  `accepted` + feedback `up` + `bumpPreferenceFromFeedback`. "Rejeter" in the UI
  = dismiss + `down`. New `email_reply_needed` creation is skipped if the type is
  in `getSuppressedSuggestionTypes(org)` (urgent severity is never suppressed,
  matching the engine's policy).

- **Cost bound:** one IA triage call per scan (batch ≤25 inbox msgs) + at most
  `AUTONOMOUS_INBOX_MAX_DRAFTS` draft calls (critiques first), all via
  `assertAiQuota`. Cron cadence is deliberately slower than the deterministic
  engine (30 min vs 10 min) because Gmail+IA is heavy.
