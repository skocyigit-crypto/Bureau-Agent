"""FastAPI app assembly — mirrors artifacts/api-server/src/app.ts's
middleware order, which the plan (§2.7) treats as a spec, not an
implementation detail:

  trust proxy -> security headers -> CORS -> rate limiters -> session ->
  guardian (WAF) -> ip_protection -> threat_detection -> csrf_protection ->
  main router (/api) -> centralized error handler

`require_tenant` / `license_check` are NOT global middleware here (nor were
they in Express, despite being mounted in routes/index.ts near the top) —
they're per-router FastAPI dependencies attached where routes.__init__
mounts tenant-scoped routers, matching the Node mount-order semantics
without the "bare mount at /" footgun (see auth/dependencies.py docstring).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from .db.session import close_engine
from .logging import configure_logging, get_logger
from .middleware.error_handler import register_error_handlers
from .middleware.guardian import GuardianMiddleware
from .middleware.headers import SecurityHeadersMiddleware
from .middleware.rate_limit import limiter
from .middleware.security import CsrfProtectionMiddleware, IpProtectionMiddleware, ThreatDetectionMiddleware
from .routes import api_router
from .settings import get_settings, resolve_allowed_origins

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    yield
    await close_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    allowed_origins = resolve_allowed_origins(settings)
    if settings.is_production and not allowed_origins:
        raise RuntimeError(
            "FATAL: no allowed origin detected in production. "
            "Set ALLOWED_ORIGINS, REPLIT_DOMAINS or PUBLIC_URL."
        )

    app = FastAPI(title="Agent de Bureau API (Python)", lifespan=lifespan)
    app.state.limiter = limiter

    # Order below is load-bearing (plan §2.7). Starlette applies
    # add_middleware() calls in REVERSE as the actual request-handling
    # stack (the last one added is outermost / runs first) — so this list
    # is written innermost-call-first to produce the desired execution
    # order: headers -> CORS -> guardian -> ip_protection -> rate limiters
    # -> threat_detection -> csrf_protection -> router.
    app.add_middleware(
        CsrfProtectionMiddleware,
        settings=settings,
        disable_dev=not settings.is_production,
    )
    app.add_middleware(ThreatDetectionMiddleware)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(IpProtectionMiddleware)
    app.add_middleware(GuardianMiddleware, is_production=settings.is_production)
    # NOTE: session resolution happens per-request via the `require_auth` /
    # `require_tenant` dependency chain (auth/dependencies.py), not a global
    # middleware — Starlette has no direct equivalent to mounting
    # express-session once and having every downstream handler read
    # req.session synchronously; FastAPI's Depends() chain plays that role.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins if allowed_origins else (["*"] if not settings.is_production else []),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
        max_age=86400,
    )
    app.add_middleware(SecurityHeadersMiddleware, is_production=settings.is_production)

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse({"error": "Too many requests. Please try again later."}, status_code=429)

    register_error_handlers(app)

    app.include_router(api_router, prefix="/api")

    return app


app = create_app()
