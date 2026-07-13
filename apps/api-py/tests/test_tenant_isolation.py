"""Verifies the tenant-isolation mechanism from plan §2.3: a read scoped to
one organisation never returns another organisation's rows, and the
defense-in-depth guard flags a query against a TenantScopedMixin model that
has no organisation_id predicate at all.

Uses an in-memory SQLite engine (not the app's Postgres-only engine in
db/session.py) — this test only exercises ORM-level query shape, not any
Postgres-specific behavior, so SQLite is a reasonable, fast substitute here.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from agent_bureau_api.db.base import Base
from agent_bureau_api.db.models import Organisation, Task
from agent_bureau_api.tenant.context import TenantContext
from agent_bureau_api.tenant.scoped_query import (
    TenantIsolationViolation,
    install_tenant_isolation_guard,
    tenant_scoped_select,
)


@pytest.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=[Organisation.__table__, Task.__table__])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
async def two_orgs_with_tasks(session_factory):
    async with session_factory() as session:
        org_a = Organisation(name="Org A", slug="org-a")
        org_b = Organisation(name="Org B", slug="org-b")
        session.add_all([org_a, org_b])
        await session.flush()

        task_a = Task(organisation_id=org_a.id, title="Task for A")
        task_b = Task(organisation_id=org_b.id, title="Task for B")
        session.add_all([task_a, task_b])
        await session.commit()
        return org_a.id, org_b.id


async def test_tenant_scoped_select_only_returns_own_org_rows(session_factory, two_orgs_with_tasks):
    org_a_id, org_b_id = two_orgs_with_tasks
    ctx_a = TenantContext(organisation_id=org_a_id, user_id=1, user_role="agent", user_email="a@example.test")

    async with session_factory() as session:
        rows = (await session.execute(tenant_scoped_select(Task, ctx_a))).scalars().all()

    assert len(rows) == 1
    assert rows[0].title == "Task for A"
    assert all(r.organisation_id == org_a_id for r in rows)
    assert not any(r.organisation_id == org_b_id for r in rows)


async def test_unscoped_query_against_tenant_table_is_flagged(session_factory, two_orgs_with_tasks):
    install_tenant_isolation_guard(strict=True)

    async with session_factory() as session:
        with pytest.raises(TenantIsolationViolation):
            await session.execute(select(Task))
