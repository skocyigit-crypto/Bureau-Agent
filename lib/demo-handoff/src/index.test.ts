import { describe, it, expect } from "vitest";
import {
  HANDOFF_KEY,
  HANDOFF_TTL_MS,
  type Msg,
  slimHistory,
  encodeHandoff,
  decodeHandoffParam,
  persistHandoff,
  consumeHandoff,
  lastUserPrompt,
} from "./index";

// A tiny in-memory Storage so we can exercise the real persist/consume code the
// two apps run, without a DOM.
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const sampleHistory: Msg[] = [
  { role: "user", text: "Quels appels aujourd'hui ?" },
  { role: "assistant", text: "8 appels, 2 manqués." },
  { role: "user", text: "Mes tâches urgentes ?" },
  { role: "assistant", text: "3 tâches urgentes." },
];

describe("slimHistory — compaction", () => {
  it("keeps only the last 6 messages", () => {
    const long: Msg[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `m${i}`,
    }));
    const slim = slimHistory(long);
    expect(slim).toHaveLength(6);
    expect(slim[0].t).toBe("m4");
    expect(slim[5].t).toBe("m9");
  });

  it("maps role to its initial and truncates text to 400 chars", () => {
    const slim = slimHistory([{ role: "assistant", text: "x".repeat(500) }]);
    expect(slim[0].r).toBe("a");
    expect(slim[0].t).toHaveLength(400);
  });

  it("tolerates a non-array input", () => {
    // @ts-expect-error — defensive against malformed callers
    expect(slimHistory(null)).toEqual([]);
  });
});

describe("URL-param round-trip (tanitim → buro-ajani)", () => {
  it("decodes exactly what was encoded, including accents", () => {
    const decoded = decodeHandoffParam(encodeHandoff(sampleHistory));
    expect(decoded).toEqual(slimHistory(sampleHistory));
  });

  it("returns null for a malformed param", () => {
    expect(decodeHandoffParam("%%%not-base64%%%")).toBeNull();
    expect(decodeHandoffParam("")).toBeNull();
    expect(decodeHandoffParam(null)).toBeNull();
  });
});

describe("localStorage fallback round-trip + TTL (the cross-app handoff)", () => {
  it("a transcript written by tanitim is consumed and cleared by buro-ajani", () => {
    const store = memoryStorage();
    const t0 = 1_000_000;

    // tanitim persists on click
    persistHandoff(sampleHistory, store, t0);
    expect(store.map.has(HANDOFF_KEY)).toBe(true);

    // buro-ajani consumes shortly after (well within TTL)
    const consumed = consumeHandoff(store, t0 + 60_000);
    expect(consumed).toEqual(slimHistory(sampleHistory));

    // ...and the key is gone so it never leaks into a later session
    expect(store.map.has(HANDOFF_KEY)).toBe(false);
  });

  it("ignores a stale (>30 min) payload but still clears it", () => {
    const store = memoryStorage();
    const t0 = 1_000_000;
    persistHandoff(sampleHistory, store, t0);

    const consumed = consumeHandoff(store, t0 + HANDOFF_TTL_MS + 1);
    expect(consumed).toBeNull();
    expect(store.map.has(HANDOFF_KEY)).toBe(false);
  });

  it("accepts a payload exactly at the TTL boundary minus 1ms", () => {
    const store = memoryStorage();
    const t0 = 5_000;
    persistHandoff(sampleHistory, store, t0);
    expect(consumeHandoff(store, t0 + HANDOFF_TTL_MS - 1)).not.toBeNull();
  });

  it("returns null and clears when the stored payload is malformed JSON", () => {
    const store = memoryStorage({ [HANDOFF_KEY]: "{not json" });
    expect(consumeHandoff(store, Date.now())).toBeNull();
    expect(store.map.has(HANDOFF_KEY)).toBe(false);
  });

  it("returns null when nothing was stored", () => {
    const store = memoryStorage();
    expect(consumeHandoff(store, Date.now())).toBeNull();
  });

  it("no-ops gracefully without storage", () => {
    expect(() => persistHandoff(sampleHistory, null, 0)).not.toThrow();
    expect(consumeHandoff(null, 0)).toBeNull();
  });
});

describe("lastUserPrompt — what pre-fills the in-app chat input", () => {
  it("returns the most recent non-empty user message", () => {
    const slim = slimHistory(sampleHistory);
    expect(lastUserPrompt(slim)).toBe("Mes tâches urgentes ?");
  });

  it("skips empty/whitespace user messages and assistant turns", () => {
    const slim = slimHistory([
      { role: "user", text: "Bonjour" },
      { role: "user", text: "   " },
      { role: "assistant", text: "Réponse" },
    ]);
    expect(lastUserPrompt(slim)).toBe("Bonjour");
  });

  it("returns null when there is no user message", () => {
    expect(lastUserPrompt([{ r: "a", t: "only assistant" }])).toBeNull();
    expect(lastUserPrompt([])).toBeNull();
    expect(lastUserPrompt(null)).toBeNull();
  });
});
