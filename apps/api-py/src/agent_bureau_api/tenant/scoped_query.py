"""Concrete mechanism for plan §2.3's tenant-isolation design.

The PRIMARY mechanism is convention: every repository function takes
`org_id`/`ctx` as a required (never optional/defaulted) argument and calls
`tenant_scoped_select()`, exactly mirroring how every Express handler
explicitly calls `getOrgId(req)` today. The `install_tenant_isolation_guard`
event listener below is DEFENSE-IN-DEPTH ONLY — a best-effort runtime check,
not a substitute for the convention, and it cannot see cross-entity FK
writes that skip the ORM (e.g. raw SQL) or joins where the org predicate is
expressed against a *different* table's organisation_id column further down
a join chain.
"""
from __future__ import annotations

from sqlalchemy import Select, event
from sqlalchemy.orm import ORMExecuteState, Session
from sqlalchemy.sql import visitors

from ..logging import get_logger
from ..db.mixins import TENANT_SCOPED_TABLES
from ..tenant.context import TenantContext

logger = get_logger(__name__)


class TenantIsolationViolation(RuntimeError):
    pass


def tenant_scoped_select(model: type, ctx: TenantContext) -> Select:
    """Required entry point for reads against any TenantScopedMixin model —
    direct analog of Drizzle's `db.select().from(x).where(eq(x.organisationId, orgId))`
    pattern used throughout the current route handlers."""
    return Select(model).where(model.organisation_id == ctx.organisation_id)  # type: ignore[attr-defined]


def _mentions_column(clause, column) -> bool:
    if clause is None or column is None:
        return False
    found = False

    def _visit(el):  # noqa: ANN001
        nonlocal found
        if el is column:
            found = True

    visitors.traverse(clause, {}, {"column": _visit})
    return found


def install_tenant_isolation_guard(*, strict: bool = True) -> None:
    """Registers a Session-level `do_orm_execute` hook that flags any
    SELECT/UPDATE/DELETE against a TenantScopedMixin model whose compiled
    WHERE clause never references that table's organisation_id column.
    `strict=True` (recommended for dev/test) raises; `strict=False` (an
    escape hatch, not recommended) only logs, for use if a legitimate
    cross-tenant super-admin query needs to bypass this temporarily."""

    @event.listens_for(Session, "do_orm_execute")
    def _check(orm_execute_state: ORMExecuteState) -> None:  # noqa: ANN001
        if not (
            orm_execute_state.is_select
            or orm_execute_state.is_update
            or orm_execute_state.is_delete
        ):
            return
        stmt = orm_execute_state.statement
        where = getattr(stmt, "_where_criteria", None) or getattr(stmt, "whereclause", None)

        for mapper in orm_execute_state.all_mappers:
            model = mapper.class_
            if model not in TENANT_SCOPED_TABLES:
                continue
            org_col = mapper.local_table.columns.get("organisation_id")
            mentioned = False
            if isinstance(where, (list, tuple)):
                mentioned = any(_mentions_column(c, org_col) for c in where)
            else:
                mentioned = _mentions_column(where, org_col)
            if not mentioned:
                message = (
                    f"Tenant isolation violation: query against "
                    f"'{mapper.local_table.name}' has no organisation_id predicate"
                )
                if strict:
                    raise TenantIsolationViolation(message)
                logger.error("tenant_isolation_violation", table=mapper.local_table.name)
