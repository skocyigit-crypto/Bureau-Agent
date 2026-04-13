import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
};

export default function VoiceAssistantScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [wakeWordActive, setWakeWordActive] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const wakeActiveRef = useRef(false);
  const stateRef = useRef<VoiceState>("idle");

  const SpeechRecognitionClass = isWeb
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

  useEffect(() => {
    stateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    fetchAuth(`${API_BASE}/api/voice/commands`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.commands) setCommands(d.commands); })
      .catch(() => {});

    addMessage("system", `Bonjour ${user?.prenom || ""}! Appuyez sur le micro pour parler ou activez le mode "Hey Bureau" pour la detection vocale automatique.`);
  }, []);

  useEffect(() => {
    if (voiceState === "listening" || voiceState === "listening_wake") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [voiceState]);

  function addMessage(type: "user" | "assistant" | "system", text: string) {
    setMessages(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, type, text, timestamp: new Date() }]);
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
        const errMsg = "Erreur de traitement. Reessayez.";
        addMessage("assistant", errMsg);
        speak(errMsg);
      }
    } catch {
      const errMsg = "Erreur de connexion. Verifiez votre reseau.";
      addMessage("assistant", errMsg);
      speak(errMsg);
    }
  }, [fetchAuth, speak]);

  function stopListeners() {
    try { recognitionRef.current?.stop(); } catch {}
    if (isWeb) {
      try { (window as any).speechSynthesis?.cancel(); } catch {}
    } else {
      Speech.stop();
    }
  }

  function startCommandListener() {
    if (!isWeb || !SpeechRecognitionClass) {
      addMessage("system", "La reconnaissance vocale necessite un navigateur compatible (Chrome). Sur mobile natif, utilisez les commandes rapides ci-dessous.");
      setShowCommands(true);
      return;
    }

    stopListeners();
    const recognition = new SpeechRecognitionClass();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      setTranscript(final || interim);
      if (final) {
        recognition.stop();
        processCommand(final);
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        addMessage("system", "Erreur micro: " + e.error);
      }
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
    if (!isWeb) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
          addMessage("system", 'Detection: "Hey Bureau" - Je vous ecoute!');
          if (!isWeb) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speak("Je vous ecoute");
          setTimeout(() => startCommandListener(), 1200);
          return;
        }
      }
    };

    recognition.onerror = () => {
      setTimeout(() => { if (wakeActiveRef.current) startWakeWordListener(); }, 3000);
    };

    recognition.onend = () => {
      if (wakeActiveRef.current && stateRef.current !== "listening" && stateRef.current !== "processing" && stateRef.current !== "speaking") {
        setTimeout(() => { if (wakeActiveRef.current) startWakeWordListener(); }, 500);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setVoiceState("listening_wake");
    } catch {}
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
    if (!isWeb) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    if (!isWeb) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }

  useEffect(() => {
    return () => {
      stopListeners();
      wakeActiveRef.current = false;
    };
  }, []);

  const stateColor =
    voiceState === "listening" ? "#ef4444" :
    voiceState === "listening_wake" ? "#f59e0b" :
    voiceState === "processing" ? "#3b82f6" :
    voiceState === "speaking" ? "#22c55e" : colors.primary;

  const stateLabel =
    voiceState === "listening" ? "Je vous ecoute..." :
    voiceState === "listening_wake" ? 'Dites "Hey Bureau"...' :
    voiceState === "processing" ? "Traitement IA..." :
    voiceState === "speaking" ? "Reponse en cours..." : "Appuyez pour parler";

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
          <Pressable onPress={() => setShowCommands(!showCommands)} style={styles.helpBtn}>
            <Feather name="help-circle" size={18} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </View>
        <Pressable
          onPress={toggleWakeWord}
          style={[styles.wakeWordToggle, { backgroundColor: wakeWordActive ? "#f59e0b25" : "rgba(255,255,255,0.08)", borderColor: wakeWordActive ? "#f59e0b" : "transparent" }]}
        >
          <View style={[styles.wakeWordDot, { backgroundColor: wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.3)" }]} />
          <Text style={[styles.wakeWordText, { color: wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.6)" }]}>
            {wakeWordActive ? '"Hey Bureau" actif' : 'Activer "Hey Bureau"'}
          </Text>
          <Feather name={wakeWordActive ? "toggle-right" : "toggle-left"} size={20} color={wakeWordActive ? "#f59e0b" : "rgba(255,255,255,0.4)"} />
        </Pressable>
      </View>

      {showCommands ? (
        <ScrollView style={styles.commandsList} contentContainerStyle={styles.commandsContent}>
          <Text style={[styles.commandsTitle, { color: colors.foreground }]}>Commandes disponibles</Text>
          <Text style={[styles.aiNote, { color: colors.primary }]}>L'IA comprend aussi les phrases naturelles en francais.</Text>
          {commands.map((c, i) => (
            <Pressable
              key={i}
              onPress={() => {
                setShowCommands(false);
                processCommand(c.phrase);
              }}
              style={[styles.commandItem, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.commandPhrase, { color: colors.primary }]}>"{c.phrase}"</Text>
              <Text style={[styles.commandDesc, { color: colors.mutedForeground }]}>{c.description}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={styles.chatContent} showsVerticalScrollIndicator={false}>
          {messages.map(m => (
            <View
              key={m.id}
              style={[
                styles.messageBubble,
                m.type === "user" ? styles.userBubble : m.type === "system" ? styles.systemBubble : styles.assistantBubble,
                {
                  backgroundColor: m.type === "user" ? colors.primary : m.type === "system" ? colors.muted + "80" : colors.card,
                  borderColor: m.type === "assistant" ? colors.border : "transparent",
                },
              ]}
            >
              {m.type === "assistant" && (
                <View style={styles.bubbleIcon}>
                  <Feather name="volume-2" size={12} color={colors.primary} />
                </View>
              )}
              {m.type === "system" && (
                <View style={styles.bubbleIcon}>
                  <Feather name="info" size={12} color={colors.mutedForeground} />
                </View>
              )}
              <Text style={[
                styles.messageText,
                { color: m.type === "user" ? "#fff" : m.type === "system" ? colors.mutedForeground : colors.foreground },
              ]}>
                {m.text}
              </Text>
            </View>
          ))}

          {transcript && voiceState === "listening" && (
            <View style={[styles.messageBubble, styles.userBubble, { backgroundColor: colors.primary + "80" }]}>
              <Text style={[styles.messageText, { color: "#fff", fontStyle: "italic" }]}>{transcript}...</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View style={[styles.micArea, { paddingBottom: isWeb ? 30 : Math.max(insets.bottom, 20) }]}>
        <Text style={[styles.stateLabel, { color: stateColor }]}>{stateLabel}</Text>

        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Pressable onPress={handleMicPress} style={[styles.micButton, { backgroundColor: stateColor, shadowColor: stateColor }]}>
            {voiceState === "processing" ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : voiceState === "listening" || voiceState === "listening_wake" ? (
              <Feather name="mic-off" size={32} color="#fff" />
            ) : (
              <Feather name="mic" size={32} color="#fff" />
            )}
          </Pressable>
        </Animated.View>

        {voiceState === "listening" || voiceState === "listening_wake" ? (
          <View style={styles.waveContainer}>
            {[0, 1, 2, 3, 4].map(i => (
              <Animated.View
                key={i}
                style={[styles.waveBar, { backgroundColor: stateColor + "60", height: 8 + Math.random() * 20 }]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  helpBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  wakeWordToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1 },
  wakeWordDot: { width: 8, height: 8, borderRadius: 4 },
  wakeWordText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  chatArea: { flex: 1 },
  chatContent: { padding: 16, gap: 8 },
  messageBubble: { maxWidth: "85%", padding: 12, borderRadius: 14, borderWidth: 1 },
  userBubble: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  systemBubble: { alignSelf: "center", borderRadius: 10, maxWidth: "90%", borderWidth: 0 },
  bubbleIcon: { marginBottom: 4 },
  messageText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  commandsList: { flex: 1 },
  commandsContent: { padding: 16, gap: 8 },
  commandsTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 4 },
  aiNote: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic", marginBottom: 8 },
  commandItem: { padding: 14, borderRadius: 12, borderWidth: 1 },
  commandPhrase: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  commandDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  micArea: { alignItems: "center", paddingTop: 16 },
  stateLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 12 },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 8 },
      web: { boxShadow: "0 4px 12px rgba(0,0,0,0.3)" },
    }),
  },
  waveContainer: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12, height: 30 },
  waveBar: { width: 4, borderRadius: 2 },
});
