"""1:1 port of lib/db/src/schema/users.ts.

organisation_id is intentionally NULLABLE here (onDelete=SET NULL) — this is
one of the documented exceptions to the tenant-scoped NOT-NULL convention
(tenant-org-not-null.md), so this model does NOT use TenantScopedMixin.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base
from ..mixins import TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (Index("users_organisation_id_idx", "organisation_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    nom: Mapped[str] = mapped_column(String(100), nullable=False)
    prenom: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="agent", server_default="agent")
    departement: Mapped[str | None] = mapped_column(String(100))
    organisation: Mapped[str | None] = mapped_column(String(200), default="Agent de Bureau SAS")
    organisation_id: Mapped[int | None] = mapped_column(
        ForeignKey("organisations.id", ondelete="SET NULL")
    )
    telephone: Mapped[str | None] = mapped_column(String(30))
    avatar: Mapped[str | None] = mapped_column(String(10))
    actif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    mfa_actif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    mfa_secret: Mapped[str | None] = mapped_column(Text)

    dernier_acces: Mapped[datetime | None]
    tentatives_echouees: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    verrouille_jusqua: Mapped[datetime | None]

    reset_password_token: Mapped[str | None] = mapped_column(String(128))
    reset_password_expiry: Mapped[datetime | None]
    last_login_fingerprint: Mapped[str | None] = mapped_column(String(64))
    last_login_ip: Mapped[str | None] = mapped_column(String(64))
    email_verified_at: Mapped[datetime | None]
    email_verification_token: Mapped[str | None] = mapped_column(String(128))
    email_verification_expiry: Mapped[datetime | None]

    preferences: Mapped[dict | None] = mapped_column(JSONB)

    # Bearer-token revocation floor — see auth/invalidation_cache.py, a direct
    # port of middleware/auth.ts's getTokenInvalidatedAt.
    token_invalidated_at: Mapped[datetime | None]
