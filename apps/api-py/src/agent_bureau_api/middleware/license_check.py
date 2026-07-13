"""Phase 1 STUB for artifacts/api-server/src/middleware/license-check.ts.

Reserves the dependency slot between require_tenant and business routers so
route wiring never has to be reshuffled later — real subscription-status
gating (exempt paths, read-only degradation for cancelled/suspended/
expired-trial/past_due orgs) lands in Phase 5 once billing/Stripe/
subscriptions are ported. Always allows for now.
"""
from __future__ import annotations

from fastapi import Depends

from ..tenant.context import TenantContext, require_tenant


async def license_check(ctx: TenantContext = Depends(require_tenant)) -> TenantContext:
    return ctx
