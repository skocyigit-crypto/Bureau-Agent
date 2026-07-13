import { useCallback, useEffect, useRef, useState } from "react";
import { type VisemeKey, charToViseme, charWeight } from "./visemes";

export type SpeechLang = "fr" | "tr";
export type SpeechGender = "female" | "male";

export interface UseTextToSpeechOptions {
  lang?: SpeechLang;
  gender?: SpeechGender;
  rate?: number;
  pitch?: number;
  /**
   * Only speak with on-device ("local") voices, never cloud-backed ones, so no
   * text is sent to a remote synthesis server. Default true to honor the
   * "no data leaves device" guarantee. When no local voice exists for the
   * requested language, speech is skipped (fail closed) — see `hasVoiceForLang`.
   */
  requireLocal?: boolean;
}

export interface TextToSpeech {
  /** Browser supports the Web Speech synthesis API. */
  supported: boolean;
  /** Currently speaking. */
  speaking: boolean;
  /** Current mouth shape to render. */
  viseme: VisemeKey;
  /** Whether at least one voice for the requested language is installed. */
  hasVoiceForLang: boolean;
  speak: (text: string, lang?: SpeechLang) => void;
  cancel: () => void;
}

const FEMALE_HINTS = ["female", "femme", "amelie", "amélie", "audrey", "marie", "google français", "yelda", "filiz", "seda", "zira", "samantha"];
const MALE_HINTS = ["male", "homme", "thomas", "paul", "henri", "google türkçe", "tolga", "david"];

function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: SpeechLang,
  gender: SpeechGender,
  requireLocal: boolean,
): SpeechSynthesisVoice | null {
  let byLang = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  // Fail closed: when on-device synthesis is required, never consider
  // cloud-backed voices (localService === false) so no text leaves the device.
  if (requireLocal) byLang = byLang.filter((v) => v.localService);
  if (byLang.length === 0) return null;
  const hints = gender === "female" ? FEMALE_HINTS : MALE_HINTS;
  const matched = byLang.find((v) => {
    const n = v.name.toLowerCase();
    return hints.some((h) => n.includes(h));
  });
  return matched ?? byLang.find((v) => v.localService) ?? byLang[0];
}

interface Timeline {
  /** viseme per source character */
  vis: VisemeKey[];
  /** cumulative duration weight up to and including each character */
  cum: number[];
  /** total weight (cum at last char) */
  total: number;
}

function buildTimeline(text: string): Timeline {
  // Index by UTF-16 code units (not code points) so positions line up with
  // SpeechSynthesisEvent.charIndex, which is UTF-16 based. A lone surrogate
  // simply maps to "rest" with a tiny weight, which is harmless.
  const n = text.length;
  const vis: VisemeKey[] = new Array(n);
  const cum: number[] = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const lower = text[i].toLowerCase();
    vis[i] = /\s/.test(lower) ? "rest" : charToViseme(lower) ?? "rest";
    acc += charWeight(lower);
    cum[i] = acc;
  }
  return { vis, cum, total: acc || 1 };
}

/**
 * Text-to-speech using the browser's built-in speech engine (free, on-device,
 * no audio leaves the machine). Derives a live viseme stream for lip-sync.
 *
 * The Web Speech API never exposes the synthesized audio buffer, so we cannot
 * analyze real audio frequencies. Instead the playback is a linguistically
 * paced scheduler: each character carries a duration weight (vowels long, stops
 * short, punctuation = pause) and a requestAnimationFrame loop maps elapsed time
 * to a character position. `boundary` events (word/char anchors emitted by the
 * engine) re-anchor the cursor and adaptively *learn* the real speaking pace, so
 * the mouth stays in sync even as rate varies. When a voice emits no boundary
 * events, the loop still plays from the rate-based estimate (graceful fallback).
 */
export function useTextToSpeech(opts: UseTextToSpeechOptions = {}): TextToSpeech {
  const { gender = "female", rate = 1, pitch = 1, requireLocal = true } = opts;
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const [speaking, setSpeaking] = useState(false);
  const [viseme, setViseme] = useState<VisemeKey>("rest");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [lang, setLang] = useState<SpeechLang>(opts.lang ?? "fr");

  const rafRef = useRef<number | null>(null);
  const tlRef = useRef<Timeline | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  // playback anchor: at `time` (performance.now ms) we were at weight `weight`,
  // advancing at `mspw` ms per weight unit.
  const anchorRef = useRef({ weight: 0, time: 0, mspw: 60 });
  const cursorRef = useRef(0);
  const lastVisRef = useRef<VisemeKey>("rest");
  const boundarySeenRef = useRef(false);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const emit = useCallback((v: VisemeKey) => {
    if (v !== lastVisRef.current) {
      lastVisRef.current = v;
      setViseme(v);
    }
  }, []);

  const cancel = useCallback(() => {
    stopRaf();
    if (supported) window.speechSynthesis.cancel();
    utterRef.current = null;
    tlRef.current = null;
    setSpeaking(false);
    lastVisRef.current = "rest";
    setViseme("rest");
  }, [supported, stopRaf]);

  const speak = useCallback(
    (text: string, langOverride?: SpeechLang) => {
      if (!supported) return;
      const trimmed = (text || "").trim();
      if (!trimmed) return;
      const useLang = langOverride ?? lang;
      setLang(useLang);

      // Always cancel any in-flight utterance first.
      window.speechSynthesis.cancel();
      stopRaf();

      const u = new SpeechSynthesisUtterance(trimmed);
      u.lang = useLang === "fr" ? "fr-FR" : "tr-TR";
      u.rate = rate;
      u.pitch = pitch;
      const voice = pickVoice(window.speechSynthesis.getVoices(), useLang, gender, requireLocal);
      // Fail closed: if on-device synthesis is required but no local voice is
      // installed for this language, do not speak (text must not be sent to a
      // cloud TTS server). The mouth simply stays at rest.
      if (requireLocal && !voice) {
        emit("rest");
        return;
      }
      if (voice) u.voice = voice;
      utterRef.current = u;

      const tl = buildTimeline(trimmed);
      tlRef.current = tl;
      cursorRef.current = 0;
      boundarySeenRef.current = false;
      // Initial pace guess: ~60ms per weight unit, scaled by the speech rate.
      const baseMspw = 60 / Math.max(0.5, rate);
      anchorRef.current = { weight: 0, time: performance.now(), mspw: baseMspw };

      const tick = () => {
        const cur = tlRef.current;
        if (!cur) return;
        const now = performance.now();
        const a = anchorRef.current;
        const w = a.weight + (now - a.time) / a.mspw;

        // advance the cursor to the first char whose cumulative weight >= w
        let i = cursorRef.current;
        while (i < cur.cum.length - 1 && cur.cum[i] < w) i++;
        cursorRef.current = i;

        if (i >= cur.cum.length - 1 && w > cur.total) {
          // Ran past the end of the estimate. If the engine never emitted a
          // boundary we have no further anchor, so close the mouth; otherwise
          // hold the last shape until onend/next boundary corrects us.
          emit(boundarySeenRef.current ? cur.vis[i] : "rest");
        } else {
          emit(cur.vis[i] ?? "rest");
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      u.onstart = () => {
        // Ignore callbacks from a superseded utterance (rapid speak→speak).
        if (utterRef.current !== u) return;
        setSpeaking(true);
        anchorRef.current.time = performance.now();
        rafRef.current = requestAnimationFrame(tick);
      };

      u.onboundary = (e: SpeechSynthesisEvent) => {
        if (utterRef.current !== u) return;
        const cur = tlRef.current;
        if (!cur) return;
        const c = Math.min(cur.cum.length - 1, Math.max(0, e.charIndex ?? 0));
        const now = performance.now();
        const a = anchorRef.current;
        // weight at the START of the boundary char
        const newWeight = c > 0 ? cur.cum[c - 1] : 0;
        if (boundarySeenRef.current) {
          const dt = now - a.time;
          const dw = newWeight - a.weight;
          if (dw > 0.5 && dt > 20) {
            // learn the real pace, clamped to a sane band
            a.mspw = Math.min(120, Math.max(16, dt / dw));
          }
        }
        a.weight = newWeight;
        a.time = now;
        boundarySeenRef.current = true;
        cursorRef.current = Math.max(0, c - 1);
      };

      const finish = () => {
        // A late onend/onerror from a replaced utterance must not stop the new
        // playback or reset its viseme/speaking state.
        if (utterRef.current !== u) return;
        stopRaf();
        tlRef.current = null;
        setSpeaking(false);
        emit("rest");
        utterRef.current = null;
      };
      u.onend = finish;
      u.onerror = finish;

      window.speechSynthesis.speak(u);
    },
    [supported, lang, rate, pitch, gender, requireLocal, stopRaf, emit],
  );

  useEffect(() => () => cancel(), [cancel]);

  // Reflects whether speech will actually play: when on-device synthesis is
  // required, only a local voice for the language counts.
  const hasVoiceForLang = voices.some(
    (v) => v.lang?.toLowerCase().startsWith(lang) && (!requireLocal || v.localService),
  );

  return { supported, speaking, viseme, hasVoiceForLang, speak, cancel };
}
