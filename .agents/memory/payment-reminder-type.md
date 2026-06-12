---
name: Payment-reminder proactive type
description: Why payment_reminder is collection-critical, locally-managed, and never suppressed in the proactive engine.
---

# Payment-reminder proactive type

`payment_reminder` suggestions (overdue client-invoice reminders) are deliberately
NOT in `DETECTOR_TYPES`/`RETIRED_DETECTOR_TYPES`. Their full lifecycle (create,
auto-resolve, send) lives in its own service, invoked at the end of
`runProactiveForOrg` in a try/catch — so it inherits the 10-min cron + manual
"Analyser maintenant" without any new cron wiring.

**Why:** It needs a custom send flow (editable draft → human one-click send via
email or SMS, never autonomous) and a custom auto-resolve (invoice paid/cancelled),
which the generic detector candidate pipeline can't express.

**How to apply:**
- NEVER apply `getSuppressedSuggestionTypes` / feedback suppression to this type —
  collection is critical, it must never be fully silenced. Spam is controlled by
  hysteresis/spacing (min interval) keyed on BOTH the invoice's actual last-sent
  marker AND a recent-suggestion window (covers dismiss), not by suppression.
- The ONLY send path is the dedicated send route (atomic pending→accepted claim,
  revert on failure, then bump the invoice's reminder counter/date). Don't add an
  autonomous sender.
- If adding similar "act-on-it" proactive types (draft + human send), mirror this
  pattern instead of forcing them through the deterministic detector candidates.
