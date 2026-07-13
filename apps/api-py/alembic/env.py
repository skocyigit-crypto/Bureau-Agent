"""Async-aware Alembic env.py.

IMPORTANT (plan §2.4): for the ~85 tables ported from the existing Drizzle
schema, the workflow is `alembic revision --autogenerate` -> verify the
diff is EMPTY against a staging clone of production -> `alembic stamp head`
(never `upgrade head`) in any environment with real data. `upgrade head`
only runs against a from-empty database (fresh local/CI Postgres) or for
genuinely NEW tables this service owns outright (e.g. py_user_sessions).
Running `upgrade head` against the shared production database is exactly
the "two migration tools racing" failure mode flagged as the highest risk
in the plan — do not do it without the explicit sign-off described there.
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from agent_bureau_api.db.base import Base
from agent_bureau_api.db.models import *  # noqa: F401,F403 — populates Base.metadata
from agent_bureau_api.settings import get_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

config.set_main_option("sqlalchemy.url", get_settings().database_url)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:  # noqa: ANN001
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
