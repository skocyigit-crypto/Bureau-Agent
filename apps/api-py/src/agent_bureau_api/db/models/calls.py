"""1:1 port of lib/db/src/schema/calls.ts. status/direction stay TEXT — see
db/enums.py CallStatus/CallDirection (task-status-enum.md invariant)."""
from __future__ import annotations

from sqlalchemy import ARRAY, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base
from ..mixins import TenantScopedMixin, TimestampMixin


class Call(Base, TenantScopedMixin, TimestampMixin):
    __tablename__ = "calls"
    __table_args__ = (
        Index("calls_contact_id_idx", "contact_id"),
        Index("calls_status_idx", "status"),
        Index("calls_created_at_idx", "created_at"),
        Index("calls_org_id_idx", "organisation_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
    contact_name: Mapped[str | None] = mapped_column(Text)
    phone_number: Mapped[str] = mapped_column(Text, nullable=False)
    direction: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    notes: Mapped[str | None] = mapped_column(Text)
    sentiment: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list, server_default="{}")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
