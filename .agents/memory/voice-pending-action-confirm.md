---
name: Voice pending-action confirm mapping & open-task guard
description: Footguns when building HMAC pending-action voice flows (parse → signed token → confirm) that mutate tenant data.
---

# Voice pending-action confirm flow

Two-endpoint pattern (mirrors `voice-command.ts`): a parse endpoint extracts
actions, signs an HMAC token (TTL + replay-protected) and returns it; a confirm
endpoint verifies the token and applies the writes. Never apply writes inline.

## Confirm `accept` index mapping
The signed token must contain ONLY the applicable ("ready") actions, in order.
The frontend therefore numbers ready actions sequentially (0..n) — its `accept`
indices index into the *ready subset*, NOT the full resolved-action list that
also includes blocked/needs-info cards. If you ever put all actions in the token
or index over the full list on the client, confirm applies the wrong rows.
**How to apply:** keep token actions and client `accept` indices both keyed to
the filtered ready list; assign client indices while filtering, not by array
position in the full list.

## "Mark complete" must re-guard state at confirm time
A voice "tâche terminée" must only target OPEN tasks (`en_attente`/`en_cours`),
both when matching candidates in parse AND in the confirm UPDATE
(`status IN open` in the WHERE + check `.returning().length`).
**Why:** the task can be closed between parse and confirm; without the WHERE
guard you silently "re-close" or clobber an already-finished/cancelled task.

## Concurrency
Stock-deduction read-then-update runs in a tx with `SELECT … FOR UPDATE` to
avoid lost updates under concurrent confirms. Replay dedupe is in-memory per
process (same as voice-command) — fine for single-instance Replit; would need
shared storage if ever multi-instance.
