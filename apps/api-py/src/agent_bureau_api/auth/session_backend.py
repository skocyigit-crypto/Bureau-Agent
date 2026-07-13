"""Small hand-written Postgres-backed session store — there is no off-the-
shelf equivalent to express-session+connect-pg-simple for Starlette (plan
§1.5/§2.5). Cookie value is `<sid>.<hmac-sha256(sid)>` (multi-secret
rotation via SESSION_SECRETS, same primitive as auth/api_token.py) so a
forged/guessed sid string can't be presented without also knowing a valid
secret — belt-and-suspenders on top of the sid already being 32 random
bytes.

Same fixed-window semantics as the Node service: 24h maxAge, no rolling
refresh (rolling=false there too — avoids a write-amplifying UPDATE on every
request).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import base64
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models.sessions import PySession
from ..settings import get_settings

SESSION_MAX_AGE = timedelta(hours=24)
SID_BYTES = 32


def _get_secrets() -> list[str]:
    settings = get_settings()
    out = [p.strip() for p in settings.session_secrets.split(",") if len(p.strip()) >= 16]
    if out:
        return out
    if settings.is_production:
        raise RuntimeError("SESSION_SECRETS is required in production.")
    return ["dev-api-token-secret-do-not-use-in-prod-aaaaaaaa"]


def session_cookie_name(is_production: bool) -> str:
    # __Host- prefix is a browser-enforced lock (Secure required, no Domain
    # attribute, Path=/) — can't be set over plain http://, so dev keeps the
    # unprefixed name, exactly matching app.ts:370-377.
    return "__Host-adb_py.sid" if is_production else "adb_py.sid"


def _sign_sid(sid: str) -> str:
    sig = hmac.new(_get_secrets()[0].encode(), sid.encode(), hashlib.sha256).digest()
    return f"{sid}.{base64.urlsafe_b64encode(sig).rstrip(b'=').decode()}"


def _verify_and_extract_sid(cookie_value: str) -> str | None:
    if "." not in cookie_value:
        return None
    sid, _, sig_b64 = cookie_value.rpartition(".")
    if not sid or not sig_b64:
        return None
    try:
        padding = "=" * (-len(sig_b64) % 4)
        sig_buf = base64.urlsafe_b64decode(sig_b64 + padding)
    except Exception:  # noqa: BLE001
        return None
    for secret in _get_secrets():
        expected = hmac.new(secret.encode(), sid.encode(), hashlib.sha256).digest()
        if len(expected) == len(sig_buf) and hmac.compare_digest(expected, sig_buf):
            return sid
    return None


class PgSessionBackend:
    async def create(self, db: AsyncSession, data: dict) -> tuple[str, str]:
        """Returns (sid, signed_cookie_value)."""
        sid = base64.urlsafe_b64encode(os.urandom(SID_BYTES)).rstrip(b"=").decode()
        expires_at = datetime.now(timezone.utc) + SESSION_MAX_AGE
        db.add(PySession(sid=sid, data=data, expires_at=expires_at))
        await db.commit()
        return sid, _sign_sid(sid)

    async def load(self, db: AsyncSession, cookie_value: str) -> tuple[str, dict] | None:
        sid = _verify_and_extract_sid(cookie_value)
        if sid is None:
            return None
        row = (await db.execute(select(PySession).where(PySession.sid == sid))).scalar_one_or_none()
        if row is None:
            return None
        if row.expires_at <= datetime.now(timezone.utc):
            await db.execute(delete(PySession).where(PySession.sid == sid))
            await db.commit()
            return None
        return sid, row.data

    async def save(self, db: AsyncSession, sid: str, data: dict) -> None:
        row = (await db.execute(select(PySession).where(PySession.sid == sid))).scalar_one_or_none()
        if row is None:
            return
        row.data = data
        await db.commit()

    async def destroy(self, db: AsyncSession, sid: str) -> None:
        await db.execute(delete(PySession).where(PySession.sid == sid))
        await db.commit()

    async def regenerate(self, db: AsyncSession, old_sid: str | None, data: dict) -> tuple[str, str]:
        """Session-fixation prevention: mint a brand-new sid for the same
        data rather than reusing one that existed before authentication,
        mirroring req.session.regenerate() in routes/auth.ts:226-228."""
        if old_sid is not None:
            await self.destroy(db, old_sid)
        return await self.create(db, data)


session_backend = PgSessionBackend()
