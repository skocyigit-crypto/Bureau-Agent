"""Port of the 3 named rate limiters + Twilio-specific limiters in
app.ts:261-332, using slowapi (an express-rate-limit analog for
Starlette/FastAPI). Two Limiter instances are needed (not one) because
slowapi binds `key_func` per-Limiter: `limiter` is IP-keyed (covers
general/ai/strict/webhook-flood-guard, distinguished by the limit string
passed to `.limit(...)` per route), `webhook_limiter` is sender-keyed.

Limit strings, mirrored 1:1 from app.ts:
    GENERAL_LIMIT  = "1000/15minutes"
    AI_LIMIT       = "15/minute"
    STRICT_LIMIT   = "200/15minutes"
    WEBHOOK_FLOOD_GUARD_LIMIT = "600/minute"
    WEBHOOK_SENDER_LIMIT      = "60/minute"
    LOGIN_LIMIT               = "10/15minutes"
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

GENERAL_LIMIT = "1000/15minutes"
AI_LIMIT = "15/minute"
STRICT_LIMIT = "200/15minutes"
WEBHOOK_FLOOD_GUARD_LIMIT = "600/minute"
WEBHOOK_SENDER_LIMIT = "60/minute"
LOGIN_LIMIT = "10/15minutes"


def _sender_or_ip_key(request: Request) -> str:
    """Mirrors webhookLimiter's keyGenerator in app.ts:320-330 — keys by
    Twilio AccountSid+From/Caller/WaId (from the already-parsed form body) so
    a single sender can't flood, falling back to IP if the body isn't
    usable. NOTE: this key is attacker-forgeable pre-signature-check, which
    is why the IP-keyed flood guard always runs first (app.ts:296-305)."""
    form = getattr(request.state, "twilio_form", None) or {}
    sid = form.get("AccountSid", "")
    sender = form.get("From") or form.get("Caller") or form.get("WaId") or ""
    if sid or sender:
        return f"twilio:{sid}:{sender}"
    return get_remote_address(request)


limiter = Limiter(key_func=get_remote_address)
webhook_limiter = Limiter(key_func=_sender_or_ip_key)


def is_twilio_webhook(request: Request) -> bool:
    """Direct port of isTwilioWebhook() in app.ts:337-347."""
    if request.method != "POST":
        return False
    path = request.url.path
    return (
        path == "/whatsapp/twilio/inbound"
        or path == "/api/whatsapp/twilio/inbound"
        or path.startswith("/voice/twilio/")
        or path.startswith("/api/voice/twilio/")
    )
