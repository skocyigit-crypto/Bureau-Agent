"""TenantScopedMixin / TimestampMixin — see plan §2.3.

Tenant isolation in the source system is APPLICATION-LAYER ONLY: cross-entity
FKs reference the target's global serial PK (never a composite
(organisation_id, id) key), and the DB itself does not stop a cross-tenant
link. This mixin preserves that exact invariant rather than "upgrading" to
DB-level RLS — it exists to (a) mark which models are tenant-scoped and (b)
let `tenant_scoped_select()` / `TenantScopedSession` enforce the convention
at the application layer, matching current behavior.

Two tables intentionally do NOT use this mixin even though they're similar
shape (see tenant-org-not-null.md / tenant-fk-convention.md in the Node
memory notes): `payments` (nullable org — bank-upload reconciliation) and
`google_oauth_tokens` (isolated by user_id, not org).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

TENANT_SCOPED_TABLES: set[type] = set()


class TenantScopedMixin:
    """Declares organisation_id NOT NULL, FK cascade — the default convention
    for tenant-owned tables. Registers the owning model class so tenant.py's
    runtime assertion can recognize it."""

    organisation_id: Mapped[int] = mapped_column(
        ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    def __init_subclass__(cls, **kwargs) -> None:  # noqa: ANN001
        super().__init_subclass__(**kwargs)
        TENANT_SCOPED_TABLES.add(cls)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
