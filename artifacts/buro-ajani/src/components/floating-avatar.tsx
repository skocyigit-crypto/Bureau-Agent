import { useCallback, useEffect, useRef, useState } from "react";
import { AvatarDock } from "@workspace/ai-avatar";
import { GripVertical, Minus, Plus } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Avatar flottant déplaçable ("Canvas" vivant).
//
// Affiche l'agent de bureau (visage animé + voix on-device) en superposition
// fixe sur la page d'accueil. L'utilisateur peut le saisir par la poignée et le
// glisser n'importe où ; la position est mémorisée (localStorage) et survit au
// rechargement. Réductible en pastille pour ne pas gêner.
//
// On NE déclenche AUCUNE voix automatique au chargement (autoSpeak=false) — les
// navigateurs bloquent l'audio sans interaction et un son surprise est intrusif.
// Le message d'accueil est prêt : l'utilisateur le réécoute via le bouton ▶.
// ─────────────────────────────────────────────────────────────────────────────

const POS_KEY = "buro:floating-avatar:pos";
const MIN_KEY = "buro:floating-avatar:min";
const VOICE_KEY = "buro:floating-avatar:voice";

const GREETING =
  "Bonjour ! Je suis votre agent de bureau. Déplacez-moi où vous voulez. Comment puis-je vous aider ?";

interface Pos {
  x: number;
  y: number;
}

const PANEL_W = 300;
const PANEL_H = 120;
const PILL = 64;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pos>;
    if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
  } catch {
    /* ignore */
  }
  return null;
}

function defaultPos(minimized: boolean): Pos {
  if (typeof window === "undefined") return { x: 24, y: 120 };
  const w = minimized ? PILL : PANEL_W;
  const h = minimized ? PILL : PANEL_H;
  // Coin bas-gauche par défaut (le bouton assistant occupe le bas-droit).
  return {
    x: 24,
    y: clamp(window.innerHeight - h - 24, 16, window.innerHeight - h - 8),
  };
}

export function FloatingAvatar() {
  const [minimized, setMinimized] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MIN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pos, setPos] = useState<Pos>(() => loadPos() ?? defaultPos(false));
  const dragging = useRef(false);
  const moved = useRef(false);
  const start = useRef<{ px: number; py: number; ox: number; oy: number }>({
    px: 0,
    py: 0,
    ox: 0,
    oy: 0,
  });

  const persist = useCallback((p: Pos) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  // Reclampe la position dans la fenêtre lors d'un redimensionnement.
  useEffect(() => {
    const onResize = () => {
      setPos((p) => {
        const w = minimized ? PILL : PANEL_W;
        const h = minimized ? PILL : PANEL_H;
        const next = {
          x: clamp(p.x, 8, Math.max(8, window.innerWidth - w - 8)),
          y: clamp(p.y, 8, Math.max(8, window.innerHeight - h - 8)),
        };
        return next;
      });
    };
    // Reclampe immédiatement aussi au mont + à chaque bascule réduit/agrandi :
    // une pastille placée près d'un bord ne doit pas laisser le panneau agrandi
    // déborder hors de l'écran.
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minimized]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      moved.current = false;
      start.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [pos.x, pos.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - start.current.px;
      const dy = e.clientY - start.current.py;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
      const w = minimized ? PILL : PANEL_W;
      const h = minimized ? PILL : PANEL_H;
      setPos({
        x: clamp(start.current.ox + dx, 8, Math.max(8, window.innerWidth - w - 8)),
        y: clamp(start.current.oy + dy, 8, Math.max(8, window.innerHeight - h - 8)),
      });
    },
    [minimized],
  );

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setPos((p) => {
      persist(p);
      return p;
    });
  }, [persist]);

  const toggleMin = useCallback(() => {
    setMinimized((m) => {
      const next = !m;
      try {
        localStorage.setItem(MIN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Pastille réduite : avatar seul, déplaçable, clic (sans glisser) pour ouvrir.
  if (minimized) {
    return (
      <div
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          zIndex: 40,
          touchAction: "none",
          cursor: "grab",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => {
          endDrag();
          if (!moved.current) toggleMin();
          e.stopPropagation();
        }}
        onPointerCancel={endDrag}
        title="Agent de bureau — glissez pour déplacer, cliquez pour ouvrir"
        role="button"
        aria-label="Ouvrir l'agent de bureau"
        className="rounded-full bg-white shadow-xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="pointer-events-none p-1.5">
          <AvatarDock
            text={GREETING}
            defaultLang="fr"
            autoSpeak={false}
            size={48}
            storageKey={VOICE_KEY}
            className="!gap-0 [&>div:nth-child(2)]:hidden"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: PANEL_W,
        zIndex: 40,
      }}
      className="overflow-hidden rounded-2xl border border-black/10 bg-white/95 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-zinc-900/95"
    >
      {/* Poignée de déplacement */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ touchAction: "none", cursor: dragging.current ? "grabbing" : "grab" }}
        className="flex items-center justify-between gap-2 border-b border-black/5 bg-gradient-to-r from-violet-500/10 to-indigo-500/10 px-3 py-2 dark:border-white/5"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          <GripVertical className="h-4 w-4 text-zinc-400" />
          Agent de bureau
        </div>
        <button
          type="button"
          onClick={toggleMin}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-white"
          title={minimized ? "Agrandir" : "Réduire"}
          aria-label={minimized ? "Agrandir" : "Réduire"}
        >
          {minimized ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
        </button>
      </div>

      {/* Corps : avatar vivant + contrôles voix */}
      <div className="px-3 py-3">
        <AvatarDock
          text={GREETING}
          defaultLang="fr"
          autoSpeak={false}
          size={52}
          accent="#a855f7"
          storageKey={VOICE_KEY}
        />
      </div>
    </div>
  );
}
