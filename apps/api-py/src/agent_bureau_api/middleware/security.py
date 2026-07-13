"""Port of artifacts/api-server/src/middleware/security.ts (ipProtection,
threatDetection, csrfProtection). File-malware/URL-safety scanning
(VirusTotal/Safe Browsing) is Phase 6 scope, not ported here."""
from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from ..logging import get_logger
from ..settings import Settings, resolve_allowed_origins

logger = get_logger(__name__)

MALICIOUS_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"<script[\s>]", r"javascript:", r"on(load|error|click|mouseover|focus|blur|submit|change|input|keydown|keyup|keypress)\s*=",
        r"data:\s*text/html", r"vbscript:", r"expression\s*\(", r"url\s*\(\s*['\"]?\s*javascript",
        r"eval\s*\(", r"document\.(cookie|domain|write)", r"window\.(location|open)",
        r"\.constructor\s*\(", r"fromCharCode", r"innerHTML", r"outerHTML", r"insertAdjacentHTML",
    ]
]
SQL_INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"('\s*(OR|AND)\s+')", r"(UNION\s+SELECT)", r"(DROP\s+TABLE)", r"(INSERT\s+INTO)",
        r"(DELETE\s+FROM)", r"(UPDATE\s+\w+\s+SET)", r"(;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE))",
        r"(--\s*$)", r"(xp_cmdshell|sp_executesql)",
    ]
] + [re.compile(r"(/\*[\s\S]*?\*/)"), re.compile(r"(\bEXEC\b|\bEXECUTE\b)\s", re.IGNORECASE)]
PATH_TRAVERSAL_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [r"\.\.[/\\]", r"%2e%2e[%2f%5c]", r"\.\.%2f", r"%2e%2e/", r"\.\.\\", r"\.\.%5c"]
]
COMMAND_INJECTION_PATTERNS = [
    re.compile(r"[;&|`$](?![\s]*$)"),
    re.compile(r"\$\(.*\)"),
    re.compile(r"`[^`]*`"),
]

THREAT_THRESHOLD = 5
BAN_DURATION_S = 30 * 60
PERMANENT_BAN_THRESHOLD = 15
BURST_WINDOW_S = 1
BURST_MAX_REQUESTS = 300

SCAN_BYPASS_PATHS = {
    "/security/scan-url", "/api/security/scan-url",
    "/security/scan-document", "/api/security/scan-document",
    "/security/scan-text", "/api/security/scan-text",
    "/web-search", "/api/web-search",
}


def _detect_threat(value: object, path: str) -> str | None:
    if isinstance(value, str):
        for p in MALICIOUS_PATTERNS:
            if p.search(value):
                return f"XSS detected in {path}: {p.pattern}"
        for p in SQL_INJECTION_PATTERNS:
            if p.search(value):
                return f"SQL injection detected in {path}: {p.pattern}"
        for p in PATH_TRAVERSAL_PATTERNS:
            if p.search(value):
                return f"Path traversal detected in {path}"
        for p in COMMAND_INJECTION_PATTERNS:
            if p.search(value):
                return f"Command injection detected in {path}"
        return None
    if isinstance(value, list):
        for i, v in enumerate(value):
            t = _detect_threat(v, f"{path}[{i}]")
            if t:
                return t
        return None
    if isinstance(value, dict):
        for k, v in value.items():
            t = _detect_threat(v, f"{path}.{k}")
            if t:
                return t
    return None


@dataclass
class _BlacklistEntry:
    count: int = 0
    until: float = 0.0
    permanent: bool = False


def _get_client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class IpProtectionMiddleware(BaseHTTPMiddleware):
    def __init__(self, app) -> None:  # noqa: ANN001
        super().__init__(app)
        self._blacklist: dict[str, _BlacklistEntry] = {}
        self._request_log: dict[str, list[float]] = {}

    def _is_blacklisted(self, ip: str) -> bool:
        entry = self._blacklist.get(ip)
        if entry is None:
            return False
        if entry.permanent:
            return True
        if time.time() < entry.until:
            return True
        del self._blacklist[ip]
        return False

    def record_threat(self, ip: str, reason: str) -> None:
        entry = self._blacklist.setdefault(ip, _BlacklistEntry())
        entry.count += 1
        if entry.count >= PERMANENT_BAN_THRESHOLD:
            entry.permanent = True
            entry.until = math.inf
        elif entry.count >= THREAT_THRESHOLD:
            entry.until = time.time() + BAN_DURATION_S * min(entry.count - THREAT_THRESHOLD + 1, 10)
        logger.warning("threat_detected", ip=ip, reason=reason, count=entry.count)

    def _check_burst(self, ip: str) -> bool:
        now = time.time()
        recent = [t for t in self._request_log.get(ip, []) if now - t < BURST_WINDOW_S]
        recent.append(now)
        self._request_log[ip] = recent[-100:]
        return len(recent) > BURST_MAX_REQUESTS

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        ip = _get_client_ip(request)
        if self._is_blacklisted(ip):
            return JSONResponse({"error": "Access denied. Your IP address was blocked for suspicious activity."}, status_code=403)
        if self._check_burst(ip):
            return JSONResponse({"error": "Too many concurrent requests detected."}, status_code=429)
        request.state.ip_protection = self
        return await call_next(request)


class ThreatDetectionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        exact_path = (request.url.path.split("?")[0] or "").rstrip("/") or "/"
        if request.method == "POST" and exact_path in SCAN_BYPASS_PATHS:
            return await call_next(request)
        if request.method == "POST" and (
            request.url.path.startswith("/voice/twilio/") or exact_path.startswith("/api/voice/twilio/")
        ):
            return await call_next(request)

        ip = _get_client_ip(request)
        ip_guard: IpProtectionMiddleware | None = getattr(request.state, "ip_protection", None)

        query_dict = dict(request.query_params)
        if query_dict:
            threat = _detect_threat(query_dict, "query")
            if threat:
                if ip_guard:
                    ip_guard.record_threat(ip, threat)
                return JSONResponse({"error": "Potentially dangerous parameter detected.", "code": "THREAT_DETECTED"}, status_code=400)

        path_params = dict(request.path_params)
        if path_params:
            threat = _detect_threat(path_params, "params")
            if threat:
                if ip_guard:
                    ip_guard.record_threat(ip, threat)
                return JSONResponse({"error": "Potentially dangerous path parameter detected.", "code": "THREAT_DETECTED"}, status_code=400)

        url = str(request.url)
        for p in PATH_TRAVERSAL_PATTERNS:
            if p.search(url):
                if ip_guard:
                    ip_guard.record_threat(ip, "Path traversal in URL")
                return JSONResponse({"error": "Invalid URL detected."}, status_code=400)

        url_path = url.split("?")[0]
        for p in COMMAND_INJECTION_PATTERNS:
            if p.search(url_path):
                if ip_guard:
                    ip_guard.record_threat(ip, "Command injection in URL")
                return JSONResponse({"error": "Invalid URL detected."}, status_code=400)

        # NOTE: body scanning happens at the route/dependency layer in this
        # port (Pydantic models are parsed after this middleware runs, and
        # re-reading request.body() here would require explicit buffering)
        # — a Phase 2 follow-up once route bodies are wired up.
        return await call_next(request)


class CsrfProtectionMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, settings: Settings, disable_dev: bool = False) -> None:  # noqa: ANN001
        super().__init__(app)
        self.settings = settings
        self.disable_dev = disable_dev

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        path = request.url.path
        if path.startswith("/telephony/webhook/") or path.startswith("/api/telephony/webhook/"):
            return await call_next(request)
        if request.method == "POST" and path in ("/whatsapp/twilio/inbound", "/api/whatsapp/twilio/inbound"):
            return await call_next(request)
        if request.method == "POST" and (path.startswith("/voice/twilio/") or path.startswith("/api/voice/twilio/")):
            return await call_next(request)
        if not self.settings.is_production and self.disable_dev:
            return await call_next(request)

        origin = request.headers.get("origin")
        referer = request.headers.get("referer")
        host = request.headers.get("host")

        if not origin and not referer:
            logger.warning("csrf_no_origin", method=request.method, path=path)
            return JSONResponse({"error": "Unauthorized request - missing origin."}, status_code=403)

        allowed_origins = resolve_allowed_origins(self.settings)
        request_origin = origin or (urlparse(referer).scheme + "://" + urlparse(referer).netloc if referer else "")

        if host and request_origin:
            try:
                origin_host = urlparse(request_origin).netloc
            except ValueError:
                origin_host = ""
            if origin_host == host or any(urlparse(ao).netloc == origin_host for ao in allowed_origins):
                return await call_next(request)

        logger.warning("csrf_origin_mismatch", method=request.method, path=path, origin=origin, referer=referer)
        return JSONResponse({"error": "Invalid session. Please refresh the page."}, status_code=403)
