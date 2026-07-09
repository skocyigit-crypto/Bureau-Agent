"""Partial port of artifacts/api-server/src/routes/auth.ts — just enough to
prove all three auth transports (cookie session, Bearer HMAC token, API key)
populate TenantContext end-to-end, per the Phase 1 done criteria. Full
parity (password reset, email verification, MFA setup/enrollment, admin
user CRUD, CSV export) is Phase 2 scope.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import pyotp
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.api_token import mint_api_token
from ..auth.dependencies import SessionData
from ..auth.session_backend import session_backend, session_cookie_name
from ..db.models import User
from ..db.session import get_db
from ..middleware.rate_limit import LOGIN_LIMIT, limiter
from ..settings import get_settings
from ..tenant.context import TenantContext, require_tenant

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION = timedelta(minutes=15)
EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# Same constant string as DUMMY_BCRYPT_HASH in routes/auth.ts — bcrypt hashes
# are cross-language-compatible, so reusing the identical value isn't
# required for correctness, but does mean the two services impose the exact
# same ~80-200ms timing cost on the account-enumeration defense.
DUMMY_BCRYPT_HASH = b"$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"


class LoginRequest(BaseModel):
    email: str
    password: str
    totpCode: str | None = None
    wantsToken: bool | None = None


def verify_mfa_token(token: str | None, secret: str | None) -> bool:
    if not token or not secret:
        return False
    cleaned = re.sub(r"\s+", "", token)
    if not re.fullmatch(r"\d{6}", cleaned):
        return False
    try:
        return pyotp.TOTP(secret).verify(cleaned, valid_window=1)
    except Exception:  # noqa: BLE001
        return False


@router.post("/login")
@limiter.limit(LOGIN_LIMIT)
async def login(request: Request, payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    if not payload.email or not payload.password:
        response.status_code = 400
        return {"error": "Email and password are required."}

    user = (
        await db.execute(select(User).where(User.email == payload.email.lower().strip()))
    ).scalar_one_or_none()

    # Account-enumeration timing defense: run a bcrypt.compare against a
    # constant dummy hash on every early-failure path (nonexistent/disabled/
    # locked account) so response latency doesn't leak which case occurred.
    if user is None or not user.actif or (user.verrouille_jusqua and user.verrouille_jusqua > datetime.now(timezone.utc)):
        await asyncio.to_thread(bcrypt.checkpw, payload.password.encode("utf-8"), DUMMY_BCRYPT_HASH)
        response.status_code = 401
        return {"error": "Invalid credentials."}

    is_valid = await asyncio.to_thread(bcrypt.checkpw, payload.password.encode("utf-8"), user.password_hash.encode("utf-8"))
    if not is_valid:
        new_attempts = user.tentatives_echouees + 1
        values: dict = {"tentatives_echouees": new_attempts}
        if new_attempts >= MAX_FAILED_ATTEMPTS:
            values["verrouille_jusqua"] = datetime.now(timezone.utc) + LOCKOUT_DURATION
        await db.execute(update(User).where(User.id == user.id).values(**values))
        await db.commit()
        response.status_code = 401
        return {"error": "Invalid credentials."}

    if user.mfa_actif and user.mfa_secret:
        if not payload.totpCode:
            return {"requiresMfa": True, "message": "TOTP code required."}
        if not verify_mfa_token(payload.totpCode, user.mfa_secret):
            new_attempts = user.tentatives_echouees + 1
            values = {"tentatives_echouees": new_attempts}
            if new_attempts >= MAX_FAILED_ATTEMPTS:
                values["verrouille_jusqua"] = datetime.now(timezone.utc) + LOCKOUT_DURATION
            await db.execute(update(User).where(User.id == user.id).values(**values))
            await db.commit()
            response.status_code = 401
            return {"error": "Invalid TOTP code.", "requiresMfa": True}

    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(tentatives_echouees=0, verrouille_jusqua=None, dernier_acces=datetime.now(timezone.utc))
    )
    await db.commit()

    session_payload = {
        "userId": user.id,
        "userRole": user.role,
        "organisationId": user.organisation_id,
        "userEmail": user.email,
        "prenom": user.prenom,
        "nom": user.nom,
    }

    settings = get_settings()
    # Session-fixation prevention: always mint a brand-new sid rather than
    # reusing any pre-auth session, mirroring req.session.regenerate() in
    # routes/auth.ts:226-228.
    _, cookie_value = await session_backend.regenerate(db, None, session_payload)
    response.set_cookie(
        key=session_cookie_name(settings.is_production),
        value=cookie_value,
        max_age=int(timedelta(hours=24).total_seconds()),
        httponly=True,
        secure=settings.is_production,
        samesite="strict" if settings.is_production else "lax",
        path="/",
    )

    result: dict = {
        "id": user.id,
        "email": user.email,
        "nom": user.nom,
        "prenom": user.prenom,
        "role": user.role,
        "organisationId": user.organisation_id,
    }
    if payload.wantsToken:
        result["token"] = mint_api_token(
            {
                "userId": user.id,
                "userRole": user.role,
                "organisationId": user.organisation_id,
                "userEmail": user.email,
                "prenom": user.prenom,
                "nom": user.nom,
            }
        )
    return result


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    session: SessionData | None = getattr(request.state, "session", None)
    if session and session.sid:
        await session_backend.destroy(db, session.sid)
    response.delete_cookie(session_cookie_name(get_settings().is_production), path="/")
    return {"success": True}


@router.get("/me")
async def me(ctx: TenantContext = Depends(require_tenant)) -> dict:
    """Proves all three auth transports (cookie, Bearer token, API key)
    resolve to a working TenantContext — the Phase 1 done criterion."""
    return {
        "userId": ctx.user_id,
        "userRole": ctx.user_role,
        "organisationId": ctx.organisation_id,
        "userEmail": ctx.user_email,
    }
