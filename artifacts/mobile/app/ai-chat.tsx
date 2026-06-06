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
import { TalkingAvatar, type TalkingAvatarHandle } from "@/components/TalkingAvatar";

// Entity types come from the Commandant IA conversations endpoint
// (POST /api/commandant/conversations/:id/messages -> assistantMessage.metadata.retrievedEntities).
// The server uses English type names and web URLs; we map them to mobile routes here.
type ServerEntityType = "contact" | "task" | "event" | "invoice" | "prospect";

interface RetrievedEntity {
  id: number;
  type: ServerEntityType;
  label: string;
  url: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  entities?: RetrievedEntity[];
}

const ENTITY_META: Record<ServerEntityType, { icon: keyof typeof Feather.glyphMap; color: string; bg: string; label: string }> = {
  contact:  { icon: "user",         color: "#3b82f6", bg: "#3b82f618", label: "Contact" },
  task:     { icon: "check-square", color: "#22c55e", bg: "#22c55e18", label: "Tache" },
  event:    { icon: "calendar",     color: "#8b5cf6", bg: "#8b5cf618", label: "Evenement" },
  invoice:  { icon: "file-text",    color: "#f97316", bg: "#f9731618", label: "Facture" },
  prospect: { icon: "target",       color: "#ec4899", bg: "#ec489918", label: "Prospect" },
};

// Map a retrieved entity to the matching screen inside the mobile app.
// The server's `url` field holds web routes; on mobile we redirect to the
// equivalent native screen. Mobile factures live on the /abonnement screen
// (see artifacts/mobile/app/abonnement.tsx, which fetches /api/my-subscription/invoices
// and renders a "Factures recentes" section).
function entityRoute(e: RetrievedEntity): string {
  switch (e.type) {
    case "contact":  return `/contact-detail?id=${e.id}`;
    case "task":     return `/tasks?id=${e.id}`;
    case "event":    return `/calendar?id=${e.id}`;
    case "invoice":  return `/abonnement?factureId=${e.id}`;
    case "prospect": return `/prospects?id=${e.id}`;
    default:         return "/";
  }
}

function normalizeEntities(raw: any): RetrievedEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: RetrievedEntity[] = [];
  for (const e of raw) {
    if (!e || typeof e.id !== "number" || typeof e.type !== "string") continue;
    if (!(e.type in ENTITY_META)) continue;
    out.push({
      id: e.id,
      type: e.type as ServerEntityType,
      label: typeof e.label === "string" && e.label ? e.label : `${ENTITY_META[e.type as ServerEntityType].label} #${e.id}`,
      url: typeof e.url === "string" ? e.url : "",
    });
  }
  return out;
}

const CONVERSATION_ID_KEY = "commandant_conversation_id";
const VOICE_PREF_KEY = "buro.aichat.voice";

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
  const lines = (text || "").split("\n");
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
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceLang, setVoiceLang] = useState<"fr" | "tr">("fr");
  const [spokenText, setSpokenText] = useState("");
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [voicePrefsLoaded, setVoicePrefsLoaded] = useState(false);
  const avatarRef = useRef<TalkingAvatarHandle>(null);
  const flatListRef = useRef<FlatList>(null);
  const recognitionRef = useRef<any>(null);

  const SpeechRecognitionClass = isWeb
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

  const conversationIdRef = useRef<number | null>(null);

  const welcomeMessage = useCallback((): Message => ({
    id: "welcome",
    role: "assistant",
    content: `Bonjour ${user?.prenom || ""}! Je suis votre Commandant IA. Je peux vous aider avec:\n\n- Briefing quotidien et analyses\n- Recherche dans vos donnees\n- Conseils strategiques CRM\n- Suivi des performances\n\nComment puis-je vous aider?`,
    timestamp: new Date().toISOString(),
  }), [user?.prenom]);

  // Load persisted voice preference (on/off + language) once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(VOICE_PREF_KEY);
        if (raw && !cancelled) {
          const p = JSON.parse(raw) as { on?: boolean; lang?: string };
          if (typeof p.on === "boolean") setVoiceOn(p.on);
          if (p.lang === "fr" || p.lang === "tr") setVoiceLang(p.lang);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setVoicePrefsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist voice preference whenever it changes (after the initial load).
  useEffect(() => {
    if (!voicePrefsLoaded) return;
    AsyncStorage.setItem(VOICE_PREF_KEY, JSON.stringify({ on: voiceOn, lang: voiceLang })).catch(() => {});
  }, [voicePrefsLoaded, voiceOn, voiceLang]);

  // Load (or create) the persistent Commandant IA conversation, then hydrate
  // history from the server. Server-side messages already include the
  // metadata.retrievedEntities payload we want to render as chips.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedId = await AsyncStorage.getItem(CONVERSATION_ID_KEY);
        let convId = storedId ? parseInt(storedId, 10) : NaN;

        if (Number.isFinite(convId)) {
          const r = await fetchAuth(`${API_BASE}/api/commandant/conversations/${convId}/messages`);
          if (r.ok) {
            const d = await r.json();
            if (d?.success && Array.isArray(d.messages)) {
              if (cancelled) return;
              conversationIdRef.current = convId;
              const hydrated: Message[] = d.messages.map((m: any) => ({
                id: `s-${m.id}`,
                role: m.role === "user" ? "user" : "assistant",
                content: String(m.content ?? ""),
                timestamp: m.createdAt ?? new Date().toISOString(),
                entities: m.role === "assistant" ? normalizeEntities(m.metadata?.retrievedEntities) : undefined,
              }));
              setMessages(hydrated.length > 0 ? hydrated : [welcomeMessage()]);
              setHistoryLoaded(true);
              return;
            }
          }
          // Stored conv no longer accessible — fall through to create a new one.
          convId = NaN;
        }

        // Create a fresh conversation lazily; messages stay empty until the user sends one.
        const c = await fetchAuth(`${API_BASE}/api/commandant/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Conversation mobile" }),
        });
        if (c.ok) {
          const d = await c.json();
          if (d?.conversation?.id) {
            conversationIdRef.current = d.conversation.id;
            await AsyncStorage.setItem(CONVERSATION_ID_KEY, String(d.conversation.id));
          }
        }
      } catch {}
      if (!cancelled) {
        setMessages([welcomeMessage()]);
        setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchAuth, welcomeMessage]);

  const ensureConversationId = useCallback(async (): Promise<number | null> => {
    if (conversationIdRef.current) return conversationIdRef.current;
    try {
      const c = await fetchAuth(`${API_BASE}/api/commandant/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Conversation mobile" }),
      });
      if (c.ok) {
        const d = await c.json();
        if (d?.conversation?.id) {
          conversationIdRef.current = d.conversation.id;
          await AsyncStorage.setItem(CONVERSATION_ID_KEY, String(d.conversation.id));
          return d.conversation.id;
        }
      }
    } catch {}
    return null;
  }, [fetchAuth]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isTyping) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: text.trim(), timestamp: new Date().toISOString() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setIsTyping(true);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const convId = await ensureConversationId();
      if (!convId) throw new Error("no-conversation");

      const res = await fetchAuth(`${API_BASE}/api/commandant/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      });

      let reply = "Desole, je n'ai pas pu traiter votre demande. Veuillez reessayer.";
      let entities: RetrievedEntity[] = [];
      let serverId: number | undefined;
      let serverTs: string | undefined;
      if (res.ok) {
        const data = await res.json();
        const am = data?.assistantMessage;
        if (am?.content) {
          reply = String(am.content);
          entities = normalizeEntities(am.metadata?.retrievedEntities);
          serverId = typeof am.id === "number" ? am.id : undefined;
          serverTs = am.createdAt;
        }
      }
      const aiMsg: Message = {
        id: serverId != null ? `s-${serverId}` : `a-${Date.now()}`,
        role: "assistant",
        content: reply,
        timestamp: serverTs ?? new Date().toISOString(),
        entities: entities.length > 0 ? entities : undefined,
      };
      setMessages([...updated, aiMsg]);
      if (voiceOn) setSpokenText(reply);
    } catch {
      const errorMsg: Message = { id: `e-${Date.now()}`, role: "assistant", content: "Une erreur est survenue. Verifiez votre connexion et reessayez.", timestamp: new Date().toISOString() };
      setMessages([...updated, errorMsg]);
    } finally {
      setIsTyping(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
    }
  }, [fetchAuth, isTyping, messages, ensureConversationId, voiceOn]);

  async function clearHistory() {
    // Start a brand-new server-side conversation so the assistant forgets prior context.
    conversationIdRef.current = null;
    try { await AsyncStorage.removeItem(CONVERSATION_ID_KEY); } catch {}
    try {
      const c = await fetchAuth(`${API_BASE}/api/commandant/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Conversation mobile" }),
      });
      if (c.ok) {
        const d = await c.json();
        if (d?.conversation?.id) {
          conversationIdRef.current = d.conversation.id;
          await AsyncStorage.setItem(CONVERSATION_ID_KEY, String(d.conversation.id));
        }
      }
    } catch {}
    setMessages([{ ...welcomeMessage(), content: "Conversation reinitialise. Comment puis-je vous aider?" }]);
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
        {!isUser && item.entities && item.entities.length > 0 && (
          <View style={styles.entityChipsRow}>
            {item.entities.map((e, i) => {
              const meta = ENTITY_META[e.type];
              return (
                <Pressable
                  key={`${e.type}-${e.id}-${i}`}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(entityRoute(e) as any);
                  }}
                  style={[styles.entityChip, { backgroundColor: meta.bg, borderColor: meta.color + "40" }]}
                >
                  <Feather name={meta.icon} size={11} color={meta.color} />
                  <Text style={[styles.entityChipText, { color: meta.color }]} numberOfLines={1}>{e.label}</Text>
                  <Feather name="external-link" size={9} color={meta.color} style={{ opacity: 0.6 }} />
                </Pressable>
              );
            })}
          </View>
        )}
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
            <View style={styles.headerAvatarWrap}>
              <TalkingAvatar
                ref={avatarRef}
                text={voiceOn ? spokenText : ""}
                lang={voiceLang}
                size={40}
                muted={!voiceOn}
                autoPlay
                onAvailability={({ hasVoice }) => setVoiceUnavailable(!hasVoice)}
                onSpeakingChange={setAvatarSpeaking}
              />
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
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setVoiceLang((l) => (l === "fr" ? "tr" : "fr"));
              }}
              style={styles.langBtn}
              hitSlop={8}
            >
              <Text style={styles.langBtnText}>{voiceLang.toUpperCase()}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setVoiceOn((v) => !v);
              }}
              style={styles.clearBtn}
              hitSlop={12}
            >
              <Feather name={voiceOn ? "volume-2" : "volume-x"} size={16} color="rgba(255,255,255,0.85)" />
            </Pressable>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (avatarSpeaking) avatarRef.current?.stop();
                else if (spokenText.trim()) avatarRef.current?.speak(spokenText);
              }}
              disabled={!voiceOn || (!avatarSpeaking && !spokenText.trim())}
              style={[styles.clearBtn, (!voiceOn || (!avatarSpeaking && !spokenText.trim())) && { opacity: 0.4 }]}
              hitSlop={12}
            >
              <Feather name={avatarSpeaking ? "square" : "rotate-ccw"} size={15} color="rgba(255,255,255,0.85)" />
            </Pressable>
            <Pressable onPress={clearHistory} style={styles.clearBtn} hitSlop={12}>
              <Feather name="trash-2" size={16} color="rgba(255,255,255,0.6)" />
            </Pressable>
          </View>
        </View>
        {voiceOn && voiceUnavailable && (
          <Text style={styles.voiceHint}>
            Aucune voix {voiceLang === "fr" ? "française" : "turque"} sur cet appareil — l'avatar reste muet.
          </Text>
        )}
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
  headerAvatarWrap: { width: 40, height: 40, borderRadius: 20, overflow: "hidden" },
  langBtn: { paddingHorizontal: 8, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  langBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  msgCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clearBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  voiceHint: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8, paddingHorizontal: 4 },
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
  entityChipsRow: { paddingLeft: 36, marginTop: -4, marginBottom: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  entityChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, borderWidth: 1, maxWidth: 220 },
  entityChipText: { fontSize: 11, fontFamily: "Inter_500Medium", flexShrink: 1 },
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
