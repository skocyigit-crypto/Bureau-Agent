import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type VoiceState = "idle" | "listening_wake" | "listening" | "processing" | "speaking";

interface Message {
  id: string;
  type: "user" | "assistant" | "system";
  text: string;
  timestamp: Date;
}

interface CommandInfo {
  phrase: string;
  description: string;
}

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

const QUICK_COMMANDS = [
  { icon: "phone-missed" as const, label: "Appels manques", phrase: "Montre moi les appels manques d'aujourd'hui" },
  { icon: "bar-chart-2" as const, label: "Briefing", phrase: "Donne moi le briefing de la journee" },
  { icon: "clock" as const, label: "Taches urgentes", phrase: "Quelles sont mes taches urgentes en cours?" },
  { icon: "users" as const, label: "Contacts recents", phrase: "Montre moi mes derniers contacts" },
  { icon: "calendar" as const, label: "Agenda", phrase: "Quels sont mes rendez-vous aujourd'hui?" },
  { icon: "trending-up" as const, label: "Performance", phrase: "Analyse mes performances de la semaine" },
  { icon: "folder" as const, label: "Projets actifs", phrase: "Combien de projets actifs avons-nous?" },
  { icon: "alert-circle" as const, label: "Risques", phrase: "Quels sont les risques actuels?" },
  { icon: "zap" as const, label: "Suggestions", phrase: "Quelles actions me recommandes-tu pour aujourd'hui?" },
];

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
            Animated.timing(scale, { toValue: 1.6, duration: 1000, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.35, duration: 200, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 800, useNativeDriver: true }),
          ]),
        ])
      ).start();
    } else {
      scale.setValue(1);
      opacity.setValue(0);
    }
  }, [active]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, {
        borderRadius: 50,
        backgroundColor: color,
        transform: [{ scale }],
        opacity,
      }]}
    />
  );
}

export default function VoiceAssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [showAllCommands, setShowAllCommands] = useState(false);
  const [wakeWordActive, setWakeWordActive] = useState(false);

  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const wakeActiveRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");

  const SpeechRecognitionClass = isWeb
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);

  useEffect(() => {
    fetchAuth(`${API_BASE}/api/voice/commands`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.commands) setCommands(d.commands); })
      .catch(() => {});
    addMessage("system", `Bonjour ${user?.prenom || ""}! Appuyez sur le micro ou choisissez une commande rapide ci-dessous.`);
  }, []);

  function addMessage(type: "user" | "assistant" | "system", text: string) {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, type, text, timestamp: new Date() }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const speak = useCallback((text: string) => {
    setVoiceState("speaking");
    if (isWeb && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "fr-FR";
      utter.rate = 1.05;
      const voices = window.speechSynthesis.getVoices();
      const frVoice = voices.find((v: SpeechSynthesisVoice) => v.lang.startsWith("fr"));
      if (frVoice) utter.voice = frVoice;
      utter.onend = () => {
        setVoiceState(wakeActiveRef.current ? "listening_wake" : "idle");
        if (wakeActiveRef.current) startWakeWordListener();
      };
      window.speechSynthesis.speak(utter);
    } else {
      Speech.speak(text, {
        language: "fr-FR",
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
    try {
      const res = await fetchAuth(`${API_BASE}/api/voice/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        addMessage("assistant", data.spoken);
        speak(data.spoken);
        if (data.navigate) {
          setTimeout(() => {
            const target = MOBILE_ROUTE_MAP[data.navigate] || data.navigate;
            router.push(target as any);
          }, 3000);
        }
      } else {
        const msg = "Erreur de traitement. Reessayez.";
        addMessage("assistant", msg);
        speak(msg);
      }
    } catch {
      const msg = "Erreur de connexion. Verifiez votre reseau.";
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
      addMessage("system", "Reconnaissance vocale disponible sur Chrome. Sur mobile natif, utilisez les commandes rapides.");
      return;
    }
    stopListeners();
    const recognition = new SpeechRecognitionClass();
    recognition.lang = "fr-FR";
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
      if (e.error !== "no-speech" && e.error !== "aborted") addMessage("system", "Erreur micro: " + e.error);
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
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        if (text.includes("hey bureau") || text.includes("hé bureau") || text.includes("hey buro")) {
          recognition.stop();
          addMessage("system", '"Hey Bureau" detecte — Je vous ecoute!');
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speak("Je vous ecoute");
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
      stopListeners();
      setVoiceState("idle");
      addMessage("system", 'Mode "Hey Bureau" desactive.');
    } else {
      wakeActiveRef.current = true;
      setWakeWordActive(true);
      addMessage("system", 'Mode "Hey Bureau" active. Dites "Hey Bureau" pour commencer.');
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
    voiceState === "listening" ? "Je vous ecoute..." :
    voiceState === "listening_wake" ? 'Dites "Hey Bureau"...' :
    voiceState === "processing" ? "IA en cours de traitement..." :
    voiceState === "speaking" ? "Reponse vocale en cours..." : "Appuyez pour parler";

  const stateIcon: keyof typeof Feather.glyphMap =
    voiceState === "listening" ? "mic" :
    voiceState === "listening_wake" ? "radio" :
    voiceState === "processing" ? "cpu" :
    voiceState === "speaking" ? "volume-2" : "mic";

  const WAVE_BARS = [
    { minH: 6, maxH: 28, duration: 380, delay: 0 },
    { minH: 10, maxH: 36, duration: 290, delay: 60 },
    { minH: 4, maxH: 22, duration: 440, delay: 120 },
    { minH: 14, maxH: 40, duration: 320, delay: 30 },
    { minH: 6, maxH: 30, duration: 400, delay: 90 },
    { minH: 10, maxH: 34, duration: 270, delay: 150 },
    { minH: 4, maxH: 20, duration: 460, delay: 50 },
  ];

  const allCommands = commands.length > 0
    ? commands.slice(0, 8).map((c) => ({ icon: "zap" as const, label: c.phrase.slice(0, 20), phrase: c.phrase }))
    : QUICK_COMMANDS;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Feather name="mic" size={18} color="#fff" />
            <Text style={styles.headerTitle}>Assistant Vocal IA</Text>
          </View>
          <Pressable onPress={() => setShowAllCommands(!showAllCommands)} style={styles.helpBtn} hitSlop={8}>
            <Feather name={showAllCommands ? "message-square" : "list"} size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
        <Pressable
          onPress={toggleWakeWord}
          style={[styles.wakeToggle, {
            backgroundColor: wakeWordActive ? "#f59e0b18" : "rgba(255,255,255,0.08)",
            borderColor: wakeWordActive ? "#f59e0b50" : "transparent",
          }]}
        >
          <View style={[styles.wakeWordDot, { backgroundColor: wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.3)" }]} />
          <Text style={[styles.wakeWordText, { color: wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.6)" }]}>
            {wakeWordActive ? '"Hey Bureau" actif' : 'Activer "Hey Bureau"'}
          </Text>
          <Feather name={wakeWordActive ? "toggle-right" : "toggle-left"} size={20} color={wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.3)"} />
        </Pressable>
      </View>

      {showAllCommands ? (
        <ScrollView style={styles.commandsPanel} contentContainerStyle={styles.commandsPanelContent}>
          <Text style={[styles.commandsPanelTitle, { color: colors.foreground }]}>Commandes disponibles</Text>
          <Text style={[styles.commandsPanelNote, { color: colors.primary }]}>Appuyez pour envoyer une commande.</Text>
          {allCommands.map((c, i) => (
            <Pressable
              key={i}
              onPress={() => { setShowAllCommands(false); processCommand(c.phrase); }}
              style={[styles.commandFullItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.commandFullIcon, { backgroundColor: colors.primary + "15" }]}>
                <Feather name={c.icon} size={14} color={colors.primary} />
              </View>
              <Text style={[styles.commandFullText, { color: colors.foreground }]}>"{c.phrase}"</Text>
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
                    m.type === "system" ? colors.muted :
                    colors.card,
                  borderColor: m.type === "assistant" ? colors.border : "transparent",
                },
              ]}
            >
              {m.type === "assistant" && (
                <View style={styles.bubbleIconRow}>
                  <View style={[styles.bubbleIconBg, { backgroundColor: colors.primary + "20" }]}>
                    <Feather name="cpu" size={10} color={colors.primary} />
                  </View>
                  <Text style={[styles.bubbleRoleText, { color: colors.mutedForeground }]}>Assistant IA</Text>
                </View>
              )}
              {m.type === "system" && (
                <View style={styles.bubbleIconRow}>
                  <Feather name="info" size={12} color={colors.mutedForeground} />
                </View>
              )}
              <Text style={[
                styles.messageText,
                { color: m.type === "user" ? "#fff" : m.type === "system" ? colors.mutedForeground : colors.foreground },
              ]}>
                {m.text}
              </Text>
              <Text style={[styles.messageTime, { color: m.type === "user" ? "rgba(255,255,255,0.5)" : colors.mutedForeground + "80" }]}>
                {m.timestamp.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
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

      <View style={[styles.bottomArea, { paddingBottom: isWeb ? 30 : Math.max(insets.bottom + 10, 20) }]}>
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

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickCmdsRow}
          style={styles.quickCmdsScroll}
        >
          {QUICK_COMMANDS.map((cmd, i) => (
            <Pressable
              key={i}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                processCommand(cmd.phrase);
              }}
              disabled={voiceState === "processing" || voiceState === "speaking"}
              style={({ pressed }) => [
                styles.quickCmd,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Feather name={cmd.icon} size={13} color={colors.primary} />
              <Text style={[styles.quickCmdText, { color: colors.foreground }]}>{cmd.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  helpBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  wakeToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1 },
  wakeWordDot: { width: 8, height: 8, borderRadius: 4 },
  wakeWordText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1, textAlign: "center" },
  chatArea: { flex: 1 },
  chatContent: { padding: 16, gap: 8, paddingBottom: 4 },
  messageBubble: { maxWidth: "85%", padding: 12, borderRadius: 14, borderWidth: 1 },
  userBubble: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  systemBubble: { alignSelf: "center", maxWidth: "90%", borderWidth: 0, borderRadius: 10 },
  bubbleIconRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 5 },
  bubbleIconBg: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bubbleRoleText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  messageText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  messageTime: { fontSize: 9, fontFamily: "Inter_400Regular", marginTop: 5, textAlign: "right" },
  commandsPanel: { flex: 1 },
  commandsPanelContent: { padding: 16, gap: 8 },
  commandsPanelTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 4 },
  commandsPanelNote: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic", marginBottom: 8 },
  commandFullItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  commandFullIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  commandFullText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  bottomArea: { paddingTop: 12, paddingHorizontal: 20, alignItems: "center", gap: 8 },
  waveRow: { flexDirection: "row", alignItems: "center", gap: 5, height: 50 },
  micRow: { alignItems: "center" },
  statePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  stateLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  micContainer: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginVertical: 6 },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, shadowColor: "#000" },
      android: { elevation: 10 },
      web: { boxShadow: "0 6px 20px rgba(0,0,0,0.35)" },
    }),
  },
  quickCmdsScroll: { alignSelf: "stretch" },
  quickCmdsRow: { gap: 8, paddingHorizontal: 4 },
  quickCmd: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  quickCmdText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
