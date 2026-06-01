/**
 * Shared, platform-agnostic lip-sync core (React Native copy).
 *
 * No DOM, no React. Maps text (French + Turkish) to a sequence of "visemes"
 * (visual mouth shapes). Mirrors lib/ai-avatar/src/visemes.ts — the web lib is
 * DOM-only and cannot be imported into the Expo typecheck, so the pure core is
 * duplicated here. Speech audio never leaves the device; we only derive mouth
 * shapes from the text characters.
 */

export type VisemeKey = "rest" | "A" | "E" | "I" | "O" | "U" | "M" | "F";

export interface MouthShape {
  /** mouth width factor (0..1) */
  w: number;
  /** mouth openness (0..1) */
  h: number;
  /** lip rounding (0 = spread, 1 = rounded) */
  round: number;
}

/** Target mouth geometry for each viseme. Tuned for a friendly, readable look. */
export const VISEME_SHAPES: Record<VisemeKey, MouthShape> = {
  rest: { w: 0.52, h: 0.05, round: 0.25 },
  A: { w: 0.58, h: 0.62, round: 0.35 },
  E: { w: 0.82, h: 0.3, round: 0.1 },
  I: { w: 0.78, h: 0.14, round: 0.05 },
  O: { w: 0.46, h: 0.5, round: 0.92 },
  U: { w: 0.34, h: 0.32, round: 1.0 },
  M: { w: 0.5, h: 0.02, round: 0.3 },
  F: { w: 0.62, h: 0.12, round: 0.1 },
};

/** Map a single (lowercased) character to a viseme. Covers FR + TR letters. */
export function charToViseme(ch: string): VisemeKey | null {
  switch (ch) {
    case "a":
    case "à":
    case "â":
    case "ä":
      return "A";
    case "e":
    case "é":
    case "è":
    case "ê":
    case "ë":
      return "E";
    case "i":
    case "î":
    case "ï":
    case "ı":
    case "y":
      return "I";
    case "o":
    case "ô":
    case "ö":
      return "O";
    case "u":
    case "ù":
    case "û":
    case "ü":
      return "U";
    case "m":
    case "b":
    case "p":
      return "M";
    case "f":
    case "v":
      return "F";
    case "s":
    case "z":
    case "c":
    case "ç":
    case "j":
    case "ş":
    case "x":
      return "I";
    case "r":
    case "l":
    case "n":
    case "d":
    case "t":
    case "g":
    case "ğ":
    case "k":
    case "q":
    case "h":
    case "w":
      return "E";
    default:
      return null;
  }
}

/**
 * Build an ordered list of visemes for a piece of text. Whitespace and
 * punctuation become brief "rest" gaps so the mouth closes between words.
 */
export function textToVisemes(text: string): VisemeKey[] {
  const out: VisemeKey[] = [];
  let lastVowelRun = 0;
  for (const raw of text.toLowerCase()) {
    if (/\s/.test(raw)) {
      out.push("rest");
      lastVowelRun = 0;
      continue;
    }
    const v = charToViseme(raw);
    if (!v) {
      out.push("rest");
      lastVowelRun = 0;
      continue;
    }
    const isVowel = v === "A" || v === "E" || v === "I" || v === "O" || v === "U";
    if (isVowel) {
      lastVowelRun = out.length && out[out.length - 1] === v ? lastVowelRun + 1 : 0;
      if (lastVowelRun >= 2) continue;
    }
    out.push(v);
  }
  if (out.length === 0) out.push("rest");
  return out;
}
