"""NEW table for the Python service's server-side session store.

Deliberately NOT named `user_sessions` (the Node/connect-pg-simple table) and
NOT part of the ported Drizzle schema — this is a hard-cutover design choice
(plan decision #4): existing browser sessions are not carried over, only
Bearer tokens and API keys stay byte-compatible across the cutover. Because
this table is new (not something Drizzle already owns), creating it via a
real Alembic migration is a legitimate additive DDL change, not a violation
of the "Alembic baseline is stamped, never run" rule for the ~85 ported
tables — see plan §2.4.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class PySession(Base):
    __tablename__ = "py_user_sessions"

    sid: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
