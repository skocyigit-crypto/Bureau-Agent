---
name: Replit-managed Stripe connector shape
description: Field names + state of the Replit Stripe connection, and the env-first credential precedence the billing layer relies on.
---

# Replit-managed Stripe connector

The Replit Stripe **connection** (fetched from the connector proxy with
`include_secrets=true`) does NOT match the generic code template. Its `settings`
expose:

- `secret` — the Stripe API secret key (`sk_test_…` / `sk_live_…`). **NOT** `secret_key`.
- `publishable` — `pk_…` (NOT `publishable_key`).
- `account_id` — `acct_…`
- `mcp` — `ek_…` ephemeral key
- `claim_url`, `claimed_at` — it is a Replit-provisioned/managed Stripe account.
- **No `webhook_secret`** is provided.

A freshly provisioned managed account starts in **TEST mode**, `country` per the
account (e.g. FR / `default_currency: eur`), with `charges_enabled:false` and
`details_submitted:false` — it can run test calls but cannot take real money
until the owner completes Stripe onboarding via the claim/go-live flow.

**Rule:** read the secret as `settings.secret ?? settings.secret_key` (accept
either for forward-compat).

**Why:** the official code-template assumed `secret_key`; with the real payload
that key is undefined, so the connector path silently returns null and Stripe
looks "not configured".

## Credential precedence (billing layer)

`resolveCredentials()` in `api-server/src/services/stripe-client.ts`:

1. **Env vars win, checked on EVERY call** (env reads are free) —
   `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. Keeps tests + self-hosting
   deterministic and lets ops set/rotate/remove env take effect immediately.
2. **Connector fallback**, and ONLY the connector fetch is cached (short TTL).
   Never cache the env branch, or env precedence is delayed by the TTL.

**Webhook secret gap:** the connector gives none, so if `STRIPE_WEBHOOK_SECRET`
is also unset the webhook route returns 503 (fail-safe: rejects unverified
events, never accepts them). To go fully live you must provision a webhook
endpoint and set `STRIPE_WEBHOOK_SECRET`, plus seed products/prices and set
`STRIPE_PRICE_{STARTER,PROFESSIONNEL,ENTREPRISE}`.

`getStripeClient()` / `getStripeWebhookSecret()` / `isStripeConfigured()` are all
**async** because of the connector fetch — every call site must `await`.
