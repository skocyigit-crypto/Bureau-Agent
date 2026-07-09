"""1:1 port of lib/db/src/schema/tasks.ts. status/priority stay TEXT (see
db/enums.py TaskStatus/TaskPriority) — never a native Postgres enum, matching
the source system exactly (task-status-enum.md: wrong literals fail
silently, 0 rows, not an error — must not change that behavior)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base
from ..mixins import TenantScopedMixin, TimestampMixin


class Task(Base, TenantScopedMixin, TimestampMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("tasks_status_idx", "status"),
        Index("tasks_related_contact_idx", "related_contact_id"),
        Index("tasks_related_call_idx", "related_call_id"),
        Index("tasks_due_date_idx", "due_date"),
        Index("tasks_org_id_idx", "organisation_id"),
        Index("tasks_projet_id_idx", "projet_id"),
        # tasks_search_trgm_idx (f_unaccent + pg_trgm GIN) intentionally
        # omitted — see contacts.py docstring.
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="en_attente", server_default="en_attente")
    priority: Mapped[str] = mapped_column(Text, nullable=False, default="moyenne", server_default="moyenne")
    due_date: Mapped[datetime | None]
    assigned_to: Mapped[str | None] = mapped_column(Text)
    # NOTE: cross-entity FKs reference the target's global serial PK, never a
    # composite (org, id) key — tenant isolation for these links is an
    # APPLICATION-LAYER concern (verify same-org ownership before writing),
    # not a DB-level guarantee. See tenant/guard.py assert_same_org.
    related_contact_id: Mapped[int | None] = mapped_column(Integer)
    related_call_id: Mapped[int | None] = mapped_column(Integer)
    # FK to projets.id (onDelete=SET NULL) in the source schema — left as a
    # plain column until the projets table is ported in Phase 2, to avoid an
    # unresolvable cross-file FK in this Phase 1 representative slice.
    projet_id: Mapped[int | None] = mapped_column(Integer)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    recurrence_rule: Mapped[str | None] = mapped_column(Text)
    recurrence_end_date: Mapped[datetime | None]
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
