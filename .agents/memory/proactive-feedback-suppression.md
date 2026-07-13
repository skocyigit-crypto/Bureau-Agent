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

# Durable "re-enable" of an auto-suppressed type

Suppression is DERIVED from votes and rebuilt by the daily recompute
(`recomputeLearnedPreferences` re-aggregates raw feedback into
`ai_learned_preferences`). So resetting/deleting a pref row is NOT a durable
un-mute — next recompute re-derives the negative score and re-suppresses.

**Rule:** durable owner re-enable uses an explicit `suppression_overridden`
column (additive, default 0). `getSuppressedSuggestionTypes` requires
`suppression_overridden = 0`; `reactivateSuggestionType(org,type)` sets it to 1
and purges the suppress cache.

**Why it survives recompute:** `upsertPreference`'s `onConflictDoUpdate` set
clause touches ONLY `up/down/score/updatedAt` — it never overwrites the override
flag. Any NEW column on `ai_learned_preferences` that must persist across
recompute MUST stay out of that set clause (and out of the INSERT defaults path).

**How to apply:** the re-enable route is manager-only (super_admin|administrateur);
non-managers see the muted list but cannot mutate. Schema column reaches prod via
Publish only (never push to prod).
