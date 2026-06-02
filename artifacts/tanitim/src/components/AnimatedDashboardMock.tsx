import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, Mail, CheckSquare, DollarSign, TrendingUp, Bot, Sparkles, Bell, Calendar, Users, Shield, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

// 3D-feel animated dashboard mockup. Replaces the static hero dashboard image
// with a continuously animated live preview: counters tick, cards slide in,
// notifications pulse, mini-chart pulses. CSS 3D perspective + framer-motion.

type Activity = { id: number; icon: any; text: string; color: string; time: string };

const ACTIVITY_POOL: Omit<Activity, "id" | "time">[] = [
  { icon: Phone, text: "Appel de Jean Dupont", color: "emerald" },
  { icon: Mail, text: "Email Acme Corp", color: "blue" },
  { icon: CheckSquare, text: "Tache terminee", color: "violet" },
  { icon: DollarSign, text: "Devis #4521 envoye", color: "amber" },
  { icon: Calendar, text: "RDV Beta SAS confirme", color: "pink" },
  { icon: Bot, text: "IA suggere 3 actions", color: "amber" },
  { icon: Bell, text: "Rappel reunion 14h", color: "orange" },
  { icon: Users, text: "Nouveau prospect", color: "cyan" },
];

const COLOR_MAP: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  blue: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pink: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  orange: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

function Counter({ end, suffix = "", duration = 1500 }: { end: number; suffix?: string; duration?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setV(Math.round(end * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [end, duration]);
  return (
    <span>
      {v.toLocaleString("fr-FR")}
      {suffix}
    </span>
  );
}

function Sparkbar() {
  const [heights, setHeights] = useState<number[]>(() =>
    Array.from({ length: 16 }, () => 30 + Math.floor(Math.random() * 70))
  );
  useEffect(() => {
    const id = setInterval(() => {
      setHeights((prev) => {
        const next = prev.slice(1);
        next.push(20 + Math.floor(Math.random() * 80));
        return next;
      });
    }, 600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-end gap-1 h-12">
      {heights.map((h, i) => (
        <motion.div
          key={i}
          className="w-1.5 rounded-t bg-gradient-to-t from-amber-500 to-amber-300"
          animate={{ height: `${h}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

export function AnimatedDashboardMock() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [callsCount, setCallsCount] = useState(47);
  const [revenue, setRevenue] = useState(38400);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // Continuously add new activities to feel alive
  useEffect(() => {
    let id = 0;
    const interval = setInterval(() => {
      const pick = ACTIVITY_POOL[Math.floor(Math.random() * ACTIVITY_POOL.length)];
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      setActivities((prev) => [{ ...pick, id: id++, time }, ...prev].slice(0, 6));
      // counter bumps every tick now (more lively)
      setCallsCount((c) => c + 1);
      if (Math.random() > 0.3) setRevenue((r) => r + Math.floor(80 + Math.random() * 1200));
    }, 1300);
    return () => clearInterval(interval);
  }, []);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width / 2) / r.width;
    const dy = (e.clientY - r.top - r.height / 2) / r.height;
    setTilt({ x: dx * 6, y: -dy * 6 });
  };

  const handleLeave = () => setTilt({ x: 0, y: 0 });

  return (
    <div
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className="relative max-w-5xl mx-auto"
      style={{ perspective: "1500px" }}
    >
      {/* Glow halo */}
      <div className="absolute -inset-8 bg-gradient-to-tr from-amber-500/20 via-transparent to-blue-500/20 blur-3xl pointer-events-none" />

      <div
        className="relative bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 rounded-2xl md:rounded-[2rem] border border-white/10 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.5)] overflow-hidden"
        style={{
          transform: `rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
          transformStyle: "preserve-3d",
          transition: "transform 200ms ease-out",
        }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-slate-950/50">
          <span className="w-3 h-3 rounded-full bg-red-500" />
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="w-3 h-3 rounded-full bg-emerald-500" />
          <div className="ml-4 flex-1 bg-white/5 rounded-md px-3 py-1 text-xs text-white/40">app.agentdebureau.fr</div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            En direct
          </div>
        </div>

        <div className="grid grid-cols-12 gap-3 md:gap-4 p-4 md:p-6">
          {/* Sidebar mini */}
          <div className="hidden md:flex col-span-1 flex-col items-center gap-3 py-2">
            {[Phone, Mail, Calendar, CheckSquare, DollarSign, Users, Bot].map((Ic, i) => (
              <motion.div
                key={i}
                className={`w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 ${i === 6 ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-white/50"}`}
                animate={i === 6 ? { boxShadow: ["0 0 0 0 rgba(245,158,11,0.4)", "0 0 0 8px rgba(245,158,11,0)", "0 0 0 0 rgba(245,158,11,0)"] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Ic className="w-4 h-4" />
              </motion.div>
            ))}
          </div>

          {/* Main */}
          <div className="col-span-12 md:col-span-7 space-y-3">
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {[
                { label: "Appels semaine", value: callsCount, color: "from-emerald-500/20 to-emerald-700/10", text: "text-emerald-300", icon: Phone, suffix: "" },
                { label: "CA mois (EUR)", value: revenue, color: "from-amber-500/20 to-amber-700/10", text: "text-amber-300", icon: DollarSign, suffix: "" },
                { label: "Taches OK", value: 23, color: "from-violet-500/20 to-violet-700/10", text: "text-violet-300", icon: CheckSquare, suffix: "" },
              ].map((k, i) => {
                const Ic = k.icon;
                return (
                  <div key={i} className={`relative bg-gradient-to-br ${k.color} border border-white/10 rounded-xl p-2.5 md:p-3 overflow-hidden`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-white/60 uppercase tracking-wide truncate">{k.label}</span>
                      <Ic className={`w-3.5 h-3.5 ${k.text}`} />
                    </div>
                    <div className={`text-lg md:text-2xl font-extrabold ${k.text}`}>
                      <Counter end={k.value} suffix={k.suffix} duration={1200} />
                    </div>
                    <div className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                      <TrendingUp className="w-3 h-3" /> +{12 + i * 4}%
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Chart card */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 md:p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs text-white/60 uppercase tracking-wide">Activite 7 jours</div>
                  <div className="text-xl md:text-2xl font-extrabold text-white">312 appels</div>
                </div>
                <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" /> +18%
                </div>
              </div>
              <Sparkbar />
            </div>

            {/* AI suggest */}
            <motion.div
              className="bg-gradient-to-r from-amber-500/15 to-amber-600/5 border border-amber-500/30 rounded-xl p-3 flex items-start gap-3"
              animate={{ borderColor: ["rgba(245,158,11,0.3)", "rgba(245,158,11,0.7)", "rgba(245,158,11,0.3)"] }}
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0 shadow-lg shadow-amber-500/30">
                <Sparkles className="w-4 h-4 text-slate-900" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-amber-300 mb-0.5">L'IA suggere</div>
                <div className="text-xs md:text-sm text-white/85">Rappeler Jean Dupont avant 17h — le devis Beta SAS attend depuis 3 jours.</div>
              </div>
            </motion.div>

            {/* Document security breakdown — mirrors in-app SecuritySummary */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 md:p-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5 text-xs text-white/70 font-medium">
                  <Shield className="w-3.5 h-3.5 text-emerald-300" />
                  Securite des documents
                </div>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-full px-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Antivirus actif
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Verifies", value: 128, icon: ShieldCheck, text: "text-emerald-300", bg: "from-emerald-500/15 to-emerald-700/5 border-emerald-500/25" },
                  { label: "Menaces", value: 1, icon: ShieldAlert, text: "text-red-300", bg: "from-red-500/15 to-red-700/5 border-red-500/25" },
                  { label: "Non analyses", value: 6, icon: ShieldQuestion, text: "text-slate-300", bg: "from-slate-500/15 to-slate-700/5 border-slate-500/25" },
                ].map((s, i) => {
                  const Ic = s.icon;
                  return (
                    <div key={i} className={`flex flex-col items-center gap-1 rounded-lg border bg-gradient-to-br ${s.bg} px-2 py-2.5`}>
                      <Ic className={`w-4 h-4 ${s.text}`} />
                      <span className={`text-lg md:text-xl font-extrabold tabular-nums ${s.text}`}>
                        <Counter end={s.value} duration={1400} />
                      </span>
                      <span className="text-[10px] text-white/55 text-center leading-tight">{s.label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-white/45 mt-2 leading-snug">
                Chaque fichier importe est scanne automatiquement (antivirus + liens malveillants) avant d'arriver dans votre coffre.
              </div>
            </div>
          </div>

          {/* Activity feed */}
          <div className="col-span-12 md:col-span-4 bg-white/5 border border-white/10 rounded-xl p-3 md:p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-white/60 uppercase tracking-wide">Activite live</div>
              <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </div>
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {activities.map((a) => {
                  const Ic = a.icon;
                  return (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, y: -8, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.3 }}
                      className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${COLOR_MAP[a.color] ?? COLOR_MAP.blue}`}
                    >
                      <Ic className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] truncate">{a.text}</div>
                        <div className="text-[10px] text-white/40">{a.time}</div>
                      </div>
                    </motion.div>
                  );
                })}
                {activities.length === 0 && (
                  <div className="text-xs text-white/30 italic py-3 text-center">En attente d'activite…</div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Floating notification chips around dashboard (3D feel) */}
      <motion.div
        className="absolute -top-4 left-1/4 hidden md:flex items-center gap-2 bg-emerald-500 text-white px-3 py-1.5 rounded-full shadow-xl shadow-emerald-500/40 text-xs font-bold border border-white/20 z-10"
        animate={{ y: [0, -8, 0], rotate: [-2, 2, -2] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ transform: "perspective(600px) rotateY(-12deg)" }}
      >
        <Phone className="w-3 h-3" /> +1 appel VIP
      </motion.div>
      <motion.div
        className="absolute -bottom-4 right-1/4 hidden md:flex items-center gap-2 bg-amber-500 text-slate-900 px-3 py-1.5 rounded-full shadow-xl shadow-amber-500/40 text-xs font-bold border border-white/20 z-10"
        animate={{ y: [0, 8, 0], rotate: [2, -2, 2] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        style={{ transform: "perspective(600px) rotateY(12deg)" }}
      >
        <Sparkles className="w-3 h-3" /> IA active
      </motion.div>
    </div>
  );
}
