import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

// ───────────────────────── i18n / langues ────────────────────────────────────
type Lang = "fr" | "tr" | "en";
const SUPPORTED_LANGS: Lang[] = ["fr", "tr", "en"];
const LANG_KEY = "buro.voiceLang";
const MODE_KEY = "buro.voiceMode";
const DEEP_KEY = "buro.voiceDeep";
const WAKE_KEY = "buro.voiceWake";

type AssistMode = "command" | "chat";
const CHAT_HISTORY_SEND_LIMIT = 10;

const STT_LOCALE: Record<Lang, string> = { fr: "fr-FR", tr: "tr-TR", en: "en-US" };
const SPEECH_LOCALE: Record<Lang, string> = { fr: "fr-FR", tr: "tr-TR", en: "en-US" };

const WAKE_WORDS: Record<Lang, string[]> = {
  fr: ["hey bureau", "he bureau", "hey buro", "he buro"],
  tr: ["hey buro", "ey buro", "hey burro"],
  en: ["hey bureau", "hey buro", "hey burrow"],
};

const T: Record<string, Record<Lang, string>> = {
  title:        { fr: "Assistant Vocal IA",        tr: "Sesli Yapay Zeka Asistani", en: "AI Voice Assistant" },
  state_idle:   { fr: "Appuyez pour parler",       tr: "Konusmak icin basin",       en: "Tap to speak" },
  state_wake:   { fr: 'Dites "Hey Bureau"...',     tr: '"Hey Buro" deyin...',       en: 'Say "Hey Bureau"...' },
  state_listen: { fr: "Je vous ecoute...",         tr: "Sizi dinliyorum...",        en: "Listening..." },
  state_proc:   { fr: "IA en cours...",            tr: "YZ isliyor...",             en: "AI processing..." },
  state_speak:  { fr: "Reponse vocale...",         tr: "Sesli yanit...",            en: "Speaking..." },
  hello:        { fr: "Bonjour",                   tr: "Merhaba",                   en: "Hello" },
  hello_hint:   {
    fr: "Appuyez sur le micro ou choisissez une commande rapide.",
    tr: "Mikrofona basin veya bir hizli komut secin.",
    en: "Tap the mic or pick a quick command.",
  },
  hello_hint_chat: {
    fr: "Posez-moi n'importe quelle question sur votre activite.",
    tr: "Isinizle ilgili her seyi sorabilirsiniz.",
    en: "Ask me anything about your business.",
  },
  wake_on:      { fr: '"Hey Bureau" actif',        tr: '"Hey Buro" aktif',          en: '"Hey Bureau" on' },
  wake_off:     { fr: 'Activer "Hey Bureau"',      tr: '"Hey Buro" yu ac',          en: 'Enable "Hey Bureau"' },
  mode_command: { fr: "Commande",                  tr: "Komut",                     en: "Command" },
  mode_chat:    { fr: "Sohbet",                    tr: "Sohbet",                    en: "Chat" },
  deep_on:      { fr: "Reflexion profonde ON",     tr: "Derin dusunce ACIK",        en: "Deep thinking ON" },
  deep_off:     { fr: "Reflexion profonde (Pro)",  tr: "Derin dusunce (Pro)",       en: "Deep thinking (Pro)" },
  library:      { fr: "Bibliotheque",              tr: "Kutuphane",                 en: "Library" },
  send:         { fr: "Envoyer",                   tr: "Gonder",                    en: "Send" },
  clear:        { fr: "Effacer",                   tr: "Temizle",                   en: "Clear" },
  chat_ph:      { fr: "Posez votre question...",   tr: "Sorunuzu yazin...",         en: "Ask your question..." },
  cmd_ph:       { fr: "Tapez une commande...",     tr: "Bir komut yazin...",        en: "Type a command..." },
  err_proc:     { fr: "Erreur de traitement. Reessayez.", tr: "Isleme hatasi. Tekrar deneyin.", en: "Processing error. Retry." },
  err_net:      { fr: "Erreur reseau.",            tr: "Ag hatasi.",                en: "Network error." },
  stt_unavail:  {
    fr: "Reconnaissance vocale disponible sur Chrome. Sur mobile natif, utilisez le clavier ou les commandes rapides.",
    tr: "Sesli komut Chrome'da kullanilabilir. Mobil cihazlarda klavye veya hizli komutlar kullanin.",
    en: "Voice recognition available on Chrome. On native mobile, use the keyboard or quick commands.",
  },
};
const tr = (k: keyof typeof T, l: Lang) => T[k]?.[l] ?? T[k]?.fr ?? String(k);

// ───────────────────────── Bibliotheque d'actions ────────────────────────────
type LibCategory = { title: string; items: { label: string; text: string }[] };
const LIBRARY: Record<Lang, LibCategory[]> = {
  fr: [
    { title: "Travail quotidien", items: [
      { label: "Briefing", text: "Briefing du jour" },
      { label: "Taches urgentes", text: "Taches urgentes" },
      { label: "Agenda", text: "Agenda du jour" },
      { label: "Appels", text: "Derniers appels" },
      { label: "Performance", text: "Performance" },
      { label: "En attente", text: "Combien de taches en attente" },
    ]},
    { title: "Gestion", items: [
      { label: "Projets actifs", text: "Combien de projets actifs" },
      { label: "Projets en retard", text: "Projets en retard" },
      { label: "Contacts", text: "Combien de contacts" },
      { label: "Creer tache", text: "Cree une tache pour" },
      { label: "Ajouter contact", text: "Ajoute un nouveau contact" },
    ]},
    { title: "Idees & strategie", items: [
      { label: "Augmenter ventes", text: "Donne moi 3 idees concretes pour augmenter mes ventes ce mois-ci" },
      { label: "Fideliser", text: "Comment mieux fideliser mes clients ?" },
      { label: "Analyser perf", text: "Analyse ma performance recente et propose 2 axes d'amelioration" },
      { label: "Hausse prix", text: "Comment annoncer une hausse de prix sans perdre de clients ?" },
      { label: "Reseaux sociaux", text: "Propose 3 idees de posts pour cette semaine" },
    ]},
    { title: "Equipe & RH", items: [
      { label: "Recrutement", text: "Quelles questions poser en entretien pour ce poste ?" },
      { label: "Motiver equipe", text: "Comment motiver mon equipe sans augmenter les salaires ?" },
      { label: "Email pro", text: "Redige un email professionnel pour" },
      { label: "Delegation", text: "Sur quoi devrais-je deleguer en priorite ?" },
    ]},
  ],
  tr: [
    { title: "Gunluk is", items: [
      { label: "Gunluk ozet", text: "Gunluk ozet" },
      { label: "Acil gorevler", text: "Acil gorevler" },
      { label: "Takvim", text: "Bugunku takvim" },
      { label: "Aramalar", text: "Son aramalar" },
      { label: "Performans", text: "Performans" },
      { label: "Bekleyenler", text: "Bekleyen gorevler" },
    ]},
    { title: "Yonetim", items: [
      { label: "Aktif projeler", text: "Kac aktif proje var" },
      { label: "Gecikmis", text: "Gecikmis projeler" },
      { label: "Toplam kisi", text: "Kac kisi var" },
      { label: "Gorev olustur", text: "Yeni bir gorev olustur" },
      { label: "Kisi ekle", text: "Yeni bir kisi ekle" },
    ]},
    { title: "Fikir & strateji", items: [
      { label: "Satislari artir", text: "Bu ay satislarimi artirmak icin 3 somut fikir ver" },
      { label: "Sadakat", text: "Mevcut musterilerimi nasil daha iyi tutarim?" },
      { label: "Performans", text: "Son performansimi analiz et ve 2 gelistirme onerisi ver" },
      { label: "Fiyat artisi", text: "Musteri kaybetmeden fiyat artisini nasil duyururum?" },
      { label: "Sosyal medya", text: "Bu hafta icin 3 sosyal medya gonderisi fikri ver" },
    ]},
    { title: "Ekip & IK", items: [
      { label: "Ise alim", text: "Bu pozisyon icin mulakatta hangi sorulari sormaliyim?" },
      { label: "Motivasyon", text: "Maas artirmadan ekibimi nasil motive ederim?" },
      { label: "Email", text: "Su konuda profesyonel bir email yaz:" },
      { label: "Delegasyon", text: "Onceliklendirerek neyi delege etmeliyim?" },
    ]},
  ],
  en: [
    { title: "Daily work", items: [
      { label: "Briefing", text: "Daily briefing" },
      { label: "Urgent tasks", text: "Urgent tasks" },
      { label: "Calendar", text: "Today's calendar" },
      { label: "Calls", text: "Recent calls" },
      { label: "Performance", text: "Performance" },
      { label: "Pending", text: "Pending tasks" },
    ]},
    { title: "Management", items: [
      { label: "Active projects", text: "How many active projects" },
      { label: "Overdue", text: "Overdue projects" },
      { label: "Contacts", text: "How many contacts" },
      { label: "Create task", text: "Create a new task" },
      { label: "Add contact", text: "Add a new contact" },
    ]},
    { title: "Ideas & strategy", items: [
      { label: "Boost sales", text: "Give me 3 concrete ideas to boost my sales this month" },
      { label: "Retention", text: "How can I better retain my existing customers?" },
      { label: "Analyze perf", text: "Analyze my recent performance and suggest 2 improvements" },
      { label: "Price hike", text: "How do I announce a price increase without losing clients?" },
      { label: "Social", text: "Give me 3 social media post ideas for this week" },
    ]},
    { title: "Team & HR", items: [
      { label: "Hiring", text: "What questions should I ask in an interview for this role?" },
      { label: "Motivate", text: "How can I motivate my team without raising salaries?" },
      { label: "Pro email", text: "Write a professional email about:" },
      { label: "Delegation", text: "What should I prioritize delegating?" },
    ]},
  ],
};

// ───────────────────────── Types ─────────────────────────────────────────────
type VoiceState = "idle" | "listening_wake" | "listening" | "processing" | "speaking";

interface Message {
  id: string;
  type: "user" | "assistant" | "system";
  text: string;
  timestamp: Date;
}

interface CommandInfo { phrase: string; description: string; }

const MOBILE_ROUTE_MAP: Record<string, string> = {
  "/": "/(tabs)",
  "/appels": "/(tabs)/calls",
  "/contacts": "/(tabs)/contacts",
  "/taches": "/(tabs)/tasks",
  "/calendrier": "/calendar",
  "/analyse": "/analytics",
  "/messages": "/messages",
  "/projets": "/projets",
};

// ───────────────────────── Animations utilitaires ────────────────────────────
function AnimatedWaveBar({ color, active, minH, maxH, duration, delay }: {
  color: string; active: boolean; minH: number; maxH: number; duration: number; delay: number;
}) {
  const anim = useRef(new Animated.Value(minH)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: maxH, duration, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(anim, { toValue: minH, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ])
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      Animated.timing(anim, { toValue: 4, duration: 200, useNativeDriver: false }).start();
    }
    return () => { loopRef.current?.stop(); };
  }, [active]);

  return (
    <Animated.View style={{ width: 5, borderRadius: 3, backgroundColor: color, height: anim, alignSelf: "center" }} />
  );
}

function PulseRing({ color, active }: { color: string; active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(scale,   { toValue: 1.6,  duration: 1000, useNativeDriver: true }),
            Animated.timing(scale,   { toValue: 1,    duration: 0,    useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.35, duration: 200,  useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0,    duration: 800,  useNativeDriver: true }),
          ]),
        ])
      ).start();
    } else {
      scale.setValue(1); opacity.setValue(0);
    }
  }, [active]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, {
        borderRadius: 50, backgroundColor: color,
        transform: [{ scale }], opacity,
      }]}
    />
  );
}

// ───────────────────────── Composant principal ───────────────────────────────
export default function VoiceAssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [panel, setPanel] = useState<"chat" | "commands" | "library">("chat");
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [lang, setLang] = useState<Lang>("fr");
  const [mode, setMode] = useState<AssistMode>("command");
  const [deep, setDeep] = useState(false);
  const [textInput, setTextInput] = useState("");

  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const wakeActiveRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");
  // Refs miroirs pour les closures STT/Speech (langue/mode peuvent changer
  // pendant l'ecoute).
  const langRef = useRef<Lang>("fr");
  const modeRef = useRef<AssistMode>("command");
  const deepRef = useRef<boolean>(false);
  const messagesRef = useRef<Message[]>([]);
  const prefsLoadedRef = useRef(false);

  const SpeechRecognitionClass = isWeb
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { deepRef.current = deep; }, [deep]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Charge les preferences persistees (langue, mode, deep, wake) au mount.
  useEffect(() => {
    (async () => {
      try {
        const [[, sLang], [, sMode], [, sDeep], [, sWake]] = await AsyncStorage.multiGet([
          LANG_KEY, MODE_KEY, DEEP_KEY, WAKE_KEY,
        ]);
        if (sLang === "fr" || sLang === "tr" || sLang === "en") setLang(sLang);
        if (sMode === "command" || sMode === "chat") setMode(sMode);
        if (sDeep === "1") setDeep(true);
        // Wake par defaut OFF sur mobile (consomme batterie + souvent inutile
        // car native n'a pas STT). L'utilisateur peut l'activer.
        if (sWake === "1") {
          wakeActiveRef.current = true;
          setWakeWordActive(true);
        }
      } catch {}
      prefsLoadedRef.current = true;
    })();
  }, []);

  // Persiste les changements de preferences (sauf au tout premier load).
  useEffect(() => { if (prefsLoadedRef.current) AsyncStorage.setItem(LANG_KEY, lang).catch(() => {}); }, [lang]);
  useEffect(() => { if (prefsLoadedRef.current) AsyncStorage.setItem(MODE_KEY, mode).catch(() => {}); }, [mode]);
  useEffect(() => { if (prefsLoadedRef.current) AsyncStorage.setItem(DEEP_KEY, deep ? "1" : "0").catch(() => {}); }, [deep]);

  // Recharge la liste de commandes a chaque changement de langue.
  useEffect(() => {
    fetchAuth(`${API_BASE}/api/voice/commands?lang=${lang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.commands) setCommands(d.commands); })
      .catch(() => {});
  }, [lang]);

  // Message d'accueil — re-render quand la langue change pour suivre l'UI.
  useEffect(() => {
    setMessages((prev) => {
      const greeting: Message = {
        id: `greet-${lang}`,
        type: "system",
        text: `${tr("hello", lang)} ${user?.prenom || ""}! ${mode === "chat" ? tr("hello_hint_chat", lang) : tr("hello_hint", lang)}`,
        timestamp: new Date(),
      };
      const filtered = prev.filter((m) => !m.id.startsWith("greet-"));
      return [greeting, ...filtered];
    });
  }, [lang, mode, user?.prenom]);

  function addMessage(type: "user" | "assistant" | "system", text: string) {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, type, text, timestamp: new Date() }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const speak = useCallback((text: string) => {
    setVoiceState("speaking");
    const curLang = langRef.current;
    const locale = SPEECH_LOCALE[curLang];
    if (isWeb && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = locale;
      utter.rate = 1.05;
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((vv: SpeechSynthesisVoice) => vv.lang.startsWith(curLang));
      if (v) utter.voice = v;
      utter.onend = () => {
        setVoiceState(wakeActiveRef.current ? "listening_wake" : "idle");
        if (wakeActiveRef.current) startWakeWordListener();
      };
      window.speechSynthesis.speak(utter);
    } else {
      Speech.speak(text, {
        language: locale,
        rate: 1.0,
        onDone: () => {
          setVoiceState(wakeActiveRef.current ? "listening_wake" : "idle");
          if (wakeActiveRef.current) startWakeWordListener();
        },
      });
    }
  }, [isWeb]);

  const processCommand = useCallback(async (text: string) => {
    setVoiceState("processing");
    setTranscript("");
    addMessage("user", text);
    const curLang = langRef.current;
    const curMode = modeRef.current;
    const endpoint = curMode === "chat" ? "/api/voice/chat" : "/api/voice/command";
    const payload: Record<string, unknown> = { text, language: curLang };
    if (curMode === "chat") {
      payload.history = messagesRef.current
        .filter((m) => m.type === "user" || m.type === "assistant")
        .slice(-CHAT_HISTORY_SEND_LIMIT)
        .map((m) => ({ role: m.type as "user" | "assistant", text: m.text }));
      payload.deep = deepRef.current;
    }
    try {
      const res = await fetchAuth(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Voice-Lang": curLang },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const spoken = data.spoken || tr("err_proc", curLang);
        addMessage("assistant", spoken);
        speak(spoken);
        if (curMode === "command" && data.navigate) {
          setTimeout(() => {
            const target = MOBILE_ROUTE_MAP[data.navigate] || data.navigate;
            router.push(target as any);
          }, 3000);
        }
      } else {
        const msg = tr("err_proc", curLang);
        addMessage("assistant", msg);
        speak(msg);
      }
    } catch {
      const msg = tr("err_net", curLang);
      addMessage("assistant", msg);
      speak(msg);
    }
  }, [fetchAuth, speak]);

  function stopListeners() {
    try { recognitionRef.current?.stop(); } catch {}
    if (isWeb) { try { (window as any).speechSynthesis?.cancel(); } catch {} }
    else { Speech.stop(); }
  }

  function startCommandListener() {
    if (!isWeb || !SpeechRecognitionClass) {
      addMessage("system", tr("stt_unavail", langRef.current));
      return;
    }
    stopListeners();
    const recognition = new SpeechRecognitionClass();
    recognition.lang = STT_LOCALE[langRef.current];
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.onresult = (event: any) => {
      let final = "", interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      setTranscript(final || interim);
      if (final) { recognition.stop(); processCommand(final); }
    };
    recognition.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") addMessage("system", "Mic: " + e.error);
      setVoiceState(wakeActiveRef.current ? "listening_wake" : "idle");
      if (wakeActiveRef.current) startWakeWordListener();
    };
    recognition.onend = () => {
      if (stateRef.current === "listening") {
        setVoiceState(wakeActiveRef.current ? "listening_wake" : "idle");
        if (wakeActiveRef.current) startWakeWordListener();
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setVoiceState("listening");
    setTranscript("");
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function startWakeWordListener() {
    if (!isWeb || !SpeechRecognitionClass) return;
    stopListeners();
    const recognition = new SpeechRecognitionClass();
    recognition.lang = STT_LOCALE[langRef.current];
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.onresult = (event: any) => {
      const words = WAKE_WORDS[langRef.current];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        if (words.some((w) => text.includes(w))) {
          recognition.stop();
          addMessage("system", "Hey Bureau!");
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speak(langRef.current === "tr" ? "Sizi dinliyorum" : langRef.current === "en" ? "I'm listening" : "Je vous ecoute");
          setTimeout(() => startCommandListener(), 1200);
          return;
        }
      }
    };
    recognition.onerror = () => { setTimeout(() => { if (wakeActiveRef.current) startWakeWordListener(); }, 3000); };
    recognition.onend = () => {
      if (wakeActiveRef.current && stateRef.current !== "listening" && stateRef.current !== "processing" && stateRef.current !== "speaking") {
        setTimeout(() => { if (wakeActiveRef.current) startWakeWordListener(); }, 500);
      }
    };
    recognitionRef.current = recognition;
    try { recognition.start(); setVoiceState("listening_wake"); } catch {}
  }

  function toggleWakeWord() {
    if (wakeActiveRef.current) {
      wakeActiveRef.current = false;
      setWakeWordActive(false);
      AsyncStorage.setItem(WAKE_KEY, "0").catch(() => {});
      stopListeners();
      setVoiceState("idle");
    } else {
      wakeActiveRef.current = true;
      setWakeWordActive(true);
      AsyncStorage.setItem(WAKE_KEY, "1").catch(() => {});
      startWakeWordListener();
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function handleMicPress() {
    if (voiceState === "listening" || voiceState === "listening_wake") {
      stopListeners();
      setVoiceState("idle");
    } else if (voiceState === "speaking") {
      if (isWeb) (window as any).speechSynthesis?.cancel();
      else Speech.stop();
      setVoiceState("idle");
    } else {
      startCommandListener();
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }

  function submitText() {
    const t = textInput.trim();
    if (!t || voiceState === "processing") return;
    setTextInput("");
    processCommand(t);
  }

  function clearChat() {
    setMessages([]);
    setTranscript("");
  }

  useEffect(() => {
    return () => { stopListeners(); wakeActiveRef.current = false; };
  }, []);

  const isActive = voiceState === "listening" || voiceState === "listening_wake";
  const stateColor =
    voiceState === "listening" ? "#ef4444" :
    voiceState === "listening_wake" ? "#f59e0b" :
    voiceState === "processing" ? "#3b82f6" :
    voiceState === "speaking" ? "#22c55e" : colors.primary;

  const stateLabel =
    voiceState === "listening"      ? tr("state_listen", lang) :
    voiceState === "listening_wake" ? tr("state_wake",   lang) :
    voiceState === "processing"     ? tr("state_proc",   lang) :
    voiceState === "speaking"       ? tr("state_speak",  lang) :
                                       tr("state_idle",   lang);

  const stateIcon: keyof typeof Feather.glyphMap =
    voiceState === "listening" ? "mic" :
    voiceState === "listening_wake" ? "radio" :
    voiceState === "processing" ? "cpu" :
    voiceState === "speaking" ? "volume-2" : "mic";

  const WAVE_BARS = [
    { minH: 6,  maxH: 28, duration: 380, delay: 0   },
    { minH: 10, maxH: 36, duration: 290, delay: 60  },
    { minH: 4,  maxH: 22, duration: 440, delay: 120 },
    { minH: 14, maxH: 40, duration: 320, delay: 30  },
    { minH: 6,  maxH: 30, duration: 400, delay: 90  },
    { minH: 10, maxH: 34, duration: 270, delay: 150 },
    { minH: 4,  maxH: 20, duration: 460, delay: 50  },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Feather name="mic" size={18} color="#fff" />
            <Text style={styles.headerTitle}>{tr("title", lang)}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable
              onPress={() => setPanel(panel === "library" ? "chat" : "library")}
              style={[styles.helpBtn, panel === "library" && { backgroundColor: "#f59e0b40" }]}
              hitSlop={8}
            >
              <Feather name="grid" size={16} color={panel === "library" ? "#f59e0b" : "rgba(255,255,255,0.7)"} />
            </Pressable>
            <Pressable
              onPress={() => setPanel(panel === "commands" ? "chat" : "commands")}
              style={[styles.helpBtn, panel === "commands" && { backgroundColor: "rgba(255,255,255,0.25)" }]}
              hitSlop={8}
            >
              <Feather name="list" size={16} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
        </View>

        {/* Selecteur de langue */}
        <View style={styles.langRow}>
          {SUPPORTED_LANGS.map((l) => (
            <Pressable
              key={l}
              onPress={() => setLang(l)}
              style={[styles.langPill, lang === l && styles.langPillActive]}
            >
              <Text style={[styles.langPillText, lang === l && styles.langPillTextActive]}>{l.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        {/* Selecteur de mode (Commande / Sohbet) */}
        <View style={styles.modeRow}>
          <Pressable
            onPress={() => setMode("command")}
            style={[styles.modePill, mode === "command" && { backgroundColor: "#f59e0b" }]}
          >
            <Feather name="zap" size={12} color={mode === "command" ? "#0f172a" : "rgba(255,255,255,0.7)"} />
            <Text style={[styles.modePillText, { color: mode === "command" ? "#0f172a" : "rgba(255,255,255,0.7)" }]}>
              {tr("mode_command", lang)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode("chat")}
            style={[styles.modePill, mode === "chat" && { backgroundColor: "#3b82f6" }]}
          >
            <Feather name="message-circle" size={12} color={mode === "chat" ? "#fff" : "rgba(255,255,255,0.7)"} />
            <Text style={[styles.modePillText, { color: mode === "chat" ? "#fff" : "rgba(255,255,255,0.7)" }]}>
              {tr("mode_chat", lang)}
            </Text>
          </Pressable>
        </View>

        {/* Deep + Wake row */}
        <View style={styles.toolRow}>
          {mode === "chat" && (
            <Pressable
              onPress={() => setDeep((v) => !v)}
              style={[styles.deepPill, deep && { backgroundColor: "#a855f733", borderColor: "#a855f7" }]}
            >
              <Feather name={deep ? "zap" : "cpu"} size={12} color={deep ? "#d8b4fe" : "rgba(255,255,255,0.7)"} />
              <Text style={[styles.deepPillText, { color: deep ? "#d8b4fe" : "rgba(255,255,255,0.7)" }]}>
                {deep ? tr("deep_on", lang) : tr("deep_off", lang)}
              </Text>
              {deep && <Text style={styles.deepBadge}>Pro</Text>}
            </Pressable>
          )}
          <Pressable
            onPress={toggleWakeWord}
            style={[styles.wakePill, {
              backgroundColor: wakeWordActive ? "#f59e0b18" : "rgba(255,255,255,0.08)",
              borderColor: wakeWordActive ? "#f59e0b50" : "transparent",
            }, mode !== "chat" && { flex: 1 }]}
          >
            <View style={[styles.wakeWordDot, { backgroundColor: wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.3)" }]} />
            <Text style={[styles.wakeWordText, { color: wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.6)" }]}>
              {wakeWordActive ? tr("wake_on", lang) : tr("wake_off", lang)}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ── Panneaux ───────────────────────────────────────────────────── */}
      {panel === "library" ? (
        <ScrollView style={styles.commandsPanel} contentContainerStyle={styles.commandsPanelContent}>
          <Text style={[styles.commandsPanelTitle, { color: colors.foreground }]}>{tr("library", lang)}</Text>
          {LIBRARY[lang].map((cat, ci) => (
            <View key={ci} style={{ marginTop: 8 }}>
              <Text style={[styles.libCatTitle, { color: colors.primary }]}>{cat.title}</Text>
              <View style={styles.libGrid}>
                {cat.items.map((it, ii) => (
                  <Pressable
                    key={ii}
                    onPress={() => { setPanel("chat"); processCommand(it.text); }}
                    disabled={voiceState === "processing"}
                    style={[styles.libChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.libChipText, { color: colors.foreground }]} numberOfLines={1}>{it.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : panel === "commands" ? (
        <ScrollView style={styles.commandsPanel} contentContainerStyle={styles.commandsPanelContent}>
          <Text style={[styles.commandsPanelTitle, { color: colors.foreground }]}>Commands</Text>
          {commands.slice(0, 30).map((c, i) => (
            <Pressable
              key={i}
              onPress={() => { setPanel("chat"); processCommand(c.phrase); }}
              style={[styles.commandFullItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.commandFullIcon, { backgroundColor: colors.primary + "15" }]}>
                <Feather name="zap" size={14} color={colors.primary} />
              </View>
              <Text style={[styles.commandFullText, { color: colors.foreground }]} numberOfLines={2}>"{c.phrase}"</Text>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.chatArea}
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) => (
            <View
              key={m.id}
              style={[
                styles.messageBubble,
                m.type === "user" ? styles.userBubble : m.type === "system" ? styles.systemBubble : styles.assistantBubble,
                {
                  backgroundColor:
                    m.type === "user" ? colors.primary :
                    m.type === "system" ? colors.muted : colors.card,
                  borderColor: m.type === "assistant" ? colors.border : "transparent",
                },
              ]}
            >
              {m.type === "assistant" && (
                <View style={styles.bubbleIconRow}>
                  <View style={[styles.bubbleIconBg, { backgroundColor: colors.primary + "20" }]}>
                    <Feather name="cpu" size={10} color={colors.primary} />
                  </View>
                  <Text style={[styles.bubbleRoleText, { color: colors.mutedForeground }]}>Bureau IA</Text>
                </View>
              )}
              <Text style={[
                styles.messageText,
                { color: m.type === "user" ? "#fff" : m.type === "system" ? colors.mutedForeground : colors.foreground },
              ]}>
                {m.text}
              </Text>
              <Text style={[styles.messageTime, { color: m.type === "user" ? "rgba(255,255,255,0.5)" : colors.mutedForeground + "80" }]}>
                {m.timestamp.toLocaleTimeString(lang === "en" ? "en-US" : lang === "tr" ? "tr-TR" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </View>
          ))}
          {transcript && voiceState === "listening" && (
            <View style={[styles.messageBubble, styles.userBubble, { backgroundColor: colors.primary + "60" }]}>
              <Text style={[styles.messageText, { color: "#fff", fontStyle: "italic" }]}>{transcript}...</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Bottom area ───────────────────────────────────────────────── */}
      <View style={[styles.bottomArea, { paddingBottom: isWeb ? 30 : Math.max(insets.bottom + 10, 20) }]}>
        {/* Champ de saisie texte (toujours dispo, utile sur natif sans STT) */}
        <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            style={[styles.inputField, { color: colors.foreground }]}
            placeholder={mode === "chat" ? tr("chat_ph", lang) : tr("cmd_ph", lang)}
            placeholderTextColor={colors.mutedForeground}
            value={textInput}
            onChangeText={setTextInput}
            onSubmitEditing={submitText}
            editable={voiceState !== "processing"}
            returnKeyType="send"
          />
          <Pressable
            onPress={submitText}
            disabled={!textInput.trim() || voiceState === "processing"}
            style={[styles.sendBtn, { backgroundColor: textInput.trim() ? colors.primary : colors.muted }]}
          >
            <Feather name="send" size={16} color="#fff" />
          </Pressable>
          {messages.length > 1 && (
            <Pressable onPress={clearChat} style={styles.clearBtn}>
              <Feather name="trash-2" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        <View style={styles.waveRow}>
          {WAVE_BARS.map((bar, i) => (
            <AnimatedWaveBar
              key={i}
              color={isActive ? stateColor : stateColor + "30"}
              active={isActive}
              minH={bar.minH}
              maxH={bar.maxH}
              duration={bar.duration}
              delay={bar.delay}
            />
          ))}
        </View>

        <View style={styles.micRow}>
          <View style={[styles.statePill, { backgroundColor: stateColor + "18" }]}>
            <Feather name={stateIcon} size={12} color={stateColor} />
            <Text style={[styles.stateLabel, { color: stateColor }]}>{stateLabel}</Text>
          </View>
        </View>

        <View style={styles.micContainer}>
          <PulseRing color={stateColor} active={isActive} />
          <Pressable
            onPress={handleMicPress}
            style={[styles.micButton, { backgroundColor: stateColor }]}
          >
            {voiceState === "processing" ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : voiceState === "speaking" ? (
              <Feather name="volume-2" size={34} color="#fff" />
            ) : isActive ? (
              <Feather name="square" size={28} color="#fff" />
            ) : (
              <Feather name="mic" size={34} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  helpBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },

  langRow: { flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: 8 },
  langPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)" },
  langPillActive: { backgroundColor: "#f59e0b" },
  langPillText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.7)" },
  langPillTextActive: { color: "#0f172a" },

  modeRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
  modePill: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 7, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)" },
  modePillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  toolRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  deepPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: "transparent", backgroundColor: "rgba(255,255,255,0.08)" },
  deepPillText: { fontSize: 11, fontFamily: "Inter_500Medium", flex: 1 },
  deepBadge: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff", backgroundColor: "#a855f7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: "hidden" },
  wakePill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  wakeWordDot: { width: 7, height: 7, borderRadius: 4 },
  wakeWordText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  chatArea: { flex: 1 },
  chatContent: { padding: 14, gap: 8, paddingBottom: 4 },
  messageBubble: { maxWidth: "85%", padding: 11, borderRadius: 14, borderWidth: 1 },
  userBubble: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  systemBubble: { alignSelf: "center", maxWidth: "90%", borderWidth: 0, borderRadius: 10 },
  bubbleIconRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 5 },
  bubbleIconBg: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bubbleRoleText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  messageText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  messageTime: { fontSize: 9, fontFamily: "Inter_400Regular", marginTop: 4, textAlign: "right" },

  commandsPanel: { flex: 1 },
  commandsPanelContent: { padding: 16, gap: 6 },
  commandsPanelTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 4 },
  commandFullItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  commandFullIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  commandFullText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },

  libCatTitle: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, paddingHorizontal: 2 },
  libGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  libChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  libChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  bottomArea: { paddingTop: 10, paddingHorizontal: 16, alignItems: "center", gap: 6 },
  inputRow: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 22, borderWidth: 1 },
  inputField: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: Platform.OS === "ios" ? 10 : 6, paddingHorizontal: 6 },
  sendBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  clearBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },

  waveRow: { flexDirection: "row", alignItems: "center", gap: 5, height: 44 },
  micRow: { alignItems: "center" },
  statePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  stateLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  micContainer: { width: 86, height: 86, borderRadius: 43, alignItems: "center", justifyContent: "center", marginVertical: 4 },
  micButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, shadowColor: "#000" },
      android: { elevation: 10 },
      web: { boxShadow: "0 6px 20px rgba(0,0,0,0.35)" },
    }),
  },
});
