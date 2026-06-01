---
name: External security scan engines (URL + file)
description: How URL/file scanning layers real external engines on top of local heuristics, fail-soft.
---

# External security scan engines

Both URL and file scanning follow the same two-layer, fail-soft pattern:
local heuristic (always on, zero network, zero data leak) + an optional real
external engine that only activates when its API key is present.

- URLs: `services/url-safety.ts` -> Google Safe Browsing (env
  `GOOGLE_SAFE_BROWSING_API_KEY`/`GOOGLE_API_KEY`).
- Files: `services/file-malware.ts` -> VirusTotal v3 by **SHA-256 hash lookup
  only** (env `VIRUSTOTAL_API_KEY`). Privacy: file bytes never leave the
  server; an unknown hash (404) yields no verdict and falls back to heuristics.

**Why:** customers wanted antivirus-grade verdicts, but sensitive documents
must not be uploaded to third parties by default — hash lookup is the
privacy-safe default.

**How to apply:**
- The async orchestrator is `scanBase64ContentFull` in
  `middleware/security.ts`; the sync `scanBase64Content` stays heuristic-only.
  Only the Security Center `/api/security/scan-document` route uses the full
  async version. Automatic ingestion paths (documents.ts, whatsapp.ts,
  gmail.ts, document-ai.ts) still call the sync heuristic scan to avoid adding
  network latency to uploads.
- Every external engine must stay fail-soft: timeout (AbortController), a
  circuit breaker that disables the layer for ~30 min on 401/403/429, an
  in-memory TTL cache, and NEVER throw to the caller.
- `ScanResult.engine`/`engineDetail` and `SecurityScan.engine` surface which
  engine produced each verdict; the UI (`securite.tsx` web + mobile) shows it.
