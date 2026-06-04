---
name: Google OAuth redirect URI resolution
description: How the Google OAuth callback URL is derived per environment and why it must match Google Cloud Console.
---

# Google OAuth redirect URI

`getGoogleRedirectUri()` (api-server `lib/google-auth.ts`) resolves the callback URL
in this precedence: `GOOGLE_REDIRECT_URI` → `PUBLIC_URL`/`APP_URL` → `REPLIT_DOMAINS`
(first entry, https-prefixed) → `REPLIT_DEV_DOMAIN` → `REPL_SLUG.repl.co` → localhost.

**Why:** In a published Replit deployment `REPLIT_DEV_DOMAIN` is NOT set; only
`REPLIT_DOMAINS` carries the real prod host (e.g. `bureau-agent.replit.app`).
Earlier the resolver skipped `REPLIT_DOMAINS`, so prod fell back to `<slug>.repl.co`
or `localhost`, and Google rejected the consent with `redirect_uri_mismatch`
(user-visible symptom: "hata veriyor" when connecting Google). CORS already read
`REPLIT_DOMAINS`; the redirect resolver must use the same source to stay in sync.

**How to apply:**
- The same client_id/secret + redirect URI is reused by `/auth-url`, `/callback`,
  refresh and disconnect, so changing the resolver keeps the whole flow consistent.
- The resolved callback URL must be registered verbatim (scheme+host+path) under
  "Authorized redirect URIs" in the owner's Google Cloud Console OAuth client, or
  Google still rejects it regardless of code. Both the dev `*.spock.replit.dev`
  and prod `*.replit.app` callbacks should be added.
- For deterministic prod behavior with multiple `REPLIT_DOMAINS` entries, pin
  `GOOGLE_REDIRECT_URI` explicitly (optional; single-domain resolves fine).

## Consent-screen "app not verified / access blocked" is a SEPARATE blocker

Symptom (owner's words): "Erişim engellendi / bu uygulama doğrulanmadı". This is the
Google **OAuth consent screen** state, NOT `redirect_uri_mismatch` and NOT fixable in
code. The app requests sensitive/restricted scopes (gmail.modify, calendar, drive).
**Why:** in Testing mode only emails added under "Utilisateurs de test" can connect,
and they must click "Paramètres avancés → Continuer" past the unverified warning;
for production with restricted scopes Google requires full app verification (privacy
policy, demo video, CASA). **How to apply:** never try to "fix" this from code — guide
the owner to the console (add test users or publish + verify). The status endpoint
surfaces `redirectUri`; the buro-ajani Plateformes tab shows a French note + a
super-admin-only panel with the exact redirect URI (copy) so the owner can self-serve.
