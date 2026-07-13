---
name: API key management ownership
description: intra-tenant privilege escalation risk on api-key list/reveal/revoke
---

API-key-authenticated requests run **as the key's creator** (the bearer
inherits the creator's userId/userRole). So a leaked/revealed key === full
impersonation of its creator.

**Rule:** management routes for api keys (list / reveal-plaintext / revoke)
must NOT be gated by `requireAuth + requireTenant` alone. Within one org any
member could otherwise reveal another member's full key and act as them
(intra-tenant escalation). Scope every handler:
- list: admins see all org keys; non-admins only their own (`createdByUserId`).
- reveal / revoke: fetch row by id+org, then require `row.createdByUserId ===
  session.userId || isOrgAdmin(req)` else 403.
- reveal & revoke are sensitive → write an audit log entry.

**Why:** the secret-at-rest encryption (`enc:v1:`) protects the DB, not
authorized-but-wrong-user access. Auth path (cookie / HMAC token / api key) all
populate `session.userRole`+`userEmail`, so `isOrgAdmin` works uniformly.
