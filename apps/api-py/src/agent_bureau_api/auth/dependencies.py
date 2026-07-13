"""Port of artifacts/api-server/src/middleware/auth.ts.

Key structural difference from the Node version, done deliberately: there,
`requireSuperAdmin`/`requireRole` are plain middleware that CAN be mounted
incorrectly at a router root (`router.use(requireSuperAdmin, subRouter)`),
which is the exact documented footgun (global-super-admin-guard.md) that
403s the entire tenant API for non-super-admins. Here, `require_super_admin`
is a FastAPI dependency that only ever attaches via a specific
`APIRouter(dependencies=[Depends(require_super_admin)])` or a per-route
`Depends(...)` — there is no "bare mount at /" equivalent, so the footgun is
structurally prevented rather than merely documented. test_middleware_order
still asserts this as a regression guard.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import Cookie, Depends, HTTPException, Request, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.enums import ROLE_HIERARCHY, PROTECTED_ROLE
from ..db.session import get_db
from ..settings import get_settings
from .api_key_auth import authenticate_api_key, looks_like_api_key
from .api_token import extract_bearer_token, verify_api_token
from .invalidation_cache import get_token_invalidated_at
from .session_backend import session_backend, session_cookie_name


@dataclass
class SessionData:
    user_id: int | None = None
    user_role: str | None = None
    organisation_id: int | None = None
    user_email: str | None = None
    prenom: str | None = None
    nom: str | None = None
    sid: str | None = None  # only set for cookie-backed sessions


async def _hydrate_from_bearer(request: Request, db: AsyncSession, session: SessionData) -> None:
    """Port of hydrateFromBearer() in middleware/auth.ts:67-104. No-op if the
    session is already populated (cookie present) or no token is present."""
    if session.user_id is not None:
        return
    token = extract_bearer_token(request.headers.get("authorization"))
    if not token:
        return

    if looks_like_api_key(token):
        api_ctx = await authenticate_api_key(db, token)
        if api_ctx is None:
            return
        session.user_id = api_ctx.user_id
        session.user_role = api_ctx.user_role
        session.organisation_id = api_ctx.organisation_id
        session.user_email = api_ctx.user_email
        session.prenom = api_ctx.prenom
        session.nom = api_ctx.nom
        return

    payload = verify_api_token(token)
    if payload is None:
        return

    inv_at = await get_token_invalidated_at(db, payload.userId)
    if inv_at is not None and payload.iat < inv_at:
        return

    session.user_id = payload.userId
    session.user_role = payload.userRole
    session.organisation_id = payload.organisationId
    session.user_email = payload.userEmail
    session.prenom = payload.prenom
    session.nom = payload.nom


async def get_session(
    request: Request,
    db: AsyncSession = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=session_cookie_name(get_settings().is_production)),
) -> SessionData:
    """Resolves the request's identity from whichever transport is present:
    cookie session first (if valid), then Bearer/API-key hydration — mirrors
    the Node precedence exactly (hydrateFromBearer short-circuits if
    req.session.userId is already set)."""
    session = SessionData()
    if session_cookie:
        loaded = await session_backend.load(db, session_cookie)
        if loaded is not None:
            sid, data = loaded
            session.sid = sid
            session.user_id = data.get("userId")
            session.user_role = data.get("userRole")
            session.organisation_id = data.get("organisationId")
            session.user_email = data.get("userEmail")
            session.prenom = data.get("prenom")
            session.nom = data.get("nom")

    await _hydrate_from_bearer(request, db, session)
    request.state.session = session
    return session


async def require_auth(session: SessionData = Depends(get_session)) -> SessionData:
    if session.user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return session


def user_has_access(user_role: str | None, required_roles: list[str]) -> bool:
    if not user_role:
        return False
    user_level = ROLE_HIERARCHY.get(user_role, 0)
    if user_level == 0:
        return False
    min_required = min((ROLE_HIERARCHY.get(r, float("inf")) for r in required_roles), default=float("inf"))
    return user_level >= min_required


def require_role(*roles: str):
    """Hierarchical role guard — pass a contiguous chain highest-to-lowest,
    e.g. require_role("super_admin", "administrateur", "agent") = agent or
    higher. Non-contiguous sets silently widen access, same as the Node
    version; unlike Node this isn't logged since Python has no equivalent
    "import-time" warning hook — flagged as a residual gap, not a regression
    (the Node warning was dev-only console noise, not enforced behavior)."""

    async def _dependency(session: SessionData = Depends(require_auth)) -> SessionData:
        if not user_has_access(session.user_role, list(roles)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied. Insufficient permissions.")
        return session

    return _dependency


async def require_super_admin(session: SessionData = Depends(require_auth)) -> SessionData:
    if session.user_role != PROTECTED_ROLE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Reserved for the platform super administrator.")
    return session
