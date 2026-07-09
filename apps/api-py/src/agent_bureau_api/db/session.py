"""Direct port of lib/db/src/index.ts — pool sizing, timeouts, and the
per-connection SET statements are reproduced 1:1 (see plan §1.2)."""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import Pool

from ..logging import get_logger
from ..settings import get_settings

logger = get_logger(__name__)


def build_engine() -> AsyncEngine:
    settings = get_settings()
    engine = create_async_engine(
        settings.database_url,
        pool_size=20,
        max_overflow=0,
        pool_timeout=10,
        pool_recycle=1800,
        pool_pre_ping=True,
        connect_args={
            # asyncpg server_settings == the connection-string-level
            # statement_timeout the Node pool passes; command_timeout is the
            # client-side cancel, mirroring node-postgres' query_timeout
            # (statement_timeout + 2s grace so PG cancels first).
            "server_settings": {
                "statement_timeout": str(settings.db_statement_timeout_ms),
            },
            "command_timeout": (settings.db_statement_timeout_ms + 2000) / 1000,
        },
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _set_session_timeouts(dbapi_connection, connection_record) -> None:  # noqa: ANN001
        # Mirrors lib/db/src/index.ts:53-63 exactly: lock_timeout / idle-in-tx
        # timeout / explicit search_path are (re)applied on every NEW physical
        # connection, not just at pool creation, so pool-recycled connections
        # keep the same session-level guarantees.
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute(f"SET lock_timeout = {settings.db_lock_timeout_ms}")
            cursor.execute(
                f"SET idle_in_transaction_session_timeout = {settings.db_idle_in_tx_timeout_ms}"
            )
            cursor.execute('SET search_path = "$user", public')
        finally:
            cursor.close()

    return engine


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = build_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _session_factory


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency — one session per request, mirroring the
    request-scoped `db` import used throughout the Express routes."""
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def check_db_health() -> bool:
    from sqlalchemy import text

    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


async def close_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
