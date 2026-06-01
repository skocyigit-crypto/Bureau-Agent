---
name: Security middleware stack (api-server)
description: Non-obvious constraints of the /api global security middleware (threatDetection + express.json limits) that bite endpoints receiving URLs or base64.
---

# Security middleware stack — gotchas for new /api endpoints

The api-server mounts a global security chain on `/api` (see `app.ts` +
`middleware/security.ts`). Two layers silently break otherwise-correct new
endpoints, and the fix pattern already exists in the codebase.

## 1. `threatDetection` rejects bodies/URLs containing injection-like chars
`COMMAND_INJECTION_PATTERNS` matches `& ; | $` backtick. Any endpoint that
*legitimately receives* a URL (query strings use `&`, `;`) or arbitrary text
will get a 400 `THREAT_DETECTED` before its handler runs.

**How to apply:** add a targeted bypass at the TOP of `threatDetection`,
scoped to `req.method === "POST"` + exact path (mirror the existing telephony
webhook / whatsapp inbound bypasses). Only do this for handlers that merely
*analyze* the string and never shell out. Example endpoints:
`/security/scan-url`, `/security/scan-document`.

**Why:** these scanners exist to inspect dangerous-looking input; the WAF
would otherwise make them unusable for the exact inputs they target.

## 2. Global `express.json` limit is 1mb
`app.use(express.json({ limit: "1mb" }))` is the catch-all. base64 upload
endpoints (file scan, document AI) need a dedicated higher limit mounted
*before* the global parser, e.g.
`app.use("/api/security/scan-document", express.json({ limit: "25mb" }))`.
Remember base64 inflates ~33%, so cap the client-side file size accordingly
(15MB file ≈ 20MB base64, safe under 25mb).

**Why:** without this, payloads over ~1MB fail with a 413/parse error before
the route logic, even though the scanner itself supports large files.

## 3. `formatCallerName` returns "" (never null)
In `routes/twilio-voice.ts`, `formatCallerName(first,last)` returns an empty
string for unknown callers, never `null`. Gating optional logic on
`callerName === null` is dead code — use `!callerName` to detect "unknown".
