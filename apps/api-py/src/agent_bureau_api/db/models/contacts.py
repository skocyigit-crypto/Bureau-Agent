"""1:1 port of lib/db/src/schema/contacts.ts.

The accent-insensitive trigram search index (f_unaccent()+pg_trgm GIN) is
NOT declared here as a SQLAlchemy Index — it depends on the IMMUTABLE
f_unaccent() wrapper function that lives outside migration history (see
ensure-search-extensions.sql on the Node side). Declaring it naively here
would make `alembic revision --autogenerate` try to drop/recreate it against
the live DB. It's tracked as a Phase 2 concern (search.py port), not Phase 1.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base
from ..mixins import TenantScopedMixin, TimestampMixin


class Contact(Base, TenantScopedMixin, TimestampMixin):
    __tablename__ = "contacts"
    __table_args__ = (
        Index("contacts_category_idx", "category"),
        Index("contacts_created_at_idx", "created_at"),
        Index("contacts_org_id_idx", "organisation_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(Text, nullable=False)
    last_name: Mapped[str] = mapped_column(Text, nullable=False)
    company: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str] = mapped_column(Text, nullable=False)
    mobile: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text, nullable=False, default="autre", server_default="autre")
    address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    total_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_call_at: Mapped[datetime | None]
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
