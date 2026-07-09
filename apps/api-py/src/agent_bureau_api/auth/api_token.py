"""Byte-compatible port of artifacts/api-server/src/lib/api-token.ts.

Stateless Bearer-token auth for non-browser clients (Expo mobile). HMAC-SHA256
with multi-secret rotation via SESSION_SECRETS — deliberately not JWT/PyJWT,
same reasoning as the Node side: reuse SESSION_SECRETS rotation, avoid an
extra dependency/CVE surface, and there is exactly one accepted algorithm so
an `alg=none`-style downgrade attack class doesn't exist.

Format: "<base64url(payload-json)>.<base64url(hmac-sha256)>". A token minted
by the existing Node service (same SESSION_SECRETS) verifies here unchanged,
and vice versa — the HMAC is computed over the opaque base64url(payload)
substring, not over any language-specific JSON serialization, so formatting
differences between json.dumps and JSON.stringify never matter.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass, asdict

from ..settings import get_settings

DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
MIN_SECRET_LENGTH = 16


@dataclass
class ApiTokenPayload:
    userId: int
    userRole: str
    userEmail: str
    iat: int
    exp: int
    organisationId: int | None = None
    prenom: str | None = None
    nom: str | None = None


def _get_secrets() -> list[str]:
    """Mirrors lib/api-token.ts getSecrets() precedence exactly:
    SESSION_SECRETS CSV -> SESSION_SECRET -> JWT_SECRET -> dev fallback."""
    settings = get_settings()
    out: list[str] = []
    if settings.session_secrets:
        for part in settings.session_secrets.split(","):
            part = part.strip()
            if len(part) >= MIN_SECRET_LENGTH:
                out.append(part)
    if out:
        return out
    if settings.is_production:
        raise RuntimeError(
            "SESSION_SECRETS (or SESSION_SECRET / JWT_SECRET) is required in "
            "production to sign API tokens."
        )
    return ["dev-api-token-secret-do-not-use-in-prod-aaaaaaaa"]


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def mint_api_token(base: dict, ttl_ms: int = DEFAULT_TTL_MS) -> str:
    now = int(time.time() * 1000)
    payload = {**base, "iat": now, "exp": now + ttl_ms}
    json_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    json_b64 = _b64url_encode(json_bytes)
    sig = hmac.new(_get_secrets()[0].encode("utf-8"), json_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{json_b64}.{_b64url_encode(sig)}"


def verify_api_token(token: str) -> ApiTokenPayload | None:
    if not isinstance(token, str) or "." not in token:
        return None
    json_b64, _, sig_b64 = token.partition(".")
    if not json_b64 or not sig_b64:
        return None

    try:
        sig_buf = _b64url_decode(sig_b64)
    except Exception:  # noqa: BLE001
        return None

    # Constant-time across ALL configured secrets: total work depends only on
    # secret count, never short-circuits on the first match, so total latency
    # doesn't leak which secret (if any) actually signed the token.
    matched = False
    for secret in _get_secrets():
        expected = hmac.new(secret.encode("utf-8"), json_b64.encode("ascii"), hashlib.sha256).digest()
        if len(expected) == len(sig_buf) and hmac.compare_digest(expected, sig_buf):
            matched = True
    if not matched:
        return None

    try:
        payload = json.loads(_b64url_decode(json_b64).decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None

    if (
        not isinstance(payload.get("userId"), int)
        or not isinstance(payload.get("userRole"), str)
        or not isinstance(payload.get("userEmail"), str)
        or not isinstance(payload.get("iat"), int)
        or not isinstance(payload.get("exp"), int)
    ):
        return None

    if int(time.time() * 1000) >= payload["exp"]:
        return None

    return ApiTokenPayload(
        userId=payload["userId"],
        userRole=payload["userRole"],
        userEmail=payload["userEmail"],
        iat=payload["iat"],
        exp=payload["exp"],
        organisationId=payload.get("organisationId"),
        prenom=payload.get("prenom"),
        nom=payload.get("nom"),
    )


def extract_bearer_token(header_value: str | None) -> str | None:
    if not header_value:
        return None
    header_value = header_value.strip()
    if not header_value.lower().startswith("bearer "):
        return None
    token = header_value[7:].strip()
    return token or None
