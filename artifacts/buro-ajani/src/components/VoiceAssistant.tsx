import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, X, Volume2, MessageCircle, HelpCircle, Radio } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const WAKE_WORD_VARIANTS = ["hey bureau", "hé bureau", "hey buro", "hé buro", "hey burreau", "eh bureau"];

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
  const [history, setHistory] = useState<{ type: "user" | "assistant"; text: string }[]>([]);
  const recognitionRef = useRef<any>(null);
  const wakeListenerRef = useRef<any>(null);
  const stateRef = useRef<VoiceState>("idle");
  const wakeActiveRef = useRef(false);

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
      if (wakeActiveRef.current) {
        startWakeWordListener();
      }
    };
    setState("speaking");
    window.speechSynthesis.speak(utter);
  }, []);

  const processCommand = useCallback(async (text: string) => {
    setState("processing");
    setTranscript(text);
    setHistory(prev => [...prev, { type: "user", text }]);
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
        setHistory(prev => [...prev, { type: "assistant", text: data.spoken }]);
        speak(data.spoken);
        if (data.navigate) {
          setTimeout(() => {
            window.location.pathname = BASE + data.navigate;
          }, 2500);
        }
        if (data.action === "initiate_call" && data.data?.contact?.phone) {
          setTimeout(() => window.open(`tel:${data.data.contact.phone}`), 3000);
        }
      } else {
        const errText = "Erreur de communication avec le serveur.";
        setResponse(errText);
        setHistory(prev => [...prev, { type: "assistant", text: errText }]);
        speak(errText);
      }
    } catch {
      const errText = "Erreur de connexion. Verifiez votre reseau.";
      setResponse(errText);
      setHistory(prev => [...prev, { type: "assistant", text: errText }]);
      speak(errText);
    }
  }, [speak]);

  const stopAllListeners = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    try { wakeListenerRef.current?.stop(); } catch {}
    window.speechSynthesis?.cancel();
  }, []);

  const startCommandListener = useCallback(() => {
    if (!SpeechRecognition) return;
    stopAllListeners();

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

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
      if (wakeActiveRef.current) startWakeWordListener();
    };

    recognition.onend = () => {
      if (stateRef.current === "listening_command") {
        setState("idle");
        if (wakeActiveRef.current) startWakeWordListener();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setState("listening_command");
      setTranscript("");
      setResponse("");
      setError("");
    } catch {
      setError("Impossible d'activer le micro.");
    }
  }, [SpeechRecognition, processCommand, stopAllListeners]);

  const startWakeWordListener = useCallback(() => {
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        const detected = WAKE_WORD_VARIANTS.some(w => text.includes(w));
        if (detected) {
          recognition.stop();
          setExpanded(true);
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.value = 0.15;
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
            setTimeout(() => { osc.frequency.value = 1320; }, 60);
          } catch {}
          speak("Je vous ecoute");
          setTimeout(() => startCommandListener(), 1200);
          return;
        }
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setTimeout(() => {
          if (wakeActiveRef.current) startWakeWordListener();
        }, 3000);
      }
    };

    recognition.onend = () => {
      if (wakeActiveRef.current && stateRef.current !== "listening_command" && stateRef.current !== "processing" && stateRef.current !== "speaking") {
        setTimeout(() => {
          if (wakeActiveRef.current) startWakeWordListener();
        }, 500);
      }
    };

    wakeListenerRef.current = recognition;
    try {
      recognition.start();
      setState("listening_wake");
    } catch {}
  }, [SpeechRecognition, startCommandListener, speak]);

  function toggleVoice() {
    if (state === "idle" || state === "listening_wake") {
      setExpanded(true);
      stopAllListeners();
      startCommandListener();
    } else if (state === "listening_command") {
      stopAllListeners();
      setState("idle");
      if (wakeActiveRef.current) startWakeWordListener();
    } else if (state === "speaking") {
      window.speechSynthesis.cancel();
      setState("idle");
      if (wakeActiveRef.current) startWakeWordListener();
    }
  }

  function toggleWakeMode() {
    if (wakeActiveRef.current) {
      wakeActiveRef.current = false;
      stopAllListeners();
      setState("idle");
    } else {
      wakeActiveRef.current = true;
      stopAllListeners();
      startWakeWordListener();
    }
  }

  function closeAssistant() {
    stopAllListeners();
    wakeActiveRef.current = false;
    setState("idle");
    setExpanded(false);
    setTranscript("");
    setResponse("");
    setError("");
  }

  useEffect(() => {
    return () => {
      stopAllListeners();
      wakeActiveRef.current = false;
    };
  }, [stopAllListeners]);

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
    listening_wake: '"Hey Bureau" actif',
    listening_command: "Je vous ecoute...",
    processing: "Traitement IA...",
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
          <Mic className="w-6 h-6 text-white" />
          {state === "listening_wake" && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full animate-ping" />
          )}
        </button>
      ) : (
        <div className="fixed bottom-6 left-6 z-50 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${state === "listening_command" ? "bg-red-500 animate-pulse" : state === "processing" ? "bg-blue-400 animate-pulse" : state === "speaking" ? "bg-green-400" : state === "listening_wake" ? "bg-amber-400 animate-pulse" : "bg-slate-500"}`} />
              <span className="text-sm font-semibold text-white">Assistant Vocal IA</span>
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
              <p className="text-xs text-blue-400 mt-3 italic">L'IA comprend aussi les phrases naturelles en francais.</p>
            </div>
          ) : (
            <div className="p-4">
              <div className="text-center mb-3">
                <p className="text-xs text-slate-400">{stateLabels[state]}</p>
              </div>

              {history.length > 0 && (
                <div className="max-h-40 overflow-y-auto mb-3 space-y-2">
                  {history.slice(-4).map((h, i) => (
                    <div key={i} className={`rounded-lg p-2.5 ${h.type === "user" ? "bg-slate-800 ml-6" : "bg-blue-900/30 border border-blue-800/50 mr-6"}`}>
                      <div className="flex items-start gap-2">
                        {h.type === "user" ? (
                          <MessageCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                        )}
                        <p className={`text-xs ${h.type === "user" ? "text-white" : "text-blue-200"}`}>{h.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {transcript && state === "listening_command" && (
                <div className="bg-slate-800 rounded-lg p-3 mb-3">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0 animate-pulse" />
                    <p className="text-sm text-white italic">{transcript}...</p>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-400 text-center mb-3">{error}</p>
              )}

              <div className="flex justify-center items-center gap-3">
                <button
                  onClick={toggleWakeMode}
                  className={`px-3 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                    wakeActiveRef.current
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/50"
                      : "bg-slate-700 hover:bg-slate-600 text-slate-400"
                  }`}
                  title={wakeActiveRef.current ? 'Desactiver "Hey Bureau"' : 'Activer "Hey Bureau"'}
                >
                  <Radio className="w-3.5 h-3.5" />
                  Hey Bureau
                </button>

                <button
                  onClick={toggleVoice}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                    state === "listening_command"
                      ? "bg-red-500 hover:bg-red-600 animate-pulse"
                      : state === "processing"
                        ? "bg-blue-500 cursor-wait"
                        : state === "speaking"
                          ? "bg-green-500"
                          : "bg-amber-500 hover:bg-amber-600"
                  }`}
                >
                  {state === "listening_command" ? (
                    <MicOff className="w-6 h-6 text-white" />
                  ) : state === "processing" ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Mic className="w-6 h-6 text-white" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
