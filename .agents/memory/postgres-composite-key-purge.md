---
name: Postgres composite-key replace-set purge
description: Safe way to delete stale rows in a "recompute" job that upserts a current set, when uniqueness is a multi-column tuple.
---

When a recompute/mining job rebuilds an org-scoped set by upserting the current
rows, it must also delete rows that are no longer in the current set, or stale
preferences/patterns linger forever and violate the intended window (e.g. 90-day
mining). Drizzle has no clean composite `notInArray`, so concatenate the unique
tuple in SQL and compare against the kept list:

```
const keyExpr = sql`${t.colA} || ${SEP} || ${t.colB}`;
kept.length > 0
  ? db.delete(t).where(and(eq(t.orgId, orgId), notInArray(keyExpr, kept)))
  : db.delete(t).where(eq(t.orgId, orgId)); // empty set => purge all for org
```

**Why:** the empty-`kept` branch matters — `notInArray(x, [])` is a no-op in SQL,
so without it a fully-cleared set would never be purged.

**Critical separator rule:** the separator MUST NOT be U+0000 (NUL). Postgres
text/varchar rejects NUL bytes at runtime ("invalid byte sequence" / unterminated),
and this error does NOT show up in TypeScript typecheck — it only fails when the
delete actually runs. Use U+001F (unit separator) or another control char that is
valid Postgres text and improbable in real data.

**How to apply:** any org-scoped "rebuild the set" service (ai-learning
recompute/mining is the first instance) should follow this purge-after-upsert
pattern with a non-NUL separator.
