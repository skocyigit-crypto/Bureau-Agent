import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Phone, Mail, Calendar, CheckSquare, DollarSign, Bot, Sparkles, Bell, Users } from "lucide-react";
import { useLowPowerMode } from "@/hooks/use-low-power";

// Animated 3D-feel hero scene: orbiting cards, drifting particles, animated
// gradient mesh, ECG waveform. Pure CSS + SVG + framer-motion (no WebGL deps).
// Respects prefers-reduced-motion automatically (motion library handles it).

const ORBIT_CARDS = [
  { icon: Phone, label: "Appel entrant", sub: "Jean Dupont", color: "from-emerald-400 to-emerald-600", delay: 0 },
  { icon: Calendar, label: "RDV 14h30", sub: "Iota Group", color: "from-blue-400 to-blue-600", delay: 0.6 },
  { icon: Bot, label: "IA suggere", sub: "Devis Beta SAS", color: "from-amber-400 to-amber-600", delay: 1.2 },
  { icon: CheckSquare, label: "Tache OK", sub: "Rappel envoye", color: "from-violet-400 to-violet-600", delay: 1.8 },
  { icon: Mail, label: "Email recu", sub: "Marie Lambert", color: "from-pink-400 to-pink-600", delay: 2.4 },
  { icon: DollarSign, label: "Facture +850 EUR", sub: "Acme Corp", color: "from-cyan-400 to-cyan-600", delay: 3.0 },
  { icon: Bell, label: "Rappel 17h", sub: "Marie Lambert", color: "from-orange-400 to-orange-600", delay: 3.6 },
  { icon: Users, label: "+1 prospect", sub: "Beta SAS", color: "from-teal-400 to-teal-600", delay: 4.2 },
  { icon: Sparkles, label: "Anomalie", sub: "Facture J+12", color: "from-red-400 to-red-600", delay: 4.8 },
  { icon: Phone, label: "Appel sortant", sub: "Thomas Girard", color: "from-indigo-400 to-indigo-600", delay: 5.4 },
];

function Particles({ count = 30 }: { count?: number }) {
  const [items] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: 1 + Math.random() * 2.5,
      duration: 8 + Math.random() * 12,
      delay: Math.random() * -10,
      drift: -20 + Math.random() * 40,
    }))
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full bg-white"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            opacity: 0.35,
            animation: `particle-float ${p.duration}s linear infinite`,
            animationDelay: `${p.delay}s`,
            // @ts-expect-error CSS custom property
            "--drift": `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

function GradientMesh() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full blur-[120px] opacity-50"
        style={{
          background: "radial-gradient(circle, rgba(245,158,11,0.6) 0%, rgba(245,158,11,0) 70%)",
          animation: "mesh-drift-1 18s ease-in-out infinite",
        }}
      />
      <div
        className="absolute top-1/3 -right-40 w-[600px] h-[600px] rounded-full blur-[120px] opacity-50"
        style={{
          background: "radial-gradient(circle, rgba(59,130,246,0.55) 0%, rgba(59,130,246,0) 70%)",
          animation: "mesh-drift-2 22s ease-in-out infinite",
        }}
      />
      <div
        className="absolute -bottom-40 left-1/3 w-[500px] h-[500px] rounded-full blur-[100px] opacity-40"
        style={{
          background: "radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(168,85,247,0) 70%)",
          animation: "mesh-drift-3 25s ease-in-out infinite",
        }}
      />
    </div>
  );
}

function EcgLine() {
  return (
    <svg
      className="pointer-events-none absolute left-0 right-0 top-1/2 h-24 w-full opacity-30"
      viewBox="0 0 1200 100"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="ecg-grad" x1="0" x2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
          <stop offset="50%" stopColor="#f59e0b" stopOpacity="1" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 50 L150 50 L170 50 L185 20 L200 80 L215 50 L350 50 L370 50 L385 30 L400 70 L415 50 L600 50 L620 50 L635 25 L650 75 L665 50 L850 50 L870 50 L885 35 L900 65 L915 50 L1200 50"
        fill="none"
        stroke="url(#ecg-grad)"
        strokeWidth="2"
        style={{
          strokeDasharray: "2400",
          strokeDashoffset: "2400",
          animation: "ecg-draw 6s linear infinite",
        }}
      />
    </svg>
  );
}

function OrbitingCard({
  card,
  angle,
  radius,
}: {
  card: (typeof ORBIT_CARDS)[number];
  angle: number;
  radius: number;
}) {
  const Icon = card.icon;
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad) * radius;
  const y = Math.sin(rad) * radius * 0.45; // flatten orbit for 3D feel
  return (
    <motion.div
      className="absolute"
      style={{
        left: "50%",
        top: "50%",
        transform: `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0)`,
      }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.05, 1, 0.5], y: [0, -12, 4, 12] }}
      transition={{
        duration: 6,
        repeat: Infinity,
        delay: card.delay,
        times: [0, 0.18, 0.82, 1],
        ease: "easeInOut",
      }}
    >
      <div
        className={`relative bg-gradient-to-br ${card.color} text-white px-3 py-2 rounded-xl shadow-2xl backdrop-blur-md border border-white/20 flex items-center gap-2 min-w-[150px]`}
        style={{ transform: "perspective(600px) rotateY(-8deg) rotateX(4deg)" }}
      >
        <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold leading-tight truncate">{card.label}</div>
          <div className="text-[10px] text-white/80 truncate">{card.sub}</div>
        </div>
        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white animate-ping" />
      </div>
    </motion.div>
  );
}

export function HeroLiveScene() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const lowPower = useLowPowerMode();

  useEffect(() => {
    // Skip the mouse-tilt listener entirely in low-power mode (also typically
    // touch devices, where there's no pointer to follow).
    if (lowPower) return;
    const handler = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (e.clientX - cx) / r.width;
      const dy = (e.clientY - cy) / r.height;
      setTilt({ x: dx * 18, y: dy * 18 });
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [lowPower]);

  // Low-power / mobile / reduced-motion: a clean static backdrop — a single
  // soft gradient wash plus the central AI badge. No particles, orbiting cards,
  // ECG waveform, shooting stars, or continuous CSS animations.
  if (lowPower) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full blur-[120px] opacity-40"
            style={{ background: "radial-gradient(circle, rgba(245,158,11,0.5) 0%, rgba(245,158,11,0) 70%)" }}
          />
          <div
            className="absolute top-1/3 -right-40 w-[600px] h-[600px] rounded-full blur-[120px] opacity-40"
            style={{ background: "radial-gradient(circle, rgba(59,130,246,0.45) 0%, rgba(59,130,246,0) 70%)" }}
          />
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-[0_0_60px_-5px_rgba(245,158,11,0.7)]">
            <Sparkles className="w-10 h-10 text-white drop-shadow-md" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden pointer-events-none">
      <GradientMesh />
      <Particles count={36} />
      <EcgLine />

      {/* Orbit ring (perspective) */}
      <div
        className="absolute inset-0 hidden lg:block"
        style={{
          transform: `perspective(1200px) rotateX(${20 + tilt.y}deg) rotateY(${tilt.x}deg)`,
          transition: "transform 250ms ease-out",
        }}
      >
        {/* faint orbit ellipse */}
        <svg className="absolute inset-0 w-full h-full opacity-20" viewBox="0 0 1200 600" preserveAspectRatio="none">
          <ellipse cx="600" cy="300" rx="520" ry="220" fill="none" stroke="rgba(245,158,11,0.6)" strokeWidth="1" strokeDasharray="6 8" />
          <ellipse cx="600" cy="300" rx="380" ry="160" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="4 6" />
        </svg>

        {/* rotating orbit container — outer ring */}
        <div
          className="absolute inset-0"
          style={{ animation: "orbit-rotate 22s linear infinite", transformOrigin: "center" }}
        >
          {ORBIT_CARDS.map((card, i) => (
            <OrbitingCard key={i} card={card} angle={(360 / ORBIT_CARDS.length) * i} radius={460} />
          ))}
        </div>
        {/* inner counter-rotating ring with offset cards */}
        <div
          className="absolute inset-0"
          style={{ animation: "orbit-rotate-rev 30s linear infinite", transformOrigin: "center" }}
        >
          {ORBIT_CARDS.slice(0, 5).map((card, i) => (
            <OrbitingCard
              key={`inner-${i}`}
              card={card}
              angle={(360 / 5) * i + 36}
              radius={290}
            />
          ))}
        </div>
        {/* shooting star streaks */}
        <span className="absolute left-0 top-[20%] w-32 h-0.5 bg-gradient-to-r from-amber-300 to-transparent" style={{ animation: "shooting-star 5s linear infinite" }} />
        <span className="absolute left-0 top-[65%] w-24 h-0.5 bg-gradient-to-r from-blue-300 to-transparent" style={{ animation: "shooting-star 7s linear infinite", animationDelay: "2.5s" }} />
        <span className="absolute left-0 top-[40%] w-40 h-0.5 bg-gradient-to-r from-pink-300 to-transparent" style={{ animation: "shooting-star 9s linear infinite", animationDelay: "5s" }} />

        {/* Center glow + AI badge */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-amber-400/30 blur-2xl animate-pulse" />
            <div
              className="relative w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-[0_0_60px_-5px_rgba(245,158,11,0.7)]"
              style={{ animation: "core-pulse 3s ease-in-out infinite" }}
            >
              <Sparkles className="w-10 h-10 text-white drop-shadow-md" />
            </div>
            <div className="absolute -inset-3 rounded-full border border-amber-400/40 animate-ping" />
          </div>
        </div>
      </div>

      {/* mobile: simpler floating chips */}
      <div className="lg:hidden absolute inset-0">
        {ORBIT_CARDS.slice(0, 3).map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={i}
              className={`absolute bg-gradient-to-br ${card.color} text-white px-2.5 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 text-[10px] font-bold border border-white/20`}
              style={{
                top: `${20 + i * 25}%`,
                left: i % 2 === 0 ? "5%" : "auto",
                right: i % 2 === 1 ? "5%" : "auto",
              }}
              animate={{ y: [0, -6, 0], opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 3 + i, repeat: Infinity, ease: "easeInOut" }}
            >
              <Icon className="w-3 h-3" />
              {card.label}
            </motion.div>
          );
        })}
      </div>

      {/* Local CSS animations */}
      <style>{`
        @keyframes particle-float {
          0% { transform: translate(0, 0); opacity: 0; }
          15% { opacity: 0.5; }
          85% { opacity: 0.5; }
          100% { transform: translate(var(--drift, 0px), -120px); opacity: 0; }
        }
        @keyframes mesh-drift-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(80px, 40px) scale(1.15); }
        }
        @keyframes mesh-drift-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-60px, -50px) scale(1.2); }
        }
        @keyframes mesh-drift-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, -70px) scale(1.1); }
        }
        @keyframes ecg-draw {
          0% { stroke-dashoffset: 2400; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes orbit-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes orbit-rotate-rev {
          0% { transform: rotate(360deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes shooting-star {
          0% { transform: translate3d(-10%, 0, 0) rotate(15deg); opacity: 0; }
          10% { opacity: 0.9; }
          70% { opacity: 0.9; }
          100% { transform: translate3d(120vw, 0, 0) rotate(15deg); opacity: 0; }
        }
        @keyframes core-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 60px -5px rgba(245,158,11,0.7); }
          50% { transform: scale(1.08); box-shadow: 0 0 90px -5px rgba(245,158,11,0.9); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pointer-events-none [style*="animation"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

// Continuous "live activity" ticker — appears as a section between hero and
// dashboard, showing a never-stopping stream of fake live events.
export function LiveActivityTicker() {
  const events = [
    { icon: Phone, text: "Nouvel appel entrant — Jean Dupont (VIP)", color: "text-emerald-400" },
    { icon: CheckSquare, text: "Tache terminee : Rappel envoye a Marie Lambert", color: "text-blue-400" },
    { icon: DollarSign, text: "Devis #4521 envoye — 12 800 EUR", color: "text-amber-400" },
    { icon: Calendar, text: "RDV planifie : Iota Group, vendredi 14h", color: "text-violet-400" },
    { icon: Bot, text: "IA a redige 3 emails de relance", color: "text-pink-400" },
    { icon: Mail, text: "Email recu : Acme Corp — Confirmation contrat", color: "text-cyan-400" },
    { icon: Bell, text: "Rappel : Reunion equipe dans 15 min", color: "text-orange-400" },
    { icon: Users, text: "Nouveau prospect ajoute : Beta SAS", color: "text-emerald-400" },
    { icon: DollarSign, text: "Facture payee : 3 200 EUR — Gamma SA", color: "text-amber-400" },
    { icon: Sparkles, text: "Anomalie detectee : 2 factures en retard", color: "text-red-400" },
  ];
  // duplicate list so the marquee loop seamless
  const items = [...events, ...events];
  const reverseItems = [...events.slice().reverse(), ...events.slice().reverse()];

  const Row = ({ data, anim }: { data: typeof items; anim: string }) => (
    <div className="flex gap-8 whitespace-nowrap" style={{ animation: anim }}>
      {data.map((e, i) => {
        const Icon = e.icon;
        return (
          <div key={i} className="flex items-center gap-2 text-sm text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${e.color.replace("text-", "bg-")} animate-pulse`} />
              <Icon className={`w-4 h-4 ${e.color}`} />
            </span>
            <span>{e.text}</span>
            <span className="text-white/20 ml-2">•</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative bg-slate-950 border-y border-white/5 overflow-hidden py-2 space-y-2">
      <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-slate-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />
      <Row data={items} anim="ticker-scroll 22s linear infinite" />
      <Row data={reverseItems} anim="ticker-scroll-rev 28s linear infinite" />
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes ticker-scroll-rev {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="ticker-scroll"] { animation-duration: 180s !important; }
        }
      `}</style>
    </div>
  );
}

// Soft glow that follows the mouse — adds a "premium / alive" cursor feel.
// Pure CSS, no extra deps. Fades out on inactivity.
export function CursorGlow() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMove = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setPos(null), 1500);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!pos) return null;
  return (
    <div
      className="pointer-events-none fixed z-[9999] hidden lg:block"
      style={{
        left: pos.x,
        top: pos.y,
        width: 380,
        height: 380,
        transform: "translate(-50%, -50%)",
        background: "radial-gradient(circle, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.05) 35%, transparent 70%)",
        mixBlendMode: "screen",
        transition: "opacity 200ms ease",
      }}
    />
  );
}
