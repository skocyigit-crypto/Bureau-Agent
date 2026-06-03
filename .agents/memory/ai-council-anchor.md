---
name: AI agent council latency & anchor pattern
description: Why the "Conseil IA / Yapay Zeka Ekibi" agents are slow and the anchor+grace design that fixes it
---

# AI agent council — Gemini anchor, never block on slow providers

The multi-agent "council" (`runAgentReasoning` in `ai-agents.ts`) consults Gemini +
OpenAI + Anthropic per agent.

**Operational reality (not visible in code):** via the Replit AI proxy, OpenAI
(gpt-5.2) and Anthropic (claude-sonnet-4-6) reliably **time out at ~45s** on
realistic agent-sized prompts (big JSON business data). Tiny probe prompts return
in ~1s, so creds/connectivity are fine — the models are just slow on real load.
Gemini **Pro** with a thinking budget is also slow (~35-45s). Only Gemini **Flash**
returns a full structured report in a usable time.

**Design that works (chosen by the owner: "fast & reliable, always autonomous"):**
- Gemini is the **anchor**, and the anchor uses **Flash**, not Pro
  (`AGENT_GEMINI_MODEL` env, default `GEMINI_FLASH_MODEL`; small
  `AGENT_THINKING_BUDGET`, default 512). This alone cut latency ~44s→~26s.
- All 3 launch in parallel on a shared local `AbortController`. Await the anchor;
  if it succeeds, give a **short grace window** (`AI_COUNCIL_GRACE_MS`, default
  2000ms) for the others to enrich, then **abort stragglers** in `finally`. If the
  anchor fails, wait for the others as a safety net.
- Synthesis must use the **external** signal, not the local one — the local signal
  is already aborted in `finally` before synthesis runs.
- Council previously **swallowed provider errors silently**; they are now logged
  (but voluntary aborts are not logged as errors).

**Why:** the secondaries almost never beat the grace window, so a long grace is
pure wasted latency + quota; the anchor (Flash) is the real floor (~24s for a full
analytical report). Don't reintroduce Pro for agents or a long all-providers
`Promise.allSettled` — that brings back ~45s waits and total failures when Gemini
also hiccups.

**Autonomy gap (still open):** the per-org auto-run (every 2h) lives in an in-memory
`autoRunState` Map in `ai-agents.ts` — it does **not** survive a server restart.
"Always autonomous" is not truly durable until that marker is persisted in DB and
restored on boot (same lesson as cron-cadence-durability).
