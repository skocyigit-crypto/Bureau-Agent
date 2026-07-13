---
name: Google connection model
description: Which Google auth mechanism every Google-facing surface must use
---

# Google connection model — always per-user OAuth, never the shared connector

The app standardizes on **per-user OAuth** for all Google access: tokens live in
`google_oauth_tokens` (keyed by `userId`), and each surface builds an
`google.auth.OAuth2` client from them (the `getAuthClient(userId)` pattern, e.g.
in `gmail.ts` / `google-workspace.ts`). The OAuth flow + scope map live in
`routes/google-oauth.ts` (`GOOGLE_SCOPES_MAP`).

**Why:** This is multi-tenant SaaS — each license holder must see THEIR OWN
Gmail/Drive/Calendar. The Google Workspace "Hub" was once the only surface using
the shared `@replit/connectors-sdk` `ReplitConnectors().proxy()` (a single shared
account) plus a hardcoded "connected" status, so customers saw a shared account /
false "Connecté". That was migrated to per-user OAuth.

**How to apply:**
- Never reintroduce `ReplitConnectors`/`connectors.proxy` for Google data, and
  never hardcode connection status. Derive status from the user's token (exists =
  authenticated, `expiresAt > now` = valid, per-app connected = required scope
  present in `token.scope`).
- Any new per-app scope check must stay aligned with `GOOGLE_SCOPES_MAP`.
- **Never request the full `GOOGLE_SCOPES_MAP` on a default "connect" — it 403s the
  whole consent.** Google fails the ENTIRE consent with a generic *"403. That's an
  error… you do not have access to this page"* (not the OAuth "Accès bloqué" page)
  if even ONE requested scope's API is disabled in the Cloud project or isn't
  available to the account type. `keep` is Workspace-Enterprise-ONLY; `photos`,
  `youtube`, `chat`, `forms`, `slides`, `meet` are commonly unenabled. The default
  connect must request only the broadly-available core (`DEFAULT_SERVICES` in
  `routes/google-oauth.ts`: gmail/calendar/drive/docs/sheets/contacts/tasks); the
  rest stay opt-in per service. Each requested scope still needs its API enabled in
  the project's API Library.
- A Google API call that fails *after* a token exists is usually a missing scope,
  not a disconnect — degrade gracefully (e.g. empty list) instead of signalling
  "non_connecte".
- **Server-side selection of a Google token must always be scoped to a principal**
  (a `userId`, or `users.role` for platform-owned actions). Never `select().from(
  google_oauth_tokens)` with no `where` and use "whichever is newest" — that picks
  an arbitrary customer's account and leaks cross-tenant. The platform DB-backup
  fallback (super-admin-only) must join `users` and filter `role='super_admin'`
  so the encrypted backup never lands in a customer's Drive; fail closed (return
  null) if the owner has no Drive token rather than borrowing a tenant's.
