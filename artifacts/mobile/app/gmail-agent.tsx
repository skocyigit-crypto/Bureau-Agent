import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface GmailProfile {
  email: string;
  name?: string;
  messagesTotal: number;
  threadsTotal: number;
}

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  read: boolean;
  starred: boolean;
  hasAttachment: boolean;
  labelIds: string[];
  body?: string;
  aiPriority?: string;
  aiSummary?: string;
  aiAction?: string;
}

interface ComposeData {
  to: string;
  subject: string;
  body: string;
  replyToId?: string;
  replyToAll?: boolean;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  critique: { bg: "#fef2f2", text: "#ef4444", label: "Critique" },
  haute:    { bg: "#fff7ed", text: "#f97316", label: "Haute" },
  normale:  { bg: "#eff6ff", text: "#3b82f6", label: "Normale" },
  basse:    { bg: "#f9fafb", text: "#6b7280", label: "Basse" },
};

function fmtDate(d: string) {
  if (!d) return "";
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.getDate() === yesterday.getDate()) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function parseEmailName(str: string) {
  const m = str.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() || str };
  return { name: str, email: str };
}

function AvatarInitials({ name, size = 36, color = "#6366f1" }: { name: string; size?: number; color?: string }) {
  const initials = name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + "22", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.38, fontFamily: "Inter_700Bold", color }}>{initials || "?"}</Text>
    </View>
  );
}

export default function GmailAgentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [profile, setProfile] = useState<GmailProfile | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GmailMessage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [compose, setCompose] = useState<ComposeData>({ to: "", subject: "", body: "" });
  const [sendLoading, setSendLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const [profileRes, inboxRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/gmail/profile`),
        fetchAuth(`${API_BASE}/api/gmail/inbox?maxResults=30`),
      ]);
      if (profileRes.status === 401 || profileRes.status === 403 || inboxRes.status === 401 || inboxRes.status === 403) {
        setNotConnected(true);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (profileRes.ok) setProfile(await profileRes.json());
      if (inboxRes.ok) {
        const d = await inboxRes.json();
        setMessages(d.messages ?? d ?? []);
        setNotConnected(false);
      }
    } catch {
      setNotConnected(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function openMessage(msg: GmailMessage) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected({ ...msg });
    if (!msg.body) {
      setDetailLoading(true);
      try {
        const res = await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}`);
        if (res.ok) {
          const d = await res.json();
          setSelected(prev => prev ? { ...prev, ...d } : d);
        }
      } finally { setDetailLoading(false); }
    }
    if (!msg.read) {
      fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/read`, { method: "PATCH" }).catch(() => {});
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m));
    }
  }

  async function handleStar(msg: GmailMessage) {
    setActionLoading("star-" + msg.id);
    try {
      await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/star`, { method: "PATCH" });
      const next = !msg.starred;
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, starred: next } : m));
      if (selected?.id === msg.id) setSelected(prev => prev ? { ...prev, starred: next } : prev);
    } finally { setActionLoading(null); }
  }

  async function handleArchive(msg: GmailMessage) {
    setActionLoading("archive-" + msg.id);
    try {
      const res = await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/archive`, { method: "POST" });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        setSelected(null);
      }
    } finally { setActionLoading(null); }
  }

  async function handleTrash(msg: GmailMessage) {
    const doTrash = async () => {
      setActionLoading("trash-" + msg.id);
      try {
        await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/trash`, { method: "DELETE" });
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        setSelected(null);
      } finally { setActionLoading(null); }
    };
    if (Platform.OS === "web") { doTrash(); return; }
    Alert.alert("Supprimer", "Déplacer cet email dans la corbeille ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Corbeille", style: "destructive", onPress: doTrash },
    ]);
  }

  async function handleSend() {
    if (!compose.to.trim() || !compose.subject.trim() || !compose.body.trim()) return;
    setSendLoading(true);
    try {
      const endpoint = compose.replyToId ? "/api/gmail/reply" : "/api/gmail/send";
      const body = compose.replyToId
        ? { messageId: compose.replyToId, to: compose.to, subject: compose.subject, body: compose.body }
        : { to: compose.to, subject: compose.subject, body: compose.body };
      const res = await fetchAuth(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowCompose(false);
        setCompose({ to: "", subject: "", body: "" });
        load();
      }
    } finally { setSendLoading(false); }
  }

  function openReply(msg: GmailMessage) {
    const { email } = parseEmailName(msg.from);
    setCompose({
      to: email,
      subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
      body: `\n\n---\nDe: ${msg.from}\nDate: ${fmtDate(msg.date)}\n\n${msg.snippet}`,
      replyToId: msg.id,
    });
    setSelected(null);
    setShowCompose(true);
  }

  const unread = messages.filter(m => !m.read).length;
  const starred = messages.filter(m => m.starred).length;

  if (notConnected) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Gmail Agent</Text>
        </View>
        <View style={styles.notConnected}>
          <View style={[styles.notConnectedIcon, { backgroundColor: "#fee2e2" }]}>
            <Feather name="mail" size={40} color="#ef4444" />
          </View>
          <Text style={[styles.notConnectedTitle, { color: colors.foreground }]}>Gmail non connecté</Text>
          <Text style={[styles.notConnectedSub, { color: colors.mutedForeground }]}>
            Connectez votre compte Gmail dans les paramètres Google Workspace pour accéder à votre boîte mail depuis l'app.
          </Text>
          <Pressable onPress={() => router.push("/integrations" as any)} style={styles.connectBtn}>
            <Feather name="settings" size={16} color="#fff" />
            <Text style={styles.connectBtnText}>Gérer les intégrations</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Gmail Agent</Text>
            {profile && (
              <Text style={styles.headerSub}>{profile.email}</Text>
            )}
          </View>
          <View style={styles.headerActions}>
            {unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{unread}</Text>
              </View>
            )}
            <Pressable
              onPress={() => { setCompose({ to: "", subject: "", body: "" }); setShowCompose(true); }}
              style={[styles.composeBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
            >
              <Feather name="edit" size={16} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Stats */}
        {profile && (
          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <Feather name="mail" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.statText}>{messages.length} messages</Text>
            </View>
            <View style={styles.statChip}>
              <Feather name="bell" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.statText}>{unread} non lus</Text>
            </View>
            <View style={styles.statChip}>
              <Feather name="star" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.statText}>{starred} étoilés</Text>
            </View>
          </View>
        )}

        {/* Search */}
        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.6)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={14} color="rgba(255,255,255,0.6)" onPress={() => setSearch("")} /> : null}
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#dc2626" />
        </View>
      ) : (
        <FlatList
          data={messages.filter(m =>
            !search ||
            m.subject.toLowerCase().includes(search.toLowerCase()) ||
            m.from.toLowerCase().includes(search.toLowerCase()) ||
            m.snippet.toLowerCase().includes(search.toLowerCase())
          )}
          keyExtractor={m => m.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#dc2626" />}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          ListEmptyComponent={
            <EmptyState icon="mail" title="Aucun email" subtitle={search ? "Aucun email correspond à votre recherche." : "Votre boîte de réception est vide."} />
          }
          renderItem={({ item }) => {
            const { name } = parseEmailName(item.from);
            const prio = item.aiPriority ? PRIORITY_COLORS[item.aiPriority] : null;
            return (
              <Pressable
                onPress={() => openMessage(item)}
                style={({ pressed }) => [
                  styles.msgRow,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                  !item.read && { borderLeftWidth: 3, borderLeftColor: "#dc2626" },
                ]}
              >
                <AvatarInitials name={name} size={40} color="#dc2626" />
                <View style={{ flex: 1 }}>
                  <View style={styles.msgRowTop}>
                    <Text style={[styles.msgFrom, { color: colors.foreground, fontFamily: item.read ? "Inter_400Regular" : "Inter_700Bold" }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      {item.starred && <Feather name="star" size={11} color="#f59e0b" />}
                      {item.hasAttachment && <Feather name="paperclip" size={11} color={colors.mutedForeground} />}
                      <Text style={[styles.msgDate, { color: colors.mutedForeground }]}>{fmtDate(item.date)}</Text>
                    </View>
                  </View>
                  <Text style={[styles.msgSubject, { color: colors.foreground, fontFamily: item.read ? "Inter_500Medium" : "Inter_700Bold" }]} numberOfLines={1}>
                    {item.subject || "(Sans objet)"}
                  </Text>
                  <View style={styles.msgRowBottom}>
                    <Text style={[styles.msgSnippet, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.snippet}
                    </Text>
                    {prio && (
                      <View style={[styles.prioPill, { backgroundColor: prio.bg }]}>
                        <Text style={[styles.prioText, { color: prio.text }]}>{prio.label}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        {selected && (
          <View style={[styles.detailContainer, { backgroundColor: colors.background }]}>
            {/* Detail Header */}
            <View style={[styles.detailHeader, { backgroundColor: "#dc2626", paddingTop: isWeb ? 20 : insets.top + 8 }]}>
              <View style={styles.detailHeaderTop}>
                <Pressable onPress={() => setSelected(null)} style={styles.backBtn}>
                  <Feather name="x" size={20} color="#fff" />
                </Pressable>
                <Text style={[styles.headerTitle, { flex: 1 }]} numberOfLines={1}>{selected.subject || "(Sans objet)"}</Text>
                <Pressable onPress={() => handleStar(selected)} style={styles.backBtn}>
                  {actionLoading === "star-" + selected.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name="star" size={18} color={selected.starred ? "#fbbf24" : "#fff"} />
                  }
                </Pressable>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {/* Sender info */}
              <View style={[styles.senderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <AvatarInitials name={parseEmailName(selected.from).name} size={44} color="#dc2626" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.senderName, { color: colors.foreground }]}>{parseEmailName(selected.from).name}</Text>
                    <Text style={[styles.senderEmail, { color: colors.mutedForeground }]}>{parseEmailName(selected.from).email}</Text>
                    <Text style={[styles.senderDate, { color: colors.mutedForeground }]}>{fmtDate(selected.date)}</Text>
                  </View>
                </View>
                {selected.to && (
                  <Text style={[styles.senderTo, { color: colors.mutedForeground }]}>
                    À : {selected.to}
                  </Text>
                )}
              </View>

              {/* AI Summary */}
              {selected.aiSummary && (
                <View style={[styles.aiCard, { borderColor: "#6366f1" }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Feather name="cpu" size={13} color="#6366f1" />
                    <Text style={[styles.aiCardTitle, { color: "#6366f1" }]}>Résumé IA</Text>
                    {selected.aiPriority && (
                      <View style={[styles.prioPill, { backgroundColor: PRIORITY_COLORS[selected.aiPriority]?.bg ?? "#f9fafb", marginLeft: "auto" }]}>
                        <Text style={[styles.prioText, { color: PRIORITY_COLORS[selected.aiPriority]?.text ?? "#6b7280" }]}>
                          {PRIORITY_COLORS[selected.aiPriority]?.label}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.aiCardBody, { color: "#374151" }]}>{selected.aiSummary}</Text>
                  {selected.aiAction && (
                    <Text style={[styles.aiCardAction, { color: "#6366f1" }]}>
                      Action suggérée : {selected.aiAction}
                    </Text>
                  )}
                </View>
              )}

              {/* Body */}
              {detailLoading ? (
                <ActivityIndicator color="#dc2626" style={{ marginTop: 24 }} />
              ) : (
                <View style={[styles.bodyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    {selected.body || selected.snippet}
                  </Text>
                </View>
              )}

              {/* Actions */}
              <View style={styles.detailActions}>
                <Pressable
                  onPress={() => openReply(selected)}
                  style={[styles.actionBtn, { backgroundColor: "#dc2626" }]}
                >
                  <Feather name="corner-down-left" size={15} color="#fff" />
                  <Text style={styles.actionBtnText}>Répondre</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleArchive(selected)}
                  style={[styles.actionBtn, { backgroundColor: "#6366f1" }]}
                  disabled={actionLoading === "archive-" + selected.id}
                >
                  {actionLoading === "archive-" + selected.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name="archive" size={15} color="#fff" />
                  }
                  <Text style={styles.actionBtnText}>Archiver</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleTrash(selected)}
                  style={[styles.actionBtn, { backgroundColor: "#ef4444" }]}
                  disabled={actionLoading === "trash-" + selected.id}
                >
                  {actionLoading === "trash-" + selected.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name="trash-2" size={15} color="#fff" />
                  }
                  <Text style={styles.actionBtnText}>Corbeille</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* Compose Modal */}
      <Modal visible={showCompose} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCompose(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.detailContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.detailHeader, { backgroundColor: "#dc2626", paddingTop: isWeb ? 20 : insets.top + 8 }]}>
              <View style={styles.detailHeaderTop}>
                <Pressable onPress={() => setShowCompose(false)} style={styles.backBtn}>
                  <Feather name="x" size={20} color="#fff" />
                </Pressable>
                <Text style={styles.headerTitle}>{compose.replyToId ? "Répondre" : "Nouveau message"}</Text>
                <Pressable
                  onPress={handleSend}
                  disabled={sendLoading || !compose.to || !compose.subject || !compose.body}
                  style={[styles.sendActionBtn, { opacity: sendLoading || !compose.to || !compose.subject || !compose.body ? 0.5 : 1 }]}
                >
                  {sendLoading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={18} color="#fff" />}
                </Pressable>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              <View style={[styles.composeField, { borderColor: colors.border }]}>
                <Text style={[styles.composeLabel, { color: colors.mutedForeground }]}>À</Text>
                <TextInput
                  style={[styles.composeInput, { color: colors.foreground }]}
                  value={compose.to}
                  onChangeText={v => setCompose(p => ({ ...p, to: v }))}
                  placeholder="email@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View style={[styles.composeField, { borderColor: colors.border }]}>
                <Text style={[styles.composeLabel, { color: colors.mutedForeground }]}>Objet</Text>
                <TextInput
                  style={[styles.composeInput, { color: colors.foreground }]}
                  value={compose.subject}
                  onChangeText={v => setCompose(p => ({ ...p, subject: v }))}
                  placeholder="Objet du message"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={[styles.composeBodyField, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <TextInput
                  style={[styles.composeBodyInput, { color: colors.foreground }]}
                  value={compose.body}
                  onChangeText={v => setCompose(p => ({ ...p, body: v }))}
                  placeholder="Écrivez votre message..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  numberOfLines={12}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#dc2626", paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  unreadBadge: { backgroundColor: "#fbbf24", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#7c2d12" },
  composeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 10, height: 38, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 1 },
  msgRow: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  msgRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  msgFrom: { fontSize: 13, flex: 1, marginRight: 8 },
  msgDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  msgSubject: { fontSize: 13, marginBottom: 2 },
  msgRowBottom: { flexDirection: "row", alignItems: "center", gap: 6 },
  msgSnippet: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  prioPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  prioText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  notConnected: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  notConnectedIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  notConnectedTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  notConnectedSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, maxWidth: 300 },
  connectBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#dc2626", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  connectBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  detailContainer: { flex: 1 },
  detailHeader: { paddingHorizontal: 16, paddingBottom: 12 },
  detailHeaderTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  senderCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12, gap: 8 },
  senderName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  senderEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  senderDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  senderTo: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  aiCard: { borderRadius: 12, borderWidth: 1.5, padding: 14, marginBottom: 12, backgroundColor: "#f5f3ff" },
  aiCardTitle: { fontSize: 12, fontFamily: "Inter_700Bold" },
  aiCardBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  aiCardAction: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  bodyCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  bodyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  detailActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, flex: 1 },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sendActionBtn: { padding: 6 },
  composeField: { borderBottomWidth: 1, flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  composeLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", width: 44 },
  composeInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  composeBodyField: { borderRadius: 12, borderWidth: 1, padding: 12, minHeight: 200 },
  composeBodyInput: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, flex: 1, minHeight: 180 },
});
