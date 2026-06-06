---
name: Detail-page route-id fetch race
description: Raw fetch keyed by a route param inside useEffect needs a captured-vs-current id guard, or fast navigation overwrites the new entity's state with a stale response.
---

# Detail-page route-id fetch race

Detail pages that load an entity by a route param (e.g. `/prospects/:id`) via a
**raw `fetch` inside `useEffect`** must guard every `setState` against stale
responses. The component stays mounted across navigations (the param changes,
it does not remount), so two loads can be in flight; an older response can
resolve after the newer one and overwrite the displayed entity's state with the
wrong data.

**Pattern that works:** keep an `activeIdRef` updated in render
(`activeIdRef.current = id;`), capture `const reqId = id;` at the start of the
async loader, and bail (`if (activeIdRef.current !== reqId) return;`) before each
`setState` — including after every `await` and in `catch`/`finally`.

**Why:** functional updaters don't help here — the problem is *which* response
wins, not concurrent updates in one tick.

**How to apply:** only raw-fetch loaders need this. React Query hooks
(`useGetContact(id)`, `useGetCall(id)`) are already keyed by id and cancel/ignore
stale results, so entities loaded through them are race-free; only the secondary
raw fetches alongside them (e.g. a projets list) need the guard.
