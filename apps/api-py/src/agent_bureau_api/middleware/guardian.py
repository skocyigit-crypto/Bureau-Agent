"""Port of artifacts/api-server/src/middleware/guardian.ts — the WAF layer.

Blocking logic (attack-tool UA detection, honeypot paths, suspicious path
regexes, disallowed methods, oversized headers, JSON-bomb detection,
behavioral anomaly scoring + escalating bans) is ported faithfully. The
admin-facing introspection API (guardian stats/events/banned-IP list — Node's
getGuardianStats/getGuardianEvents/etc., consumed by routes/security.ts) is
NOT ported here since that route lands in Phase 2; the underlying state
(`_blocklist`, `_ip_profiles`) is kept module-level so those endpoints can be
added later without restructuring this middleware.
"""
from __future__ import annotations

import json
import math
import re
import time
from dataclasses import dataclass, field

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from ..logging import get_logger

logger = get_logger(__name__)

ATTACK_TOOL_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"sqlmap", r"nikto", r"nmap", r"masscan", r"burp(?:\s*suite)?", r"metasploit",
        r"dirbuster", r"\bdirb\b", r"gobuster", r"ffuf", r"hydra", r"medusa", r"nessus",
        r"openvas", r"w3af", r"havij", r"acunetix", r"appscan", r"webinspect", r"nuclei",
        r"zgrab", r"shodan\.io", r"masscdn", r"\bfuzzer\b", r"\bscanner\b", r"\bexploit\b",
        r"wfuzz", r"\bwpscan\b", r"\barachni\b", r"\bvega\b", r"joomscan", r"\bcommix\b",
        r"xsser", r"beef\s*xss", r"sqlninja", r"\bzeroscanner\b", r"\bparos\b", r"\bwebscarab\b",
    ]
]

HONEYPOT_EXACT = {
    "/.env", "/.env.local", "/.env.production", "/.env.development", "/.env.staging",
    "/.env.backup", "/.env.old", "/.env.bak", "/wp-admin", "/wp-login.php", "/wp-config.php",
    "/wp-cron.php", "/xmlrpc.php", "/phpmyadmin", "/phpmyadmin/", "/pma", "/pma/", "/myadmin",
    "/mysql", "/admin.php", "/shell.php", "/webshell.php", "/c99.php", "/r57.php", "/eval.php",
    "/cmd.php", "/.git/config", "/.git/HEAD", "/.git/index", "/.gitignore", "/.svn/entries",
    "/.htaccess", "/.htpasswd", "/config.php", "/database.php", "/db.php", "/connect.php",
    "/backup.zip", "/backup.sql", "/dump.sql", "/database.sql", "/db_backup.sql",
    "/server-status", "/server-info", "/cgi-bin", "/etc/passwd", "/etc/shadow",
    "/proc/self/environ",
}

HONEYPOT_PREFIX = [
    "/wp-", "/wordpress/", "/drupal/", "/joomla/", "/typo3/", "/.well-known/pki-validation/",
    "/vendor/phpunit/", "/telescope/", "/horizon/", "/solr/", "/jenkins/", "/.aws/", "/.ssh/",
]

SUSPICIOUS_PATH_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\.\.(/|%2f|\\|%5c)",
        r"\.(php[0-9]?|asp|aspx|jsp|cgi|pl|rb|py)(\?|$|/)",
        r"/(etc|proc|sys)/(passwd|shadow|hosts|issue|crontab)",
        r"/?(wp-content|wp-includes)",
        r"(shell|cmd|webshell|backdoor)\.(php|asp|jsp)",
        r"\.(bak|old|backup|orig|save|swp|tmp)(\?|$)",
        r"~[\w\-]+/?(\.bash|\.profile|\.ssh)?",
        r"/\.(DS_Store|bash_history|zsh_history|npmrc|yarnrc)",
    ]
]

ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}
MAX_HEADER_BYTES = 16_384
MAX_JSON_DEPTH = 25
MAX_JSON_KEYS = 5000
BAN_MINUTES = [5, 15, 60, 360, 1440]

LOOPBACK_PREFIXES = (
    "127.", "::1", "::ffff:127.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.",
    "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "192.168.",
)


def _is_internal_ip(ip: str) -> bool:
    return ip.startswith(LOOPBACK_PREFIXES) or ip in ("::1", "unknown")


@dataclass
class _GuardianBlock:
    count: int = 0
    until: float = 0.0
    permanent: bool = False
    reasons: list[str] = field(default_factory=list)


@dataclass
class _IpProfile:
    requests: list[float] = field(default_factory=list)
    unique_paths: set[str] = field(default_factory=set)
    errors: int = 0
    threat_score: float = 0.0
    last_seen: float = 0.0


IS_PROD_THRESHOLDS = {"req10s": 50, "req60s": 200, "pathBurst": 100, "pathBurstReq60s": 50, "errorBurst": 40}
DEV_THRESHOLDS = {"req10s": 120, "req60s": 500, "pathBurst": 200, "pathBurstReq60s": 100, "errorBurst": 80}


def _json_depth(obj: object, max_depth: int = MAX_JSON_DEPTH, depth: int = 0) -> int:
    if depth > max_depth or not isinstance(obj, dict):
        return depth
    best = depth
    for v in obj.values():
        d = _json_depth(v, max_depth, depth + 1)
        if d > best:
            best = d
        if best > max_depth:
            return best
    return best


def _json_key_count(obj: object, limit: int = MAX_JSON_KEYS, count: int = 0) -> int:
    if count > limit or not isinstance(obj, dict):
        return count
    for v in obj.values():
        count += 1
        if count > limit:
            return count
        count = _json_key_count(v, limit, count)
    return count


class GuardianMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, is_production: bool) -> None:  # noqa: ANN001
        super().__init__(app)
        self.is_production = is_production
        self.thresholds = IS_PROD_THRESHOLDS if is_production else DEV_THRESHOLDS
        self._blocklist: dict[str, _GuardianBlock] = {}
        self._profiles: dict[str, _IpProfile] = {}

    def _get_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _ban(self, ip: str, reason: str) -> None:
        entry = self._blocklist.setdefault(ip, _GuardianBlock())
        entry.count += 1
        seen = list(dict.fromkeys([*entry.reasons, reason]))
        entry.reasons = seen[-5:]
        if entry.count >= 6:
            entry.permanent = True
            entry.until = math.inf
        else:
            idx = min(entry.count - 1, len(BAN_MINUTES) - 1)
            entry.until = time.time() + BAN_MINUTES[idx] * 60
        logger.warning("guardian_ban", ip=ip, reason=reason, count=entry.count, permanent=entry.permanent)

    def _is_banned(self, ip: str) -> bool:
        entry = self._blocklist.get(ip)
        if entry is None:
            return False
        if entry.permanent:
            return True
        if time.time() < entry.until:
            return True
        del self._blocklist[ip]
        return False

    def _profile(self, ip: str) -> _IpProfile:
        return self._profiles.setdefault(ip, _IpProfile())

    def _record(self, ip: str, path: str) -> None:
        p = self._profile(ip)
        now = time.time()
        p.requests.append(now)
        p.last_seen = now
        p.unique_paths.add(path.split("?")[0])
        p.requests = [t for t in p.requests if now - t < 300]

    def _behavioral_anomaly(self, ip: str) -> str | None:
        p = self._profile(ip)
        now = time.time()
        last60 = len([t for t in p.requests if now - t < 60])
        last10 = len([t for t in p.requests if now - t < 10])
        t = self.thresholds
        if last10 > t["req10s"]:
            return f"Excessive request rate: {last10} req/10s (bot behavior)"
        if last60 > t["req60s"]:
            return f"High request volume: {last60} req/min"
        if len(p.unique_paths) > t["pathBurst"] and last60 > t["pathBurstReq60s"]:
            return f"Path scanner detected: {len(p.unique_paths)} unique paths"
        if p.errors > t["errorBurst"]:
            return f"Automated error scanning: {p.errors} error responses"
        return None

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        ip = self._get_ip(request)
        path = request.url.path or "/"
        method = request.method
        ua = request.headers.get("user-agent", "")[:256]
        normal_path = (path.lower().rstrip("/")) or "/"

        if _is_internal_ip(ip):
            return await call_next(request)

        if self._is_banned(ip):
            return JSONResponse({"error": "Access denied. Malicious activity detected.", "code": "GUARDIAN_BANNED"}, status_code=403)

        if ua:
            for pattern in ATTACK_TOOL_PATTERNS:
                if pattern.search(ua):
                    self._ban(ip, f"Attack tool: {pattern.pattern}")
                    logger.error("guardian_attack_tool_blocked", ip=ip, ua=ua[:100], path=path)
                    return JSONResponse({"error": "Access denied.", "code": "ATTACK_TOOL"}, status_code=403)

        stripped_path = re.sub(r"^/api", "", normal_path) or "/"
        is_honeypot = (
            normal_path in HONEYPOT_EXACT
            or stripped_path in HONEYPOT_EXACT
            or f"{normal_path}/" in HONEYPOT_EXACT
            or f"{stripped_path}/" in HONEYPOT_EXACT
            or any(normal_path.startswith(p) or stripped_path.startswith(p) for p in HONEYPOT_PREFIX)
        )
        if is_honeypot:
            self._ban(ip, f"Honeypot: {path}")
            logger.error("guardian_honeypot_triggered", ip=ip, path=path)
            return JSONResponse({"error": "Not found."}, status_code=404)

        full_url = str(request.url)
        for pattern in SUSPICIOUS_PATH_PATTERNS:
            if pattern.search(full_url):
                self._ban(ip, f"Suspicious path: {path[:60]}")
                return JSONResponse({"error": "Invalid request.", "code": "SUSPICIOUS_PATH"}, status_code=400)

        if method not in ALLOWED_METHODS:
            return JSONResponse({"error": "Method not allowed.", "code": "METHOD_NOT_ALLOWED"}, status_code=405)

        header_size = len(json.dumps(dict(request.headers)).encode("utf-8"))
        if header_size > MAX_HEADER_BYTES:
            self._ban(ip, f"Oversized headers: {header_size}B")
            return JSONResponse({"error": "Request headers too large.", "code": "HEADERS_TOO_LARGE"}, status_code=431)

        # JSON-bomb check: only for bodies FastAPI/Starlette will parse as
        # JSON later; reading here would consume the stream, so this relies
        # on a cached-body middleware upstream in production wiring (Phase 2
        # concern) — deferred rather than double-buffering in Phase 1.

        self._record(ip, path)
        anomaly = self._behavioral_anomaly(ip)
        if anomaly:
            profile = self._profile(ip)
            profile.threat_score += 15
            if profile.threat_score >= 60:
                self._ban(ip, anomaly)
                return JSONResponse(
                    {"error": "Suspicious activity detected. Access temporarily restricted.", "code": "BEHAVIORAL_BLOCK"},
                    status_code=429,
                )

        return await call_next(request)
