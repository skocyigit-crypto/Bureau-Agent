---
name: Tenant organisation_id NOT NULL hardening
description: Which tenant tables can take NOT NULL organisation_id vs which must stay nullable, and why.
---

# Adding NOT NULL to organisation_id (tenant hardening)

When hardening tenant tables, "0 nulls in dev right now" does NOT mean null is
invalid. Before adding `.notNull()` to an `organisation_id` column, check the
code paths that INSERT into it — some legitimately produce a null org.

**Rule:** add NOT NULL only when every insert path guarantees an org; otherwise
keep the column nullable (the FK still works nullable).

**Why:** an over-eager NOT NULL surfaces as api-server typecheck errors (insert
types) and would crash legitimate org-less inserts at runtime. `typecheck:libs`
does NOT catch these — you must run the api-server typecheck after a schema
change.

**How to apply — known classifications in this repo:**
- KEEP NOT NULL when the handler guards org first or a sibling insert asserts it:
  - `daily_reports` — route guards `if (!orgId) return 403` before insert.
  - `calendar_events` — `calls.organisation_id` is NOT NULL, so `call.organisationId!` is safe.
- KEEP NULLABLE — these have legitimate org-less rows:
  - `payments` — bank-upload rows are unreconciled; org is set only at matching time.
  - `google_oauth_tokens` — isolation is by `userId`; session org can be null (super-admin).
  - `license_audit_log` — `logLicenseEvent(orgId: number | null)` records global events.

Reverting a column from NOT NULL back to nullable is a normal drizzle push (drops
the constraint); apply via `pnpm --filter @workspace/db run push-force`.
