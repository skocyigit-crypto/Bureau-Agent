"""Port of artifacts/api-server/src/middleware/tenant-guard.ts.

These are in-handler defense-in-depth helpers (NOT global middleware) used
inside route bodies — same shape as the Node version. Full audit-log
persistence (logAudit -> the `audit` table) is deferred to Phase 2 since
that table isn't ported yet; log_tenant_violation here only does structured
logging, flagged clearly below so it isn't mistaken for the complete port.
"""
from __future__ import annotations

import time

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import SessionData
from ..db.enums import PROTECTED_ROLE, ROLE_HIERARCHY, TENANT_ASSIGNABLE_ROLES
from ..db.models import Organisation, User
from ..logging import get_logger

logger = get_logger(__name__)


class TenantGuardError(Exception):
    """Raised by assert_* helpers — callers translate to an HTTP response
    (status/code/message) at the route boundary, mirroring the Node
    functions' `res.status(...).json(...); return false` pattern."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def is_super_admin(session: SessionData) -> bool:
    return session.user_role == PROTECTED_ROLE


def is_admin_or_super_admin(session: SessionData) -> bool:
    return ROLE_HIERARCHY.get(session.user_role or "", 0) >= ROLE_HIERARCHY["administrateur"]


def log_tenant_violation(session: SessionData, event: str, detail: str, ip: str | None = None) -> None:
    logger.warning(
        "tenant_guard_violation",
        event=event,
        user_id=session.user_id,
        user_role=session.user_role,
        organisation_id=session.organisation_id,
        ip=ip or "unknown",
        detail=detail,
    )


def assert_role_allowed(session: SessionData, target_role: str | None) -> None:
    if not target_role:
        return
    if is_super_admin(session):
        return
    if target_role not in TENANT_ASSIGNABLE_ROLES:
        log_tenant_violation(session, "role_escalation_attempt", f"Admin tried to assign protected role: {target_role}")
        raise TenantGuardError(403, "ROLE_ESCALATION_DENIED", f"Role '{target_role}' cannot be assigned by a tenant administrator.")


def assert_caller_outranks(session: SessionData, target_role: str) -> None:
    if is_super_admin(session):
        return
    caller_rank = ROLE_HIERARCHY.get(session.user_role or "", 0)
    target_rank = ROLE_HIERARCHY.get(target_role, 0)
    if caller_rank <= target_rank:
        log_tenant_violation(session, "privilege_escalation_attempt", f"Caller (rank {caller_rank}) tried to act on user with rank {target_rank}")
        raise TenantGuardError(403, "INSUFFICIENT_RANK", "You cannot modify an account with an equal or higher role than yours.")


async def assert_org_owns_user(db: AsyncSession, session: SessionData, target_user_id: int) -> User:
    if is_super_admin(session):
        user = (await db.execute(select(User).where(User.id == target_user_id))).scalar_one_or_none()
        if user is None:
            raise TenantGuardError(404, "NOT_FOUND", "User not found.")
        return user

    if not session.organisation_id:
        raise TenantGuardError(403, "NO_ORG", "No organisation associated with this session.")

    user = (
        await db.execute(
            select(User).where(and_(User.id == target_user_id, User.organisation_id == session.organisation_id))
        )
    ).scalar_one_or_none()
    if user is None:
        log_tenant_violation(session, "cross_tenant_user_access", f"Attempt to access user {target_user_id} outside org {session.organisation_id}")
        raise TenantGuardError(404, "NOT_FOUND", "User not found in your organisation.")
    return user


def assert_target_not_super_admin(session: SessionData, target_role: str, target_email: str | None = None) -> None:
    if is_super_admin(session):
        return
    if target_role == PROTECTED_ROLE:
        log_tenant_violation(session, "super_admin_modification_attempt", f"Attempt to modify super_admin account: {target_email or 'unknown'}")
        raise TenantGuardError(403, "PROTECTED_ACCOUNT", "You cannot modify a platform super-administrator account.")


async def assert_user_quota_not_exceeded(db: AsyncSession, session: SessionData, organisation_id: int) -> None:
    if is_super_admin(session):
        return
    try:
        org = (await db.execute(select(Organisation.max_users).where(Organisation.id == organisation_id))).first()
        if org is None:
            return  # org not found — let the caller handle it
        total = (
            await db.execute(
                select(func.count())
                .select_from(User)
                .where(and_(User.organisation_id == organisation_id, User.actif.is_(True)))
            )
        ).scalar_one()
        if total >= org.max_users:
            log_tenant_violation(session, "user_quota_exceeded", f"Org {organisation_id} has {total}/{org.max_users} active users")
            raise TenantGuardError(403, "USER_QUOTA_EXCEEDED", f"User quota reached ({total}/{org.max_users}).")
    except TenantGuardError:
        raise
    except Exception:  # noqa: BLE001
        logger.error("tenant_guard_quota_check_failed")
        return  # fail open — don't block on a DB error


def assert_not_self(session: SessionData, target_id: int) -> None:
    if session.user_id == target_id:
        raise TenantGuardError(400, "CANNOT_SELF_MODIFY", "You cannot delete or deactivate your own account.")


ALLOWED_PATCH_FIELDS = {"nom", "prenom", "departement", "telephone", "actif", "role", "password"}


def sanitise_user_patch(body: dict) -> dict:
    return {k: v for k, v in body.items() if k in ALLOWED_PATCH_FIELDS}


_sensitive_op_log: dict[str, list[float]] = {}


def check_sensitive_rate_limit(session: SessionData, operation: str, max_ops: int = 20, window_ms: int = 60_000) -> None:
    key = f"{session.user_id}:{operation}"
    now = time.time() * 1000
    timestamps = [t for t in _sensitive_op_log.get(key, []) if now - t < window_ms]
    timestamps.append(now)
    _sensitive_op_log[key] = timestamps
    if len(timestamps) > max_ops:
        log_tenant_violation(session, "sensitive_rate_limit", f"Operation '{operation}' exceeded {max_ops} calls in {window_ms}ms")
        raise TenantGuardError(429, "RATE_LIMITED", f"Too many '{operation}' operations in a short time. Try again later.")
