import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useUnreadBadges } from "@/contexts/UnreadBadgesContext";
import { useColors } from "@/hooks/useColors";
import { useOfflineCache } from "@/hooks/useOfflineCache";

interface Message {
  id: number;
  contactName: string;
  phoneNumber: string;
  content: string;
  type: string;
  priority: string;
  isRead: boolean;
  createdAt: string;
}

const TYPE_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  messagerie_vocale: { label: "Messagerie vocale", color: "#8b5cf6", icon: "mic" },
  note: { label: "Note", color: "#f59e0b", icon: "file-text" },
  rappel: { label: "Rappel", color: "#3b82f6", icon: "bell" },
};

const PRIORITY_COLORS: Record<string, string> = {
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#22c55e",
};

const FORM_FIELDS = [
  { key: "contactName", label: "Nom du contact", required: true },
  { key: "phoneNumber", label: "Telephone", type: "phone" as const, required: true },
  {
    key: "type", label: "Type", type: "select" as const, options: [
      { value: "messagerie_vocale", label: "Messagerie vocale" },
      { value: "note", label: "Note" },
      { value: "rappel", label: "Rappel" },
    ],
  },
  {
    key: "priority", label: "Priorite", type: "select" as const, options: [
      { value: "basse", label: "Basse" },
      { value: "moyenne", label: "Moyenne" },
      { value: "haute", label: "Haute" },
    ],
  },
  { key: "content", label: "Contenu", type: "multiline" as const, required: true },
];

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const { clearKey } = useUnreadBadges();
  // Tâche #83 : `open=<id>` est posé par le tap sur la notification
  // "Nouveau message" (cf. `_layout.tsx`). On ouvre directement le détail
  // dès que le message correspondant est présent dans la liste.
  const { open: openParam } = useLocalSearchParams<{ open?: string | string[] }>();
  const consumedOpenRef = useRef<string | null>(null);
  const isWeb = Platform.OS === "web";
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ type: "note", priority: "moyenne", phoneNumber: "" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<Message | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const swipeRefs = useRef<Record<number, Swipeable | null>>({});

  const { cached, isFromCache, updateCache } = useOfflineCache<Message[]>("messages_list", []);

  const fetchMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100", sortOrder: "desc" });
      if (search) params.set("search", search);
      if (filter !== "all") params.set("type", filter);
      const res = await fetchAuth(`${API_BASE}/api/messages?${params}`);
      if (res.ok) {
        const data = await res.json();
        const list = data.messages ?? [];
        setMessages(list);
        updateCache(list);
      }
    } catch {
      if (cached && messages.length === 0) setMessages(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, filter, fetchAuth]);

  useEffect(() => {
    if (cached && messages.length === 0) setMessages(cached);
    setLoading(true);
    fetchMessages();
  }, [fetchMessages]);

  // Vider le badge "messages non lus" dès que la secrétaire ouvre l'écran.
  useFocusEffect(
    useCallback(() => {
      clearKey("message");
    }, [clearKey]),
  );

  // Tâche #83 : ouvrir le bon message quand on arrive via une notification.
  // On essaie d'abord la liste courante (instantané), sinon on fait un
  // GET ciblé `/api/messages/:id` pour ne pas dépendre du filtre / de la
  // recherche actifs ni d'un fetch encore en cours. `consumedOpenRef`
  // empêche de ré-ouvrir le détail si l'utilisateur ferme le modal.
  useEffect(() => {
    const idStr = Array.isArray(openParam) ? openParam[0] : openParam;
    if (!idStr || consumedOpenRef.current === idStr) return;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) return;
    const found = messages.find((m) => m.id === id);
    if (found) {
      consumedOpenRef.current = idStr;
      setSelected(found);
      markAsRead(found);
      return;
    }
    // Fallback : la liste filtrée ne contient pas l'item — on le récupère
    // directement par id pour garantir l'ouverture (Tâche #83).
    let cancelled = false;
    consumedOpenRef.current = idStr;
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/messages/${id}`);
        if (!res.ok || cancelled) return;
        const msg = (await res.json()) as Message;
        if (cancelled || !msg || typeof msg.id !== "number") return;
        setSelected(msg);
        markAsRead(msg);
      } catch {
        // Tant pis : l'utilisateur reste sur la liste, pas pire que l'ancien comportement.
      }
    })();
    return () => { cancelled = true; };
  }, [openParam, messages, fetchAuth]);

  function onRefresh() { setRefreshing(true); fetchMessages(); }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  async function handleSubmit() {
    if (!formValues.content?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/messages/${editId}` : `${API_BASE}/api/messages`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ type: "note", priority: "moyenne", phoneNumber: "" });
        fetchMessages();
      }
    } catch {} finally { setFormLoading(false); }
  }

  function openEdit(msg: Message) {
    setEditId(msg.id);
    setFormValues({
      contactName: msg.contactName || "",
      phoneNumber: msg.phoneNumber || "",
      type: msg.type || "note",
      priority: msg.priority || "moyenne",
      content: msg.content || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  async function markAsRead(msg: Message) {
    if (msg.isRead) return;
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isRead: true } : m));
    try {
      await fetchAuth(`${API_BASE}/api/messages/${msg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
    } catch {}
  }

  async function markAllRead() {
    const unread = messages.filter((m) => !m.isRead);
    if (!unread.length) return;
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
    await Promise.all(
      unread.map((m) =>
        fetchAuth(`${API_BASE}/api/messages/${m.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isRead: true }),
        })
      )
    );
  }

  async function handleDelete(id: number) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setSelected(null);
    try {
      await fetchAuth(`${API_BASE}/api/messages/${id}`, { method: "DELETE" });
    } catch {
      fetchMessages();
    }
  }

  function confirmDelete(id: number) {
    if (Platform.OS === "web") {
      handleDelete(id);
      return;
    }
    Alert.alert("Supprimer", "Supprimer ce message ?", [
      { text: "Annuler", style: "cancel", onPress: () => swipeRefs.current[id]?.close() },
      { text: "Supprimer", style: "destructive", onPress: () => handleDelete(id) },
    ]);
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "messagerie_vocale", label: "Vocal" },
    { key: "note", label: "Notes" },
    { key: "rappel", label: "Rappels" },
  ];

  const unreadCount = messages.filter((m) => !m.isRead).length;

  function renderRightActions(id: number) {
    return (
      <Pressable
        onPress={() => confirmDelete(id)}
        style={[styles.swipeAction, { backgroundColor: "#ef4444" }]}
      >
        <Feather name="trash-2" size={20} color="#fff" />
        <Text style={styles.swipeActionText}>Suppr.</Text>
      </Pressable>
    );
  }

  function renderLeftActions(id: number) {
    return (
      <Pressable
        onPress={() => {
          const msg = messages.find((m) => m.id === id);
          if (msg) { markAsRead(msg); swipeRefs.current[id]?.close(); }
        }}
        style={[styles.swipeAction, { backgroundColor: "#22c55e" }]}
      >
        <Feather name="check" size={20} color="#fff" />
        <Text style={styles.swipeActionText}>Lu</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Messages</Text>
            {unreadCount > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </View>
          {unreadCount > 0 ? (
            <Pressable onPress={markAllRead} hitSlop={12}>
              <Text style={styles.markAllBtn}>Tout lire</Text>
            </Pressable>
          ) : (
            <View style={{ width: 50 }} />
          )}
        </View>

        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Feather name="x" size={16} color="rgba(255,255,255,0.5)" /></Pressable> : null}
        </View>

        <View style={styles.filterRow}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, { backgroundColor: filter === f.key ? colors.primary : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.filterText, { color: filter === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {isFromCache && (
          <View style={styles.cacheRow}>
            <Feather name="wifi-off" size={11} color="rgba(255,255,255,0.5)" />
            <Text style={styles.cacheText}>Cache hors ligne</Text>
          </View>
        )}
      </View>

      {loading && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="message-square" title="Aucun message" subtitle="Les messages apparaitront ici" />}
          renderItem={({ item }) => {
            const type = TYPE_MAP[item.type] ?? { label: item.type, color: "#64748b", icon: "message-square" as const };
            return (
              <Swipeable
                ref={(ref) => { swipeRefs.current[item.id] = ref; }}
                renderRightActions={() => renderRightActions(item.id)}
                renderLeftActions={item.isRead ? undefined : () => renderLeftActions(item.id)}
                friction={2}
                onSwipeableOpen={(dir) => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (dir === "right") confirmDelete(item.id);
                  else if (dir === "left") { markAsRead(item); swipeRefs.current[item.id]?.close(); }
                }}
              >
                <Pressable
                  onPress={() => { markAsRead(item); setSelected(item); }}
                  style={({ pressed }) => [
                    styles.msgCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderLeftColor: item.isRead ? colors.border : type.color,
                    },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  {!item.isRead && (
                    <View style={[styles.unreadDot, { backgroundColor: type.color }]} />
                  )}
                  <View style={[styles.iconCircle, { backgroundColor: type.color + "18" }]}>
                    <Feather name={type.icon} size={18} color={item.isRead ? colors.mutedForeground : type.color} />
                  </View>
                  <View style={styles.msgBody}>
                    <View style={styles.msgTop}>
                      <Text style={[styles.msgName, { color: colors.foreground, fontFamily: item.isRead ? "Inter_500Medium" : "Inter_700Bold" }]} numberOfLines={1}>
                        {item.contactName || item.phoneNumber || "Inconnu"}
                      </Text>
                      <Text style={[styles.msgTime, { color: colors.mutedForeground }]}>{formatTime(item.createdAt)}</Text>
                    </View>
                    <Text style={[styles.msgContent, { color: colors.mutedForeground }]} numberOfLines={2}>{item.content}</Text>
                    <View style={styles.msgBottom}>
                      <View style={[styles.typePill, { backgroundColor: type.color + "18" }]}>
                        <Text style={[styles.typePillText, { color: type.color }]}>{type.label}</Text>
                      </View>
                      {item.priority && (
                        <View style={[styles.priorityPill, { backgroundColor: (PRIORITY_COLORS[item.priority] ?? "#64748b") + "18" }]}>
                          <Text style={[styles.priorityText, { color: PRIORITY_COLORS[item.priority] ?? "#64748b" }]}>
                            {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              </Swipeable>
            );
          }}
        />
      )}

      <FAB onPress={() => { setEditId(null); setFormValues({ type: "note", priority: "moyenne", phoneNumber: "" }); setShowForm(true); }} />

      <FormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditId(null); }}
        onSubmit={handleSubmit}
        title={editId ? "Modifier le message" : "Nouveau message"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="send"
        submitLabel={editId ? "Enregistrer" : "Creer"}
      />

      {selected ? (
        <DetailModal
          visible
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => handleDelete(selected.id)}
          title={selected.contactName || "Message"}
          subtitle={selected.phoneNumber}
          icon={(TYPE_MAP[selected.type]?.icon ?? "message-square") as keyof typeof Feather.glyphMap}
          iconColor={TYPE_MAP[selected.type]?.color}
          badge={{ label: TYPE_MAP[selected.type]?.label ?? selected.type, color: TYPE_MAP[selected.type]?.color ?? "#64748b" }}
          fields={[
            { label: "Contenu", value: selected.content || "-", icon: "file-text" },
            { label: "Priorite", value: selected.priority === "haute" ? "Haute" : selected.priority === "moyenne" ? "Moyenne" : "Basse", icon: "flag", color: PRIORITY_COLORS[selected.priority] },
            { label: "Date", value: new Date(selected.createdAt).toLocaleString("fr-FR"), icon: "clock" },
            { label: "Lu", value: selected.isRead ? "Oui" : "Non", icon: selected.isRead ? "check" : "circle" },
            ...(selected.phoneNumber ? [{ label: "Telephone", value: selected.phoneNumber, icon: "phone" as const, action: "call" as const }] : []),
          ]}
          extraActions={[{
            label: "Créer un projet",
            icon: "folder",
            color: "#6366f1",
            onPress: async () => {
              try {
                const res = await fetchAuth(`${API_BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Suivi message - ${selected.contactName || selected.phoneNumber}`, status: "planifie", priority: selected.priority || "moyenne", progress: 0, notes: `Créé depuis le message mobile` }) });
                if (res.ok) { setSelected(null); router.push("/projets" as any); }
              } catch {}
            },
          }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerCenter: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  markAllBtn: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)", backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  cacheRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  cacheText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  swipeAction: { width: 80, justifyContent: "center", alignItems: "center", borderRadius: 12, marginBottom: 10, gap: 4 },
  swipeActionText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  msgCard: { flexDirection: "row", alignItems: "flex-start", padding: 14, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, marginBottom: 10, position: "relative", gap: 12 },
  unreadDot: { position: "absolute", top: 14, right: 14, width: 8, height: 8, borderRadius: 4 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  msgBody: { flex: 1 },
  msgTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  msgName: { fontSize: 15, flex: 1, marginRight: 8 },
  msgTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  msgContent: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 8 },
  msgBottom: { flexDirection: "row", gap: 6 },
  typePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  typePillText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  priorityPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  priorityText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
