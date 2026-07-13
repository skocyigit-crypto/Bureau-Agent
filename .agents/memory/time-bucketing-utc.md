---
name: Time-series day bucketing must be UTC-explicit
description: When a daily-counter SQL query feeds a JS gap-filled UTC date series, the SQL bucket must also be UTC or boundary days shift.
---

# Day bucketing must force UTC when paired with JS UTC gap-fill

Rule: if an endpoint returns a per-day series whose date keys are computed in JS
as UTC (`date.toISOString().slice(0,10)` / `setUTCHours`/`setUTCDate`), the SQL
that produces the buckets MUST also truncate in UTC:
`date_trunc('day', created_at at time zone 'UTC')` — both in the SELECT formatter
AND the GROUP BY.

**Why:** `date_trunc('day', created_at)` on a `timestamptz` column buckets in the
DB **session timezone**, not UTC. If the DB/session TZ != UTC, the SQL day key and
the JS UTC gap-fill key disagree on rows near midnight, so a `Map` lookup misses and
the boundary day's counts land on the wrong day (or read as zero).

**How to apply:** any new time-series aggregation (daily/weekly counters joined to a
JS-generated date axis) — keep the SQL truncation timezone and the JS axis timezone
identical. Default to UTC on both sides unless the product explicitly wants a
tenant-local calendar.
