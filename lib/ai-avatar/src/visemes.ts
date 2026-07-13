/**
 * Shared, platform-agnostic lip-sync core.
 *
 * No DOM, no React. Maps text (French + Turkish) to a sequence of "visemes"
 * (visual mouth shapes). Used to drive both the web SVG avatar and any other
 * renderer. Speech audio never leaves the device — we only derive mouth shapes
 * from the text characters and from browser speech boundary events.
 *
 * The browser's on-device speech engine (Web Speech API) never exposes the
 * audio buffer, so true audio-frequency lip-sync is impossible while honoring
 * the "no data leaves the device" guarantee. Instead we model the *linguistics*:
 * a richer, phoneme-aware viseme set (sibilants, tongue, rounding) that the
 * scheduler plays back with real timing.
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
  /**
   * Upper-teeth visibility (0..1). Lets sibilants/labiodentals (s, z, f, v)
   * show teeth even when the mouth is nearly closed — not derivable from
   * openness alone. Optional: renderers without teeth ignore it.
   */
  teeth?: number;
  /**
   * Tongue-tip visibility (0..1) for dentals/laterals (l, t, d, n) and open
   * vowels. Optional: renderers without a tongue ignore it.
   */
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
  // labiodental: upper teeth rest on the lower lip
  F: { w: 0.6, h: 0.12, round: 0.08, teeth: 0.7, tongue: 0 },
  // sibilant: teeth nearly closed, narrow aperture
  S: { w: 0.66, h: 0.1, round: 0.06, teeth: 0.85, tongue: 0 },
  // lateral/dental: tongue tip raised, mid-open
  L: { w: 0.58, h: 0.3, round: 0.12, teeth: 0.2, tongue: 0.9 },
  // approximant r: slight rounding, mid-open
  R: { w: 0.5, h: 0.26, round: 0.55, teeth: 0.1, tongue: 0.3 },
  // glide w/ou: tight rounded
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
    // sibilants / fricatives -> teeth close
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
    // dentals / alveolars: tongue tip to the ridge
    case "t":
    case "d":
    case "n":
      return "L";
    // soft back consonants -> small open
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
      // punctuation / digits: tiny pause
      out.push("rest");
      lastVowelRun = 0;
      continue;
    }
    // avoid 3+ identical vowels in a row looking robotic
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

/**
 * Relative duration weight of a character, used by the scheduler to pace the
 * viseme stream realistically: vowels are held longer, stops are quick, spaces
 * close the mouth briefly and sentence punctuation is a real pause.
 */
export function charWeight(ch: string): number {
  if (/\s/.test(ch)) return 0.7;
  const v = charToViseme(ch);
  if (v && VOWELS.has(v)) return 1.5;
  if (!v) return /[.,;:!?…]/.test(ch) ? 2.2 : 0.5;
  return 0.85;
}
