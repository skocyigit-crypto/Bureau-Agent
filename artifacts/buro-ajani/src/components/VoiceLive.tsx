// VoiceLive: conversational voice assistant powered by Gemini Live API.
//
// UX: fullscreen overlay (Gemini-like). Once activated, continuously
// captures mic audio in 40ms chunks, streams to /api/voice/live over
// WebSocket, plays back Gemini's native audio response. Supports
// barge-in (interrupt while speaking), auto language detection (handled
// natively by Gemini), and continuous turn-taking with no button press.
//
// Audio pipeline:
//   mic --getUserMedia--> AudioContext --AudioWorklet--> Int16 PCM 16kHz
//        --base64-> WS --base64-> server --> Gemini Live
//   Gemini --PCM 24kHz--> base64 --> WS --> Int16 -> AudioBuffer --> play
//
// Backed by artifacts/api-server/src/routes/voice-live.ts.

import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, X, Sparkles, Loader2, AlertCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Gemini Live output sample rate (fixed by the API).
const OUTPUT_SAMPLE_RATE = 24000;

type LiveState = "idle" | "connecting" | "listening" | "speaking" | "error";

interface ServerFrame {
  type: "audio" | "text" | "turn_complete" | "interrupted" | "ready" | "error";
  data?: string;
  text?: string;
  message?: string;
  lang?: string;
}

// Decode base64 (browser-safe, supports large strings).
function base64ToInt16(b64: string): Int16Array {
  const binStr = atob(b64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

// Encode ArrayBuffer to base64 (chunked to avoid stack overflow).
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

interface VoiceLiveProps {
  open: boolean;
  onClose: () => void;
}

export function VoiceLive({ open, onClose }: VoiceLiveProps) {
  const [state, setState] = useState<LiveState>("idle");
  const [error, setError] = useState<string>("");
  const [transcript, setTranscript] = useState<string>("");
  const [muted, setMuted] = useState(false);
  // Volume-driven scale for the central orb (0..1).
  const [level, setLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Playback queue scheduling. Each audio chunk we receive is scheduled
  // immediately after the previous one ends, so audio plays continuously
  // without gaps even if chunks arrive bursty.
  const playbackHeadRef = useRef<number>(0);
  // Active playback sources — tracked so we can stop them on barge-in
  // without recreating the entire AudioContext (much cheaper, no churn).
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  // For visualizing the assistant's output level on the orb.
  const speakingGainRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const teardown = useCallback(() => {
    try { wsRef.current?.close(); } catch { /* noop */ }
    wsRef.current = null;
    try { workletNodeRef.current?.disconnect(); } catch { /* noop */ }
    workletNodeRef.current = null;
    try { sourceRef.current?.disconnect(); } catch { /* noop */ }
    sourceRef.current = null;
    try { analyserRef.current?.disconnect(); } catch { /* noop */ }
    analyserRef.current = null;
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    micStreamRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* noop */ }
    audioCtxRef.current = null;
    try { playbackCtxRef.current?.close(); } catch { /* noop */ }
    playbackCtxRef.current = null;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    playbackHeadRef.current = 0;
    speakingGainRef.current = 0;
    activeSourcesRef.current.clear();
    setLevel(0);
  }, []);

  const playAudioChunk = useCallback((pcm: Int16Array) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    // Convert int16 -> float32 in [-1, 1].
    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 0x8000;
    const buffer = ctx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    // Schedule at the current playback head to avoid gaps/overlaps.
    const startAt = Math.max(playbackHeadRef.current, ctx.currentTime);
    source.start(startAt);
    playbackHeadRef.current = startAt + buffer.duration;
    // Track for barge-in stop.
    activeSourcesRef.current.add(source);
    source.onended = () => { activeSourcesRef.current.delete(source); };
    // Estimate output gain for visualization (peak amplitude).
    let peak = 0;
    for (let i = 0; i < float.length; i++) {
      const a = Math.abs(float[i]);
      if (a > peak) peak = a;
    }
    speakingGainRef.current = Math.max(speakingGainRef.current, peak);
  }, []);

  const handleServerFrame = useCallback((frame: ServerFrame) => {
    switch (frame.type) {
      case "ready":
        setState("listening");
        setError("");
        break;
      case "audio":
        if (frame.data) {
          setState("speaking");
          playAudioChunk(base64ToInt16(frame.data));
        }
        break;
      case "text":
        if (frame.text) setTranscript((t) => (t + frame.text).slice(-500));
        break;
      case "interrupted":
        // The user spoke over the model — stop all in-flight playback
        // sources so Gemini's next chunk plays immediately rather than
        // after the already-buffered interrupted speech. Cheaper and
        // safer than tearing down/recreating the AudioContext.
        for (const src of activeSourcesRef.current) {
          try { src.stop(); } catch { /* already stopped */ }
        }
        activeSourcesRef.current.clear();
        playbackHeadRef.current = 0;
        speakingGainRef.current = 0;
        setState("listening");
        break;
      case "turn_complete":
        setState("listening");
        setTranscript("");
        break;
      case "error":
        setError(frame.message || "Erreur Gemini Live");
        setState("error");
        break;
    }
  }, [playAudioChunk]);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    setState("connecting");
    setError("");
    setTranscript("");
    try {
      // 1. Request mic permission first (user gesture is in this call chain).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      // 2. Set up capture AudioContext at the device's native rate.
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      await audioCtx.audioWorklet.addModule(`${BASE}/voice-pcm-worklet.js`);

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(audioCtx, "pcm-downsample");
      workletNodeRef.current = worklet;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);
      source.connect(worklet);
      // Note: worklet output is NOT connected to destination — we don't
      // want the user's mic echoing through their speakers.

      // 3. Set up playback context at Gemini's output rate (24kHz).
      playbackCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });

      // 4. Open WebSocket to the server bridge.
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${wsProto}//${window.location.host}${BASE}/api/voice/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Forward PCM chunks from worklet to WS.
        worklet.port.onmessage = (ev) => {
          if (mutedRef.current) return;
          if (ws.readyState !== WebSocket.OPEN) return;
          const b64 = arrayBufferToBase64(ev.data as ArrayBuffer);
          ws.send(JSON.stringify({ type: "audio", data: b64 }));
        };
      };
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data) as ServerFrame;
          handleServerFrame(frame);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onerror = () => {
        setError("Connexion perdue avec le serveur Gemini Live");
        setState("error");
        teardown();
      };
      ws.onclose = (ev) => {
        // 1000 = normal closure (user fermeture volontaire). Tous les
        // autres codes indiquent une fermeture anormale — on libere
        // les ressources audio pour eviter qu'un micro reste actif.
        if (ev.code !== 1000) {
          if (!error) {
            setError(ev.reason || "Connexion fermee inopinement");
          }
          setState((s) => (s === "error" ? s : "error"));
          teardown();
        }
      };

      // 5. Drive the visual orb from mic level (in case user is silent
      // we still see a calm pulse from speaker output).
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const mic = Math.min(1, rms * 4);
        const out = speakingGainRef.current;
        // Decay assistant level smoothly between chunks.
        speakingGainRef.current = Math.max(0, out - 0.04);
        setLevel(Math.max(mic, out));
        animationFrameRef.current = requestAnimationFrame(tick);
      };
      animationFrameRef.current = requestAnimationFrame(tick);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Impossible d'activer le micro: ${msg}`);
      setState("error");
      teardown();
    }
  }, [handleServerFrame, teardown]);

  // Lifecycle: start when opened, teardown when closed.
  useEffect(() => {
    if (open) {
      start();
    } else {
      teardown();
      setState("idle");
    }
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Press Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const orbScale = 1 + level * 0.6;
  const stateLabel: Record<LiveState, string> = {
    idle: "Pret",
    connecting: "Connexion...",
    listening: "Je vous ecoute",
    speaking: "...",
    error: "Erreur",
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
        aria-label="Fermer"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Branding */}
      <div className="absolute top-6 left-6 flex items-center gap-2 text-white/80">
        <Sparkles className="w-5 h-5" />
        <span className="font-medium">Bureau Live</span>
      </div>

      {/* Orb visualization */}
      <div className="relative flex items-center justify-center mb-12">
        {/* Outer halo, soft glow */}
        <div
          className="absolute w-72 h-72 rounded-full bg-gradient-to-br from-cyan-400/30 via-violet-500/30 to-fuchsia-500/30 blur-3xl"
          style={{ transform: `scale(${orbScale})`, transition: "transform 80ms ease-out" }}
        />
        {/* Mid ring */}
        <div
          className="absolute w-56 h-56 rounded-full bg-gradient-to-br from-cyan-400/40 via-violet-500/40 to-fuchsia-500/40 blur-xl"
          style={{ transform: `scale(${1 + level * 0.4})`, transition: "transform 80ms ease-out" }}
        />
        {/* Core orb */}
        <div
          className="relative w-40 h-40 rounded-full bg-gradient-to-br from-cyan-300 via-violet-400 to-fuchsia-400 shadow-2xl shadow-violet-500/50 flex items-center justify-center"
          style={{ transform: `scale(${1 + level * 0.15})`, transition: "transform 80ms ease-out" }}
        >
          {state === "connecting" && <Loader2 className="w-10 h-10 text-white animate-spin" />}
          {state === "error" && <AlertCircle className="w-12 h-12 text-white" />}
        </div>
      </div>

      {/* State label */}
      <p className="text-white/90 text-lg font-medium tracking-wide mb-2">
        {stateLabel[state]}
      </p>

      {/* Transcript (assistant text, if any) */}
      {transcript && (
        <p className="text-white/70 text-sm max-w-xl text-center px-6 mb-4 min-h-[1.5rem]">
          {transcript}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="max-w-md mx-6 mb-6 p-4 rounded-xl bg-red-500/20 border border-red-400/30 text-red-100 text-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4 mt-8">
        <button
          onClick={() => setMuted((m) => !m)}
          className={`p-4 rounded-full transition ${muted ? "bg-red-500/30 text-red-100 hover:bg-red-500/40" : "bg-white/10 text-white hover:bg-white/20"}`}
          aria-label={muted ? "Reactiver le micro" : "Couper le micro"}
        >
          {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
      </div>

      <p className="absolute bottom-6 text-white/40 text-xs">
        Parlez naturellement. Coupez ma parole quand vous voulez.
      </p>
    </div>
  );
}
