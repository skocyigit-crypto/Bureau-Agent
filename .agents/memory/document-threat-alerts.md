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

A third layer drives the **mobile push** (local notification via SSE, no Expo
push tokens exist here): a `security` SSE event carrying `meta.notify` +
`route`/`scan`. The mobile `UnreadBadgesContext` only notifies on
`security`+`meta.notify` (per-file `emitSecurityAlert` events have no `notify`,
so they don't spam), and `_layout.tsx` deep-links the tap to
`/documents?scan=dangerous`.

**Dedup the push PER DOCUMENT, not per org.** Gate it on the verdict
*transition* via `shouldNotifyDocumentThreat(prevVerdict, newVerdict)` (notify
iff `new === 'dangerous' && prev !== 'dangerous'`), evaluated at the scan sites
where the old verdict is still readable. **Why:** the proactive suggestion's
org-wide dedupeKey means only the FIRST threat per org inserts a pending row;
reusing that gate (`inserted.length > 0`) to trigger the push silently
suppresses notifications for every later distinct dangerous file until the user
resolves the suggestion. The transition rule survives restarts (verdict is
persisted) and still skips re-scans of an already-dangerous file.
