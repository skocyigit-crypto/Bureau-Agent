/**
 * Shared, platform-agnostic lip-sync core (React Native copy).
 *
 * No DOM, no React. Maps text (French + Turkish) to a sequence of "visemes"
 * (visual mouth shapes). Mirrors lib/ai-avatar/src/visemes.ts — the web lib is
 * DOM-only and cannot be imported into the Expo typecheck, so the pure core is
 * duplicated here. Speech audio never leaves the device; we only derive mouth
 * shapes from the text characters.
 */

export type VisemeKey =
  | "rest"
  | "A"
  | "E"
  | "I"
  | "O"
  | "U"
  | "M"
  | "F"
  | "S"
  | "L"
  | "R"
  | "W";

export interface MouthShape {
  /** mouth width factor (0..1) */
  w: number;
  /** mouth openness (0..1) */
  h: number;
  /** lip rounding (0 = spread, 1 = rounded) */
  round: number;
  /** upper-teeth visibility (0..1); optional, renderers may ignore */
  teeth?: number;
  /** tongue-tip visibility (0..1); optional, renderers may ignore */
  tongue?: number;
}

/** Target mouth geometry for each viseme. Tuned for a friendly, readable look. */
export const VISEME_SHAPES: Record<VisemeKey, MouthShape> = {
  rest: { w: 0.52, h: 0.05, round: 0.25, teeth: 0, tongue: 0 },
  A: { w: 0.58, h: 0.66, round: 0.32, teeth: 0.1, tongue: 0.35 },
  E: { w: 0.82, h: 0.3, round: 0.08, teeth: 0.28, tongue: 0.1 },
  I: { w: 0.8, h: 0.14, round: 0.04, teeth: 0.55, tongue: 0 },
  O: { w: 0.46, h: 0.52, round: 0.92, teeth: 0, tongue: 0.2 },
  U: { w: 0.32, h: 0.3, round: 1.0, teeth: 0, tongue: 0 },
  M: { w: 0.5, h: 0.02, round: 0.3, teeth: 0, tongue: 0 },
  F: { w: 0.6, h: 0.12, round: 0.08, teeth: 0.7, tongue: 0 },
  S: { w: 0.66, h: 0.1, round: 0.06, teeth: 0.85, tongue: 0 },
  L: { w: 0.58, h: 0.3, round: 0.12, teeth: 0.2, tongue: 0.9 },
  R: { w: 0.5, h: 0.26, round: 0.55, teeth: 0.1, tongue: 0.3 },
  W: { w: 0.3, h: 0.2, round: 1.0, teeth: 0, tongue: 0 },
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
    case "w":
      return "W";
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
      return "S";
    case "l":
      return "L";
    case "r":
      return "R";
    case "t":
    case "d":
    case "n":
      return "L";
    case "g":
    case "ğ":
    case "k":
    case "q":
    case "h":
      return "E";
    default:
      return null;
  }
}

const VOWELS = new Set<VisemeKey>(["A", "E", "I", "O", "U"]);

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
    if (VOWELS.has(v)) {
      lastVowelRun = out.length && out[out.length - 1] === v ? lastVowelRun + 1 : 0;
      if (lastVowelRun >= 2) continue;
    }
    out.push(v);
  }
  if (out.length === 0) out.push("rest");
  return out;
}

/** Pick the viseme that corresponds to a character index inside `text`. */
export function visemeAtCharIndex(text: string, charIndex: number): VisemeKey {
  const slice = text.slice(charIndex, charIndex + 4).toLowerCase();
  for (const ch of slice) {
    const v = charToViseme(ch);
    if (v) return v;
  }
  return "rest";
}

/** Relative duration weight of a character, used to pace the viseme stream. */
export function charWeight(ch: string): number {
  if (/\s/.test(ch)) return 0.7;
  const v = charToViseme(ch);
  if (v && VOWELS.has(v)) return 1.5;
  if (!v) return /[.,;:!?…]/.test(ch) ? 2.2 : 0.5;
  return 0.85;
}
