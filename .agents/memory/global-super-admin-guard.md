---
name: Global super-admin guard regression
description: Router-level requireSuperAdmin without a path prefix accidentally gates the whole client API
---

In the api-server route aggregator, the backoffice SaaS routers (prospects,
devis, factures-client, adminSaasDashboard) must be gated by `requireSuperAdmin`
**path-scoped**, never as a bare `router.use(requireSuperAdmin, xRouter)`.

**The footgun:** `router.use(mw, subRouter)` with no path mounts `mw` at `/`, so
`requireSuperAdmin` runs for **every** request reaching that point. All routes
mounted *after* it (calls, contacts, tasks, proactive, security/scan-*, etc.)
then return 403 for any non-super_admin (agent AND administrateur included) —
i.e. the entire client product is dead for normal users, while a super_admin
token still reaches handlers. Confirmed empirically: `/api/calls` returns 403
(not 401) for an authenticated agent when the leak is present.

**Correct pattern (currently in place):** scope the guard to each router's exact
path prefix, then mount the routers unguarded:
```
router.use("/admin/saas-dashboard", requireSuperAdmin);
router.use("/prospects", requireSuperAdmin);
router.use("/devis", requireSuperAdmin);
router.use("/factures-client", requireSuperAdmin);
router.use(adminSaasDashboardRouter); // these declare their full path internally
router.use(prospectsRouter);
router.use(devisRouter);
router.use(facturesClientRouter);
```
This works because each backoffice router declares its full path internally
(e.g. `router.get("/prospects", ...)`), so the path-scoped guard covers all of
its sub-paths while leaving unrelated tenant routes untouched.

**Why it keeps coming back:** background task agents working on backoffice/SaaS
features tend to reintroduce the bare `router.use(requireSuperAdmin, xRouter)`
form. After any merge that touches the route aggregator, re-check this mount
block. Quick smoke: an authenticated non-admin hitting a client route must get
401/200, never 403 from a global guard. The `admin-isolation` test does NOT
catch this — it only checks commercial routes, never an unrelated client route
with a non-admin user.
