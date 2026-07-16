import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";
import {
  AvatarFace,
  useTextToSpeech,
  VISEME_SHAPES,
  type VisemeKey,
} from "@workspace/ai-avatar";
import { Volume2, Square, MicOff } from "lucide-react";
import { useLowPowerMode } from "@/hooks/use-low-power";

// True when the browser can create a WebGL context. Headless/sandboxed browsers
// and some low-end devices can't — we fall back to the 2D SVG avatar there.
function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

// Catches a runtime WebGL context-creation failure thrown from inside <Canvas>
// (e.g. context lost) and renders the 2D fallback instead of crashing the page.
class WebGLBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Big "vitrine" 3D talking avatar for the marketing hero. A stylized, brand
// coloured head whose mouth is driven by the SAME on-device viseme engine the
// in-app assistant uses (lib/ai-avatar). No audio ever leaves the device: the
// browser's local speech engine synthesises the voice and we derive mouth
// shapes from the text linguistically. Falls back gracefully (silent, still
// animated idle) when no on-device voice is installed.

const BRAND_AMBER = "#f59e0b";

// A few welcome lines the avatar cycles through on each click. French, on-brand.
const GREETINGS = [
  "Bonjour ! Je suis votre agent de bureau. Je gère vos appels, vos emails et vos rendez-vous pendant que vous travaillez.",
  "Enchanté ! Confiez-moi votre accueil téléphonique, vos relances et votre agenda. Je m'occupe de tout, en français.",
  "Bienvenue chez Ajant Bureau. Je centralise vos appels, vos contacts et vos tâches grâce à l'intelligence artificielle.",
];

interface AvatarHeadProps {
  viseme: VisemeKey;
  speaking: boolean;
  reduceMotion: boolean;
}

// The 3D head. Mouth scale is lerped every frame toward the target mouth shape
// for the current viseme, so speech stays smooth even between viseme changes.
function AvatarHead({ viseme, speaking, reduceMotion }: AvatarHeadProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const teethRef = useRef<THREE.Mesh>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);

  // Keep the latest viseme/speaking in refs so useFrame reads fresh values.
  const visemeRef = useRef<VisemeKey>(viseme);
  const speakingRef = useRef(speaking);
  visemeRef.current = viseme;
  speakingRef.current = speaking;

  // Blink scheduling (seconds until next blink + current blink progress).
  const blink = useRef({ next: 1.6, t: 1 });

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const shape = VISEME_SHAPES[visemeRef.current] ?? VISEME_SHAPES.rest;

    // --- Mouth: lerp scale toward target geometry --------------------------
    const targetW = 0.34 + shape.w * 0.62;
    const targetH = 0.05 + shape.h * 0.62;
    if (mouthRef.current) {
      const s = mouthRef.current.scale;
      s.x += (targetW - s.x) * Math.min(1, dt * 16);
      s.y += (targetH - s.y) * Math.min(1, dt * 16);
      s.z = 0.18;
    }
    // Teeth flash for sibilants / labiodentals (s, f, …): opacity from `teeth`.
    if (teethRef.current) {
      const mat = teethRef.current.material as THREE.MeshStandardMaterial;
      const target = (shape.teeth ?? 0) * (speakingRef.current ? 0.9 : 0);
      mat.opacity += (target - mat.opacity) * Math.min(1, dt * 14);
      teethRef.current.visible = mat.opacity > 0.02;
    }

    // --- Eyes: periodic blink ---------------------------------------------
    const b = blink.current;
    b.next -= dt;
    if (b.next <= 0 && b.t >= 1) b.t = 0;
    if (b.t < 1) {
      b.t += dt * 7;
      if (b.t >= 1) {
        b.t = 1;
        b.next = 1.4 + Math.random() * 3.2;
      }
    }
    // 0 → open, 0.5 → closed, 1 → open again.
    const closed = Math.sin(Math.min(b.t, 1) * Math.PI);
    const eyeScaleY = 1 - closed * 0.9;
    if (leftEyeRef.current) leftEyeRef.current.scale.y = eyeScaleY;
    if (rightEyeRef.current) rightEyeRef.current.scale.y = eyeScaleY;

    // --- Idle head motion: gentle look toward pointer + bob ----------------
    if (groupRef.current && !reduceMotion) {
      const t = state.clock.elapsedTime;
      const px = state.pointer.x;
      const py = state.pointer.y;
      const targetRotY = px * 0.35 + Math.sin(t * 0.6) * 0.05;
      const targetRotX = -py * 0.25 + Math.sin(t * 0.9) * 0.03;
      groupRef.current.rotation.y += (targetRotY - groupRef.current.rotation.y) * Math.min(1, dt * 4);
      groupRef.current.rotation.x += (targetRotX - groupRef.current.rotation.x) * Math.min(1, dt * 4);
    }
  });

  return (
    <Float
      speed={reduceMotion ? 0 : 1.4}
      rotationIntensity={reduceMotion ? 0 : 0.25}
      floatIntensity={reduceMotion ? 0 : 0.6}
    >
      <group ref={groupRef}>
        {/* Head */}
        <mesh castShadow>
          <sphereGeometry args={[1, 64, 64]} />
          <meshStandardMaterial color="#eef2f7" roughness={0.32} metalness={0.12} />
        </mesh>

        {/* Brand "headband" / halo — signals the office-agent identity */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.55, 0]}>
          <torusGeometry args={[0.86, 0.05, 16, 64]} />
          <meshStandardMaterial color={BRAND_AMBER} emissive={BRAND_AMBER} emissiveIntensity={0.5} roughness={0.3} metalness={0.4} />
        </mesh>

        {/* Headset earpiece + mic boom (left side) */}
        <mesh position={[-1.0, -0.05, 0.05]}>
          <sphereGeometry args={[0.16, 24, 24]} />
          <meshStandardMaterial color="#1a2744" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[-0.62, -0.5, 0.78]} rotation={[0, 0, 0.5]}>
          <cylinderGeometry args={[0.025, 0.025, 0.95, 12]} />
          <meshStandardMaterial color="#1a2744" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[-0.25, -0.72, 0.95]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color={BRAND_AMBER} emissive={BRAND_AMBER} emissiveIntensity={0.6} />
        </mesh>

        {/* Eyes */}
        <mesh ref={leftEyeRef} position={[-0.34, 0.2, 0.86]}>
          <sphereGeometry args={[0.13, 32, 32]} />
          <meshStandardMaterial color="#1a2744" roughness={0.2} />
        </mesh>
        <mesh ref={rightEyeRef} position={[0.34, 0.2, 0.86]}>
          <sphereGeometry args={[0.13, 32, 32]} />
          <meshStandardMaterial color="#1a2744" roughness={0.2} />
        </mesh>
        {/* Eye sparkle */}
        <mesh position={[-0.3, 0.25, 0.98]}>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.7} />
        </mesh>
        <mesh position={[0.38, 0.25, 0.98]}>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.7} />
        </mesh>

        {/* Teeth (behind mouth, flashes on sibilants) */}
        <mesh ref={teethRef} position={[0, -0.42, 0.9]}>
          <boxGeometry args={[0.34, 0.06, 0.04]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0} roughness={0.4} />
        </mesh>

        {/* Mouth — scaled each frame by the current viseme */}
        <mesh ref={mouthRef} position={[0, -0.44, 0.92]} scale={[0.5, 0.1, 0.18]}>
          <sphereGeometry args={[0.5, 32, 32]} />
          <meshStandardMaterial color="#7a1f3d" roughness={0.5} />
        </mesh>
      </group>
    </Float>
  );
}

export function ShowcaseAvatar3D({ className = "" }: { className?: string }) {
  const tts = useTextToSpeech({ lang: "fr", gender: "female", requireLocal: true });
  const [idx, setIdx] = useState(0);
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    [],
  );
  const lowPower = useLowPowerMode();
  // Skip WebGL entirely on low-end/mobile/reduced-motion contexts: the 2D SVG
  // avatar uses the same viseme engine but no GPU 3D scene.
  const webglOk = useMemo(() => !lowPower && detectWebGL(), [lowPower]);

  // Pause the 3D render loop when the avatar is scrolled off-screen so it stops
  // consuming GPU/CPU while not visible. The viseme engine itself is unaffected.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => () => tts.cancel(), [tts]);

  const handleSpeak = () => {
    if (tts.speaking) {
      tts.cancel();
      return;
    }
    const text = GREETINGS[idx % GREETINGS.length];
    setIdx((i) => i + 1);
    tts.speak(text, "fr");
  };

  const noVoice = tts.supported && !tts.hasVoiceForLang;

  // 2D SVG fallback (no WebGL): same viseme engine, still lip-syncs + talks.
  const face2d = (
    <button
      type="button"
      onClick={handleSpeak}
      className="flex h-full w-full cursor-pointer items-center justify-center"
      aria-label="Faire parler l'avatar"
    >
      <AvatarFace
        viseme={tts.viseme}
        speaking={tts.speaking}
        size={360}
        palette={{ ring: BRAND_AMBER, headset: "#cbd5e1" }}
      />
    </button>
  );

  return (
    <div className={`relative ${className}`}>
      <div ref={stageRef} className="relative mx-auto aspect-square w-full max-w-[420px]">
        {/* Glow backdrop */}
        <div className="pointer-events-none absolute inset-0 rounded-full bg-amber-400/20 blur-3xl" />
        {webglOk ? (
          <WebGLBoundary fallback={face2d}>
            <Canvas
              shadows
              dpr={[1, 2]}
              camera={{ position: [0, 0, 4.1], fov: 38 }}
              gl={{ antialias: true, alpha: true }}
              frameloop={onScreen ? "always" : "never"}
              onClick={handleSpeak}
              className="cursor-pointer"
            >
              <ambientLight intensity={0.7} />
              <directionalLight position={[3, 4, 5]} intensity={1.4} color="#fff7ed" castShadow />
              <directionalLight position={[-4, 1, 2]} intensity={0.8} color={BRAND_AMBER} />
              <pointLight position={[0, -2, 3]} intensity={0.5} color="#60a5fa" />
              <AvatarHead viseme={tts.viseme} speaking={tts.speaking} reduceMotion={reduceMotion} />
            </Canvas>
          </WebGLBoundary>
        ) : (
          face2d
        )}

        {/* Speaking indicator */}
        {tts.speaking && (
          <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-semibold text-[#1a2744] shadow-lg">
            En train de parler…
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={handleSpeak}
          disabled={noVoice}
          className="inline-flex items-center gap-2 rounded-full bg-[#f59e0b] px-6 py-3 text-base font-bold text-[#1a2744] shadow-[0_0_40px_-10px_rgba(245,158,11,0.6)] transition-all hover:scale-105 hover:bg-[#f59e0b]/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tts.speaking ? (
            <>
              <Square className="h-4 w-4" /> Arrêter
            </>
          ) : (
            <>
              <Volume2 className="h-4 w-4" /> Faites-moi parler
            </>
          )}
        </button>
        {noVoice && (
          <p className="inline-flex items-center gap-1.5 text-xs text-white/60">
            <MicOff className="h-3.5 w-3.5" />
            Aucune voix française installée sur cet appareil — l'animation reste visible.
          </p>
        )}
      </div>
    </div>
  );
}
