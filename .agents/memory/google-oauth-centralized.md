---
name: Google OAuth (centralized SaaS model)
description: One global OAuth client from server env for all tenants; per-user token isolation; no credential UI.
---

# Google OAuth — centralized SaaS model

The platform uses ONE global Google OAuth application. Client ID/Secret live ONLY
in server env (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). Each end user simply
connects THEIR own Google account; the app credentials are never per-org and never
shown in the UI.

**Rule — OAuth-client paths must use env-only credentials.**
`getOrgGoogleCredentials(orgId, { envOnly: true })` returns the global env client and
IGNORES any legacy `google_app_credentials` row. EVERY OAuth2 client constructor must
pass `envOnly: true` — not just the route handlers but ALSO the background services
(calendar-sync, auto-pointage, drive-backup). `envFallback: true` still resolves org
rows first, so it must NOT be used for any OAuth client path. Covered call sites:
auth-url, callback, refresh, disconnect, `getAuthClientForUser`, `/status` + `/config`
probes, and the three background services. The `getOAuth2ClientForOrg(orgId)` helper is
hardwired to envOnly.

**Why:** a per-org "bring your own credentials" model was tried and reverted. With
org-first resolution, any tenant that had saved its own client would override the
global one — breaking the single-client guarantee. A refresh_token can only be
redeemed with the SAME client_id that issued it, so connect AND refresh must use the
identical global client or refresh fails silently once the access token expires.

**How to apply:**
- Never reintroduce Client ID/Secret input fields or `/app-credentials` CRUD, and
  never surface `needsConfig`/technical OAuth errors to users — only the blue
  "Se connecter avec Google" button + a generic "réessayez" toast.
- Per-user isolation stays in `google_oauth_tokens` (userId-scoped). That is correct
  and unchanged.
- The `google_app_credentials` table + `encryptSecret/decryptSecret` helpers remain
  in the codebase (dropping is destructive) but are dead for the OAuth flow. Don't
  wire them back into connect/refresh.
- Setup that only the operator can do: put REAL values in `GOOGLE_CLIENT_ID`/
  `GOOGLE_CLIENT_SECRET` (placeholders cause `invalid_client`) and register the
  redirect URI `https://<domain>/api/google-oauth/callback` (from `getGoogleRedirectUri`)
  in Google Cloud Console.

**Rule — never build a Google service client inline; use the per-service factories.**
`lib/google-auth.ts` is the single source of truth: `createOAuthClient(orgId?)` is the
only bare-client constructor, and `getAuthClientForUser(userId)` sets `expiry_date` for
proactive refresh AND attaches `oauth2Client.on("tokens", …)` which persists refreshed
access/refresh tokens ENCRYPTED back to DB. App code must call the typed factories
`getGmailForUser / getCalendarForUser / getDriveForUser / getDocsForUser /
getSheetsForUser / getTasksForUser` (return a ready client or null) — never
`google.gmail({auth})` + a hand-rolled `setCredentials/refreshAccessToken/UPDATE` block.
**Why:** those manual refresh blocks were duplicated across routes/services and drifted;
centralizing means refresh + at-rest encryption happen once and consistently.
**How to apply:** intentional exceptions stay out of this layer — `google-oauth.ts`
`/refresh` (explicit user-triggered force-refresh endpoint, its whole purpose) and
`services/email.ts` (Replit connector system mail, different auth model). `services/
google-drive-backup.ts` (service-account, platform backups) is also separate; align it
only if "all Google" must be truly universal.
