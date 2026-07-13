---
name: useCallback load() self-dep refetch loop
description: Why a fetch callback must not depend on state it itself mutates, in the useEffect(()=>load(),[load]) pattern.
---

# `load()` self-dependency → continuous refetch loop

**Rule:** A data-loading `useCallback` wired as `useEffect(() => load(), [load])`
must NOT list in its deps any value it mutates on success. If `load` calls
`setX(newRef)` / `updateCache(newArray)` and also depends on that same state
(or a derived `arr.length`/array ref), each fetch changes `load`'s identity →
the effect re-runs → it fetches again → forever (a silent, continuous network
loop, worst on the default/unfiltered view).

**Why:** A new array/object reference is never shallow-equal, so the callback is
rebuilt every render after a successful fetch. The loop is easy to miss because
the UI still shows correct data — only logs / battery / AI-quota reveal it.

**How to apply:** Read offline-fallback / "current list" values through refs
(`cachedRef.current`, `lenRef.current`) inside `load` instead of closing over
them, so `load`'s deps are only the true inputs (filters, search, fetchAuth).
Pair with a `reqGen` counter (increment per call, bail after each await if
`gen !== reqGenRef.current`) to also drop stale responses on rapid filter
changes. For route `:id` detail pages use the activeIdRef variant instead
(see detail-page-fetch-race.md).
