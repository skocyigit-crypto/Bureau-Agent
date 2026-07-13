---
name: Retiring a proactive detector
description: How to remove a proactive-engine detector without leaving orphaned pending suggestions.
---

# Retiring a proactive detector

When you delete a detector from the proactive engine, its existing `pending`
`proactive_suggestions` rows will otherwise live forever: the auto-resolution
step only closes rows whose `type` is in `DETECTOR_TYPES`.

**Rule:** removing a detector = remove its type from `DETECTOR_TYPES` AND add the
type string to `RETIRED_DETECTOR_TYPES`. The stale filter matches either list, so
the next tick flips old pending rows to `done` deterministically.

**Why:** manual `DELETE`/`UPDATE` SQL only fixes the dev DB. Prod schema/data is
applied via Publish and gets no boot migration or manual SQL, so prod would keep
showing dead suggestions (often linking to a removed page → 404). Letting the
engine self-resolve on its next tick fixes every environment with no migration.

**How to apply:** never reuse a retired type string. If you also dropped the
backing table/columns, apply that to dev via `push-force`; prod picks it up on the
next Publish (never run push against prod).
