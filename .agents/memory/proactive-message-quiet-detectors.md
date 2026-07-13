---
name: Message-SLA & quiet-customer proactive detectors
description: How the two newer deterministic detectors identify inbound messages and avoid overlap with existing detectors
---

Two deterministic proactive detectors complement the originals; their non-obvious
design constraints:

**Inbound vs outbound messages live in ONE table (`messages`) with NO `direction`
column.** The deterministic proxy is `created_by`: an employee-authored (outbound)
message sets `createdBy` from the session; externally-received (inbound) messages
(e.g. AI voice receptionist) insert with `createdBy = NULL`. WhatsApp messages are
a SEPARATE table (`whatsapp_messages`, which DOES have `direction`) — not used here.
**Why:** any new "inbound message" logic on `messages` must filter `createdBy IS
NULL`, not look for a direction column.

**`message_sla_breach` is partitioned from `urgent_message` by PRIORITY to avoid
duplicate suggestions on the same message.** urgent_message = priority `haute`,
unread, >2h (a read/triage signal). message_sla_breach = priority NOT `haute`,
inbound, older than `PROACTIVE_MESSAGE_SLA_HOURS` (default 8h), with no later
outbound reply to the same phone number (a response-time signal). "Answered" =
the latest outbound (`createdBy NOT NULL`) reply to that phone is newer than the
inbound; resolution is reply-based, not read-based. Bounded by a 14-day lookback
so very old unanswered messages auto-resolve out of the window.

**`quiet_customer` window [QUIET_AFTER_DAYS=21, INACTIVE_CONTACT_DAYS=60) keeps it
DISJOINT from `inactive_contact`.** quiet_customer uses `contacts.lastCallAt` +
`totalCalls >= 2` (a previously-engaged customer that just went quiet);
inactive_contact uses `contacts.updatedAt < 60d`. Different timestamps, different
windows → clean handoff (crossing 60d drops quiet, inactive may pick up). **Why:**
when tuning thresholds, keep the upper bound of quiet below inactive's floor or
the two will double-fire on the same contact.

Both reuse existing `open_messages` / `open_contact` actionTypes so frontends need
no ACTION_NAV changes (only TYPE_META labels added in web + mobile assistant-proactif).
The pure reply-matching core is `selectUnansweredInbound` (exported, unit-tested).
