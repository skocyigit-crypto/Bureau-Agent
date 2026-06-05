import { useEffect, useRef, useState } from "react";
import { type VisemeKey, VISEME_SHAPES } from "./visemes";

export type AvatarEmotion = "auto" | "neutral" | "happy" | "thinking" | "listening";

export interface AvatarPalette {
  skin: string;
  skinShadow: string;
  hair: string;
  lips: string;
  mouthInner: string;
  ring: string;
  // Extras added by the richer renderer — optional so existing callers that
  // typed a palette before these existed keep compiling (defaults fill them in).
  hairHi?: string;
  tongue?: string;
  cheek?: string;
  bg1?: string;
  bg2?: string;
  headset?: string;
}

export const DEFAULT_PALETTE: Required<AvatarPalette> = {
  skin: "#f7d3b5",
  skinShadow: "#dca888",
  hair: "#33303f",
  hairHi: "#4c4860",
  lips: "#c8697a",
  mouthInner: "#54222f",
  tongue: "#d97a86",
  ring: "#f59e0b",
  cheek: "#f0a78d",
  bg1: "#243049",
  bg2: "#0b1220",
  headset: "#cbd5e1",
};

export interface AvatarFaceProps {
  viseme: VisemeKey;
  speaking: boolean;
  size?: number;
  palette?: Partial<AvatarPalette>;
  className?: string;
  /** Facial expression. "auto" = happy while speaking, neutral otherwise. */
  emotion?: AvatarEmotion;
  /** Eyes follow the cursor (with idle saccades). Default true. */
  gaze?: boolean;
}

const CX = 100;
const CY_MOUTH = 140;
const MAX_HALF_W = 30;
const MAX_OPEN = 27;

/** Mouth outline. `corner` lifts the lip corners (smile); `open` opens the jaw. */
function mouthPath(w: number, h: number, corner: number): string {
  const halfW = MAX_HALF_W * w;
  const open = MAX_OPEN * h;
  const ly = CY_MOUTH - corner;
  const upper = open * 0.5;
  const lower = open * 0.72;
  return (
    `M ${CX - halfW} ${ly} ` +
    `Q ${CX} ${CY_MOUTH - upper} ${CX + halfW} ${ly} ` +
    `Q ${CX} ${CY_MOUTH + lower} ${CX - halfW} ${ly} Z`
  );
}

interface EmoParams {
  brow: number; // vertical offset (negative = raised)
  browTilt: number; // inner-brow tilt (deg) for concern/thought
  corner: number; // mouth-corner lift
  squint: number; // lower-lid raise (0..1)
}

const EMOTIONS: Record<Exclude<AvatarEmotion, "auto">, EmoParams> = {
  neutral: { brow: 0, browTilt: 0, corner: 1.5, squint: 0 },
  happy: { brow: -1.6, browTilt: 0, corner: 5.5, squint: 0.22 },
  thinking: { brow: -2.2, browTilt: 7, corner: 0.4, squint: 0 },
  listening: { brow: -2.8, browTilt: 0, corner: 2.6, squint: 0.05 },
};

/** Friendly stylized assistant face with viseme lip-sync, gaze, head motion and
 * emotion. Pure SVG — no canvas, no remote assets. */
export function AvatarFace({
  viseme,
  speaking,
  size = 220,
  palette,
  className,
  emotion = "auto",
  gaze = true,
}: AvatarFaceProps) {
  const p = { ...DEFAULT_PALETTE, ...palette };
  // Core extras render at every size (the in-app avatars are 44–56px); only the
  // fiddly mic boom is reserved for larger renders so it never turns to mush.
  const showMic = size >= 72;

  const resolved: Exclude<AvatarEmotion, "auto"> =
    emotion === "auto" ? (speaking ? "happy" : "neutral") : emotion;
  const emo = EMOTIONS[resolved];

  const svgRef = useRef<SVGSVGElement | null>(null);
  const lipRef = useRef<SVGPathElement | null>(null);
  const innerRef = useRef<SVGPathElement | null>(null);
  const teethRef = useRef<SVGRectElement | null>(null);
  const tongueRef = useRef<SVGEllipseElement | null>(null);
  const headRef = useRef<SVGGElement | null>(null);
  const pupilsRef = useRef<SVGGElement | null>(null);
  const ringARef = useRef<SVGCircleElement | null>(null);
  const ringBRef = useRef<SVGCircleElement | null>(null);

  // eased mouth params + corner lift
  const cur = useRef({ w: 0.52, h: 0.05, round: 0.25, corner: 1.5 });
  const target = useRef<{ w: number; h: number; round: number }>(VISEME_SHAPES.rest);
  const cornerTarget = useRef(emo.corner);

  useEffect(() => {
    target.current = VISEME_SHAPES[viseme];
  }, [viseme]);
  useEffect(() => {
    cornerTarget.current = emo.corner;
  }, [emo.corner]);

  // gaze tracking
  const gazeTarget = useRef({ x: 0, y: 0 });
  const gazeCur = useRef({ x: 0, y: 0 });
  const lastMove = useRef(0);

  useEffect(() => {
    if (!gaze || typeof window === "undefined") return;
    const onMove = (e: MouseEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
      gazeTarget.current = {
        x: Math.max(-1, Math.min(1, dx)),
        y: Math.max(-1, Math.min(1, dy)),
      };
      lastMove.current = Date.now();
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [gaze]);

  // idle saccades when the cursor is still (only while gaze is enabled)
  useEffect(() => {
    if (!gaze) return;
    const id = setInterval(() => {
      if (Date.now() - lastMove.current > 2200) {
        gazeTarget.current = {
          x: (Math.random() * 2 - 1) * 0.5,
          y: (Math.random() * 2 - 1) * 0.35,
        };
      }
    }, 1500);
    return () => clearInterval(id);
  }, [gaze]);

  // single animation loop: mouth + gaze + head + ring
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = performance.now() / 1000;

      // mouth easing
      const c = cur.current;
      const tg = target.current;
      c.w += (tg.w - c.w) * 0.35;
      c.h += (tg.h - c.h) * 0.45;
      c.round += (tg.round - c.round) * 0.35;
      c.corner += (cornerTarget.current - c.corner) * 0.12;
      const path = mouthPath(c.w, c.h, c.corner);
      if (lipRef.current) lipRef.current.setAttribute("d", path);
      if (innerRef.current) {
        innerRef.current.setAttribute("d", path);
        innerRef.current.setAttribute("opacity", String(Math.min(1, c.h * 1.9)));
      }
      if (teethRef.current) {
        teethRef.current.setAttribute("opacity", String(c.h > 0.22 ? 0.92 : 0));
        teethRef.current.setAttribute("width", String(2 * MAX_HALF_W * c.w * 0.66));
        teethRef.current.setAttribute("x", String(CX - MAX_HALF_W * c.w * 0.66));
      }
      if (tongueRef.current) {
        const show = c.h > 0.4 ? Math.min(0.85, (c.h - 0.4) * 2.2) : 0;
        tongueRef.current.setAttribute("opacity", String(show));
        tongueRef.current.setAttribute("cy", String(CY_MOUTH + MAX_OPEN * c.h * 0.46));
      }

      // gaze easing — when gaze is disabled the target collapses to centre, so
      // pupils recentre and then stay static (no cursor track, no saccades).
      const g = gazeCur.current;
      const gt = gaze ? gazeTarget.current : { x: 0, y: 0 };
      g.x += (gt.x - g.x) * 0.08;
      g.y += (gt.y - g.y) * 0.08;
      if (pupilsRef.current) {
        pupilsRef.current.setAttribute(
          "transform",
          `translate(${(g.x * 3).toFixed(2)} ${(g.y * 2.4).toFixed(2)})`,
        );
      }

      // head parallax + idle sway + speaking nod
      if (headRef.current) {
        const nod = speaking ? Math.sin(t * 5.2) * 0.9 : 0;
        const swayX = Math.sin(t * 0.9) * 0.6;
        const swayY = Math.sin(t * 0.7) * 0.5;
        const hx = g.x * 3 + swayX;
        const hy = g.y * 2 + swayY + nod;
        const rot = g.x * 2.4 + Math.sin(t * 0.8) * 0.5 + (speaking ? Math.sin(t * 5.2) * 0.5 : 0);
        headRef.current.setAttribute(
          "transform",
          `translate(${hx.toFixed(2)} ${hy.toFixed(2)}) rotate(${rot.toFixed(2)} 100 116)`,
        );
      }

      // audio-reactive rings (driven by mouth openness while speaking)
      const energy = speaking ? 0.35 + Math.min(1, c.h * 1.6) * 0.65 : 0;
      if (ringARef.current) {
        const s = 1 + energy * 0.06 + Math.sin(t * 3.1) * 0.012;
        ringARef.current.setAttribute("transform", `translate(100 100) scale(${s.toFixed(3)}) translate(-100 -100)`);
        ringARef.current.setAttribute("opacity", String(0.15 + energy * 0.5));
      }
      if (ringBRef.current) {
        const s = 1 + energy * 0.12 + Math.sin(t * 2.2 + 1) * 0.02;
        ringBRef.current.setAttribute("transform", `translate(100 100) scale(${s.toFixed(3)}) translate(-100 -100)`);
        ringBRef.current.setAttribute("opacity", String(0.06 + energy * 0.32));
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking, gaze]);

  // blinking (occasional double-blink)
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const doBlink = (then: () => void) => {
      setBlink(true);
      timers.push(setTimeout(() => {
        setBlink(false);
        then();
      }, 120));
    };
    const schedule = () => {
      const delay = 2600 + Math.random() * 3400;
      timers.push(setTimeout(() => {
        doBlink(() => {
          if (Math.random() < 0.25) {
            timers.push(setTimeout(() => doBlink(schedule), 160));
          } else {
            schedule();
          }
        });
      }, delay));
    };
    schedule();
    return () => timers.forEach(clearTimeout);
  }, []);

  const uid = useRef(`av${Math.random().toString(36).slice(2, 8)}`).current;

  const lidShut = "scaleY(1)";
  const lidOpen = "scaleY(0.04)";
  // lower-lid squint for warm/happy expressions
  const lowerLid = emo.squint;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="Assistant"
    >
      <defs>
        <radialGradient id={`${uid}-skin`} cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor={p.skin} />
          <stop offset="78%" stopColor={p.skin} />
          <stop offset="100%" stopColor={p.skinShadow} />
        </radialGradient>
        <radialGradient id={`${uid}-bg`} cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor={p.bg1} />
          <stop offset="100%" stopColor={p.bg2} />
        </radialGradient>
        <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.hairHi} />
          <stop offset="100%" stopColor={p.hair} />
        </linearGradient>
        <radialGradient id={`${uid}-cheek`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={p.cheek} stopOpacity="0.55" />
          <stop offset="100%" stopColor={p.cheek} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.ring} />
          <stop offset="100%" stopColor={p.ring} stopOpacity="0.4" />
        </linearGradient>
        <style>{`
          @keyframes ${uid}-breathe { 0%,100%{transform:translateY(0)} 50%{transform:translateY(2px)} }
          .${uid}-breathe { transform-origin:100px 110px; animation:${uid}-breathe 4.4s ease-in-out infinite; }
          .${uid}-lid { transform-box:fill-box; transform-origin:center; transition:transform .09s ease; }
        `}</style>
      </defs>

      {/* backdrop */}
      <circle cx="100" cy="100" r="98" fill={`url(#${uid}-bg)`} />
      <ellipse cx="100" cy="70" rx="78" ry="60" fill="#ffffff" opacity="0.05" />

      {/* audio-reactive aura rings */}
      <circle ref={ringBRef} cx="100" cy="100" r="92" fill="none" stroke={`url(#${uid}-ring)`} strokeWidth="2" opacity="0" />
      <circle ref={ringARef} cx="100" cy="100" r="84" fill="none" stroke={p.ring} strokeWidth="3" opacity="0.18" />

      <g className={`${uid}-breathe`}>
        <g ref={headRef}>
          {/* shoulders / collar hint */}
          <path d="M 52 196 Q 100 158 148 196 Z" fill={p.skinShadow} opacity="0.85" />
          <path d="M 64 196 Q 100 168 136 196 Z" fill="#1f2937" opacity="0.5" />
          {/* neck */}
          <rect x="86" y="150" width="28" height="26" rx="11" fill={p.skinShadow} />

          {/* hair back */}
          <ellipse cx="100" cy="92" rx="63" ry="65" fill={`url(#${uid}-hair)`} />

          {/* face */}
          <ellipse cx="100" cy="102" rx="53" ry="57" fill={`url(#${uid}-skin)`} />
          {/* soft jaw shadow */}
          <path d="M 54 116 Q 100 168 146 116 Q 132 150 100 152 Q 68 150 54 116 Z" fill={p.skinShadow} opacity="0.25" />

          {/* ears */}
          <circle cx="48" cy="106" r="9" fill={`url(#${uid}-skin)`} />
          <circle cx="152" cy="106" r="9" fill={`url(#${uid}-skin)`} />

          {/* hair top + fringe */}
          <path d="M 46 80 Q 100 26 154 80 Q 140 54 100 52 Q 60 54 46 80 Z" fill={`url(#${uid}-hair)`} />
          <path d="M 46 82 Q 60 70 76 73 L 71 90 Q 56 89 47 96 Z" fill={`url(#${uid}-hair)`} />
          <path d="M 154 82 Q 140 70 124 73 L 129 90 Q 144 89 153 96 Z" fill={`url(#${uid}-hair)`} />
          <path d="M 60 60 Q 100 44 140 60" fill="none" stroke={p.hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.5" />

          {/* cheeks */}
          <ellipse cx="70" cy="122" rx="12" ry="8" fill={`url(#${uid}-cheek)`} />
          <ellipse cx="130" cy="122" rx="12" ry="8" fill={`url(#${uid}-cheek)`} />

          {/* eyebrows (emotion-driven) */}
          <g style={{ transform: `translateY(${emo.brow + (speaking ? -0.6 : 0)}px)`, transition: "transform .2s" }}>
            <rect
              x="62" y="88" width="24" height="5" rx="2.5" fill={p.hair}
              style={{ transformBox: "fill-box", transformOrigin: "center", transform: `rotate(${emo.browTilt}deg)` }}
            />
            <rect
              x="114" y="88" width="24" height="5" rx="2.5" fill={p.hair}
              style={{ transformBox: "fill-box", transformOrigin: "center", transform: `rotate(${-emo.browTilt}deg)` }}
            />
          </g>

          {/* eyes */}
          <g>
            <ellipse cx="75" cy="104" rx="11.5" ry="9" fill="#ffffff" />
            <ellipse cx="125" cy="104" rx="11.5" ry="9" fill="#ffffff" />
            {/* iris + pupil + catchlight (move with gaze) */}
            <g ref={pupilsRef}>
              <circle cx="75" cy="105" r="5.4" fill="#6b4a36" />
              <circle cx="125" cy="105" r="5.4" fill="#6b4a36" />
              <circle cx="75" cy="105" r="2.7" fill="#241a14" />
              <circle cx="125" cy="105" r="2.7" fill="#241a14" />
              <circle cx="76.8" cy="103" r="1.7" fill="#fff" />
              <circle cx="126.8" cy="103" r="1.7" fill="#fff" />
            </g>
            {/* upper lashes */}
            <path d="M 63 100 Q 75 95 87 100" fill="none" stroke={p.hair} strokeWidth="2.2" strokeLinecap="round" />
            <path d="M 113 100 Q 125 95 137 100" fill="none" stroke={p.hair} strokeWidth="2.2" strokeLinecap="round" />
            {/* lower-lid squint for warm expressions */}
            <rect x="64.5" y="109" width="21" height="6" rx="3" fill={p.skin} style={{ transformBox: "fill-box", transformOrigin: "bottom", transform: `scaleY(${lowerLid})`, transition: "transform .2s" }} />
            <rect x="114.5" y="109" width="21" height="6" rx="3" fill={p.skin} style={{ transformBox: "fill-box", transformOrigin: "bottom", transform: `scaleY(${lowerLid})`, transition: "transform .2s" }} />
            {/* blinking lids */}
            <rect className={`${uid}-lid`} x="63.5" y="95" width="23" height="18" rx="8" fill={p.skin} style={{ transform: blink ? lidShut : lidOpen }} />
            <rect className={`${uid}-lid`} x="113.5" y="95" width="23" height="18" rx="8" fill={p.skin} style={{ transform: blink ? lidShut : lidOpen }} />
          </g>

          {/* nose */}
          <path d="M 100 110 Q 94 126 100 129 Q 105 129 100 110 Z" fill={p.skinShadow} opacity="0.7" />
          <ellipse cx="100" cy="128" rx="4.5" ry="2.2" fill={p.skinShadow} opacity="0.4" />

          {/* mouth: inner cavity, tongue, teeth, lips */}
          <path ref={innerRef} d={mouthPath(0.52, 0.05, emo.corner)} fill={p.mouthInner} opacity="0" />
          <ellipse ref={tongueRef} cx={CX} cy={CY_MOUTH + 4} rx="14" ry="6" fill={p.tongue} opacity="0" />
          <rect ref={teethRef} x="80" y={CY_MOUTH - 10} width="40" height="6.5" rx="2.5" fill="#fff" opacity="0" />
          <path ref={lipRef} d={mouthPath(0.52, 0.05, emo.corner)} fill="none" stroke={p.lips} strokeWidth="3.6" strokeLinejoin="round" strokeLinecap="round" />

          {/* headset (office-agent cue) */}
          <g opacity="0.92">
            <path d="M 44 104 Q 44 50 100 50 Q 156 50 156 104" fill="none" stroke={p.headset} strokeWidth="4.5" strokeLinecap="round" />
            <rect x="40" y="100" width="11" height="20" rx="5" fill={p.headset} />
            <rect x="149" y="100" width="11" height="20" rx="5" fill={p.headset} />
            {/* mic boom — fiddly, only on larger renders */}
            {showMic && (
              <>
                <path d="M 51 118 Q 60 142 86 144" fill="none" stroke={p.headset} strokeWidth="3.2" strokeLinecap="round" />
                <circle cx="88" cy="144" r="3.4" fill={p.ring} />
              </>
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}
