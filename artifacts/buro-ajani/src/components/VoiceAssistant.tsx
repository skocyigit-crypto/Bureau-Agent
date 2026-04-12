import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, X, Volume2, MessageCircle, HelpCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const WAKE_WORD = "hey bureau";

const ROUTE_MAP: Record<string, string> = {
  "/dashboard": "/",
  "/calls": "/appels",
  "/contacts": "/contacts",
  "/tasks": "/taches",
  "/messages": "/messages",
  "/analytics": "/analyse",
  "/calendar": "/calendrier",
  "/prospects": "/prospects",
  "/projects": "/projets",
  "/invoices": "/comptes-clients",
  "/stock": "/stock",
};

interface VoiceResult {
  success: boolean;
  intent: string;
  spoken: string;
  data?: any;
  action?: string;
  navigate?: string;
}

type VoiceState = "idle" | "listening_wake" | "listening_command" | "processing" | "speaking";

export function VoiceAssistant() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [commands, setCommands] = useState<{ phrase: string; description: string }[]>([]);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const wakeListenerRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  useEffect(() => {
    fetch(`${BASE}/api/voice/commands`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.commands) setCommands(d.commands); })
      .catch(() => {});
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "fr-FR";
    utter.rate = 1.05;
    utter.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find(v => v.lang.startsWith("fr")) || voices[0];
    if (frVoice) utter.voice = frVoice;
    utter.onend = () => {
      setState("idle");
      startWakeWordListener();
    };
    synthRef.current = utter;
    setState("speaking");
    window.speechSynthesis.speak(utter);
  }, []);

  const processCommand = useCallback(async (text: string) => {
    setState("processing");
    setTranscript(text);
    try {
      const res = await fetch(`${BASE}/api/voice/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data: VoiceResult = await res.json();
        setResponse(data.spoken);
        speak(data.spoken);
        if (data.navigate) {
          const mappedRoute = ROUTE_MAP[data.navigate] || data.navigate;
          setTimeout(() => {
            window.location.hash = "";
            window.location.pathname = BASE + mappedRoute;
          }, 2000);
        }
        if (data.action === "initiate_call" && data.data?.contact?.phone) {
          setTimeout(() => window.open(`tel:${data.data.contact.phone}`), 2500);
        }
      } else {
        const errText = "Erreur de communication avec le serveur.";
        setResponse(errText);
        speak(errText);
      }
    } catch {
      const errText = "Erreur de connexion. Verifiez votre reseau.";
      setResponse(errText);
      speak(errText);
    }
  }, [speak]);

  const startCommandListener = useCallback(() => {
    if (!SpeechRecognition) return;
    stopAllListeners();

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(final || interim);
      if (final) {
        recognition.stop();
        processCommand(final);
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError("Erreur micro: " + e.error);
      }
      setState("idle");
      startWakeWordListener();
    };

    recognition.onend = () => {
      if (state === "listening_command") {
        setState("idle");
        startWakeWordListener();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      isListeningRef.current = true;
      setState("listening_command");
      setTranscript("");
      setResponse("");
      setError("");
    } catch (e) {
      setError("Impossible d'activer le micro.");
      isListeningRef.current = false;
    }
  }, [SpeechRecognition, processCommand]);

  const startWakeWordListener = useCallback(() => {
    if (!SpeechRecognition || isListeningRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        if (text.includes(WAKE_WORD) || text.includes("hey bureau") || text.includes("hé bureau") || text.includes("hey buro")) {
          recognition.stop();
          isListeningRef.current = false;
          setExpanded(true);
          const audio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAB/f39/");
          audio.play().catch(() => {});
          speak("Je vous ecoute");
          setTimeout(() => startCommandListener(), 1500);
          return;
        }
      }
    };

    recognition.onerror = (e: any) => {
      isListeningRef.current = false;
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setTimeout(() => startWakeWordListener(), 3000);
      }
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      if (state === "listening_wake" || state === "idle") {
        setTimeout(() => startWakeWordListener(), 500);
      }
    };

    wakeListenerRef.current = recognition;
    try {
      recognition.start();
      isListeningRef.current = true;
      setState("listening_wake");
    } catch {
      isListeningRef.current = false;
    }
  }, [SpeechRecognition, startCommandListener, speak]);

  function stopAllListeners() {
    try { recognitionRef.current?.stop(); } catch {}
    try { wakeListenerRef.current?.stop(); } catch {}
    isListeningRef.current = false;
    window.speechSynthesis?.cancel();
  }

  function toggleVoice() {
    if (state === "idle" || state === "listening_wake") {
      setExpanded(true);
      stopAllListeners();
      startCommandListener();
    } else if (state === "listening_command") {
      stopAllListeners();
      setState("idle");
      startWakeWordListener();
    } else if (state === "speaking") {
      window.speechSynthesis.cancel();
      setState("idle");
      startWakeWordListener();
    }
  }

  function startWakeMode() {
    stopAllListeners();
    setExpanded(false);
    startWakeWordListener();
  }

  function closeAssistant() {
    stopAllListeners();
    setState("idle");
    setExpanded(false);
    setTranscript("");
    setResponse("");
    setError("");
  }

  useEffect(() => {
    return () => { stopAllListeners(); };
  }, []);

  if (!supported) return null;

  const stateColors: Record<VoiceState, string> = {
    idle: "bg-slate-600",
    listening_wake: "bg-amber-500/80",
    listening_command: "bg-red-500",
    processing: "bg-blue-500",
    speaking: "bg-green-500",
  };

  const stateLabels: Record<VoiceState, string> = {
    idle: "Inactif",
    listening_wake: 'Dites "Hey Bureau"',
    listening_command: "Je vous ecoute...",
    processing: "Traitement...",
    speaking: "Reponse...",
  };

  return (
    <>
      {!expanded ? (
        <button
          onClick={toggleVoice}
          className={`fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 ${stateColors[state]} ${state === "listening_wake" ? "animate-pulse" : ""}`}
          title={stateLabels[state]}
        >
          {state === "listening_wake" ? (
            <Mic className="w-6 h-6 text-white" />
          ) : state === "listening_command" ? (
            <Mic className="w-6 h-6 text-white animate-pulse" />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
          {state === "listening_wake" && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full animate-ping" />
          )}
        </button>
      ) : (
        <div className="fixed bottom-6 left-6 z-50 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${state === "listening_command" ? "bg-red-500 animate-pulse" : state === "processing" ? "bg-blue-400 animate-pulse" : state === "speaking" ? "bg-green-400" : "bg-amber-400"}`} />
              <span className="text-sm font-semibold text-white">Assistant Vocal</span>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => setShowHelp(!showHelp)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                <HelpCircle className="w-4 h-4" />
              </button>
              <button onClick={closeAssistant} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {showHelp ? (
            <div className="p-3 max-h-64 overflow-y-auto">
              <p className="text-xs text-slate-400 mb-2">Commandes disponibles:</p>
              {commands.map((c, i) => (
                <div key={i} className="flex justify-between items-start py-1.5 border-b border-slate-800 last:border-0">
                  <span className="text-xs text-amber-400 font-medium">"{c.phrase}"</span>
                  <span className="text-xs text-slate-500 ml-2 text-right">{c.description}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <div className="text-center mb-3">
                <p className="text-xs text-slate-400">{stateLabels[state]}</p>
              </div>

              {transcript && (
                <div className="bg-slate-800 rounded-lg p-3 mb-3">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-white">{transcript}</p>
                  </div>
                </div>
              )}

              {response && (
                <div className="bg-blue-900/30 border border-blue-800/50 rounded-lg p-3 mb-3">
                  <div className="flex items-start gap-2">
                    <Volume2 className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-blue-200">{response}</p>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-400 text-center mb-3">{error}</p>
              )}

              <div className="flex justify-center gap-3">
                <button
                  onClick={toggleVoice}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                    state === "listening_command"
                      ? "bg-red-500 hover:bg-red-600 animate-pulse"
                      : state === "processing"
                        ? "bg-blue-500 cursor-wait"
                        : "bg-amber-500 hover:bg-amber-600"
                  }`}
                >
                  {state === "listening_command" ? (
                    <MicOff className="w-6 h-6 text-white" />
                  ) : (
                    <Mic className="w-6 h-6 text-white" />
                  )}
                </button>

                {state === "idle" && (
                  <button
                    onClick={startWakeMode}
                    className="px-4 py-2 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium transition-colors"
                  >
                    Mode "Hey Bureau"
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
