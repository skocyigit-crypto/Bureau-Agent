---
name: Global super-admin guard regression
description: Router-level requireSuperAdmin without a path prefix accidentally gates the whole client API
---

In the api-server route aggregator, the backoffice SaaS routers are mounted as
`router.use(requireSuperAdmin, prospectsRouter)` (and devis / factures-client /
adminSaasDashboard) with **no path prefix**. Because `router.use(mw, subRouter)`
mounts `mw` at `/`, `requireSuperAdmin` runs for **every** request that reaches
that point — so all routes mounted *after* it (calls, contacts, tasks,
security/scan-*, etc.) return 403 "Permissions insuffisantes" for any
non-super_admin (agent AND administrateur included).

**Why it matters:** the client layer is meant for administrateur/agent users, so
in effect only super_admin can reach the main app. The intent was to gate only
`/prospects`, `/devis`, `/factures-client`, `/stock` — those guards need a path
prefix (e.g. `router.use("/prospects", requireSuperAdmin, prospectsRouter)`).

**How to apply:** when testing or reasoning about any tenant/client API route
that lives after those mounts, a super_admin token reaches the handler while
agent/administrateur get a 403 from the global guard — not from the route's own
auth. The `admin-isolation` test didn't catch this because it only checks the
commercial routes themselves, never an unrelated client route with a non-admin.
