---
name: Assistant write-tools confirmation gate
description: When adding new AI assistant tools that mutate state or produce stored artifacts, mirror the existing confirmation/error-handling guardrails.
---

Any new tool in `assistant-tools.ts` that performs a persistent write (DB rows, stored
documents, outbound email/SMS, generated media) MUST set `requiresConfirmation: true`,
just like `send_email`, `send_sms`, `generate_image`, and the document-creation tools
(`create_excel_document` / `create_word_document`).

**Why:** the assistant runs tools autonomously; un-gated write tools let it spam records,
storage, or messages without user approval — a real cost/abuse risk in a sold multi-tenant
product. Read-only lookup tools do NOT need confirmation.

**How to apply:**
- Pass-through `orgId`/`userId` from the tool `ctx` straight into the persistence call
  (e.g. `ingestDocument`) so tenant isolation is preserved.
- Wrap any builder/generator call in a local try/catch and return a structured
  `{ success: false, error }` instead of letting it bubble to the generic executeTool catch,
  so the model gets a usable error message.
- For string-only field validators, pass complex/nested input as a single JSON-string param
  (`dataJson`) and `JSON.parse` it inside `execute`.
