"""1:1 port of lib/db/src/schema/organisations.ts. The tenant root — not
itself tenant-scoped (it IS the tenant)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Integer, Numeric, String, Text, BigInteger
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base
from ..mixins import TimestampMixin


class Organisation(Base, TimestampMixin):
    __tablename__ = "organisations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    logo: Mapped[str | None] = mapped_column(Text)
    max_users: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")
    actif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    bank_name: Mapped[str | None] = mapped_column(String(200))
    bank_iban: Mapped[str | None] = mapped_column(String(50))
    bank_bic: Mapped[str | None] = mapped_column(String(20))
    siret: Mapped[str | None] = mapped_column(String(20))
    tva_number: Mapped[str | None] = mapped_column(String(30))
    legal_form: Mapped[str | None] = mapped_column(String(100))
    capital: Mapped[str | None] = mapped_column(String(50))
    invoice_footer: Mapped[str | None] = mapped_column(Text)

    auto_invoice_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    auto_email_invoice: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    weekly_security_email: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    last_security_digest_at: Mapped[datetime | None]
    proactive_engine_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    expense_auto_capture_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    message_sla_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=8, server_default="8")
    quiet_customer_after_days: Mapped[int] = mapped_column(Integer, nullable=False, default=21, server_default="21")
    agent_auto_run_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    agent_auto_run_last_run_at: Mapped[datetime | None]

    working_days: Mapped[str] = mapped_column(String(20), nullable=False, default="1,2,3,4,5", server_default="1,2,3,4,5")
    working_hours_start: Mapped[str] = mapped_column(String(5), nullable=False, default="09:00", server_default="09:00")
    working_hours_end: Mapped[str] = mapped_column(String(5), nullable=False, default="18:00", server_default="18:00")
    appointment_timezone: Mapped[str] = mapped_column(String(60), nullable=False, default="Europe/Paris", server_default="Europe/Paris")
    appointment_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")

    ai_learning_last_run_at: Mapped[datetime | None]
    reused_scan_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    reused_scan_saved_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    ai_quota_cost_usd: Mapped[float | None] = mapped_column(Numeric(10, 2))
    ai_quota_calls: Mapped[int | None] = mapped_column(Integer)
    ai_agent_name: Mapped[str | None] = mapped_column(String(100))
