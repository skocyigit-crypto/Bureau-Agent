---
name: Driving the live API from a script/test
description: Gotchas when hitting the running api-server over HTTP from a non-browser client (e2e scripts, tooling)
---

# Driving the live API from a non-browser client

When a script/test calls the running api-server over `localhost:80/api/...`:

- **CSRF blocks Origin-less mutations.** The `/api` CSRF middleware returns **403
  "origine manquante"** for any non-GET/HEAD/OPTIONS request without an
  `Origin`/`Referer` header. Send an `Origin` header whose host matches either the
  request host OR an allowed origin (`REPLIT_DOMAINS`/`PUBLIC_URL`/`ALLOWED_ORIGINS`,
  or the Expo domain). Easiest: `Origin: https://<first REPLIT_DOMAINS entry>`.
  **Why:** non-browser clients send no Origin by default → every POST 403s before
  the route runs (looks like an auth/login failure but isn't).

- **Use the stateless bearer, not the cookie.** `POST /api/auth/login` with
  `{ ..., wantsToken: true }` returns an `apiToken` in the JSON body. Send it as
  `Authorization: Bearer <apiToken>` — it hydrates `req.session` (userId, role,
  organisationId) exactly like the cookie, so role guards AND `autoBroadcast`
  (which needs `session.organisationId`) work. **Why:** the web session cookie is
  `__Host-` + Secure, which express-session won't set over a plain-http curl/fetch.

- **A user who has logged in cannot be hard-deleted.** `audit_logs` is append-only
  (trigger forbids both UPDATE and DELETE) and other tables FK to `users` with NO
  ACTION. A successful login writes an audit row → `DELETE FROM users` fails with
  23503, and you can't delete the audit row either. **How to apply:** for test
  cleanup, deactivate + anonymize the user (`actif=false`, scramble email/hash)
  instead of deleting. Never drop/bypass the audit append-only guard.

- **SSRF guard has no test bypass.** `lib/ssrf-guard.ts` blocks loopback/private
  (127/10/0/::1) on BOTH webhook create and delivery — no env to allow it. To
  verify a real outbound HMAC-signed delivery end-to-end you need a genuinely
  public receiver (e.g. webhook.site), not a local listener.
