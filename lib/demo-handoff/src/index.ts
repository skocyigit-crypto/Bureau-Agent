// Cross-app demo handoff codec.
//
// The marketing site (tanitim) lets a visitor chat with a demo of the assistant.
// When they continue into the real app (buro-ajani), their last question is
// carried over so the assistant picks up naturally. The transcript travels two
// ways and BOTH ends must agree on the exact shape, or the handoff silently
// breaks on a refactor:
//   1. a base64 `?demo=` URL param (preferred, most precise), and
//   2. a short-lived localStorage fallback that survives a dropped param across
//      the sign-up / login redirect (same origin via path-based routing).
//
// This module is the single source of truth for that contract. Storage and the
// clock are injected so the logic is deterministic and unit-testable without a
// DOM.

export type Role = "user" | "assistant";
export type Msg = { role: Role; text: string; timestamp?: number };
/** Slim wire form: `r` = role initial ("u"/"a"), `t` = truncated text. */
export type SlimMsg = { r: string; t: string };

/** localStorage key shared by both apps for the durable fallback payload. */
export const HANDOFF_KEY = "ajan.demo.handoff";
/** How long a persisted transcript stays valid — long enough to sign up. */
export const HANDOFF_TTL_MS = 30 * 60 * 1000; // 30 min

const MAX_MESSAGES = 6;
const MAX_TEXT = 400;

/** Keep only the tail of the conversation, trimmed, in the compact wire form. */
export function slimHistory(history: Msg[]): SlimMsg[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_MESSAGES)
    .map((m) => ({ r: (m.role ?? "")[0] ?? "", t: String(m.text ?? "").slice(0, MAX_TEXT) }));
}

/** Encode a transcript for the `?demo=` URL param (UTF-8 safe base64). */
export function encodeHandoff(history: Msg[]): string {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(slimHistory(history)))));
  } catch {
    return "";
  }
}

/** Decode a `?demo=` URL param value back to slim messages, or null if bad. */
export function decodeHandoffParam(raw: string | null | undefined): SlimMsg[] | null {
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(raw))));
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed as SlimMsg[];
  } catch {
    return null;
  }
}

/**
 * Persist a transcript to the durable fallback. Caller injects storage and the
 * current time so this stays side-effect-free for tests. No-op if storage is
 * unavailable.
 */
export function persistHandoff(
  history: Msg[],
  storage: Pick<Storage, "setItem"> | null | undefined,
  now: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify({ ts: now, msgs: slimHistory(history) }));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * Read and CONSUME the durable fallback: returns the slim messages only when the
 * payload is fresh (within the TTL), and ALWAYS removes the key afterward so a
 * stale demo never leaks into a later, unrelated session. Returns null when
 * absent, malformed, or expired.
 */
export function consumeHandoff(
  storage: Pick<Storage, "getItem" | "removeItem"> | null | undefined,
  now: number,
): SlimMsg[] | null {
  if (!storage) return null;
  let result: SlimMsg[] | null = null;
  try {
    const stored = storage.getItem(HANDOFF_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { ts?: number; msgs?: SlimMsg[] };
      const fresh = typeof parsed.ts === "number" && now - parsed.ts < HANDOFF_TTL_MS;
      if (fresh && Array.isArray(parsed.msgs)) result = parsed.msgs;
    }
  } catch {
    result = null;
  }
  try {
    storage.removeItem(HANDOFF_KEY);
  } catch {
    /* ignore */
  }
  return result;
}

/** Last non-empty user prompt from a slim transcript, trimmed, or null. */
export function lastUserPrompt(slim: SlimMsg[] | null | undefined): string | null {
  if (!Array.isArray(slim) || slim.length === 0) return null;
  const last = [...slim].reverse().find(
    (s) => s?.r === "u" && typeof s.t === "string" && s.t.trim(),
  );
  return last ? String(last.t).slice(0, MAX_TEXT) : null;
}
