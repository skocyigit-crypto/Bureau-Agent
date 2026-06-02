---
name: Webhook session<->tenant binding
description: Why per-request tenant resolution is not enough when a webhook also keeps server-side per-call session state.
---

# Webhook session must be re-bound to the resolved tenant every turn

Telephony/chat webhooks (Twilio voice, WhatsApp, etc.) resolve the tenant per
request from a provider identifier (e.g. `AccountSid`) and validate the provider
signature. When the same flow ALSO keeps server-side session state keyed by a
call/conversation id (e.g. `sessions.get(CallSid)`), every follow-up request must
assert `session.orgId === resolvedTenant.orgId` before acting on that session.

**Why:** signature validation only proves the request came from *a* tenant that
owns that provider credential. If two organisations share the same provider
account/token (allowed by the config shape), a signed request from org A could
continue or finalize a session that belongs to org B — a cross-tenant leak that
the signature check alone does NOT catch.

**How to apply:**
- After signature validation in every follow-up handler (respond/status/etc.),
  reject (403 / empty response) unless the stored session's org matches the
  resolved tenant's org.
- Make tenant resolution deterministic (stable `orderBy`) so duplicate-credential
  edge cases never attribute a call nondeterministically.
- Persist-side: only set a `fulfilled`/done flag AFTER the DB write succeeds, so a
  failed insert can retry on a later turn instead of silently dropping the outcome.
