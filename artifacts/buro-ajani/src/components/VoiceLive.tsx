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
import { Mic, MicOff, X, Sparkles, Loader2, AlertCircle, Check, Settings2, Wrench } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Gemini Live output sample rate (fixed by the API).
const OUTPUT_SAMPLE_RATE = 24000;
// Cle localStorage pour persister le choix de voix entre sessions.
const VOICE_STORAGE_KEY = "voicelive.voice";

type LiveState = "idle" | "connecting" | "listening" | "speaking" | "error";

interface ServerFrame {
  type:
    | "audio"
    | "text"
    | "turn_complete"
    | "interrupted"
    | "ready"
    | "error"
    | "user_transcript"
    | "assistant_transcript"
    | "tool_step"
    | "tool_pending"
    | "voices";
  data?: string;
  text?: string;
  message?: string;
  lang?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  toolCallId?: string;
  summary?: string;
  voices?: readonly string[];
}

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

interface ToolEvent {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: "running" | "done" | "error" | "pending";
  summary?: string;
}

// Etiquettes lisibles pour les outils (FR par defaut).
const TOOL_LABELS: Record<string, string> = {
  create_task: "Cree une tache",
  list_tasks: "Liste les taches",
  create_contact: "Cree un contact",
  search_contacts: "Recherche dans les contacts",
  create_calendar_event: "Cree un evenement",
  list_calendar_events: "Liste les evenements",
  send_email: "Envoie un e-mail",
  send_sms: "Envoie un SMS",
  list_recent_calls: "Liste les appels recents",
  generate_image: "Genere une image",
};
const labelForTool = (name: string): string => TOOL_LABELS[name] ?? name;

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
  // Conversation tour-par-tour (affichage chat-style).
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  // Tool events recents (animation type "action en cours").
  const [tools, setTools] = useState<ToolEvent[]>([]);
  // File d'attente de tools necessitant confirmation utilisateur (envoi
  // email/SMS/suppression). On les resout un par un (FIFO) pour ne
  // jamais en perdre un en cas d'actions multiples consecutives.
  const [pendingQueue, setPendingQueue] = useState<ToolEvent[]>([]);
  // Voix selectionnee (persistee dans localStorage).
  const [voice, setVoice] = useState<string>(() => {
    if (typeof window === "undefined") return "Aoede";
    return localStorage.getItem(VOICE_STORAGE_KEY) ?? "Aoede";
  });
  const [availableVoices, setAvailableVoices] = useState<readonly string[]>([
    "Aoede", "Charon", "Fenrir", "Kore", "Puck", "Zephyr",
  ]);
  const [showSettings, setShowSettings] = useState(false);
  const [muted, setMuted] = useState(false);
  // Volume-driven scale for the central orb (0..1).
  const [level, setLevel] = useState(0);
  // Spectrum data for the radial visualizer (frequency bars autour de l'orb).
  const [spectrum, setSpectrum] = useState<number[]>(() => new Array(24).fill(0));

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
  // Timer arme par changeVoice pour reconnecter apres teardown. On le
  // garde dans un ref pour pouvoir le canceler si l'utilisateur ferme
  // l'overlay entre-temps (evite reactivation micro fantome).
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref vers la version courante de `start` — evite stale-closure quand
  // changeVoice() arme un setTimeout: au declenchement on lit la
  // derniere `start` (qui a vu la nouvelle valeur de voice via deps).
  const startRef = useRef<() => Promise<void>>(async () => { /* noop */ });
  // Refs miroirs pour teardown (qui est stable via useCallback []):
  // permet d'auto-rejeter les pending confirmations et de connaitre
  // l'etat "ouvert" sans recreer teardown a chaque changement.
  const pendingQueueRef = useRef<ToolEvent[]>([]);
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  // NOTE: pendingQueueRef est mis a jour de maniere SYNCHRONE dans
  // chaque setState ci-dessous (pas via useEffect) pour que teardown()
  // voie immediatement la file la plus a jour, meme si un tool_pending
  // arrive juste avant la fermeture (race condition signalee par le
  // code review).
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const teardown = useCallback(() => {
    // Annule un reconnect en attente — sinon le micro pourrait se
    // reouvrir apres fermeture de l'overlay (bug privacy).
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Auto-rejette toutes les pending confirmations restantes pour ne
    // pas laisser Gemini bloque en attente de `sendToolResponse`.
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      for (const p of pendingQueueRef.current) {
        try {
          ws.send(JSON.stringify({ type: "confirm_tool", toolCallId: p.id, decision: "reject" }));
        } catch { /* noop */ }
      }
    }
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

  // Helper: ajoute du texte au dernier tour de meme role, ou cree un
  // nouveau tour. Permet d'accumuler les morceaux de transcription qui
  // arrivent par petits chunks pendant que l'utilisateur/AI parle.
  const appendToTurn = useCallback((role: "user" | "assistant", text: string) => {
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        const updated = [...prev];
        updated[updated.length - 1] = { ...last, text: last.text + text };
        return updated.slice(-20);
      }
      return [...prev, { role, text }].slice(-20);
    });
  }, []);

  const handleServerFrame = useCallback((frame: ServerFrame) => {
    switch (frame.type) {
      case "ready":
        setState("listening");
        setError("");
        break;
      case "voices":
        if (frame.voices && frame.voices.length > 0) setAvailableVoices(frame.voices);
        break;
      case "audio":
        if (frame.data) {
          setState("speaking");
          playAudioChunk(base64ToInt16(frame.data));
        }
        break;
      case "text":
        // Le modele Live envoie generalement de l'audio, mais peut aussi
        // emettre du texte (ex: messages systeme). On l'agrege dans le
        // dernier tour assistant.
        if (frame.text) appendToTurn("assistant", frame.text);
        break;
      case "user_transcript":
        if (frame.text) appendToTurn("user", frame.text);
        break;
      case "assistant_transcript":
        if (frame.text) appendToTurn("assistant", frame.text);
        break;
      case "tool_step": {
        if (!frame.toolCallId || !frame.toolName) break;
        const id = frame.toolCallId;
        const name = frame.toolName;
        setTools((prev) => {
          const existing = prev.find((t) => t.id === id);
          const isResult = frame.toolResult !== undefined;
          const errored = isResult && typeof frame.toolResult?.error === "string";
          const next: ToolEvent = {
            id,
            name,
            args: frame.toolArgs ?? existing?.args,
            result: frame.toolResult ?? existing?.result,
            status: isResult ? (errored ? "error" : "done") : "running",
          };
          const filtered = prev.filter((t) => t.id !== id);
          return [...filtered, next].slice(-6);
        });
        // Si un tool pending vient d'etre execute (race avec un click
        // simultane), on le retire aussi de la file.
        if (frame.toolResult !== undefined) {
          setPendingQueue((q) => {
            const next = q.filter((p) => p.id !== id);
            pendingQueueRef.current = next;
            return next;
          });
        }
        break;
      }
      case "tool_pending": {
        if (!frame.toolCallId || !frame.toolName) break;
        const callId = frame.toolCallId;
        const name = frame.toolName;
        const next: ToolEvent = {
          id: callId,
          name,
          args: frame.toolArgs,
          status: "pending",
          summary: frame.summary,
        };
        // FIFO + dedupe par id (au cas ou un tool_pending arriverait
        // deux fois pour le meme call). Mise a jour SYNCHRONE du ref
        // pour que teardown puisse rejeter ce call meme si fermeture
        // arrive avant le prochain render.
        setPendingQueue((q) => {
          if (q.some((p) => p.id === callId)) return q;
          const updated = [...q, next];
          pendingQueueRef.current = updated;
          return updated;
        });
        break;
      }
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
        break;
      case "error":
        setError(frame.message || "Erreur Gemini Live");
        setState("error");
        break;
    }
  }, [playAudioChunk, appendToTurn]);

  // Confirme ou refuse le PREMIER tool en attente (FIFO). Envoye au
  // backend qui appelle alors `sendToolResponse` cote Gemini.
  const respondToConfirmation = useCallback((decision: "approve" | "reject") => {
    setPendingQueue((q) => {
      const head = q[0];
      if (!head) return q;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "confirm_tool", toolCallId: head.id, decision }));
      }
      const updated = q.slice(1);
      pendingQueueRef.current = updated;
      return updated;
    });
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    setState("connecting");
    setError("");
    setTurns([]);
    setTools([]);
    setPendingQueue([]);
    pendingQueueRef.current = [];
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

      // 4. Open WebSocket to the server bridge. La voix est fixee a
      // l'ouverture cote Gemini Live, donc on la passe en query-param.
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${wsProto}//${window.location.host}${BASE}/api/voice/live?voice=${encodeURIComponent(voice)}`,
      );
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

      // 5. Drive the visual orb + spectrum viz from mic level (in case
      // l'utilisateur est silencieux on voit toujours une pulse douce
      // de la sortie assistant).
      const timeData = new Uint8Array(analyser.frequencyBinCount);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const NUM_BARS = 24;
      let frame = 0;
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeData.length);
        const mic = Math.min(1, rms * 4);
        const out = speakingGainRef.current;
        speakingGainRef.current = Math.max(0, out - 0.04);
        setLevel(Math.max(mic, out));

        // Spectrum bars: ~30 fps suffit pour l'oeil + economise la CPU.
        if ((frame++ & 1) === 0) {
          analyserRef.current.getByteFrequencyData(freqData);
          const bars: number[] = new Array(NUM_BARS);
          const step = Math.floor(freqData.length / NUM_BARS) || 1;
          for (let b = 0; b < NUM_BARS; b++) {
            let s = 0;
            for (let k = 0; k < step; k++) s += freqData[b * step + k] ?? 0;
            bars[b] = Math.min(1, (s / step) / 200 + out * 0.4);
          }
          setSpectrum(bars);
        }
        animationFrameRef.current = requestAnimationFrame(tick);
      };
      animationFrameRef.current = requestAnimationFrame(tick);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Impossible d'activer le micro: ${msg}`);
      setState("error");
      teardown();
    }
  }, [handleServerFrame, teardown, voice, error]);

  // Persiste la voix selectionnee.
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(VOICE_STORAGE_KEY, voice);
  }, [voice]);

  // Garde toujours la derniere version de `start` dans un ref, pour
  // qu'un setTimeout differe n'utilise pas une closure obsolete (qui
  // tiendrait l'ancienne valeur de `voice`).
  useEffect(() => { startRef.current = start; }, [start]);

  // Reconnecte avec la nouvelle voix quand l'utilisateur en change en
  // cours de session (Gemini Live fige la voix a l'ouverture).
  const changeVoice = useCallback((v: string) => {
    setVoice(v);
    setShowSettings(false);
    const hadSession = wsRef.current !== null;
    if (hadSession) {
      teardown();
      // Petit delai pour laisser teardown nettoyer les contextes audio.
      // Trace via ref pour annulation propre si l'overlay se ferme.
      if (reconnectTimerRef.current !== null) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        // Garde-fou: si l'utilisateur a ferme l'overlay entre-temps,
        // ne pas reouvrir le micro.
        if (!openRef.current) return;
        void startRef.current();
      }, 200);
    }
  }, [teardown]);

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
    speaking: "Je reponds...",
    error: "Erreur",
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 overflow-hidden">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition z-10"
        aria-label="Fermer"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Branding */}
      <div className="absolute top-6 left-6 flex items-center gap-2 text-white/80 z-10">
        <Sparkles className="w-5 h-5" />
        <span className="font-medium">Bureau Live</span>
      </div>

      {/* Voice picker / settings */}
      <div className="absolute top-6 right-20 z-10">
        <button
          onClick={() => setShowSettings((s) => !s)}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-2"
          aria-label="Parametres"
        >
          <Settings2 className="w-5 h-5" />
          <span className="text-xs hidden sm:inline">{voice}</span>
        </button>
        {showSettings && (
          <div className="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900/95 backdrop-blur border border-white/10 shadow-2xl overflow-hidden">
            <div className="px-3 py-2 text-xs text-white/60 border-b border-white/10">Voix</div>
            {availableVoices.map((v) => (
              <button
                key={v}
                onClick={() => changeVoice(v)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex items-center justify-between ${v === voice ? "text-cyan-300" : "text-white/80"}`}
              >
                <span>{v}</span>
                {v === voice && <Check className="w-4 h-4" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat panel: side, scrollable history of transcripts */}
      <aside className="absolute left-0 top-0 bottom-0 hidden md:flex w-80 flex-col p-6 pt-20 pointer-events-none">
        <div className="flex-1 overflow-y-auto pr-2 space-y-3 pointer-events-auto scrollbar-thin">
          {turns.length === 0 && (
            <p className="text-white/40 text-xs italic">La transcription s'affichera ici en temps reel.</p>
          )}
          {turns.map((t, i) => (
            <div
              key={i}
              className={`rounded-2xl px-3 py-2 text-sm max-w-[95%] ${
                t.role === "user"
                  ? "bg-white/10 text-white/90 self-end ml-auto"
                  : "bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 border border-violet-400/20 text-white"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      </aside>

      {/* Tools panel: right side */}
      <aside className="absolute right-0 top-0 bottom-0 hidden lg:flex w-72 flex-col p-6 pt-20 pointer-events-none">
        <div className="flex-1 overflow-y-auto pr-2 space-y-2 pointer-events-auto">
          {tools.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl px-3 py-2 text-xs border flex items-start gap-2 ${
                t.status === "done"
                  ? "bg-emerald-500/10 border-emerald-400/20 text-emerald-100"
                  : t.status === "error"
                    ? "bg-red-500/10 border-red-400/20 text-red-100"
                    : "bg-amber-500/10 border-amber-400/20 text-amber-100"
              }`}
            >
              {t.status === "running" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5 shrink-0" />
              ) : t.status === "done" ? (
                <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              ) : (
                <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              )}
              <span className="leading-tight">{labelForTool(t.name)}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* Center stage: orb + spectrum + label */}
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <div className="relative flex items-center justify-center mb-8">
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
          {/* Radial spectrum bars */}
          <svg className="absolute" width="320" height="320" viewBox="-160 -160 320 320">
            {spectrum.map((mag, i) => {
              const angle = (i / spectrum.length) * Math.PI * 2 - Math.PI / 2;
              const r1 = 95;
              const r2 = 95 + mag * 55;
              const x1 = Math.cos(angle) * r1;
              const y1 = Math.sin(angle) * r1;
              const x2 = Math.cos(angle) * r2;
              const y2 = Math.sin(angle) * r2;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="white"
                  strokeOpacity={0.4 + mag * 0.5}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>
          {/* Core orb */}
          <div
            className="relative w-40 h-40 rounded-full bg-gradient-to-br from-cyan-300 via-violet-400 to-fuchsia-400 shadow-2xl shadow-violet-500/50 flex items-center justify-center"
            style={{ transform: `scale(${1 + level * 0.15})`, transition: "transform 80ms ease-out" }}
          >
            {state === "connecting" && <Loader2 className="w-10 h-10 text-white animate-spin" />}
            {state === "error" && <AlertCircle className="w-12 h-12 text-white" />}
          </div>
        </div>

        <p className="text-white/90 text-lg font-medium tracking-wide mb-2">
          {stateLabel[state]}
        </p>

        {/* Sous-titre: dernier tour assistant en cours (live caption) */}
        {state === "speaking" && turns.length > 0 && turns[turns.length - 1].role === "assistant" && (
          <p className="text-white/70 text-sm max-w-xl text-center px-6 mb-4 min-h-[1.5rem]">
            {turns[turns.length - 1].text.slice(-180)}
          </p>
        )}

        {/* Error */}
        {error && (
          <div className="max-w-md mx-6 mb-6 p-4 rounded-xl bg-red-500/20 border border-red-400/30 text-red-100 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="pb-12 flex flex-col items-center gap-4 w-full z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setMuted((m) => !m)}
            className={`p-4 rounded-full transition ${muted ? "bg-red-500/30 text-red-100 hover:bg-red-500/40" : "bg-white/10 text-white hover:bg-white/20"}`}
            aria-label={muted ? "Reactiver le micro" : "Couper le micro"}
          >
            {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>
        </div>
        <p className="text-white/40 text-xs">
          Parlez naturellement. Coupez ma parole quand vous voulez.
        </p>
      </div>

      {/* Confirmation modal (envoi email / SMS / suppression / etc.).
          On affiche le PREMIER element de la file et on resout FIFO —
          si Gemini emet 2 actions risquees coup-sur-coup, on les
          confirme une par une sans en perdre. */}
      {pendingQueue.length > 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="max-w-md w-[90%] rounded-2xl bg-slate-900 border border-white/10 p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-white font-semibold">
                  Confirmation requise
                  {pendingQueue.length > 1 && (
                    <span className="ml-2 text-xs text-white/50">
                      (1 / {pendingQueue.length})
                    </span>
                  )}
                </h3>
                <p className="text-white/60 text-sm">
                  {labelForTool(pendingQueue[0].name)}
                </p>
              </div>
            </div>
            {pendingQueue[0].summary && (
              <p className="text-white/80 text-sm mb-4 leading-relaxed">{pendingQueue[0].summary}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => respondToConfirmation("reject")}
                className="px-4 py-2 rounded-lg bg-white/10 text-white/80 hover:bg-white/20 text-sm"
              >
                Annuler
              </button>
              <button
                onClick={() => respondToConfirmation("approve")}
                className="px-4 py-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm font-medium hover:opacity-90"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
