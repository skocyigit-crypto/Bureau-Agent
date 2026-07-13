"""1:1 port of lib/db/src/schema/api-keys.ts — backs auth/api_key_auth.py."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import ARRAY, CheckConstraint, ForeignKey, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base
from ..mixins import TenantScopedMixin, TimestampMixin


class ApiKey(Base, TenantScopedMixin, TimestampMixin):
    __tablename__ = "api_keys"
    __table_args__ = (
        UniqueConstraint("key_hash", name="api_keys_key_hash_uniq"),
        Index("api_keys_org_idx", "organisation_id"),
        # Defense-in-depth: the reversible copy must be encrypted at rest
        # (enc:v1: prefix) — mirrors the Node-side CHECK constraint exactly.
        CheckConstraint("key_encrypted LIKE 'enc:%'", name="api_keys_key_encrypted_chk"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    key_prefix: Mapped[str] = mapped_column(Text, nullable=False)
    key_hash: Mapped[str] = mapped_column(Text, nullable=False)
    key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list, server_default="{}")
    last_used_at: Mapped[datetime | None]
    expires_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
