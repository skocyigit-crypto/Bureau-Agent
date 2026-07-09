"""Port of artifacts/api-server/src/middleware/proto-pollution.ts.

Python dicts have no __proto__/prototype-chain pollution class the way JS
objects do, so this is a much smaller residual-gap concern than in Node —
kept anyway for defense-in-depth against raw dict-merge call sites (e.g. the
document-AI execute-action contract's `{...extractedFields, **action.data}`
pattern) where a client-supplied key could otherwise shadow something
unexpected. Pydantic's `model_config = ConfigDict(extra="forbid")` on
request schemas covers most of the FastAPI-boundary case already.
"""
from __future__ import annotations

FORBIDDEN_KEYS = {"__proto__", "constructor", "prototype"}
MAX_DEPTH = 12


def find_forbidden_key(value: object, depth: int = 0) -> str | None:
    if depth > MAX_DEPTH or not isinstance(value, (dict, list)):
        return None
    if isinstance(value, list):
        for item in value:
            hit = find_forbidden_key(item, depth + 1)
            if hit:
                return hit
        return None
    for key, val in value.items():
        if key in FORBIDDEN_KEYS:
            return key
        hit = find_forbidden_key(val, depth + 1)
        if hit:
            return hit
    return None
