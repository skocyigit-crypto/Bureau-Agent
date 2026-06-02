---
name: Document threat alerts
description: Where a stored document's "dangerous" verdict actually originates, and how owners get alerted
---

A document row only ever transitions to `scanVerdict = 'dangerous'` via the two
**re-scan** paths, never on first upload:

- `POST /documents/upload` blocks a dangerous file (HTTP 400) before insert.
- `POST /documents/upload-multiple` skips dangerous files (not stored).
- `POST /documents/process` (import rescan) blocks before storing.
- `POST /documents/bulk/scan` and `POST /documents/:id/scan` re-scan an
  already-stored doc and **persist** the dangerous verdict.

**How to apply:** any feature that reacts to a "newly dangerous document" must
hook the two re-scan endpoints, not the upload endpoints.

Owner alerting reuses two layers: `emitSecurityAlert` (real-time SSE + optional
WhatsApp, in-memory) and an org-scoped persistent proactive suggestion
(`recordDocumentThreatSuggestion`, dedupeKey `document_threat`). The suggestion
is event-driven and intentionally fires regardless of
`organisations.proactiveEngineEnabled` — security alerts must not be silenced by
the workflow-automation opt-in. It is aggregated to one pending row per org
(points to `/documents?scan=dangerous`) and is **not** a `DETECTOR_TYPES` member,
so the proactive cron never auto-resolves it.
