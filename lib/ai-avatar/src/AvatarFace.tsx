import { useEffect, useRef, useState } from "react";
import { type VisemeKey, VISEME_SHAPES } from "./visemes";

export interface AvatarPalette {
  skin: string;
  skinShadow: string;
  hair: string;
  lips: string;
  mouthInner: string;
  ring: string;
}

export const DEFAULT_PALETTE: AvatarPalette = {
  skin: "#f5cfb0",
  skinShadow: "#e3b394",
  hair: "#2b2b38",
  lips: "#c46a6a",
  mouthInner: "#5a2330",
  ring: "#f59e0b",
};

export interface AvatarFaceProps {
  viseme: VisemeKey;
  speaking: boolean;
  size?: number;
  palette?: Partial<AvatarPalette>;
  className?: string;
}

const CX = 100;
const CY_MOUTH = 138;
const MAX_HALF_W = 30;
const MAX_OPEN = 26;

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

/** Friendly stylized assistant face with viseme-driven lip-sync. Pure SVG. */
export function AvatarFace({ viseme, speaking, size = 220, palette, className }: AvatarFaceProps) {
  const p = { ...DEFAULT_PALETTE, ...palette };

  const lipRef = useRef<SVGPathElement | null>(null);
  const innerRef = useRef<SVGPathElement | null>(null);
  const teethRef = useRef<SVGRectElement | null>(null);

  // eased mouth params
  const cur = useRef({ w: 0.52, h: 0.05, round: 0.25 });
  const target = useRef(VISEME_SHAPES.rest);

  useEffect(() => {
    target.current = VISEME_SHAPES[viseme];
  }, [viseme]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const c = cur.current;
      const t = target.current;
      c.w += (t.w - c.w) * 0.35;
      c.h += (t.h - c.h) * 0.45;
      c.round += (t.round - c.round) * 0.35;
      const path = mouthPath(c.w, c.h);
      if (lipRef.current) lipRef.current.setAttribute("d", path);
      if (innerRef.current) {
        innerRef.current.setAttribute("d", path);
        innerRef.current.setAttribute("opacity", String(Math.min(1, c.h * 1.8)));
      }
      if (teethRef.current) {
        const show = c.h > 0.25 ? 0.9 : 0;
        teethRef.current.setAttribute("opacity", String(show));
        teethRef.current.setAttribute("width", String(2 * MAX_HALF_W * c.w * 0.7));
        teethRef.current.setAttribute("x", String(CX - MAX_HALF_W * c.w * 0.7));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // blinking
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let outer: ReturnType<typeof setTimeout>;
    let inner: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = 2600 + Math.random() * 3200;
      outer = setTimeout(() => {
        setBlink(true);
        inner = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 130);
      }, delay);
    };
    schedule();
    // Clear BOTH timers so no nested callback fires (and re-schedules / sets
    // state) after the component unmounts.
    return () => {
      clearTimeout(outer);
      clearTimeout(inner);
    };
  }, []);

  const uid = useRef(`av${Math.random().toString(36).slice(2, 8)}`).current;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="Assistant"
    >
      <defs>
        <radialGradient id={`${uid}-skin`} cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor={p.skin} />
          <stop offset="100%" stopColor={p.skinShadow} />
        </radialGradient>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <style>{`
          @keyframes ${uid}-breathe { 0%,100%{transform:translateY(0)} 50%{transform:translateY(2.2px)} }
          @keyframes ${uid}-pulse { 0%,100%{opacity:.25;transform:scale(1)} 50%{opacity:.6;transform:scale(1.04)} }
          .${uid}-head { transform-origin:100px 110px; animation:${uid}-breathe 4.2s ease-in-out infinite; }
          .${uid}-ring { transform-origin:100px 100px; animation:${uid}-pulse 1.4s ease-in-out infinite; }
          .${uid}-lid { transform-box:fill-box; transform-origin:center; transition:transform .09s ease; }
        `}</style>
      </defs>

      <circle cx="100" cy="100" r="96" fill={`url(#${uid}-bg)`} />
      {speaking && (
        <circle className={`${uid}-ring`} cx="100" cy="100" r="86" fill="none" stroke={p.ring} strokeWidth="3" />
      )}

      <g className={`${uid}-head`}>
        {/* neck + shoulders hint */}
        <rect x="84" y="150" width="32" height="30" rx="12" fill={p.skinShadow} />
        {/* hair back */}
        <ellipse cx="100" cy="92" rx="62" ry="64" fill={p.hair} />
        {/* face */}
        <ellipse cx="100" cy="100" rx="52" ry="56" fill={`url(#${uid}-skin)`} />
        {/* ears */}
        <circle cx="49" cy="104" r="9" fill={`url(#${uid}-skin)`} />
        <circle cx="151" cy="104" r="9" fill={`url(#${uid}-skin)`} />
        {/* hair top */}
        <path d="M 48 78 Q 100 30 152 78 Q 138 58 100 56 Q 62 58 48 78 Z" fill={p.hair} />
        <path d="M 48 80 Q 60 70 74 72 L 70 86 Q 56 86 48 92 Z" fill={p.hair} />

        {/* eyebrows */}
        <g style={{ transform: speaking ? "translateY(-1.5px)" : "none", transition: "transform .2s" }}>
          <rect x="64" y="86" width="22" height="5" rx="2.5" fill={p.hair} />
          <rect x="114" y="86" width="22" height="5" rx="2.5" fill={p.hair} />
        </g>

        {/* eyes */}
        <g>
          <ellipse cx="76" cy="102" rx="11" ry="8.5" fill="#ffffff" />
          <ellipse cx="124" cy="102" rx="11" ry="8.5" fill="#ffffff" />
          <circle cx="78" cy="103" r="4.6" fill="#3b2f2a" />
          <circle cx="126" cy="103" r="4.6" fill="#3b2f2a" />
          <circle cx="79.6" cy="101.4" r="1.5" fill="#fff" />
          <circle cx="127.6" cy="101.4" r="1.5" fill="#fff" />
          {/* eyelids */}
          <rect
            className={`${uid}-lid`}
            x="65" y="93.5" width="22" height="17" rx="8"
            fill={p.skin}
            style={{ transform: blink ? "scaleY(1)" : "scaleY(0.04)" }}
          />
          <rect
            className={`${uid}-lid`}
            x="113" y="93.5" width="22" height="17" rx="8"
            fill={p.skin}
            style={{ transform: blink ? "scaleY(1)" : "scaleY(0.04)" }}
          />
        </g>

        {/* nose */}
        <path d="M 100 108 Q 95 122 100 124 Q 104 124 100 108 Z" fill={p.skinShadow} opacity="0.7" />

        {/* mouth */}
        <path ref={innerRef} d={mouthPath(0.52, 0.05)} fill={p.mouthInner} opacity="0" />
        <rect ref={teethRef} x="79" y={CY_MOUTH - 9} width="42" height="6" rx="2" fill="#fff" opacity="0" />
        <path ref={lipRef} d={mouthPath(0.52, 0.05)} fill="none" stroke={p.lips} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
      </g>
    </svg>
  );
}
