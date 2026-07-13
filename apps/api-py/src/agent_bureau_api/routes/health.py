from __future__ import annotations

from fastapi import APIRouter

from ..db.session import check_db_health

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict:
    db_ok = await check_db_health()
    return {"status": "ok" if db_ok else "degraded", "db": db_ok}
