"""Port of the centralized error handler in app.ts:478-514."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..logging import get_logger
from ..settings import get_settings
from ..tenant.guard import TenantGuardError

logger = get_logger(__name__)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(TenantGuardError)
    async def _tenant_guard_error(request: Request, exc: TenantGuardError) -> JSONResponse:
        return JSONResponse({"error": exc.message, "code": exc.code}, status_code=exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error("server_error", detail=str(exc.detail), method=request.method, url=str(request.url))
        else:
            logger.warning("client_error", detail=str(exc.detail), status=exc.status_code)
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    @app.exception_handler(ConnectionRefusedError)
    @app.exception_handler(ConnectionResetError)
    async def _connection_error(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"error": "Service temporarily unavailable. Please try again."}, status_code=503)

    @app.exception_handler(Exception)
    async def _unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled_exception", err=str(exc), method=request.method, url=str(request.url))
        settings = get_settings()
        if settings.is_production:
            return JSONResponse({"error": "An internal error occurred."}, status_code=500)
        return JSONResponse({"error": str(exc) or "Unknown error"}, status_code=500)
