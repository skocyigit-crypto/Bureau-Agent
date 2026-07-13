---
name: Multi-tenant FK convention
description: How cross-entity FKs enforce tenant isolation in this schema (app-level, not composite FK).
---

# Multi-tenant FK convention

Cross-entity foreign keys point at the **global PK** of the target table
(`integer ref -> otherTable.id`), NOT a tenant-bound composite key. Examples:
`tasks.projet_id -> projets.id`, `vehicules.assigned_projet_id -> projets.id`.

Tenant isolation is therefore **NOT** guaranteed at the DB level for these links.

**Why:** the whole codebase isolates tenants at the application layer
(`requireTenant` middleware + `getOrgId` scoping on every query), using serial PKs.
Introducing composite/tenant-bound FKs for one table would be inconsistent with the
rest of the schema and the established pattern.

**How to apply:** any route that **writes** a cross-entity FK (e.g. sets
`assignedProjetId` on a vehicule, or `projetId` on a task) MUST first verify the
referenced row belongs to the same `organisationId` (load it scoped by `getOrgId`)
before persisting — otherwise a caller can link to another tenant's row. Don't rely
on the FK alone. If DB-level hardening is ever wanted, it's a deliberate schema-wide
change (composite unique on `projets(id, organisation_id)` + composite FKs), not a
one-table patch.
