import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

interface Call {
  id: number;
  phoneNumber: string;
  direction: "entrant" | "sortant";
  status: "repondu" | "manque" | "messagerie" | "en_cours";
  duration: number;
  notes?: string | null;
  contactName?: string | null;
  createdAt: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  repondu:   { label: "Répondu",    color: "#22c55e", icon: "phone" },
  manque:    { label: "Manqué",     color: "#ef4444", icon: "phone-missed" },
  messagerie:{ label: "Messagerie", color: "#f59e0b", icon: "voicemail" },
  en_cours:  { label: "En cours",   color: "#3b82f6", icon: "phone-call" },
};

const FORM_FIELDS = [
  { key: "phoneNumber", label: "Numéro de téléphone", required: true },
  {
    key: "direction", label: "Direction", type: "select" as const, options: [
      { value: "entrant", label: "Entrant" },
      { value: "sortant", label: "Sortant" },
    ],
  },
  {
    key: "status", label: "Statut", type: "select" as const, options: [
      { value: "repondu",    label: "Répondu"    },
      { value: "manque",     label: "Manqué"     },
      { value: "messagerie", label: "Messagerie" },
      { value: "en_cours",   label: "En cours"   },
    ],
  },
  { key: "duration", label: "Durée (secondes)" },
  { key: "contactName", label: "Nom du contact" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function fmtDuration(sec: number): string {
  if (!sec || sec === 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeDelete, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={20} color="#fff" />
      <Text style={styles.swipeText}>Supprimer</Text>
    </Animated.View>
  );
}

function CallCard({ call, colors, onDelete, onOpen }: {
  call: Call;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (c: Call) => void;
}) {
  const ref = useRef<Swipeable>(null);
  const sc = STATUS_CFG[call.status] ?? STATUS_CFG.repondu;
  const isIncoming = call.direction === "entrant";
  const isMissed = call.status === "manque";

  function handleSwipeOpen(direction: "left" | "right") {
    ref.current?.close();
    if (direction === "right") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (Platform.OS === "web") { onDelete(call.id); return; }
      Alert.alert("Supprimer", `Supprimer cet appel ?`, [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: () => onDelete(call.id) },
      ]);
    }
  }

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootRight={false}
      renderRightActions={p => <RightAction progress={p} />}
      onSwipeableOpen={handleSwipeOpen}
    >
      <Pressable
        onPress={() => onOpen(call)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderLeftWidth: 3,
            borderLeftColor: sc.color,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.cardMain}>
          <View style={[styles.callIcon, { backgroundColor: sc.color + "18" }]}>
            <Feather name={sc.icon} size={18} color={sc.color} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.cardTopRow}>
              <Text style={[styles.phoneNumber, { color: isMissed ? "#ef4444" : colors.foreground }]} numberOfLines={1}>
                {call.contactName || call.phoneNumber}
              </Text>
              <View style={styles.timeChip}>
                <Text style={[styles.timeText, { color: colors.mutedForeground }]}>{fmtTime(call.createdAt)}</Text>
              </View>
            </View>
            {call.contactName && (
              <Text style={[styles.subText, { color: colors.mutedForeground }]}>{call.phoneNumber}</Text>
            )}
            <View style={styles.metaRow}>
              <View style={[styles.dirPill, { backgroundColor: isIncoming ? "#3b82f618" : "#8b5cf618" }]}>
                <Feather
                  name={isIncoming ? "phone-incoming" : "phone-outgoing"}
                  size={10}
                  color={isIncoming ? "#3b82f6" : "#8b5cf6"}
                />
                <Text style={[styles.dirText, { color: isIncoming ? "#3b82f6" : "#8b5cf6" }]}>
                  {isIncoming ? "Entrant" : "Sortant"}
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: sc.color + "18" }]}>
                <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
              </View>
              {call.duration > 0 && (
                <View style={styles.durationChip}>
                  <Feather name="clock" size={9} color={colors.mutedForeground} />
                  <Text style={[styles.durationText, { color: colors.mutedForeground }]}>{fmtDuration(call.duration)}</Text>
                </View>
              )}
              <Text style={[styles.dateChip, { color: colors.mutedForeground }]}>{fmtDate(call.createdAt)}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => Linking.openURL(`tel:${call.phoneNumber}`)}
            style={[styles.callBtn, { backgroundColor: "#22c55e18" }]}
            hitSlop={8}
          >
            <Feather name="phone" size={16} color="#22c55e" />
          </Pressable>
        </View>
        {call.notes && (
          <Text style={[styles.notesText, { color: colors.mutedForeground }]} numberOfLines={1}>
            <Feather name="file-text" size={10} color={colors.mutedForeground} /> {call.notes}
          </Text>
        )}
      </Pressable>
    </Swipeable>
  );
}

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const { clearKey } = useUnreadBadges();
  const isWeb = Platform.OS === "web";

  const [calls, setCalls] = useState<Call[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dirFilter, setDirFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Call | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ direction: "entrant", status: "repondu", duration: "0" });
  const [formLoading, setFormLoading] = useState(false);

  const { cached, isFromCache, updateCache } = useOfflineCache<Call[]>("calls_list", []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "80", sortBy: "createdAt", sortOrder: "desc" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dirFilter !== "all") params.set("direction", dirFilter);
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/calls?${params}`);
      if (res.ok) {
        const d = await res.json();
        const list: Call[] = d.calls ?? d ?? [];
        setCalls(list);
        if (statusFilter === "all" && dirFilter === "all" && !search) updateCache(list);
      }
    } catch {
      if (cached.length > 0 && calls.length === 0) setCalls(cached);
    } finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, statusFilter, dirFilter, search, cached, calls.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && calls.length === 0) setCalls(cached);
  }, [isFromCache, cached, calls.length]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useFocusEffect(
    useCallback(() => {
      clearKey("call");
    }, [clearKey]),
  );
  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setCalls(prev => prev.filter(c => c.id !== id));
    setSelected(null);
    try { await fetchAuth(`${API_BASE}/api/calls/${id}`, { method: "DELETE" }); load(); }
    catch { load(); }
  }

  async function handleSubmit() {
    if (!formValues.phoneNumber?.trim()) return;
    setFormLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formValues,
          duration: parseInt(formValues.duration || "0"),
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormValues({ direction: "entrant", status: "repondu", duration: "0" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  const repondus = calls.filter(c => c.status === "repondu").length;
  const manques  = calls.filter(c => c.status === "manque").length;
  const totalDur = calls.reduce((s, c) => s + (c.duration || 0), 0);
  const entrants = calls.filter(c => c.direction === "entrant").length;

  const detailFields = selected ? [
    { label: "Téléphone",  value: selected.phoneNumber },
    { label: "Direction",  value: selected.direction === "entrant" ? "Entrant" : "Sortant" },
    { label: "Statut",     value: STATUS_CFG[selected.status]?.label ?? selected.status },
    { label: "Durée",      value: fmtDuration(selected.duration) },
    { label: "Contact",    value: selected.contactName ?? "—" },
    { label: "Date/Heure", value: `${fmtDate(selected.createdAt)} ${fmtTime(selected.createdAt)}` },
    { label: "Notes",      value: selected.notes ?? "—" },
  ] : [];

  const statusFilters = [
    { key: "all",        label: "Tout"       },
    { key: "repondu",    label: "Répondus"   },
    { key: "manque",     label: "Manqués"    },
    { key: "messagerie", label: "Messagerie" },
    { key: "en_cours",   label: "En cours"   },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#166534", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Journal d'Appels</Text>
          {isFromCache && (
            <View style={[styles.cachePill, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.7)" />
            </View>
          )}
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Numéro, contact, notes…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={14} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>

        <View style={styles.filtersContainer}>
          <View style={styles.filterRow}>
            {statusFilters.map(f => (
              <Pressable
                key={f.key}
                onPress={() => setStatusFilter(f.key)}
                style={[styles.filterChip, { backgroundColor: statusFilter === f.key ? "#fff" : "rgba(255,255,255,0.15)" }]}
              >
                <Text style={[styles.filterText, { color: statusFilter === f.key ? "#166534" : "rgba(255,255,255,0.85)" }]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.filterRow}>
            {[{ key: "all", label: "Tout" }, { key: "entrant", label: "Entrants" }, { key: "sortant", label: "Sortants" }].map(f => (
              <Pressable
                key={f.key}
                onPress={() => setDirFilter(f.key)}
                style={[styles.filterChip, { backgroundColor: dirFilter === f.key ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)" }]}
              >
                <Text style={[styles.filterText, { color: "rgba(255,255,255,0.85)" }]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#166534" />
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#166534" />}
          ListHeaderComponent={
            calls.length > 0 ? (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{calls.length}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Total</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e" }]}>{repondus}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Répondus</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#ef4444" }]}>{manques}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Manqués</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#3b82f6", fontSize: 13 }]}>{fmtDuration(totalDur)}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Durée tot.</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="phone"
              title="Aucun appel"
              subtitle={search ? "Aucun appel ne correspond à votre recherche." : "Aucun appel enregistré."}
            />
          }
          renderItem={({ item }) => (
            <CallCard call={item} colors={colors} onDelete={handleDelete} onOpen={setSelected} />
          )}
        />
      )}

      <FAB onPress={() => setShowForm(true)} icon="plus" />

      <FormModal
        visible={showForm}
        title="Enregistrer un appel"
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        onSubmit={handleSubmit}
        onClose={() => setShowForm(false)}
        loading={formLoading}
        submitLabel="Enregistrer"
      />

      <DetailModal
        visible={!!selected}
        icon="phone"
        iconColor={selected ? (STATUS_CFG[selected.status]?.color ?? "#166534") : "#166534"}
        title={selected?.contactName || selected?.phoneNumber || ""}
        subtitle={selected ? `${selected.direction === "entrant" ? "Entrant" : "Sortant"} · ${STATUS_CFG[selected.status]?.label}` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={selected ? [
          {
            label: "Voir détail",
            icon: "external-link" as const,
            color: "#0369a1",
            onPress: () => { const id = selected.id; setSelected(null); router.push(`/call-detail?id=${id}` as any); },
          },
          {
            label: "Rappeler",
            icon: "phone" as const,
            color: "#22c55e",
            onPress: () => { setSelected(null); Linking.openURL(`tel:${selected.phoneNumber}`); },
          },
        ] : undefined}
        onDelete={selected ? () => {
          if (Platform.OS === "web") { handleDelete(selected.id); return; }
          Alert.alert("Supprimer", "Supprimer cet appel ?", [
            { text: "Annuler", style: "cancel" },
            { text: "Supprimer", style: "destructive", onPress: () => handleDelete(selected.id) },
          ]);
        } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  cachePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filtersContainer: { gap: 6 },
  filterRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  filterText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDiv: { width: 1, height: 28 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  cardMain: { flexDirection: "row", alignItems: "center", gap: 10 },
  callIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  phoneNumber: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  timeChip: { marginLeft: 8 },
  timeText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  subText: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  dirPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  dirText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  durationChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  durationText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  dateChip: { fontSize: 10, fontFamily: "Inter_400Regular" },
  callBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  notesText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8 },
  swipeDelete: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#ef4444" },
  swipeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
