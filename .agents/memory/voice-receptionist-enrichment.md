---
name: Voice receptionist enrichment (anonymous caller)
description: Safe + low-latency rules for enriching the inbound phone AI (RAG, calendar availability) when the caller is anonymous/untrusted.
---

# Voice receptionist enrichment

The inbound phone AI (`voice-receptionist.ts`) answers an **anonymous, unauthenticated**
caller over Twilio, one turn at a time. Any context you inject into its prompt is
two-sided risk: latency (the caller is on a live line) and disclosure (the model may
read injected internal data aloud if asked).

## Rules when adding any new enrichment (KB/RAG, availability, contacts, etc.)

1. **Latency budget, always.** Wrap every per-turn enrichment in `withTimeout(p, VOICE_RETRIEVAL_TIMEOUT_MS, fallback)`
   (default 3000ms, env-overridable). KB search can trigger an embedding call + scan
   thousands of chunks; a slow path must degrade to "no enrichment this turn", never
   block the voice round-trip. Even the `/incoming` greeting path bounds its lookups.
2. **Disclosure guardrails in the system instruction, not just feature flags.** Inject a
   hard CONFIDENTIALITE block: never read out internal-only data (busy slots are
   USAGE INTERNE — only say if a requested time is free / propose an alternative),
   never recite whole documents, never disclose other clients' data, and refuse +
   offer to take a message if asked to dump internal info or ignore instructions.
3. **Org-scoped + best-effort.** Enrichment helpers (`retrieveKnowledge`, `fetchBusySlots`)
   are org-scoped and try/catch → empty fallback. KB is tenant-only (same corpus as the
   in-app assistant); there is **no `phone_public` allowlist** yet — if non-public docs
   get indexed they are reachable by phone. A per-doc phone-public tag is the proper
   future fix (schema + UI = major change, ask the owner first).
4. **Single-pass, keep `GEMINI_FLASH_MODEL`.** No multi-hop tool loop on the phone path —
   it would multiply latency. Enrich the one prompt instead of looping.

**Why:** architect review flagged that capability gains for the phone agent are only
acceptable if they don't leak internal data to an anonymous caller or stall the live call.

## Known-caller actions: authorize by relatedContactId, NOT phone suffix

When a *known* caller acts on "their own" data over the phone (read their next
appointment, cancel an appointment), the caller is authenticated only by inbound
number — weak auth. Matching their rows by last-9-digit phone suffix
(`regexp_replace(...) LIKE '%suffix'`) is **not safe**: two contacts in the same
tenant can collide by suffix/format, so a phone-suffix `UPDATE ... SET status=annule`
can cancel (or a SELECT can disclose) a *third party's* appointment.

**Rule:** bind on the strong key `calendar_events.relatedContactId`. Set
`relatedContactId: session.callerContactId` at appointment creation. For
reads/cancellations use the shared `ownAppointmentMatch(contactId, phoneLike, hasDigits)`
predicate: `relatedContactId = contactId` OR (phone match **only when**
`relatedContactId IS NULL`, i.e. legacy/unlinked rows). Never phone-match a row that
already belongs to a different contact.

**Also:** outbound SMS to a caller/owner must validate strict E.164
(`/^\+[1-9]\d{6,14}$/`), not just `startsWith("+")`, to avoid cost/abuse on masked or
malformed numbers. And the dup-write guard `session.fulfilled` must actually be set
`true` after each successful persist — it was a latent no-op, so any repeated
`outcome` re-wrote appointments/messages/tasks and re-sent SMS.
