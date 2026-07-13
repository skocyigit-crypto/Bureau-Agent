---
name: AI cache org isolation
description: Why the AI response cache must never fall back to a shared bucket when organisationId is missing.
---

# AI cache must never share a bucket across tenants

`buildAiCacheKey` (ai-cache.ts) builds `route:org:user:hash`. When `organisationId`
is missing it must NOT use a fixed shared string (old behavior: `"noorg"`). A shared
fallback lets two tenants — or the owner's test/demo usage and a licensed client —
collide on the same key for an identical prompt and receive each other's cached AI
answer = cross-tenant data leak.

**Rule:** missing org → generate a per-call random `orgPart` (`noorg-<hex>`) + log a
warning. This makes the missing-org path effectively non-cacheable (get/set never
rejoin across requests) instead of shared.

**Why:** all AI routes currently pass `organisationId` from the session, so the
fallback should never trigger — but it's the one latent vector a future coding
mistake (a new AI route forgetting the org) could turn into a real leak. Defense in
depth, not a fix for a live bug.

**How to apply:** never reintroduce a shared `"noorg"` constant. Real-org keys keep
the `:<id>:` segment so `invalidateOrg` (suffix match) still works. Public demo
(routes/public-demo-chat.ts) is separately safe: fully synthetic prompt, no DB, no
orgId, never caches per-tenant.
