"""Port of the helmet() config + manual Permissions-Policy/X-Permitted-Cross-
Domain-Policies header middleware in app.ts:21-144. No drop-in Python
library reproduces this exact, heavily-commented policy set — the whole
point of these headers (per the source comments) is a specific enumerated
policy, not "a reasonable default", so they're hand-set here.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

FRAME_ANCESTORS_DEV = ["'self'", "https://*.replit.dev", "https://*.repl.co", "https://replit.com", "https://*.spock.replit.dev"]

PERMISSIONS_POLICY = ", ".join(
    [
        "accelerometer=()", "autoplay=()", "camera=()", "cross-origin-isolated=()",
        "display-capture=()", "encrypted-media=()", "fullscreen=()", "geolocation=()",
        "gyroscope=()", "hid=()", "identity-credentials-get=()", "idle-detection=()",
        "interest-cohort=()", "keyboard-map=()", "magnetometer=()", "microphone=()",
        "midi=()", "payment=()", "picture-in-picture=()", "publickey-credentials-get=()",
        "screen-wake-lock=()", "serial=()", "sync-xhr=()", "usb=()", "xr-spatial-tracking=()",
    ]
)


def _build_csp(is_production: bool) -> str:
    frame_ancestors = "'none'" if is_production else " ".join(FRAME_ANCESTORS_DEV)
    directives = [
        "default-src 'self'",
        "script-src 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "font-src 'self' https:",
        "object-src 'none'",
        "media-src 'self'",
        "frame-src 'none'",
        f"frame-ancestors {frame_ancestors}",
        "base-uri 'none'",
        "form-action 'none'",
    ]
    if is_production:
        directives.append("upgrade-insecure-requests")
    return "; ".join(directives)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, is_production: bool) -> None:  # noqa: ANN001
        super().__init__(app)
        self.is_production = is_production
        self.csp = _build_csp(is_production)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = self.csp
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin" if self.is_production else "cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        if self.is_production:
            response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "0"
        response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        response.headers.pop("X-Powered-By", None)
        if request.url.path.startswith("/api/auth"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response
