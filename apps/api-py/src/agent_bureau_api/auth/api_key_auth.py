"""Port of artifacts/api-server/src/lib/api-key-auth.ts.

An API key authenticates AS ITS CREATOR (full impersonation) — session is
hydrated with the creator's identity/role/org, reusing every existing guard
(require_tenant, require_role, ...). Scope enforcement is not yet applied
(matches the Node TODO — the key inherits its creator's rights today).
"""
from __future__ import annotations

import os
import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import ApiKey, User
from .crypto import encrypt_sensitive_data, hash_sensitive_data

API_KEY_PREFIX = "adb_live_"
RANDOM_BYTES = 32
PREFIX_DISPLAY_LEN = len(API_KEY_PREFIX) + 6
TOUCH_THROTTLE_SECONDS = 60


@dataclass
class GeneratedApiKey:
    full: str
    prefix: str
    hash: str
    encrypted: str


def generate_api_key() -> GeneratedApiKey:
    full = API_KEY_PREFIX + base64.urlsafe_b64encode(os.urandom(RANDOM_BYTES)).rstrip(b"=").decode("ascii")
    return GeneratedApiKey(
        full=full,
        prefix=full[:PREFIX_DISPLAY_LEN],
        hash=hash_sensitive_data(full),
        encrypted=encrypt_sensitive_data(full),
    )


@dataclass
class ApiKeyAuthContext:
    api_key_id: int
    user_id: int
    user_role: str
    organisation_id: int
    user_email: str
    prenom: str
    nom: str


def looks_like_api_key(token: str) -> bool:
    return token.startswith(API_KEY_PREFIX)


async def authenticate_api_key(session: AsyncSession, token: str) -> ApiKeyAuthContext | None:
    if not looks_like_api_key(token):
        return None
    key_hash = hash_sensitive_data(token)

    key = (await session.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))).scalar_one_or_none()
    if key is None:
        return None
    if key.revoked_at is not None:
        return None
    if key.expires_at is not None and key.expires_at <= datetime.now(timezone.utc):
        return None
    if key.created_by_user_id is None:
        return None

    user = (await session.execute(select(User).where(User.id == key.created_by_user_id))).scalar_one_or_none()
    if user is None or not user.actif:
        return None
    # Defense-in-depth: the key and its bearer must share an organisation.
    if user.organisation_id != key.organisation_id:
        return None

    await _touch_last_used(session, key.id)

    return ApiKeyAuthContext(
        api_key_id=key.id,
        user_id=user.id,
        user_role=user.role,
        organisation_id=key.organisation_id,
        user_email=user.email,
        prenom=user.prenom,
        nom=user.nom,
    )


async def _touch_last_used(session: AsyncSession, api_key_id: int) -> None:
    """Best-effort, throttled to once per window — auth must never fail
    because of a timestamp write."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=TOUCH_THROTTLE_SECONDS)
        await session.execute(
            update(ApiKey)
            .where(
                ApiKey.id == api_key_id,
                (ApiKey.last_used_at.is_(None)) | (ApiKey.last_used_at < cutoff),
            )
            .values(last_used_at=datetime.now(timezone.utc))
        )
        await session.commit()
    except Exception:  # noqa: BLE001
        pass
