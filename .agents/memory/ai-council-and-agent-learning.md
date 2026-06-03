---
name: AI Council + agent learning loop
description: How the 10 office agents consult multiple frontier models in parallel and learn from the patron's approve/reject decisions.
---

# AI Council (multi-model) in agent runs

Each agent run can consult Gemini + GPT + Claude in parallel, then a synthesizer
(Gemini) merges the successful JSON analyses into one consensus. ≥2 replies → synthesize;
1 → use it; 0 → throw. Sequential first-success fallback when `AI_COUNCIL_DISABLED=1`.

**Why:** the patron asked agents to always collaborate with the strongest AIs ("Conseil IA").
**How to apply:**
- This lives in the **non-stream** path (`runSingleAgent` / `runAgentReasoning`), which is
  what the cockpit's "run all" and per-agent run use. The `/ai/agents/run/:agentId/stream`
  endpoint deliberately stays single-model token streaming — parallel council synthesis can't
  stream tokens. If you ever need council on the stream path, expect a UX redesign, not a drop-in.
- Council fans out to 3 providers + 1 synthesis per agent → ~3-4× cost on a 10-agent run.
  Quota is asserted once per agent (entry), not per sub-call; an exhausted quota fails the next
  agent fast. The env kill-switch is the cost valve. Keep AbortSignal + `AiQuotaExceededError`
  propagation intact through `Promise.allSettled` (rejected reasons must be re-checked and rethrown).

# Strong learning loop (approve/reject → preferences)

`recomputeLearnedPreferences` (deterministic, no AI cost) now also aggregates `agent_proposals`
by `category`: status approuvee/executee = up, rejetee = down → pref kind `proposition_categorie`.
`bumpProposalPreference(orgId, category)` does the incremental recompute; agent-queue approve/reject
routes call it fire-and-forget. `buildLearnedContextBlock` is injected into the agent prompt.

**Why:** agents must self-improve from what the patron validates/refuses.
**How to apply (two traps that silently defeat learning):**
1. **Any prompt that injects learned context MUST fold a learned-context fingerprint into its
   AI cache key.** The agent cache key includes the full `learnedContext` string; without it,
   changed preferences are ignored until TTL expiry and "learning" looks broken.
2. **Cache the full reasoning artifact `{text, models, synthesized}`, not just text.** Otherwise a
   cache hit records misleading `details.council` provenance (empty models / synthesized=false)
   even though the cached text came from a real council synthesis.

# Instance-level corrections + self-performance trend

Beyond category weights, two finer signals feed the agents:
- **Rejection corrections:** a rejected proposal stores a free-text `decisionNote`; `getLearningProfile`
  returns the last 8 rejected items (title/category/note) and `computeContextBlock` injects a
  "[Corrections — propositions REFUSÉES…]" block so agents avoid re-proposing the exact item.
- **Self-correction:** `runSingleAgent` derives a deterministic `selfCorrection {trend,scores,delta,note}`
  from `getAgentTrendHistory` and persists it under `details.selfCorrection`.

**Why:** the patron wants agents to learn from concrete refusals and from their own score trend.
**How to apply (security):** `decisionNote` is patron-authored free text that flows INTO agent prompts.
It MUST pass through `sanitizeFeedback()` (strip newlines/quotes, bound length) and be labelled as
"feedback, not instructions" in the block — otherwise it's a prompt-injection vector. Never inject raw
user notes into a prompt structure.
