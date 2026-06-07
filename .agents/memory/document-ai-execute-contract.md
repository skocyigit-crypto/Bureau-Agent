---
name: Document-AI execute-action contract
description: Correct request shape for the document-ai analyze/execute/batch routes shared by all mobile/web capture screens.
---

# Document-AI execute-action contract

The `/api/document-ai/execute-action` and `/batch-execute` routes expect the
**full SuggestedAction object** plus the analyze result's `extractedFields`:

- single: `{ action: <full SuggestedAction>, extractedFields }`
- batch: `{ actions: <SuggestedAction[]>, extractedFields }`

The executor merges `{ ...extractedFields, ...action.data }`, so the screen MUST
forward `extractedFields` or fields like échéance/montant/contact never reach the
created task/facture.

**Why:** the legacy `mobile/app/document-ai.tsx` sends a flattened
`{ action: string, module, data }` instead — the route reads `req.body.action.action`,
gets `undefined`, and returns 400. That mobile "Exécuter" button is effectively
dead. New capture screens (e.g. `smart-capture.tsx` / Capture Intelligente) send
the correct shape.

**How to apply:** any new screen that triggers document-ai actions must send the
full action object + `extractedFields`. If `document-ai.tsx` is ever reused,
fix its payload first.

**Override precedence:** the executor merges `{ ...extractedFields, ...action.data }`,
so `action.data` WINS. A client that lets the user edit fields (montant/échéance/
contact) before approving MUST write the overrides into BOTH `extractedFields` AND
each `action.data` — writing only to `extractedFields` is silently overridden by any
value the AI already put in `action.data`. Only override fields the user actually
changed, or you force values (e.g. a contact link) the AI never proposed.

`creer_tache` now maps a due date (echeance/dateEcheance/dueDate) onto
`tasks.due_date` and links `relatedContactId` only after re-checking the contact
belongs to the caller's org (never trust an AI/client-supplied id).
