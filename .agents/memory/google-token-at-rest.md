---
name: Google OAuth tokens encrypted at rest
description: How google_oauth_tokens access/refresh tokens are encrypted, and the lazy backfill that migrates legacy plaintext rows.
---

# Google OAuth tokens at rest

`google_oauth_tokens.access_token` / `refresh_token` are encrypted at rest with the
canonical `lib/crypto` (AES-256-GCM, `DATA_ENCRYPTION_KEY`, `enc:v1:` prefix) — the
same layer used for webhook/API-key secrets. `client_secret` uses a *separate*
SESSION_SECRET-derived scheme (`encryptSecret`, `:`-delimited) — don't conflate them.

Helpers live in `lib/google-auth.ts`: `encryptToken` (write), `decryptToken` (read,
legacy-tolerant: passes through non-`enc:v1:` values), `ensureEncryptedToken`
(idempotent encrypt-if-not-encrypted, for keeping an existing value on rewrite),
`ensureTokenRowEncrypted` (opportunistic in-place backfill of a row).

**Why the lazy backfill exists:** the refresh flow only rewrites `access_token`;
Google rarely returns a new `refresh_token`, so a legacy plaintext refresh_token would
*never* get re-encrypted by normal writes. So every read site that loads a token row
calls `ensureTokenRowEncrypted` before use, and the OAuth callback's "keep existing
refresh_token" branch uses `ensureEncryptedToken` (NOT `ensureTokenRowEncrypted` — the
same UPDATE re-sets refreshToken and would clobber a pre-update DB encryption with
in-memory plaintext; encrypt the fallback value inline instead).

**How to apply:** any NEW code path that reads or writes these token columns must go
through these helpers — never store a raw token or pass a stored value to
`setCredentials` without `decryptToken`. Prod legacy rows migrate lazily on first use
(no boot migration/DDL, per the prod-schema rule); dev table was empty so no one-time
backfill was needed.
