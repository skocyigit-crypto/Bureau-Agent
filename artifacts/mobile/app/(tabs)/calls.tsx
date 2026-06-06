import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
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
import { router, useFocusEffect } from "expo-router";

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
  repondu: { label: "Repondu", color: "#22c55e" },
  manque: { label: "Manque", color: "#ef4444" },
  messagerie: { label: "Messagerie", color: "#f59e0b" },
  en_cours: { label: "En cours", color: "#3b82f6" },
};

const FORM_FIELDS = [
  { key: "contactName", label: "Nom du contact", required: true },
  { key: "phoneNumber", label: "Numero de telephone", type: "phone" as const, required: true },
  {
    key: "direction", label: "Direction", type: "select" as const, options: [
      { value: "entrant", label: "Entrant" },
      { value: "sortant", label: "Sortant" },
    ],
  },
  {
    key: "status", label: "Statut", type: "select" as const, options: [
      { value: "repondu", label: "Repondu" },
      { value: "manque", label: "Manque" },
      { value: "messagerie", label: "Messagerie" },
    ],
  },
  { key: "duration", label: "Duree (secondes)" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const { clearKey } = useUnreadBadges();
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
  const swipeRefs = useRef<Record<number, Swipeable | null>>({});

  const { cached, isFromCache, updateCache } = useOfflineCache<Call[]>("calls_list", []);

  const fetchCalls = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100", sortOrder: "desc" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/calls?${params}`);
      if (res.ok) {
        const data = await res.json();
        const list = data.calls ?? [];
        setCalls(list);
        updateCache(list);
      }
    } catch {
      if (cached.length > 0 && calls.length === 0) setCalls(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth]);

  useEffect(() => {
    if (cached.length > 0 && calls.length === 0) setCalls(cached);
    setLoading(true);
    fetchCalls();
  }, [fetchCalls]);

  useEffect(() => {
    const interval = setInterval(() => { fetchCalls(); }, 120000);
    return () => clearInterval(interval);
  }, [fetchCalls]);

  useFocusEffect(
    useCallback(() => {
      clearKey("call");
    }, [clearKey]),
  );

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

  const todayStats = useMemo(() => {
    const today = new Date().toDateString();
    const todayCalls = calls.filter((c) => new Date(c.createdAt).toDateString() === today);
    const missed = todayCalls.filter((c) => c.status === "manque").length;
    const answered = todayCalls.filter((c) => c.status === "repondu").length;
    const totalDuration = todayCalls.reduce((sum, c) => sum + (c.duration || 0), 0);
    return { total: todayCalls.length, missed, answered, totalDuration };
  }, [calls]);

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
        setFormValues({ direction: "entrant", status: "repondu" });
        fetchCalls();
      }
    } catch {} finally { setFormLoading(false); }
  }

  async function handleDelete(id: number) {
    setCalls((prev) => prev.filter((c) => c.id !== id));
    setSelected(null);
    try {
      await fetchAuth(`${API_BASE}/api/calls/${id}`, { method: "DELETE" });
    } catch {
      fetchCalls();
    }
  }

  function confirmDelete(id: number) {
    if (Platform.OS === "web") { handleDelete(id); return; }
    Alert.alert("Supprimer", "Supprimer cet appel ?", [
      { text: "Annuler", style: "cancel", onPress: () => swipeRefs.current[id]?.close() },
      { text: "Supprimer", style: "destructive", onPress: () => handleDelete(id) },
    ]);
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

  function callBack(phone: string) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Linking.openURL(`tel:${phone}`);
  }

  function renderRightActions(id: number) {
    return (
      <Pressable
        onPress={() => confirmDelete(id)}
        style={[styles.swipeAction, { backgroundColor: "#ef4444" }]}
      >
        <Feather name="trash-2" size={18} color="#fff" />
        <Text style={styles.swipeText}>Suppr.</Text>
      </Pressable>
    );
  }

  function renderLeftActions(phone: string) {
    if (!phone) return null;
    return (
      <Pressable
        onPress={() => callBack(phone)}
        style={[styles.swipeAction, { backgroundColor: "#22c55e" }]}
      >
        <Feather name="phone-call" size={18} color="#fff" />
        <Text style={styles.swipeText}>Rappel</Text>
      </Pressable>
    );
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "answered", label: "Repondus" },
    { key: "missed", label: "Manques" },
    { key: "outgoing", label: "Sortants" },
  ];

  const missedCount = calls.filter((c) => c.status === "manque").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>Appels</Text>
            {missedCount > 0 && (
              <View style={styles.missedBadge}>
                <Text style={styles.missedBadgeText}>{missedCount}</Text>
              </View>
            )}
          </View>
          {isFromCache && (
            <View style={styles.cacheRow}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.5)" />
              <Text style={styles.cacheText}>Cache</Text>
            </View>
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
              <Text style={[styles.filterText, { color: filter === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading && calls.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            todayStats.total > 0 ? (
              <View style={[styles.todaySummary, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.todayLabel, { color: colors.foreground }]}>Aujourd'hui</Text>
                <View style={styles.todayRow}>
                  {[
                    { icon: "phone" as const, value: todayStats.total, color: colors.primary, label: "Total" },
                    { icon: "check-circle" as const, value: todayStats.answered, color: "#22c55e", label: "Repondus" },
                    { icon: "phone-missed" as const, value: todayStats.missed, color: "#ef4444", label: "Manques" },
                    { icon: "clock" as const, value: formatDuration(todayStats.totalDuration), color: colors.mutedForeground, label: "Duree" },
                  ].map((stat, i) => (
                    <View key={i} style={styles.todayStat}>
                      <Feather name={stat.icon} size={13} color={stat.color} />
                      <Text style={[styles.todayValue, { color: stat.color }]}>{stat.value}</Text>
                      <Text style={[styles.todayStatLabel, { color: colors.mutedForeground }]}>{stat.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={<EmptyState icon="phone-off" title="Aucun appel" subtitle="Les appels apparaitront ici" />}
          renderItem={({ item }) => {
            const status = STATUS_MAP[item.status] ?? { label: item.status, color: colors.mutedForeground };
            const isMissed = item.status === "manque";
            const isOutgoing = item.direction === "sortant" || item.direction === "outgoing";
            return (
              <Swipeable
                ref={(ref) => { swipeRefs.current[item.id] = ref; }}
                renderRightActions={() => renderRightActions(item.id)}
                renderLeftActions={item.phoneNumber ? () => renderLeftActions(item.phoneNumber) : undefined}
                friction={2}
                onSwipeableOpen={(dir) => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (dir === "right") confirmDelete(item.id);
                  else if (dir === "left" && item.phoneNumber) {
                    callBack(item.phoneNumber);
                    swipeRefs.current[item.id]?.close();
                  }
                }}
              >
                <View style={[
                  styles.callRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: isMissed ? "#ef444425" : colors.border,
                    borderLeftColor: status.color,
                  },
                ]}>
                  <View style={[styles.callIcon, { backgroundColor: status.color + "18" }]}>
                    <Feather
                      name={isMissed ? "phone-missed" : isOutgoing ? "phone-outgoing" : "phone-incoming"}
                      size={16}
                      color={status.color}
                    />
                  </View>
                  <Pressable onPress={() => setSelected(item)} style={styles.callContent}>
                    <View style={styles.callTop}>
                      <Text style={[styles.callName, { color: colors.foreground }]} numberOfLines={1}>
                        {item.contactName || item.phoneNumber || "Inconnu"}
                      </Text>
                      <Text style={[styles.callTime, { color: colors.mutedForeground }]}>{formatTime(item.createdAt)}</Text>
                    </View>
                    <View style={styles.callMeta}>
                      <View style={[styles.statusPill, { backgroundColor: status.color + "18" }]}>
                        <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
                      </View>
                      <Text style={[styles.callDir, { color: colors.mutedForeground }]}>
                        {isOutgoing ? "Sortant" : "Entrant"}
                      </Text>
                      {item.duration > 0 && (
                        <Text style={[styles.callDuration, { color: colors.mutedForeground }]}>
                          · {formatDuration(item.duration)}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                  {item.phoneNumber && (
                    <Pressable
                      onPress={() => callBack(item.phoneNumber)}
                      style={[styles.callbackBtn, { backgroundColor: isMissed ? "#ef444418" : "#22c55e18" }]}
                      hitSlop={8}
                    >
                      <Feather name="phone-call" size={15} color={isMissed ? "#ef4444" : "#22c55e"} />
                    </Pressable>
                  )}
                </View>
              </Swipeable>
            );
          }}
        />
      )}

      <FAB icon="plus" onPress={() => { setEditId(null); setFormValues({ direction: "entrant", status: "repondu" }); setShowForm(true); }} />

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
          title={selected.contactName || selected.phoneNumber || "Inconnu"}
          subtitle={selected.direction === "entrant" || selected.direction === "entrant" ? "Appel entrant" : "Appel sortant"}
          icon={selected.status === "manque" ? "phone-missed" : "phone"}
          iconColor={STATUS_MAP[selected.status]?.color}
          badge={{ label: STATUS_MAP[selected.status]?.label ?? selected.status, color: STATUS_MAP[selected.status]?.color ?? "#64748b" }}
          fields={[
            { label: "Telephone", value: selected.phoneNumber || "-", icon: "phone", action: selected.phoneNumber ? "call" : undefined },
            { label: "Duree", value: selected.duration > 0 ? formatDuration(selected.duration) : "0s", icon: "clock" },
            { label: "Date", value: new Date(selected.createdAt).toLocaleString("fr-FR"), icon: "calendar" },
            ...(selected.notes ? [{ label: "Notes", value: selected.notes, icon: "file-text" as const }] : []),
          ]}
          extraActions={[{
            label: "Projet",
            icon: "folder",
            color: "#6366f1",
            onPress: async () => {
              try {
                const res = await fetchAuth(`${API_BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Appel - ${selected.contactName || selected.phoneNumber}`, status: "planifie", priority: "moyenne", progress: 0, notes: `Projet créé depuis un appel de ${selected.contactName || selected.phoneNumber}` }) });
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
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  missedBadge: { backgroundColor: "#ef4444", minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  missedBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  cacheRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cacheText: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  todaySummary: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  todayLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  todayRow: { flexDirection: "row", justifyContent: "space-around" },
  todayStat: { alignItems: "center", gap: 3 },
  todayValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  todayStatLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },
  swipeAction: { width: 72, justifyContent: "center", alignItems: "center", borderRadius: 12, marginBottom: 8, gap: 4 },
  swipeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff" },
  callRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, marginBottom: 8, gap: 10 },
  callIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  callContent: { flex: 1 },
  callTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  callName: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1, marginRight: 6 },
  callTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  callMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  callDir: { fontSize: 11, fontFamily: "Inter_400Regular" },
  callDuration: { fontSize: 11, fontFamily: "Inter_400Regular" },
  callbackBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
