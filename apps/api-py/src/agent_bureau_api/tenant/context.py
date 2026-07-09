"""Port of artifacts/api-server/src/middleware/tenant.ts.

`require_tenant` resolves organisation_id onto the session (falling back to
a `users` table lookup if it wasn't already present, e.g. for a Bearer token
minted before an org was assigned), persisting the resolved value back to
the session store for cookie-backed sessions — mirrors Node's
`req.session.organisationId = user.organisationId` (auto-saved by
express-session since a mutated session is always written regardless of
`resave: false`, which only skips re-saving UNMODIFIED sessions).
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import SessionData, require_auth
from ..auth.session_backend import session_backend
from ..db.models import User
from ..db.session import get_db


@dataclass(frozen=True)
class TenantContext:
    organisation_id: int
    user_id: int
    user_role: str
    user_email: str | None


async def require_tenant(
    session: SessionData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> TenantContext:
    if session.organisation_id:
        return TenantContext(
            organisation_id=session.organisation_id,
            user_id=session.user_id,  # type: ignore[arg-type]
            user_role=session.user_role or "",
            user_email=session.user_email,
        )

    row = (
        await db.execute(select(User.organisation_id).where(User.id == session.user_id))
    ).first()
    if row is None or row.organisation_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No organisation associated with this account.")

    session.organisation_id = row.organisation_id
    if session.sid is not None:
        await session_backend.save(
            db,
            session.sid,
            {
                "userId": session.user_id,
                "userRole": session.user_role,
                "organisationId": session.organisation_id,
                "userEmail": session.user_email,
                "prenom": session.prenom,
                "nom": session.nom,
            },
        )

    return TenantContext(
        organisation_id=row.organisation_id,
        user_id=session.user_id,  # type: ignore[arg-type]
        user_role=session.user_role or "",
        user_email=session.user_email,
    )
