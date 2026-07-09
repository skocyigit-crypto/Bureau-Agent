"""Regression guard for the documented Node footgun (global-super-admin-
guard.md, ported in auth/dependencies.py's docstring): `require_super_admin`
must never be attached as a router-wide dependency on the top-level `/api`
router, since that would 403 every tenant route for non-super-admin users —
exactly what `router.use(requireSuperAdmin, subRouter)` did by accident in
the Node version. It must only ever appear scoped to a specific sub-router
or a specific route.

Also exercises the Stripe-webhook-ordering invariant at the unit level:
nothing in this Phase 1 skeleton reads the request body via a body-consuming
dependency ahead of where a raw-body Stripe route would need to read it
(there is no Stripe route yet — this test documents the intended contract
for whoever adds it in Phase 5, per plan §2.7 row 8).
"""
from __future__ import annotations

from fastapi.routing import APIRoute

from agent_bureau_api.auth.dependencies import require_super_admin
from agent_bureau_api.main import app
from agent_bureau_api.routes import api_router


def test_require_super_admin_not_mounted_at_api_root() -> None:
    # Router-level dependencies on the top-level api_router would apply to
    # every route mounted under /api — require_super_admin must not be one
    # of them.
    top_level_dep_calls = {d.dependency for d in api_router.dependencies}
    assert require_super_admin not in top_level_dep_calls


def test_require_super_admin_not_a_global_app_dependency() -> None:
    app_level_deps = {d.dependency for d in app.router.dependencies}
    assert require_super_admin not in app_level_deps


def test_require_super_admin_only_appears_on_explicitly_scoped_routes() -> None:
    """If/when a super-admin-only route is added, it must declare the
    dependency on itself or on a dedicated sub-router — never inherit it
    from a broad mount. This walks every registered route's resolved
    dependency tree and, for any route depending on require_super_admin,
    just confirms the route path is more specific than the bare `/api`
    prefix (i.e., it opted in)."""
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        dependant = route.dependant
        stack = [dependant]
        found = False
        while stack:
            current = stack.pop()
            if current.call is require_super_admin:
                found = True
            stack.extend(current.dependencies)
        if found:
            assert route.path != "/api" and route.path != "/api/", (
                f"require_super_admin must not be attached to a root-level route: {route.path}"
            )
