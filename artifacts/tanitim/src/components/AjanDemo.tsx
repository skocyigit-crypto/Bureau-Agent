import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, Mic, MicOff, ArrowRight, Search, Zap, Bot, User, Loader2, X, Volume2, VolumeX, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TalkingAvatar, type SpeechLang, type TalkingAvatarHandle } from "@workspace/ai-avatar";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// In dev the API server runs on the same proxy host; in prod the marketing site
// sits behind the same domain as /api, so a relative path works in both modes.
const API_PREFIX = "/api";

type Msg = { role: "user" | "assistant"; text: string; timestamp: number };

const FALLBACK_PROMPTS = [
  "Quels appels aujourd'hui ?",
  "Mes taches urgentes ?",
  "Combien de chiffre d'affaires ce mois ?",
  "Resume ma semaine",
];

const GOOGLE_SAMPLES: { q: string; google: string[]; ajan: string }[] = [
  {
    q: "Quels appels aujourd'hui ?",
    google: [
      "agenda.google.com — Calendar",
      "wikipedia.org — Téléphonie",
      "comment savoir mes appels — Forum",
      "10 articles, 2.4M résultats…",
    ],
    ajan: "8 appels (6 entrants, 2 sortants), 2 manqués. 3 VIP — Jean Dupont 12'40, Marie Lambert 8'20. Voulez-vous rappeler Jean en priorité ?",
  },
  {
    q: "Mes tâches urgentes ?",
    google: [
      "todoist.com — Task management",
      "Comment gérer ses tâches — Blog",
      "asana.com / notion.com / monday.com",
      "Définition « urgent vs important »…",
    ],
    ajan: "3 tâches urgentes : Rappeler Jean Dupont avant 17h, Envoyer devis Beta SAS, Préparer réunion Iota vendredi. Je commence par laquelle ?",
  },
];

type SlimMsg = { r: string; t: string };

function slimHistory(history: Msg[]): SlimMsg[] {
  return history.slice(-6).map((m) => ({ r: m.role[0], t: m.text.slice(0, 400) }));
}

function encodeHandoff(history: Msg[]): string {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(slimHistory(history)))));
  } catch { return ""; }
}

// Durable fallback so the demo conversation survives the sign-up / login
// redirect even if the URL param is dropped along the way. tanitim and the app
// share an origin (path-based routing), so localStorage is visible to both.
// The consumer (commandant-ia) reads the URL param first, then this key, and
// clears it once consumed. Short TTL keeps it from leaking into later sessions.
const HANDOFF_KEY = "ajan.demo.handoff";
function persistHandoff(history: Msg[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ ts: Date.now(), msgs: slimHistory(history) }),
    );
  } catch { /* ignore */ }
}

// Durable, server-side handoff. The base64 URL param + localStorage above are
// instant but die after 30 min and never cross devices. We also POST the
// transcript to get a short-lived claim token; the app claims it on first login
// and can resume even days later / on another device. The token is stashed in
// localStorage (survives the sign-up redirect) and also placed on the URL.
const HANDOFF_TOKEN_KEY = "ajan.demo.token";
async function createServerHandoff(history: Msg[]): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${API_PREFIX}/public/demo-handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: slimHistory(history) }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    const token = typeof data?.token === "string" ? data.token : "";
    if (token) {
      try { window.localStorage.setItem(HANDOFF_TOKEN_KEY, JSON.stringify({ ts: Date.now(), token })); } catch { /* ignore */ }
    }
    return token;
  } catch {
    return "";
  }
}

const VOICE_PREF_KEY = "tanitim.demo.voice";
function readVoicePref(): { on: boolean; lang: SpeechLang } {
  if (typeof window === "undefined") return { on: true, lang: "fr" };
  try {
    const raw = window.localStorage.getItem(VOICE_PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { on?: boolean; lang?: string };
      return { on: typeof p.on === "boolean" ? p.on : true, lang: p.lang === "tr" ? "tr" : "fr" };
    }
  } catch { /* ignore */ }
  return { on: true, lang: "fr" };
}

export function AjanDemo() {
  const [open, setOpen] = useState(false); // mobile: open as sheet
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_PROMPTS);
  const [comparing, setComparing] = useState(true);
  const [activeSample, setActiveSample] = useState(0);
  const [recording, setRecording] = useState(false);
  const [voiceOn, setVoiceOn] = useState<boolean>(() => readVoicePref().on);
  const [voiceLang, setVoiceLang] = useState<SpeechLang>(() => readVoicePref().lang);
  const [spokenText, setSpokenText] = useState("");
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const avatarRef = useRef<TalkingAvatarHandle>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);

  const SpeechRecognition =
    typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;

  useEffect(() => {
    fetch(`${API_PREFIX}/public/demo-chat/suggestions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.suggestions) && d.suggestions.length) setSuggestions(d.suggestions); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, sending]);

  useEffect(() => {
    try { window.localStorage.setItem(VOICE_PREF_KEY, JSON.stringify({ on: voiceOn, lang: voiceLang })); } catch { /* ignore */ }
  }, [voiceOn, voiceLang]);

  // Auto-rotate the side-by-side comparison every 6 s when no conversation
  useEffect(() => {
    if (history.length > 0 || !comparing) return;
    const id = setInterval(() => setActiveSample((i) => (i + 1) % GOOGLE_SAMPLES.length), 6000);
    return () => clearInterval(id);
  }, [history.length, comparing]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const userMsg: Msg = { role: "user", text: trimmed, timestamp: Date.now() };
    setHistory((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setComparing(false);
    try {
      const res = await fetch(`${API_PREFIX}/public/demo-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: [...history, userMsg].map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const data = await res.json().catch(() => ({ reply: "" }));
      const reply = String(data?.reply || "Demo indisponible. Reessayez dans quelques instants.");
      setHistory((prev) => [...prev, { role: "assistant", text: reply, timestamp: Date.now() }]);
      if (voiceOn) setSpokenText(reply);
    } catch {
      setHistory((prev) => [...prev, {
        role: "assistant",
        text: "Erreur de connexion. Reessayez ou demarrez votre essai gratuit pour la version complete.",
        timestamp: Date.now(),
      }]);
    } finally {
      setSending(false);
      // Return keyboard focus to the input after a send (incl. suggestion-chip
      // and voice sends) so keyboard users can keep typing without re-tabbing.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [history, sending]);

  const startVoice = useCallback(() => {
    if (!SpeechRecognition) return;
    try {
      const rec = new SpeechRecognition();
      rec.lang = "fr-FR";
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (event: any) => {
        let final = "";
        let interim = "";
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) final += event.results[i][0].transcript;
          else interim += event.results[i][0].transcript;
        }
        const t = final || interim;
        setInput(t);
        if (final) {
          rec.stop();
          setRecording(false);
          send(final);
        }
      };
      rec.onend = () => setRecording(false);
      rec.onerror = () => setRecording(false);
      rec.start();
      recognitionRef.current = rec;
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }, [SpeechRecognition, send]);

  const stopVoice = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    setRecording(false);
  }, []);

  // Fallback href (no JS / right-click "open in new tab"): the instant base64
  // route. The onClick handler upgrades this to also carry a server token.
  const handoffUrl = (() => {
    const encoded = encodeHandoff(history);
    // Point straight at the in-app assistant (commandant-ia) which consumes the
    // handoff. When logged out, buro-ajani renders login/register in-place at the
    // same URL, so the ?demo= param survives sign-up.
    return encoded
      ? `/buro-ajani/commandant-ia?demo=${encodeURIComponent(encoded)}`
      : "/register";
  })();

  const goToApp = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    persistHandoff(history);
    const encoded = encodeHandoff(history);
    // Persist server-side and get a claim token so the conversation survives the
    // 30-min window and can resume on another device once claimed at login.
    const token = await createServerHandoff(history);
    const params = new URLSearchParams();
    if (encoded) params.set("demo", encoded);
    if (token) params.set("demo_token", token);
    const url = params.toString()
      ? `/buro-ajani/commandant-ia?${params.toString()}`
      : "/register";
    window.location.href = url;
  }, [history]);

  const sample = GOOGLE_SAMPLES[activeSample];

  return (
    <section
      id="demo-ajan"
      className="relative py-24 md:py-32 overflow-hidden bg-gradient-to-br from-[#0a1530] via-[#101e44] to-[#1a2744] text-white"
    >
      {/* Animated background accents */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-20 -left-20 w-[500px] h-[500px] rounded-full bg-amber-500/20 blur-3xl animate-pulse" />
        <div className="absolute top-1/2 -right-20 w-[400px] h-[400px] rounded-full bg-blue-500/20 blur-3xl animate-pulse" style={{ animationDelay: "1.5s" }} />
        <div className="absolute bottom-0 left-1/3 w-[300px] h-[300px] rounded-full bg-purple-500/20 blur-3xl animate-pulse" style={{ animationDelay: "3s" }} />
      </div>

      <div className="relative max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-2 mb-6"
          >
            <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            <span className="text-sm font-semibold text-amber-300 uppercase tracking-wider">Demo en direct</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl md:text-6xl font-black mb-4 tracking-tight"
          >
            Plus puissant que <span className="line-through text-white/30">Google</span>{" "}
            <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 bg-clip-text text-transparent">votre Agent</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg md:text-xl text-blue-100/80 max-w-3xl mx-auto"
          >
            Google donne des liens. Votre Agent connaît votre entreprise, prend les actions et vous fait gagner du temps.
            Posez une question — la démo répond avec un jeu de données réaliste.
          </motion.p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start">
          {/* CHAT — left/wide */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-3 relative"
          >
            {/* Animated gradient border */}
            <div className="absolute -inset-[2px] rounded-3xl bg-gradient-to-r from-amber-400 via-amber-500 to-amber-300 opacity-70 blur-sm animate-gradient-x" />
            <div className="relative bg-slate-900/80 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
              {/* Chat header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-gradient-to-r from-slate-900/80 to-slate-800/80">
                <div className="flex items-center gap-3">
                  <div className="relative w-11 h-11 rounded-xl overflow-hidden shadow-lg shadow-amber-500/30 ring-1 ring-amber-400/40">
                    <TalkingAvatar
                      ref={avatarRef}
                      text={voiceOn ? spokenText : ""}
                      lang={voiceLang}
                      autoPlay={voiceOn}
                      size={44}
                      palette={{ ring: "#f59e0b" }}
                      onStart={() => setAvatarSpeaking(true)}
                      onEnd={() => setAvatarSpeaking(false)}
                      onAvailability={({ supported, hasVoiceForLang }) => setVoiceUnavailable(supported && !hasVoiceForLang)}
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-slate-900 rounded-full animate-pulse" />
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">Agent de Bureau</p>
                    <p className="text-xs text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      En ligne · Demo
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex rounded-lg border border-white/10 overflow-hidden text-[11px] font-semibold">
                    <button
                      onClick={() => setVoiceLang("fr")}
                      className={`px-2 py-1 transition ${voiceLang === "fr" ? "bg-amber-400 text-slate-900" : "text-white/60 hover:bg-white/5"}`}
                    >FR</button>
                    <button
                      onClick={() => setVoiceLang("tr")}
                      className={`px-2 py-1 transition ${voiceLang === "tr" ? "bg-amber-400 text-slate-900" : "text-white/60 hover:bg-white/5"}`}
                    >TR</button>
                  </div>
                  <button
                    onClick={() => setVoiceOn((v) => !v)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/5 transition"
                    title={voiceOn ? "Couper la voix" : "Activer la voix"}
                  >
                    {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-white/40" />}
                  </button>
                  <button
                    onClick={() => {
                      if (avatarSpeaking) avatarRef.current?.stop();
                      else if (spokenText.trim()) avatarRef.current?.speak(spokenText, voiceLang);
                    }}
                    disabled={!voiceOn || (!avatarSpeaking && !spokenText.trim())}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/5 transition disabled:opacity-40 disabled:hover:bg-transparent"
                    title={avatarSpeaking ? "Arrêter" : "Réécouter la dernière réponse"}
                  >
                    {avatarSpeaking ? <Square className="w-3.5 h-3.5" /> : <RotateCcw className="w-4 h-4" />}
                  </button>
                  {history.length > 0 && (
                    <button
                      onClick={() => { setHistory([]); setComparing(true); setSpokenText(""); }}
                      className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition"
                    >
                      Reinitialiser
                    </button>
                  )}
                </div>
              </div>
              {voiceOn && voiceUnavailable && (
                <div className="px-5 py-1.5 text-[11px] text-amber-300/90 bg-amber-500/10 border-b border-amber-400/20">
                  Aucune voix {voiceLang === "fr" ? "française" : "turque"} sur cet appareil — l'avatar reste muet (rien n'est envoyé en ligne).
                </div>
              )}

              {/* Messages */}
              <div ref={scrollRef} role="log" aria-live="polite" aria-label="Conversation avec l'Agent de Bureau" className="h-[400px] md:h-[440px] overflow-y-auto px-5 py-6 space-y-4 scroll-smooth">
                {history.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <div className="relative w-20 h-20 mb-4">
                      <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
                      <div className="absolute inset-2 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/40">
                        <Sparkles className="w-8 h-8 text-slate-900" aria-hidden="true" />
                      </div>
                    </div>
                    <p className="text-white/90 font-semibold mb-2">Posez votre première question</p>
                    <p className="text-sm text-white/50 mb-5 max-w-sm">L'Agent répond avec un jeu de données réaliste de démo. Texte ou voix.</p>
                    <div className="flex flex-wrap justify-center gap-2 max-w-md">
                      {suggestions.slice(0, 4).map((s, i) => (
                        <button
                          key={i}
                          onClick={() => send(s)}
                          className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/80 hover:bg-amber-500/20 hover:border-amber-400/40 hover:text-amber-200 transition"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {history.map((m, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {m.role === "assistant" && (
                        <div className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md shadow-amber-500/20">
                          <Bot className="w-4 h-4 text-slate-900" aria-hidden="true" />
                        </div>
                      )}
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-md ${
                          m.role === "user"
                            ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-tr-sm"
                            : "bg-slate-800/80 backdrop-blur border border-white/10 text-white/95 rounded-tl-sm"
                        }`}
                      >
                        {m.text}
                      </div>
                      {m.role === "user" && (
                        <div className="w-8 h-8 shrink-0 rounded-lg bg-slate-700 flex items-center justify-center">
                          <User className="w-4 h-4 text-white/80" aria-hidden="true" />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {sending && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5 justify-start">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-slate-900" aria-hidden="true" />
                    </div>
                    <div className="bg-slate-800/80 backdrop-blur border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-white/10 bg-slate-950/60 backdrop-blur p-4">
                {history.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {suggestions.slice(0, 3).map((s, i) => (
                      <button
                        key={i}
                        onClick={() => send(s)}
                        disabled={sending}
                        className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-amber-500/15 hover:text-amber-200 hover:border-amber-400/40 transition disabled:opacity-40"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                    placeholder={recording ? "Ecoute en cours…" : "Posez votre question en français…"}
                    aria-label="Posez votre question à l'Agent de Bureau"
                    disabled={sending}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400/70 focus:border-amber-400/60 focus:bg-white/10 transition disabled:opacity-50"
                  />
                  {SpeechRecognition && (
                    <button
                      onClick={recording ? stopVoice : startVoice}
                      disabled={sending}
                      className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition ${
                        recording
                          ? "bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-500/40"
                          : "bg-white/5 border border-white/10 hover:bg-white/10 text-white/70"
                      }`}
                      title={recording ? "Arrêter" : "Parler"}
                      aria-label={recording ? "Arrêter la dictée vocale" : "Dicter votre question"}
                    >
                      {recording ? <MicOff className="w-5 h-5 text-white" aria-hidden="true" /> : <Mic className="w-5 h-5" aria-hidden="true" />}
                    </button>
                  )}
                  <button
                    onClick={() => send(input)}
                    disabled={sending || !input.trim()}
                    className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shadow-lg shadow-amber-500/30 transition"
                    title="Envoyer"
                    aria-label="Envoyer la question"
                  >
                    {sending ? <Loader2 className="w-5 h-5 text-slate-900 animate-spin" aria-hidden="true" /> : <Send className="w-5 h-5 text-slate-900" aria-hidden="true" />}
                  </button>
                </div>
                {history.length > 0 && (
                  <a
                    href={handoffUrl}
                    onClick={goToApp}
                    className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 hover:from-emerald-500/30 hover:to-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-sm font-medium transition group"
                  >
                    Continuer cette conversation dans l'app
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </motion.div>

          {/* COMPARISON — right */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="lg:col-span-2 space-y-4"
          >
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/5">
                <div className="w-7 h-7 rounded bg-white flex items-center justify-center text-xs font-bold text-slate-700">G</div>
                <span className="text-sm font-semibold text-white/80">Google</span>
                <span className="ml-auto text-[10px] text-white/40">Recherche</span>
              </div>
              <div className="p-4">
                <div className="bg-white rounded-lg px-3 py-2 mb-3 flex items-center gap-2 text-xs text-slate-700 shadow-sm">
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate flex-1">{sample.q}</span>
                </div>
                <div className="space-y-2">
                  {sample.google.map((g, i) => (
                    <div key={i} className="text-xs text-blue-200/80 hover:text-blue-300 truncate cursor-pointer">
                      <span className="text-emerald-400/70 mr-1">•</span>{g}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-white/40 mt-3 italic">À vous de trier, lire et agir.</p>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-amber-400 to-amber-600 opacity-50 blur-sm" />
              <div className="relative bg-gradient-to-br from-slate-900 to-slate-800 border border-amber-400/40 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-amber-500/10">
                  <div className="w-7 h-7 rounded bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-slate-900" />
                  </div>
                  <span className="text-sm font-semibold text-white">Agent de Bureau</span>
                  <span className="ml-auto text-[10px] text-amber-300 flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Action directe
                  </span>
                </div>
                <div className="p-4">
                  <div className="bg-blue-500/20 border border-blue-400/30 rounded-lg px-3 py-2 mb-3 text-xs text-white/90">
                    {sample.q}
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeSample}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm text-white/95 leading-relaxed"
                    >
                      {sample.ajan}
                    </motion.div>
                  </AnimatePresence>
                  <p className="text-[10px] text-amber-300/80 mt-3 italic flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Réponse contextuelle + action proposée.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-1.5">
              {GOOGLE_SAMPLES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveSample(i)}
                  className={`h-1.5 rounded-full transition-all ${i === activeSample ? "bg-amber-400 w-8" : "bg-white/20 w-1.5"}`}
                  aria-label={`Exemple ${i + 1}`}
                />
              ))}
            </div>

            <a
              href="/register"
              className="block text-center px-6 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-900 font-bold shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:scale-[1.02] transition-all"
            >
              Créer mon compte gratuit (14 j)
              <ArrowRight className="inline w-4 h-4 ml-2" />
            </a>
          </motion.div>
        </div>
      </div>

      <style>{`
        @keyframes gradient-x {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient-x {
          background-size: 200% 200%;
          animation: gradient-x 4s ease infinite;
        }
      `}</style>
    </section>
  );
}
