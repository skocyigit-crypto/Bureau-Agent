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

**Inverse footgun — under-gating mutations:** routers mounted *after*
`requireTenant` are authenticated and org-scoped but NOT role-gated. State-changing
endpoints there (e.g. agent-queue approve/reject/run-now, ai agent runs) need an
explicit per-route `requireRole(...)` guard — a client-side "canRun" check is
cosmetic and any authenticated org member can curl the endpoint otherwise.
**Why:** the agent-queue approve/reject/run-now routes shipped with no role guard
while the UI hid the buttons; broken access control until guarded with the same
`requireRole("super_admin","administrateur")` policy the ai-agent run routes use.
**How to apply:** when adding a mutation under a tenant-mounted router, gate it
per-route; smoke that an unauth POST returns 401/403, never 200/500.

**In-router variant of the same footgun:** a bare `router.use(requireRole(...))`
placed at the TOP of a sub-router ALSO leaks — if that sub-router is mounted
without a path prefix (`router.use(webhooksRouter)`), the bare guard runs for
every request flowing through it, including sibling routers mounted *after* it
(e.g. apiKeysRouter). Symptom: hardening webhooks to admin-only with a bare
`router.use(requireRole("super_admin","administrateur"))` inside webhooks.ts made
non-admin POST /api/api-keys return 403. **Fix:** path-scope it to the router's
own prefix — `router.use("/webhooks", requireRole(...))` — which covers
/webhooks, /webhooks/:id, /webhooks/:id/deliveries, /webhooks/:id/rotate-secret
but not siblings. **Why webhooks must be admin-only:** a webhook streams ALL org
events to an arbitrary external URL, so any low-priv member creating one is a
data-exfiltration vector. Locked by `webhooks-access-control.test.ts`.

## Backoffice routes intentionally have NO org filter (don't "fix" them)

prospects / devis / factures-client routers are mounted in routes/index.ts under
`router.use("/x", requireSuperAdmin)` BEFORE `requireTenant`. They use a
`parseOrgFilter` (optional `?organisationId=`) and otherwise query GLOBALLY across
all tenants by design (super-admin backoffice). Their PATCH/DELETE-by-id with no
`organisationId` in the WHERE is therefore CORRECT, not an IDOR.

**Why:** an audit can mistake these for missing-tenant-scope bugs and add
`eq(organisationId, orgId)`, which would break the super-admin's global view.

**How to apply:** before flagging a missing org filter, check the router's mount
point in routes/index.ts. After `requireTenant` = client layer (must scope by
getOrgId, usually via check-then-act select). Before it under requireSuperAdmin =
global by design. Client single-write routes (e.g. documents) verify ownership
with an org-scoped SELECT first, then write by id — that pattern is safe. All
bulk-operations routes correctly AND `eq(organisationId, orgId)` with
`inArray(id, ids)`.
