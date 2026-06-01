import { useCallback, useEffect, useRef, useState } from "react";
import { type VisemeKey, textToVisemes, visemeAtCharIndex } from "./visemes";

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

/**
 * Text-to-speech using the browser's built-in speech engine (free, on-device,
 * no audio leaves the machine). Derives a live viseme stream for lip-sync from
 * boundary events, with a timer fallback for browsers without boundary support.
 */
export function useTextToSpeech(opts: UseTextToSpeechOptions = {}): TextToSpeech {
  const { gender = "female", rate = 1, pitch = 1, requireLocal = true } = opts;
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const [speaking, setSpeaking] = useState(false);
  const [viseme, setViseme] = useState<VisemeKey>("rest");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [lang, setLang] = useState<SpeechLang>(opts.lang ?? "fr");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqRef = useRef<VisemeKey[]>([]);
  const cursorRef = useRef(0);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    stopTimer();
    if (supported) window.speechSynthesis.cancel();
    utterRef.current = null;
    setSpeaking(false);
    setViseme("rest");
  }, [supported, stopTimer]);

  const speak = useCallback(
    (text: string, langOverride?: SpeechLang) => {
      if (!supported) return;
      const trimmed = (text || "").trim();
      if (!trimmed) return;
      const useLang = langOverride ?? lang;
      setLang(useLang);

      // Always cancel any in-flight utterance first.
      window.speechSynthesis.cancel();
      stopTimer();

      const u = new SpeechSynthesisUtterance(trimmed);
      u.lang = useLang === "fr" ? "fr-FR" : "tr-TR";
      u.rate = rate;
      u.pitch = pitch;
      const voice = pickVoice(window.speechSynthesis.getVoices(), useLang, gender, requireLocal);
      // Fail closed: if on-device synthesis is required but no local voice is
      // installed for this language, do not speak (text must not be sent to a
      // cloud TTS server). The mouth simply stays at rest.
      if (requireLocal && !voice) {
        setViseme("rest");
        return;
      }
      if (voice) u.voice = voice;
      utterRef.current = u;

      seqRef.current = textToVisemes(trimmed);
      cursorRef.current = 0;

      let lastBoundaryAt = 0;

      u.onstart = () => {
        setSpeaking(true);
        // Timer fallback / inter-boundary liveliness (~11 shapes per second).
        intervalRef.current = setInterval(() => {
          const sinceBoundary = Date.now() - lastBoundaryAt;
          if (sinceBoundary < 120 && lastBoundaryAt !== 0) return;
          const seq = seqRef.current;
          if (seq.length === 0) return;
          const next = seq[cursorRef.current % seq.length];
          cursorRef.current += 1;
          setViseme(next);
        }, 90);
      };

      u.onboundary = (e: SpeechSynthesisEvent) => {
        lastBoundaryAt = Date.now();
        setViseme(visemeAtCharIndex(trimmed, e.charIndex ?? 0));
      };

      const finish = () => {
        stopTimer();
        setSpeaking(false);
        setViseme("rest");
        utterRef.current = null;
      };
      u.onend = finish;
      u.onerror = finish;

      window.speechSynthesis.speak(u);
    },
    [supported, lang, rate, pitch, gender, stopTimer],
  );

  useEffect(() => () => cancel(), [cancel]);

  // Reflects whether speech will actually play: when on-device synthesis is
  // required, only a local voice for the language counts.
  const hasVoiceForLang = voices.some(
    (v) => v.lang?.toLowerCase().startsWith(lang) && (!requireLocal || v.localService),
  );

  return { supported, speaking, viseme, hasVoiceForLang, speak, cancel };
}
