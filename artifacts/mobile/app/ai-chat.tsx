import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const STORAGE_KEY = "ai_chat_history";
const MAX_STORED = 60;

const QUICK_ACTIONS = [
  { icon: "bar-chart-2" as const, label: "Briefing du jour", prompt: "Donne-moi le briefing complet de la journee: appels, taches, rendez-vous, factures en retard." },
  { icon: "users" as const, label: "Analyse clients", prompt: "Analyse mes contacts et prospects: qui sont les plus importants, quels suivis faire?" },
  { icon: "trending-up" as const, label: "Performance", prompt: "Analyse mes performances de la semaine: appels, taches terminees, chiffre d'affaires." },
  { icon: "folder" as const, label: "Etat projets", prompt: "Fais un bilan de mes projets: combien sont actifs, lesquels sont en retard, et quel est l'avancement global?" },
  { icon: "alert-circle" as const, label: "Risques", prompt: "Quels sont les risques actuels: factures en retard, taches urgentes, projets en danger?" },
  { icon: "zap" as const, label: "Suggestions", prompt: "Quelles actions me recommandes-tu pour ameliorer ma productivite aujourd'hui?" },
  { icon: "search" as const, label: "Recherche", prompt: "Recherche dans mes donnees: " },
];

const FOLLOW_UP_SETS: Array<string[]> = [
  ["Donne plus de details", "Quelles actions recommandes-tu?", "Resume en 3 points"],
  ["Et pour cette semaine?", "Quels sont les risques?", "Montre moi les chiffres"],
  ["Quels sont les contacts importants?", "Analyse les taches urgentes", "Compare avec le mois dernier"],
  ["Explique davantage", "Que faire maintenant?", "Quelles sont les priorites?"],
  ["Donne des exemples concrets", "Comment ameliorer ca?", "Quel est le plan d'action?"],
];

function getFollowUps(content: string): string[] {
  const lower = content.toLowerCase();
  if (lower.includes("appel") || lower.includes("call")) return FOLLOW_UP_SETS[0];
  if (lower.includes("tache") || lower.includes("tâche")) return FOLLOW_UP_SETS[2];
  if (lower.includes("contact") || lower.includes("client")) return FOLLOW_UP_SETS[2];
  if (lower.includes("performance") || lower.includes("statistique")) return FOLLOW_UP_SETS[3];
  if (lower.includes("risque") || lower.includes("urgent")) return FOLLOW_UP_SETS[4];
  return FOLLOW_UP_SETS[Math.floor(Math.random() * FOLLOW_UP_SETS.length)];
}

function parseMarkdown(text: string, textColor: string, mutedColor: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  lines.forEach((line, lineIdx) => {
    if (line.startsWith("- ") || line.startsWith("• ")) {
      const content = line.replace(/^[-•] /, "");
      elements.push(
        <View key={lineIdx} style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
          <Text style={{ color: mutedColor, fontSize: 14, lineHeight: 21 }}>•</Text>
          <Text style={{ flex: 1, color: textColor, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 }}>
            {renderInline(content, textColor)}
          </Text>
        </View>
      );
    } else if (line.startsWith("**") && line.endsWith("**")) {
      elements.push(
        <Text key={lineIdx} style={{ color: textColor, fontSize: 14, fontFamily: "Inter_700Bold", lineHeight: 21, marginTop: lineIdx > 0 ? 6 : 0 }}>
          {line.slice(2, -2)}
        </Text>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <Text key={lineIdx} style={{ color: textColor, fontSize: 16, fontFamily: "Inter_700Bold", lineHeight: 24, marginTop: 8, marginBottom: 2 }}>
          {line.slice(2)}
        </Text>
      );
    } else if (line === "") {
      elements.push(<View key={lineIdx} style={{ height: 6 }} />);
    } else {
      elements.push(
        <Text key={lineIdx} style={{ color: textColor, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 }}>
          {renderInline(line, textColor)}
        </Text>
      );
    }
  });
  return elements;
}

function renderInline(text: string, textColor: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <Text key={i} style={{ fontFamily: "Inter_700Bold", color: textColor }}>{part.slice(2, -2)}</Text>;
    }
    return <Text key={i} style={{ color: textColor }}>{part}</Text>;
  });
}

export default function AIChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const recognitionRef = useRef<any>(null);

  const SpeechRecognitionClass = isWeb
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const stored: Message[] = JSON.parse(raw);
          if (stored.length > 0) {
            setMessages(stored.slice(-MAX_STORED));
            setHistoryLoaded(true);
            return;
          }
        } catch {}
      }
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: `Bonjour ${user?.prenom || ""}! Je suis votre assistant IA Agent de Bureau. Je peux vous aider avec:\n\n- Briefing quotidien et analyses\n- Recherche dans vos donnees\n- Conseils strategiques CRM\n- Suivi des performances\n\nComment puis-je vous aider?`,
        timestamp: new Date().toISOString(),
      }]);
      setHistoryLoaded(true);
    });
  }, []);

  async function persistMessages(msgs: Message[]) {
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_STORED))); } catch {}
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: text.trim(), timestamp: new Date().toISOString() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setIsTyping(true);
    persistMessages(updated);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/smart-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text.trim() }),
      });
      let reply = "Desole, je n'ai pas pu traiter votre demande. Veuillez reessayer.";
      if (res.ok) {
        const data = await res.json();
        if (data.aiSummary) {
          reply = data.aiSummary;
        } else if (data.answer || data.response || data.message) {
          reply = data.answer || data.response || data.message;
        } else if (data.results) {
          const parts: string[] = [];
          if (typeof data.results === "object" && !Array.isArray(data.results)) {
            const r = data.results;
            if (r.contacts?.length) parts.push(`**Contacts (${r.contacts.length}):**\n${r.contacts.slice(0, 3).map((c: any) => `- ${c.firstName || ""} ${c.lastName || ""} ${c.company ? `(${c.company})` : ""}`).join("\n")}`);
            if (r.tasks?.length) parts.push(`**Taches (${r.tasks.length}):**\n${r.tasks.slice(0, 3).map((t: any) => `- ${t.title}`).join("\n")}`);
            if (r.prospects?.length) parts.push(`**Prospects (${r.prospects.length}):**\n${r.prospects.slice(0, 3).map((p: any) => `- ${p.title || p.contactName}`).join("\n")}`);
            if (r.invoices?.length) parts.push(`**Factures (${r.invoices.length}):**\n${r.invoices.slice(0, 3).map((f: any) => `- ${f.reference || f.title} - ${f.clientName}`).join("\n")}`);
            if (r.events?.length) parts.push(`**Evenements (${r.events.length}):**\n${r.events.slice(0, 3).map((e: any) => `- ${e.title}`).join("\n")}`);
          } else if (Array.isArray(data.results)) {
            parts.push(data.results.slice(0, 5).map((r: any, i: number) => `${i + 1}. ${r.title || r.name || JSON.stringify(r)}`).join("\n"));
          }
          reply = parts.length > 0
            ? `J'ai trouve ${data.totalResults || "des"} resultat(s):\n\n${parts.join("\n\n")}`
            : "Aucun resultat trouve pour votre recherche.";
        }
      }
      const aiMsg: Message = { id: `a-${Date.now()}`, role: "assistant", content: reply, timestamp: new Date().toISOString() };
      const withReply = [...updated, aiMsg];
      setMessages(withReply);
      persistMessages(withReply);
    } catch {
      const errorMsg: Message = { id: `e-${Date.now()}`, role: "assistant", content: "Une erreur est survenue. Verifiez votre connexion et reessayez.", timestamp: new Date().toISOString() };
      const withError = [...updated, errorMsg];
      setMessages(withError);
      persistMessages(withError);
    } finally {
      setIsTyping(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
    }
  }, [fetchAuth, isTyping, messages]);

  function clearHistory() {
    const welcome: Message = { id: "welcome", role: "assistant", content: "Conversation reinitialise. Comment puis-je vous aider?", timestamp: new Date().toISOString() };
    setMessages([welcome]);
    persistMessages([welcome]);
  }

  async function copyMessage(content: string, id: string) {
    try {
      await Clipboard.setStringAsync(content);
      setCopiedId(id);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  }

  function startVoiceInput() {
    if (!isWeb || !SpeechRecognitionClass) return;
    if (voiceListening) {
      try { recognitionRef.current?.stop(); } catch {}
      setVoiceListening(false);
      return;
    }
    const recognition = new SpeechRecognitionClass();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let final = "", interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else interim += event.results[i][0].transcript;
      }
      setInput(final || interim);
      if (final) { recognition.stop(); setVoiceListening(false); }
    };
    recognition.onerror = () => setVoiceListening(false);
    recognition.onend = () => setVoiceListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setVoiceListening(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  const lastAiMessage = messages.filter((m) => m.role === "assistant").at(-1);
  const followUps = lastAiMessage && !isTyping ? getFollowUps(lastAiMessage.content) : [];

  function renderMessage({ item, index }: { item: Message; index: number }) {
    const isUser = item.role === "user";
    const textColor = isUser ? "#fff" : colors.foreground;
    const mutedColor = isUser ? "rgba(255,255,255,0.6)" : colors.mutedForeground;
    const isCopied = copiedId === item.id;
    const isLastAi = !isUser && item.id === lastAiMessage?.id && !isTyping;

    const showDateSep = index === 0 || (
      new Date(messages[index - 1]?.timestamp).toDateString() !== new Date(item.timestamp).toDateString()
    );
    const dateLabel = (() => {
      const d = new Date(item.timestamp);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
      if (d.toDateString() === yesterday.toDateString()) return "Hier";
      return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    })();

    return (
      <>
        {showDateSep && (
          <View style={styles.dateSep}>
            <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dateLabel, { color: colors.mutedForeground }]}>{dateLabel}</Text>
            <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
          </View>
        )}
        <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
          {!isUser && (
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Feather name="cpu" size={14} color="#fff" />
            </View>
          )}
          <Pressable
            onLongPress={() => copyMessage(item.content, item.id)}
            style={[
              styles.bubble,
              isUser
                ? [styles.userBubble, { backgroundColor: colors.primary }]
                : [styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }],
            ]}
          >
            <View style={styles.markdownContent}>
              {parseMarkdown(item.content, textColor, mutedColor)}
            </View>
            <View style={styles.bubbleFooter}>
              <Text style={[styles.timestamp, { color: mutedColor }]}>{formatTime(item.timestamp)}</Text>
              {isCopied ? (
                <Feather name="check" size={10} color={isUser ? "rgba(255,255,255,0.6)" : "#22c55e"} />
              ) : null}
            </View>
          </Pressable>
          {isUser && (
            <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
              <Text style={styles.avatarText}>{user ? (user.prenom[0] + user.nom[0]).toUpperCase() : "U"}</Text>
            </View>
          )}
        </View>
        {isLastAi && followUps.length > 0 && (
          <View style={styles.followUpsRow}>
            {followUps.map((fu, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  sendMessage(fu);
                }}
                style={[styles.followUpChip, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}
              >
                <Feather name="corner-down-right" size={11} color={colors.primary} />
                <Text style={[styles.followUpText, { color: colors.primary }]}>{fu}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </>
    );
  }

  if (!historyLoaded) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={[styles.headerAvatar, { backgroundColor: colors.primary }]}>
              <Feather name="cpu" size={16} color="#fff" />
            </View>
            <View>
              <Text style={styles.headerTitle}>Assistant IA</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: isTyping ? "#f59e0b" : "#22c55e" }]} />
                <Text style={styles.headerSub}>{isTyping ? "En train d'ecrire..." : "Gemini 2.5 Pro · En ligne"}</Text>
              </View>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Text style={[styles.msgCount, { color: "rgba(255,255,255,0.4)" }]}>{messages.length}</Text>
            <Pressable onPress={clearHistory} style={styles.clearBtn} hitSlop={12}>
              <Feather name="trash-2" size={16} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={[styles.messageList, { paddingBottom: 10 }]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            messages.length <= 1 ? (
              <View style={styles.quickActionsContainer}>
                <Text style={[styles.quickActionsTitle, { color: colors.mutedForeground }]}>Actions rapides</Text>
                <View style={styles.quickActionsGrid}>
                  {QUICK_ACTIONS.map((a) => (
                    <Pressable
                      key={a.label}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        sendMessage(a.prompt);
                      }}
                      style={({ pressed }) => [
                        styles.quickAction,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <View style={[styles.quickActionIcon, { backgroundColor: colors.primary + "15" }]}>
                        <Feather name={a.icon} size={16} color={colors.primary} />
                      </View>
                      <Text style={[styles.quickActionLabel, { color: colors.foreground }]}>{a.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={
            isTyping ? (
              <View style={[styles.messageRow, styles.aiRow]}>
                <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                  <Feather name="cpu" size={14} color="#fff" />
                </View>
                <View style={[styles.bubble, styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.typingDots}>
                    {[0.4, 0.65, 0.9].map((op, i) => (
                      <View key={i} style={[styles.dot, { backgroundColor: colors.mutedForeground, opacity: op }]} />
                    ))}
                  </View>
                </View>
              </View>
            ) : null
          }
        />

        <View style={[styles.inputBar, {
          backgroundColor: colors.card,
          borderColor: colors.border,
          paddingBottom: isWeb ? 20 : Math.max(insets.bottom, 10),
        }]}>
          {voiceListening && (
            <View style={[styles.voiceBanner, { backgroundColor: "#ef444418" }]}>
              <Feather name="mic" size={12} color="#ef4444" />
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#ef4444" }}>Ecoute en cours...</Text>
            </View>
          )}
          <View style={styles.inputRow}>
            {isWeb && SpeechRecognitionClass && (
              <Pressable
                onPress={startVoiceInput}
                style={[styles.voiceBtn, { backgroundColor: voiceListening ? "#ef444420" : colors.background, borderColor: voiceListening ? "#ef4444" : colors.border }]}
                hitSlop={8}
              >
                <Feather name="mic" size={18} color={voiceListening ? "#ef4444" : colors.mutedForeground} />
              </Pressable>
            )}
            <TextInput
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              placeholder="Ecrivez votre message..."
              placeholderTextColor={colors.mutedForeground}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={2000}
              onSubmitEditing={() => sendMessage(input)}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                sendMessage(input);
              }}
              disabled={!input.trim() || isTyping}
              style={[styles.sendBtn, { backgroundColor: input.trim() && !isTyping ? colors.primary : colors.muted }]}
            >
              {isTyping ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="send" size={18} color={input.trim() ? "#fff" : colors.mutedForeground} />
              )}
            </Pressable>
          </View>
          {messages.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.followUpBar} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
              {[
                { icon: "bar-chart-2" as const, label: "Briefing", prompt: "Donne-moi le briefing complet de la journee" },
                { icon: "phone-missed" as const, label: "Appels manques", prompt: "Montre moi les appels manques" },
                { icon: "alert-circle" as const, label: "Urgences", prompt: "Quelles sont mes taches urgentes?" },
                { icon: "trending-up" as const, label: "Performance", prompt: "Analyse mes performances cette semaine" },
              ].map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => sendMessage(s.prompt)}
                  style={[styles.inputSuggestion, { backgroundColor: colors.background, borderColor: colors.border }]}
                >
                  <Feather name={s.icon} size={11} color={colors.mutedForeground} />
                  <Text style={[styles.inputSuggestionText, { color: colors.mutedForeground }]}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", marginLeft: 12, gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  msgCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clearBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  chatArea: { flex: 1 },
  messageList: { padding: 16 },
  dateSep: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 12 },
  dateLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dateLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  messageRow: { flexDirection: "row", marginBottom: 8, alignItems: "flex-end", gap: 8 },
  userRow: { justifyContent: "flex-end" },
  aiRow: { justifyContent: "flex-start" },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  bubble: { maxWidth: "78%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4, borderWidth: 1 },
  markdownContent: { gap: 0 },
  bubbleFooter: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 5 },
  timestamp: { fontSize: 10, fontFamily: "Inter_400Regular" },
  followUpsRow: { paddingLeft: 36, marginBottom: 12, gap: 6 },
  followUpChip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  followUpText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  typingDots: { flexDirection: "row", gap: 4, paddingVertical: 4, paddingHorizontal: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  quickActionsContainer: { marginBottom: 16 },
  quickActionsTitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 10 },
  quickActionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickAction: { width: "48%", flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, gap: 10 },
  quickActionIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  quickActionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  inputBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10 },
  voiceBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 8 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 8 },
  voiceBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 100 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  followUpBar: { marginBottom: 4 },
  inputSuggestion: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  inputSuggestionText: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
