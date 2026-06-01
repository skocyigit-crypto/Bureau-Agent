import * as Speech from "expo-speech";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { VISEME_SHAPES, textToVisemes, type VisemeKey } from "@/lib/visemes";

export interface AvatarPalette {
  skin: string;
  skinShadow: string;
  hair: string;
  lips: string;
  mouthInner: string;
  ring: string;
}

const DEFAULT_PALETTE: AvatarPalette = {
  skin: "#f5cfb0",
  skinShadow: "#e3b394",
  hair: "#2b2b38",
  lips: "#c46a6a",
  mouthInner: "#5a2330",
  ring: "#f59e0b",
};

export interface TalkingAvatarHandle {
  speak: (text?: string) => void;
  stop: () => void;
}

export interface TalkingAvatarProps {
  /** Text the avatar should speak. Spoken automatically when it changes (if autoPlay). */
  text?: string;
  /** Spoken language. */
  lang?: "fr" | "tr";
  /** Pixel size of the square avatar. */
  size?: number;
  /** Speak automatically whenever `text` changes. Default true. */
  autoPlay?: boolean;
  /** When true, no audio plays (mouth stays at rest). Default false. */
  muted?: boolean;
  palette?: Partial<AvatarPalette>;
}

const CX = 100;
const CY_MOUTH = 138;
const MAX_HALF_W = 30;
const MAX_OPEN = 26;
const FRAME_MS = 33; // ~30fps render throttle
const VISEME_STEP_MS = 85; // cadence at which the spoken viseme advances

function mouthPath(w: number, h: number): string {
  const halfW = MAX_HALF_W * w;
  const open = MAX_OPEN * h;
  const upper = open * 0.45;
  const lower = open * 0.7;
  return (
    `M ${CX - halfW} ${CY_MOUTH} ` +
    `Q ${CX} ${CY_MOUTH - upper} ${CX + halfW} ${CY_MOUTH} ` +
    `Q ${CX} ${CY_MOUTH + lower} ${CX - halfW} ${CY_MOUTH} Z`
  );
}

interface RenderState {
  d: string;
  innerOpacity: number;
  teethX: number;
  teethW: number;
  teethOpacity: number;
  breatheY: number;
  ringOpacity: number;
}

const REST_PATH = mouthPath(0.52, 0.05);

/**
 * Friendly stylized assistant face with viseme-driven lip-sync, rendered with
 * react-native-svg and spoken via expo-speech. Audio never leaves the device.
 */
export const TalkingAvatar = forwardRef<TalkingAvatarHandle, TalkingAvatarProps>(
  function TalkingAvatar(
    { text, lang = "fr", size = 220, autoPlay = true, muted = false, palette },
    ref,
  ) {
    const p = { ...DEFAULT_PALETTE, ...palette };

    const [speaking, setSpeaking] = useState(false);
    const [blink, setBlink] = useState(false);
    const [render, setRender] = useState<RenderState>({
      d: REST_PATH,
      innerOpacity: 0,
      teethX: CX - MAX_HALF_W * 0.52 * 0.7,
      teethW: 2 * MAX_HALF_W * 0.52 * 0.7,
      teethOpacity: 0,
      breatheY: 0,
      ringOpacity: 0,
    });

    // eased mouth params + animation timing refs
    const cur = useRef({ w: 0.52, h: 0.05 });
    const target = useRef(VISEME_SHAPES.rest);
    const speakingRef = useRef(false);
    const visemesRef = useRef<VisemeKey[]>([]);
    const visemeIdxRef = useRef(0);
    const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const stop = useCallback(() => {
      try {
        Speech.stop();
      } catch {
        /* ignore */
      }
      if (stepTimer.current) {
        clearInterval(stepTimer.current);
        stepTimer.current = null;
      }
      speakingRef.current = false;
      target.current = VISEME_SHAPES.rest;
      setSpeaking(false);
    }, []);

    const speak = useCallback(
      (override?: string) => {
        const toSay = (override ?? text ?? "").trim();
        if (!toSay || muted) return;

        // reset any in-flight speech
        if (stepTimer.current) {
          clearInterval(stepTimer.current);
          stepTimer.current = null;
        }
        try {
          Speech.stop();
        } catch {
          /* ignore */
        }

        visemesRef.current = textToVisemes(toSay);
        visemeIdxRef.current = 0;
        speakingRef.current = true;
        setSpeaking(true);

        // advance the visual mouth shape on a steady cadence
        stepTimer.current = setInterval(() => {
          const list = visemesRef.current;
          if (visemeIdxRef.current >= list.length) {
            target.current = VISEME_SHAPES.rest;
            return;
          }
          target.current = VISEME_SHAPES[list[visemeIdxRef.current]];
          visemeIdxRef.current += 1;
        }, VISEME_STEP_MS);

        const finish = () => stop();
        try {
          Speech.speak(toSay, {
            language: lang === "tr" ? "tr-TR" : "fr-FR",
            rate: 1.0,
            pitch: 1.0,
            onDone: finish,
            onStopped: finish,
            onError: finish,
          });
        } catch {
          finish();
        }
      },
      [text, lang, muted, stop],
    );

    useImperativeHandle(ref, () => ({ speak, stop }), [speak, stop]);

    // auto-play whenever the text changes
    useEffect(() => {
      if (autoPlay && text && text.trim() && !muted) {
        speak(text);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text]);

    // stop audio if muted while talking, and on unmount
    useEffect(() => {
      if (muted) stop();
    }, [muted, stop]);
    useEffect(() => () => stop(), [stop]);

    // single throttled animation loop: eases mouth + drives breathe/ring pulse
    useEffect(() => {
      let raf = 0;
      let last = 0;
      let t0 = Date.now();
      const tick = () => {
        const now = Date.now();
        if (now - last >= FRAME_MS) {
          last = now;
          const c = cur.current;
          const tg = target.current;
          c.w += (tg.w - c.w) * 0.35;
          c.h += (tg.h - c.h) * 0.45;

          const elapsed = (now - t0) / 1000;
          const breatheY = Math.sin(elapsed * (Math.PI * 2) / 4.2) * 1.1 + 1.1;
          const ringOpacity = speakingRef.current
            ? 0.4 + 0.25 * (Math.sin(elapsed * (Math.PI * 2) / 1.4) * 0.5 + 0.5)
            : 0;

          setRender({
            d: mouthPath(c.w, c.h),
            innerOpacity: Math.min(1, c.h * 1.8),
            teethX: CX - MAX_HALF_W * c.w * 0.7,
            teethW: 2 * MAX_HALF_W * c.w * 0.7,
            teethOpacity: c.h > 0.25 ? 0.9 : 0,
            breatheY,
            ringOpacity,
          });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, []);

    // blinking
    useEffect(() => {
      let to: ReturnType<typeof setTimeout>;
      let inner: ReturnType<typeof setTimeout>;
      const schedule = () => {
        const delay = 2600 + Math.random() * 3200;
        to = setTimeout(() => {
          setBlink(true);
          inner = setTimeout(() => {
            setBlink(false);
            schedule();
          }, 130);
        }, delay);
      };
      schedule();
      return () => {
        clearTimeout(to);
        clearTimeout(inner);
      };
    }, []);

    const uid = useRef(`av${Math.random().toString(36).slice(2, 8)}`).current;
    const lidScaleY = blink ? 1 : 0.04;

    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id={`${uid}-skin`} cx="50%" cy="42%" r="62%">
              <Stop offset="0%" stopColor={p.skin} />
              <Stop offset="100%" stopColor={p.skinShadow} />
            </RadialGradient>
            <LinearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#1e293b" />
              <Stop offset="100%" stopColor="#0f172a" />
            </LinearGradient>
          </Defs>

          <Circle cx="100" cy="100" r="96" fill={`url(#${uid}-bg)`} />
          {speaking && render.ringOpacity > 0 && (
            <Circle
              cx="100"
              cy="100"
              r="86"
              fill="none"
              stroke={p.ring}
              strokeWidth="3"
              opacity={render.ringOpacity}
            />
          )}

          <G translateY={render.breatheY}>
            {/* neck */}
            <Rect x="84" y="150" width="32" height="30" rx="12" fill={p.skinShadow} />
            {/* hair back */}
            <Ellipse cx="100" cy="92" rx="62" ry="64" fill={p.hair} />
            {/* face */}
            <Ellipse cx="100" cy="100" rx="52" ry="56" fill={`url(#${uid}-skin)`} />
            {/* ears */}
            <Circle cx="49" cy="104" r="9" fill={`url(#${uid}-skin)`} />
            <Circle cx="151" cy="104" r="9" fill={`url(#${uid}-skin)`} />
            {/* hair top */}
            <Path d="M 48 78 Q 100 30 152 78 Q 138 58 100 56 Q 62 58 48 78 Z" fill={p.hair} />
            <Path d="M 48 80 Q 60 70 74 72 L 70 86 Q 56 86 48 92 Z" fill={p.hair} />

            {/* eyebrows */}
            <Rect x="64" y={speaking ? 84.5 : 86} width="22" height="5" rx="2.5" fill={p.hair} />
            <Rect x="114" y={speaking ? 84.5 : 86} width="22" height="5" rx="2.5" fill={p.hair} />

            {/* eyes */}
            <Ellipse cx="76" cy="102" rx="11" ry="8.5" fill="#ffffff" />
            <Ellipse cx="124" cy="102" rx="11" ry="8.5" fill="#ffffff" />
            <Circle cx="78" cy="103" r="4.6" fill="#3b2f2a" />
            <Circle cx="126" cy="103" r="4.6" fill="#3b2f2a" />
            <Circle cx="79.6" cy="101.4" r="1.5" fill="#fff" />
            <Circle cx="127.6" cy="101.4" r="1.5" fill="#fff" />
            {/* eyelids (scaleY animates the blink) */}
            <Rect
              x="65"
              y="93.5"
              width="22"
              height="17"
              rx="8"
              fill={p.skin}
              origin="76, 102"
              scaleY={lidScaleY}
            />
            <Rect
              x="113"
              y="93.5"
              width="22"
              height="17"
              rx="8"
              fill={p.skin}
              origin="124, 102"
              scaleY={lidScaleY}
            />

            {/* nose */}
            <Path d="M 100 108 Q 95 122 100 124 Q 104 124 100 108 Z" fill={p.skinShadow} opacity={0.7} />

            {/* mouth */}
            <Path d={render.d} fill={p.mouthInner} opacity={render.innerOpacity} />
            <Rect
              x={render.teethX}
              y={CY_MOUTH - 9}
              width={render.teethW}
              height="6"
              rx="2"
              fill="#fff"
              opacity={render.teethOpacity}
            />
            <Path
              d={render.d}
              fill="none"
              stroke={p.lips}
              strokeWidth="3.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </G>
        </Svg>
      </View>
    );
  },
);
