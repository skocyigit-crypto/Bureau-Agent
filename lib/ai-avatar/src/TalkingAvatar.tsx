import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { AvatarFace, type AvatarFaceProps } from "./AvatarFace";
import { useTextToSpeech, type SpeechLang, type SpeechGender } from "./useTextToSpeech";

export interface TalkingAvatarHandle {
  speak: (text: string, lang?: SpeechLang) => void;
  stop: () => void;
  speaking: boolean;
}

export interface TalkingAvatarProps extends Pick<AvatarFaceProps, "size" | "palette" | "className"> {
  /** Text to speak. When it changes and autoPlay is true, it is spoken. */
  text?: string;
  lang?: SpeechLang;
  gender?: SpeechGender;
  rate?: number;
  pitch?: number;
  /** Speak automatically whenever `text` changes (default true). */
  autoPlay?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Self-contained talking avatar: animated SVG face + on-device speech (FR/TR).
 * No audio or text ever leaves the browser.
 */
export const TalkingAvatar = forwardRef<TalkingAvatarHandle, TalkingAvatarProps>(function TalkingAvatar(
  { text, lang = "fr", gender = "female", rate, pitch, autoPlay = true, onStart, onEnd, size, palette, className },
  ref,
) {
  const tts = useTextToSpeech({ lang, gender, rate, pitch });
  const lastSpoken = useRef<string | null>(null);
  const wasSpeaking = useRef(false);

  useImperativeHandle(ref, () => ({
    speak: (t: string, l?: SpeechLang) => tts.speak(t, l),
    stop: () => tts.cancel(),
    speaking: tts.speaking,
  }), [tts]);

  useEffect(() => {
    if (!autoPlay) return;
    const t = (text || "").trim();
    if (!t || t === lastSpoken.current) return;
    lastSpoken.current = t;
    tts.speak(t, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, autoPlay, lang]);

  useEffect(() => {
    if (tts.speaking && !wasSpeaking.current) onStart?.();
    if (!tts.speaking && wasSpeaking.current) onEnd?.();
    wasSpeaking.current = tts.speaking;
  }, [tts.speaking, onStart, onEnd]);

  return <AvatarFace viseme={tts.viseme} speaking={tts.speaking} size={size} palette={palette} className={className} />;
});
