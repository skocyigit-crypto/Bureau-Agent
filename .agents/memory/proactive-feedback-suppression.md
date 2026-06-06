---
name: Proactive feedback suppression
description: How 👍/👎 votes close the loop into the DETERMINISTIC proactive engine, not just AI prompts.
---

# Votes must reach BOTH the AI prompts and the deterministic proactive feed

Vote feedback (👍/👎) on suggestions aggregates into `ai_learned_preferences`
(`kind="suggestion_type"`). There are two independent consumption paths and both
must stay wired, or the owner perceives votes as doing nothing:

1. **AI-written content** — `buildLearnedContextBlock` injected at every AI call
   site; generation caches include the learned context in their key
   (`fingerprintLearned()` or full `learned` text). This path was already sound.
2. **Deterministic proactive engine** — the 8 detectors produce suggestions with
   NO AI. It must read learned prefs and SUPPRESS types the owner repeatedly
   downvoted, otherwise a disliked type keeps reappearing forever.

**Rule:** suppression only kicks in for a STRONG, repeated signal
(`score < -0.5` AND `downCount >= 3`) and **never** removes `severity === "urgent"`
candidates — a mildly-disliked type must not hide a real urgency (cash crunch,
tense call, security). The suppression set is org-scoped, 5-min cached, purged by
`invalidateContextCache`, and fail-soft (empty set on error).

**Why:** votes only influenced AI text; the deterministic feed ignored them, so
owners kept seeing suggestion types they had clearly rejected.

**How to apply:** suppression is applied in `runProactiveForOrg` BEFORE building
`candidateKeys`, so existing pending of a now-suppressed type fall into `stale`
and auto-resolve through the existing logic — no separate cleanup path. When
adding a new detector, remember its type becomes suppressible the same way; keep
genuinely safety-critical detectors at `urgent` severity so they survive.
