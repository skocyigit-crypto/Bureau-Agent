---
name: vitest singleFork env contamination
description: Why one test file's process.env mutation leaks into others in api-server, and how to gate opt-in/live tests safely.
---

# vitest singleFork → process.env leaks across files

`artifacts/api-server/vitest.config.ts` uses `pool: "forks"` with
`forks.singleFork: true` → **all test files run in ONE process**. Any
`process.env.X = …` a file sets at module load is visible to every other test
file. File execution order is the vitest sequencer's (size/heuristic based),
**not alphabetical**, so contamination is order-dependent and flaky.

Concrete bite: `stripe-webhook-idempotency.test.ts` sets
`process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_construct_event"`. The live
e2e test inferred "a real test key is present" from
`STRIPE_SECRET_KEY.startsWith("sk_test_")` and tried real Stripe network calls
with the dummy → 401.

**Rule:** any test that auto-activates based on an env var another test might set
must exclude known dummy sentinels (e.g.
`startsWith("sk_test_") && !secret.includes("dummy")`) or gate on a dedicated
opt-in flag no sibling touches. Don't assume per-file env isolation here.
