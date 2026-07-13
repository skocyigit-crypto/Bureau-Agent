---
name: Assistant validateArgs strips undeclared args
description: Why every assistant tool param (incl. booleans) must be declared in `fields`, not just in `parameters`.
---

`validateArgs` in `artifacts/api-server/src/services/assistant-tools.ts` iterates
ONLY over the tool's `fields` spec and copies declared keys into `out`. Any arg
present in the JSON-schema `parameters.properties` but NOT in `fields` is silently
dropped before reaching `execute`.

**Why:** `find_event`'s `includePast` flag was documented in `parameters` and read
in `execute` (`a.includePast === true`) but never added to `fields`, so the flag
was dead — `find_event` always returned upcoming-only regardless of the model
passing `includePast: true`. Caught only by an end-to-end DB test.

`FieldSpec` originally had no `boolean` kind, so booleans couldn't even be
declared. Added `{ kind: "boolean" }` (coerces "true"/"false" strings too).

**How to apply:** when adding/changing an assistant tool param, add it to BOTH
`parameters.properties` (for the LLM) AND `fields` (for runtime validation +
pass-through). For booleans use `kind: "boolean"`.
