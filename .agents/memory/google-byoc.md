---
name: Google BYOC (per-org OAuth credentials)
description: Each org stores its own google_client_id/secret; rules for token binding, refresh, and credential rotation.
---

# Google "bring your own credentials" (BYOC)

Each organisation stores its OWN Google OAuth app credentials (client_id +
encrypted client_secret) in `google_app_credentials` (org-scoped, unique
organisationId). Connect/auth-url use STRICT org creds (no env fallback) so a
missing config returns a clear `needsConfig` instead of Google's cryptic
`invalid_client`. Refresh/disconnect/background services use env fallback for
legacy orgs.

**Rule — refresh_token is bound to the issuing client_id.**
A Google refresh_token can only be redeemed (and revoked) with the SAME
client_id/secret that issued it. Therefore:
- Refresh/revoke must resolve credentials from the **token row's** org
  (`token.organisationId ?? session/user org`), NOT blindly from the session.
- When an org's `client_id` changes (or is first set, or is deleted reverting to
  env), all existing `google_oauth_tokens` for that org's users become
  unredeemable and MUST be purged to force reconnect — otherwise refresh fails
  silently once the access token expires.

**Why:** placeholder/mismatched env creds caused `invalid_client`; mixing creds
across the connect-vs-refresh path is the classic latent BYOC failure.

**How to apply:** any new Google background service must build its OAuth2 client
from the token row's org via the shared helper (env fallback), never hardcode env
creds or gate startup on `process.env.GOOGLE_CLIENT_ID`. Credential CRUD
(`/app-credentials` GET/POST/DELETE) is admin/super_admin only; the secret is
AES-256-GCM encrypted (key from SESSION_SECRET||JWT_SECRET).
