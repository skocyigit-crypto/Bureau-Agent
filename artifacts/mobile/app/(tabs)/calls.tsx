import { Feather } from "@expo/vector-icons";
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

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { ListItem } from "@/components/ListItem";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Call {
  id: number;
  contactName: string;
  phoneNumber: string;
  status: string;
  direction: string;
  duration: number;
  notes?: string;
  createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  answered: { label: "Repondu", color: "#22c55e" },
  missed: { label: "Manque", color: "#ef4444" },
  voicemail: { label: "Messagerie", color: "#f59e0b" },
  outgoing: { label: "Sortant", color: "#3b82f6" },
};

const FORM_FIELDS = [
  { key: "contactName", label: "Nom du contact", required: true },
  { key: "phoneNumber", label: "Numero de telephone", type: "phone" as const, required: true },
  { key: "direction", label: "Direction", type: "select" as const, options: [
    { value: "entrant", label: "Entrant" },
    { value: "sortant", label: "Sortant" },
  ]},
  { key: "status", label: "Statut", type: "select" as const, options: [
    { value: "repondu", label: "Repondu" },
    { value: "manque", label: "Manque" },
    { value: "messagerie", label: "Messagerie" },
  ]},
  { key: "duration", label: "Duree (secondes)" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ direction: "entrant", status: "repondu" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<Call | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const fetchCalls = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/calls?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCalls(data.calls ?? []);
      }
    } catch (err) { console.warn("[Calls] fetch failed:", err); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth]);

  useEffect(() => { setLoading(true); fetchCalls(); }, [fetchCalls]);

  function onRefresh() { setRefreshing(true); fetchCalls(); }

  function formatDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  async function handleSubmit() {
    if (!formValues.contactName?.trim() && !formValues.phoneNumber?.trim()) return;
    setFormLoading(true);
    try {
      const body = { ...formValues, duration: parseInt(formValues.duration || "0") };
      const url = editId ? `${API_BASE}/api/calls/${editId}` : `${API_BASE}/api/calls`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ direction: "entrant", status: "answered" });
        fetchCalls();
      }
    } catch (err) { console.warn("[Calls] submit failed:", err); } finally { setFormLoading(false); }
  }

  async function handleDelete(id: number) {
    try {
      await fetchAuth(`${API_BASE}/api/calls/${id}`, { method: "DELETE" });
      setSelected(null);
      fetchCalls();
    } catch (err) { console.warn("[Calls] delete failed:", err); }
  }

  function openEdit(call: Call) {
    setEditId(call.id);
    setFormValues({
      contactName: call.contactName || "",
      phoneNumber: call.phoneNumber || "",
      direction: call.direction || "entrant",
      status: call.status || "repondu",
      duration: String(call.duration || 0),
      notes: call.notes || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  function openNew() {
    setEditId(null);
    setFormValues({ direction: "entrant", status: "repondu" });
    setShowForm(true);
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "answered", label: "Repondus" },
    { key: "missed", label: "Manques" },
    { key: "outgoing", label: "Sortants" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <Text style={styles.headerTitle}>Appels</Text>
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
          data={calls}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="phone-off" title="Aucun appel" subtitle="Les appels apparaitront ici" />}
          renderItem={({ item }) => {
            const status = STATUS_MAP[item.status] ?? { label: item.status, color: colors.mutedForeground };
            return (
              <ListItem
                title={item.contactName || item.phoneNumber}
                subtitle={item.direction === "entrant" ? "Entrant" : "Sortant"}
                icon={item.status === "missed" ? "phone-missed" : item.direction === "sortant" ? "phone-outgoing" : "phone-incoming"}
                iconColor={status.color}
                rightText={formatTime(item.createdAt)}
                rightSubtext={item.duration > 0 ? formatDuration(item.duration) : status.label}
                statusColor={status.color}
                onPress={() => setSelected(item)}
              />
            );
          }}
        />
      )}

      <FAB icon="plus" onPress={openNew} />

      <FormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditId(null); }}
        onSubmit={handleSubmit}
        title={editId ? "Modifier l'appel" : "Nouvel appel"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        submitLabel={editId ? "Enregistrer" : "Creer"}
      />

      {selected ? (
        <DetailModal
          visible
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => handleDelete(selected.id)}
          title={selected.contactName || selected.phoneNumber}
          subtitle={selected.direction === "entrant" ? "Appel entrant" : "Appel sortant"}
          icon={selected.status === "missed" ? "phone-missed" : "phone"}
          iconColor={STATUS_MAP[selected.status]?.color}
          badge={{ label: STATUS_MAP[selected.status]?.label ?? selected.status, color: STATUS_MAP[selected.status]?.color ?? "#64748b" }}
          fields={[
            { label: "Telephone", value: selected.phoneNumber || "-", icon: "phone", action: selected.phoneNumber ? "call" : undefined },
            { label: "Duree", value: selected.duration > 0 ? formatDuration(selected.duration) : "0s", icon: "clock" },
            { label: "Date", value: new Date(selected.createdAt).toLocaleString("fr-FR"), icon: "calendar" },
            ...(selected.notes ? [{ label: "Notes", value: selected.notes, icon: "file-text" as const }] : []),
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", marginBottom: 14 },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
});
