---
name: Stripe webhook idempotency & invoice dedupe
description: Non-obvious Stripe delivery semantics that shape how the webhook + invoice sync must dedupe; getting either wrong silently loses or doubles money records.
---

# Stripe webhook idempotency & invoice dedupe

Two Stripe delivery facts drive the design of `/api/stripe/webhook` and the
`stripe-sync` handlers. Neither is visible from the code alone — they come from
how Stripe actually delivers events.

## 1. One payment fires TWO events with different event ids
A single successful subscription payment emits BOTH `invoice.paid` AND
`invoice.payment_succeeded`. They have **distinct `event.id`s**, so event-level
dedupe (keyed on `event.id`) lets both through, and both route to the same
`handleInvoicePaid` → two invoice rows per payment.

**Rule:** dedupe invoice persistence on the **Stripe invoice id**, not the event
id. `invoices.stripeInvoiceId` is a nullable column with a UNIQUE index +
`onConflictDoNothing(target: stripeInvoiceId)`. Nullable-unique is intentional:
Postgres treats NULLs as distinct, so legacy/manual non-Stripe invoices (NULL id)
still insert freely.

## 2. Webhook dedupe must be a processing→processed STATE MACHINE
**Why:** if you write the event-id dedupe row *before* running the handler (or
mark it "processed" up-front), a handler that then throws returns 500, Stripe
retries the same event id, and the retry is skipped as a "duplicate" — the
business action (invoice/subscription sync) is **permanently lost** on any
transient DB/app failure.

**How to apply:** `stripe_webhook_events` has a `status` column.
1. Claim the event as `status:"processing"` via insert + onConflictDoNothing.
2. On conflict (row already exists): skip ONLY if existing status is
   `"processed"`. A row still at `"processing"` = a prior attempt crashed (or a
   concurrent delivery) → **reprocess** (all handlers are idempotent).
3. Run the handler; flip to `"processed"` ONLY after it succeeds.
4. Handler failure → return 500, leave row at `"processing"` so the retry replays.

Corollary: handlers must rethrow real persistence errors (not swallow them) so
the webhook returns 500 and Stripe retries. `handleInvoicePaid` swallows ONLY the
duplicate case (already absorbed by onConflictDoNothing) and rethrows everything
else.

## Plan resolution fallback
`handleSubscriptionUpdated` resolves the plan from env price ids first
(`getPlanForPriceId`), then falls back to `subscription.metadata.plan` (we stamp
it at checkout). Validate the fallback: must be `in PLANS` and `!== "essai"`.
Without it, a misconfigured/unset `STRIPE_PRICE_*` in an environment silently
leaves the plan and its limits un-updated on renewal/update events.

## Testing without a live key
Handlers are plain functions over Stripe-shaped objects — test them against the
real dev DB by feeding mock Stripe objects (no key needed). Mock
`../services/license-audit` and `../services/email` in those tests: the
`license_audit_log` append-only trigger (no_delete) otherwise blocks deleting the
test org during cleanup. The live e2e test is `describe.skipIf(!sk_test_…)`.
