---
name: Large CSV/data export streaming
description: How large list exports must be returned so they neither truncate silently nor OOM, and how to keep error semantics clean.
---

# Large export streaming pattern

Large list exports (messages, audit logs, contacts, etc.) must NOT load a single
capped `.limit(N)` query into memory and `res.send` it. That silently truncates
past the cap and pressures memory.

Use this pattern instead:
- Keyset paginate on the primary key descending (`lt(table.id, lastId)` starting
  from `Number.MAX_SAFE_INTEGER`), batch size ~1000. Keyset, not offset, so cost
  stays flat over deep exports.
- Wrap each batch read in `withDbRetry` (idempotent reads only).
- Write the CSV header AND set the `Content-Type`/`Content-Disposition` headers
  only AFTER the first batch query succeeds, then `res.write` each chunk and
  `res.end()` at the end.

**Why:** if the very first query fails before any bytes go out, `!res.headersSent`
is still true, so you can return a clean `500 JSON`. Once a chunk has been written,
headers are sent and you can only `res.end()` — a truncated file, not a fake 200
with a JSON error body in the middle of the CSV.

**How to apply:** any new bulk export endpoint. The catch block must branch on
`res.headersSent`: `false` → `res.status(500).json(...)`, `true` → `res.end()`.
