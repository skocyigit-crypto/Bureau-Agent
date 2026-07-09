"""Port of the getTokenInvalidatedAt/clearTokenInvalidationCache pair in
artifacts/api-server/src/middleware/auth.ts:19-51.

60s TTL cache of users.token_invalidated_at so a hot Bearer-token endpoint
doesn't pay a Postgres round-trip on every request just to check the
revocation floor. `None` sentinel = never invalidated; `math.inf` sentinel =
inactive/deleted user (reject without a second query).
"""
from __future__ import annotations

import math
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import User

INVALIDATION_TTL_MS = 60 * 1000
INVALIDATION_CACHE_MAX = 10_000

_cache: dict[int, tuple[float | None, float]] = {}


async def get_token_invalidated_at(session: AsyncSession, user_id: int) -> float | None:
    now = time.time() * 1000
    cached = _cache.get(user_id)
    if cached is not None and now - cached[1] < INVALIDATION_TTL_MS:
        return cached[0]

    if len(_cache) > INVALIDATION_CACHE_MAX:
        cutoff = now - INVALIDATION_TTL_MS
        for k, v in list(_cache.items()):
            if v[1] < cutoff:
                del _cache[k]

    row = (
        await session.execute(
            select(User.token_invalidated_at, User.actif).where(User.id == user_id)
        )
    ).first()

    if row is None or not row.actif:
        _cache[user_id] = (math.inf, now)
        return math.inf

    value = row.token_invalidated_at.timestamp() * 1000 if row.token_invalidated_at else None
    _cache[user_id] = (value, now)
    return value


def clear_token_invalidation_cache(user_id: int) -> None:
    _cache.pop(user_id, None)
