---
name: BTP / CREPI-OS vision scope boundaries
description: Which parts of the owner's grandiose "CREPI-OS" autonomous-office vision are buildable here vs. red lines.
---

# BTP / CREPI-OS vision — scope boundaries

The owner periodically pitches a maximalist "CREPI-OS / Dark Office" vision
(AI-generated prompts): an OS-kernel desktop agent that sees the screen via VLM,
drives mouse/keyboard, runs local accounting apps, sends SEPA payments with no human
approval, self-restarts, and locks physical site turnstiles. Treat each new variant
against these fixed boundaries.

**Red lines (do NOT build):**
- Autonomous payments (EBICS/PSD2 SEPA without human approval) — PSD2 SCA legally
  needs human auth; also violates the project's "alerts/suggestions only, no
  dangerous auto-actions" principle.
- Physical access control / turnstile lock or autonomous payment cutoff — safety + legal.
- OS-kernel / VLM screen-control / "Python kernel" desktop agent / self-restart —
  cannot run in the Replit cloud Linux container; would be a SEPARATE native desktop
  product, not this web SaaS.

**Buildable (human-approved, in this SaaS):** invoice OCR/AI → accounting draft;
autoliquidation TVA resolution; field WhatsApp voice → work-order/situation/stock
SUGGESTION; truck fault-code → service-appointment SUGGESTION; Chorus Pro/SEPA data
prep + one-click human approval. Event-driven flows belong in the EXISTING
proactive-engine as alert-only detectors, not a new orchestrator.

**Data mapping (do NOT duplicate):** chantier=`projets`, tasks=`tasks`,
factures=`factures_client` (has `is_autoliquidation`), stock=`stock*`. Only genuinely
new entity is `vehicules` (fleet/telemetry). Owner-proposed raw SQL omits
`organisation_id` and uses UUID PKs — always remap additively onto existing
serial-PK, org-scoped tables.
