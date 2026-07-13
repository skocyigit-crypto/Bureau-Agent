---
name: Assistant engine tool-loop (parallel + cache + self-correction)
description: How the Commandant IA assistant tool loop runs reads in parallel, caches within a turn, and nudges retries — and the invariants that must not break.
---

The assistant tool-calling loop lives in `assistant-engine.ts` (`runAssistantTurn`).
Within one model hop it can request several tool calls; the loop turns them into
`tool_call` rows, executes, and feeds `functionResponse` parts back.

## Invariants (do not break)
- **Confirmation gate bounds the hop.** The FIRST tool whose `requiresConfirmation`
  is true short-circuits: read-only tools BEFORE it execute, then `pending_action`
  is emitted and the loop returns. Reads AFTER a confirmation tool are NOT executed
  that hop (their `tool_call` rows persist; resume rebuilds from DB). This matches
  the original sequential semantics — keep it when refactoring.
  **Why:** the write gate is server-enforced, not prompt-only; never auto-run a
  confirmation tool.
- **Cache is turn-scoped and read-only.** `readResultCache` keyed by
  `toolName + stableStringify(args)` reuses identical reads within ONE turn only.
  Never cache write/confirmation tools (they're excluded by construction — only
  the pre-confirm read prefix is cached).
- **Self-correction is bounded.** On a read error OR empty result (`count === 0`),
  a one-shot `_conseil` hint is added to the `functionResponse`, tracked in
  `selfCorrectionHinted` (one hint per tool+args). Termination is guaranteed by
  `MAX_TOOL_HOPS`. The hint tells the model to retry once with adjusted args or
  say nothing was found — never invent data.
- **Streaming event contract is frozen.** Only `step`, `pending_action`, `text`,
  `done`, `error` events; persisted roles `tool_call` / `tool_result` /
  `tool_pending_resolved`. Extra payload fields (like `_conseil`) are fine; new
  event TYPES are not (frontend depends on these).

## How to apply
When adding tools or touching the loop: keep reads side-effect-free so parallel
`Promise.all` execution is safe; emptiness detection only fires for tools exposing
a numeric `count` field. Quota (`assertAiQuota`) and per-org isolation are upstream
and unchanged by the loop.
