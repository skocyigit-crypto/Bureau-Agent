import { useEffect, useState } from "react";
import { AvatarFace, type AvatarEmotion } from "@workspace/ai-avatar";
import type { VisemeKey } from "@workspace/ai-avatar";

const SPEAK_SEQ: VisemeKey[] = [
  "M", "A", "E", "rest", "O", "U", "I", "rest",
  "F", "A", "O", "E", "rest", "I", "U", "rest",
];

function useSpeechLoop(active: boolean, stepMs = 130) {
  const [viseme, setViseme] = useState<VisemeKey>("rest");
  useEffect(() => {
    if (!active) {
      setViseme("rest");
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % SPEAK_SEQ.length;
      setViseme(SPEAK_SEQ[i]);
    }, stepMs);
    return () => clearInterval(id);
  }, [active, stepMs]);
  return viseme;
}

const EMOTION_CARDS: { emotion: AvatarEmotion; label: string; speaking: boolean }[] = [
  { emotion: "neutral", label: "Neutre", speaking: false },
  { emotion: "happy", label: "Content", speaking: false },
  { emotion: "thinking", label: "Réflexion", speaking: false },
  { emotion: "listening", label: "À l'écoute", speaking: false },
];

function EmotionCard({ emotion, label, speaking }: { emotion: AvatarEmotion; label: string; speaking: boolean }) {
  const viseme = useSpeechLoop(speaking);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        <AvatarFace viseme={viseme} speaking={speaking} emotion={emotion} gaze={false} size={132} />
      </div>
      <span className="text-sm font-medium text-slate-300">{label}</span>
    </div>
  );
}

export function AvatarShowcase() {
  const heroViseme = useSpeechLoop(true);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#0a0f1d] via-[#0c1426] to-[#070b16] px-10 py-12 text-white">
      <div className="mx-auto flex max-w-4xl flex-col items-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Avatar repensé
        </div>
        <h1 className="mt-3 text-center text-3xl font-bold tracking-tight">
          Votre Agent, en chair et en pixels
        </h1>
        <p className="mt-2 max-w-xl text-center text-sm leading-relaxed text-slate-400">
          Synchronisation labiale (lip-sync), regard vivant, micro-mouvements de tête,
          aura audio-réactive et expressions — entièrement en SVG, sur l'appareil, sans
          dépendance externe.
        </p>

        {/* Hero speaking avatar */}
        <div className="relative mt-9 flex flex-col items-center">
          <div className="rounded-[2rem] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-8 shadow-[0_20px_70px_rgba(0,0,0,0.5)]">
            <AvatarFace viseme={heroViseme} speaking emotion="happy" gaze size={300} />
          </div>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-4 py-1.5 text-sm font-medium text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            En train de parler — lip-sync en direct
          </div>
        </div>

        {/* Emotion row */}
        <div className="mt-12 w-full">
          <h2 className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Palette d'expressions
          </h2>
          <div className="grid grid-cols-4 gap-6">
            {EMOTION_CARDS.map((c) => (
              <EmotionCard key={c.emotion} {...c} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
