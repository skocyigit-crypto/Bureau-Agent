import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { DetailModal } from "@/components/DetailModal";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { ListItem } from "@/components/ListItem";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

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
  { key: "type", label: "Type", type: "select" as const, options: [
    { value: "messagerie_vocale", label: "Messagerie vocale" },
    { value: "note", label: "Note" },
    { value: "rappel", label: "Rappel" },
  ]},
  { key: "priority", label: "Priorite", type: "select" as const, options: [
    { value: "basse", label: "Basse" },
    { value: "moyenne", label: "Moyenne" },
    { value: "haute", label: "Haute" },
  ]},
  { key: "content", label: "Contenu", type: "multiline" as const, required: true },
];

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
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

  const fetchMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (search) params.set("search", search);
      if (filter !== "all") params.set("type", filter);
      const res = await fetchAuth(`${API_BASE}/api/messages?${params}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, filter, fetchAuth]);

  useEffect(() => { setLoading(true); fetchMessages(); }, [fetchMessages]);

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

  function openNew() {
    setEditId(null);
    setFormValues({ type: "note", priority: "moyenne", phoneNumber: "" });
    setShowForm(true);
  }

  async function handleDelete(id: number) {
    try {
      await fetchAuth(`${API_BASE}/api/messages/${id}`, { method: "DELETE" });
      setSelected(null);
      fetchMessages();
    } catch {}
  }

  async function markAsRead(msg: Message) {
    if (msg.isRead) return;
    try {
      await fetchAuth(`${API_BASE}/api/messages/${msg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      fetchMessages();
    } catch {}
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "messagerie_vocale", label: "Vocal" },
    { key: "note", label: "Notes" },
    { key: "rappel", label: "Rappels" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Messages</Text>
          <View style={{ width: 22 }} />
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
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>
        <View style={styles.filterRow}>
          {filters.map((f) => (
            <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filterChip, { backgroundColor: filter === f.key ? colors.primary : "rgba(255,255,255,0.1)" }]}>
              <Text style={[styles.filterText, { color: filter === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
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
              <ListItem
                title={item.contactName || item.phoneNumber || "Inconnu"}
                subtitle={item.content?.substring(0, 50)}
                icon={type.icon}
                iconColor={!item.isRead ? type.color : colors.mutedForeground}
                rightText={formatTime(item.createdAt)}
                rightSubtext={type.label}
                statusColor={type.color}
                onPress={() => { markAsRead(item); setSelected(item); }}
              />
            );
          }}
        />
      )}

      <FAB onPress={openNew} />

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
        submitLabel="Creer"
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
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
});
