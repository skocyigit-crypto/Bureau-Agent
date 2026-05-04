import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
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
import { FormModal } from "@/components/FormModal";
import { FAB } from "@/components/FAB";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

interface Devis {
  id: number;
  reference: string;
  title: string;
  clientName: string;
  clientEmail?: string | null;
  clientCompany?: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  status: string;
  validUntil?: string | null;
  notes?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  brouillon: { label: "Brouillon",  color: "#64748b", icon: "edit-2" },
  envoye:    { label: "Envoyé",     color: "#3b82f6", icon: "send" },
  accepte:   { label: "Accepté",   color: "#22c55e", icon: "check-circle" },
  refuse:    { label: "Refusé",    color: "#ef4444", icon: "x-circle" },
  expire:    { label: "Expiré",    color: "#f59e0b", icon: "clock" },
};

const FORM_FIELDS = [
  { key: "title", label: "Titre du devis", required: true },
  { key: "clientName", label: "Nom du client", required: true },
  { key: "clientEmail", label: "Email client", type: "email" as const },
  { key: "clientCompany", label: "Société client" },
  { key: "clientPhone", label: "Téléphone client" },
  { key: "clientAddress", label: "Adresse client" },
  {
    key: "status", label: "Statut", type: "select" as const, options: [
      { value: "brouillon", label: "Brouillon" },
      { value: "envoye", label: "Envoyé" },
      { value: "accepte", label: "Accepté" },
      { value: "refuse", label: "Refusé" },
      { value: "expire", label: "Expiré" },
    ],
  },
  { key: "validUntil", label: "Valable jusqu'au" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function fmtEur(v: string | null | undefined) {
  if (!v) return "0 €";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parseFloat(v));
}

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeAction, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Supprimer</Text>
    </Animated.View>
  );
}

interface SwipeableDevisProps {
  item: Devis;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (d: Devis) => void;
  onSend: (d: Devis) => void;
}

function SwipeableDevisCard({ item, colors, onDelete, onOpen, onSend }: SwipeableDevisProps) {
  const swipeRef = useRef<Swipeable>(null);
  const sc = STATUS_CFG[item.status] ?? STATUS_CFG.brouillon;
  const isWon = item.status === "accepte";
  const isLost = item.status === "refuse";

  function handleSwipeOpen(direction: "left" | "right") {
    swipeRef.current?.close();
    if (direction === "right") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (Platform.OS === "web") {
        onDelete(item.id);
      } else {
        Alert.alert("Supprimer", `Supprimer le devis "${item.reference}" ?`, [
          { text: "Annuler", style: "cancel" },
          { text: "Supprimer", style: "destructive", onPress: () => onDelete(item.id) },
        ]);
      }
    }
  }

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      renderRightActions={(progress) => <RightAction progress={progress} />}
      onSwipeableOpen={handleSwipeOpen}
    >
      <Pressable
        onPress={() => onOpen(item)}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderLeftWidth: 3,
            borderLeftColor: isWon ? "#22c55e" : isLost ? "#ef4444" : sc.color,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.rowHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.reference, { color: colors.foreground }]}>{item.reference}</Text>
            <Text style={[styles.titleText, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: sc.color + "18" }]}>
            <Feather name={sc.icon} size={10} color={sc.color} />
            <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
          </View>
        </View>

        <Text style={[styles.clientText, { color: colors.mutedForeground }]} numberOfLines={1}>
          <Feather name="user" size={10} /> {item.clientName}
          {item.clientCompany ? ` · ${item.clientCompany}` : ""}
        </Text>

        <View style={styles.rowFooter}>
          <Text style={[styles.amountText, { color: colors.foreground }]}>{fmtEur(item.totalAmount)}</Text>
          {item.validUntil && (
            <View style={styles.metaChip}>
              <Feather name="calendar" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                Val: {new Date(item.validUntil).toLocaleDateString("fr-FR")}
              </Text>
            </View>
          )}
          {item.status === "brouillon" && (
            <Pressable
              onPress={() => onSend(item)}
              style={[styles.sendBtn, { backgroundColor: "#3b82f6" }]}
            >
              <Feather name="send" size={11} color="#fff" />
              <Text style={styles.sendBtnText}>Envoyer</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    </Swipeable>
  );
}

export default function DevisScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [devis, setDevis] = useState<Devis[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Devis | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({ status: "brouillon" });
  const [formLoading, setFormLoading] = useState(false);
  const [sending, setSending] = useState<number | null>(null);

  const { cached, isFromCache, updateCache } = useOfflineCache<Devis[]>("devis_list", []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const [listRes, statsRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/devis?${params}`),
        fetchAuth(`${API_BASE}/api/devis/stats`),
      ]);
      if (listRes.ok) {
        const d = await listRes.json();
        const list: Devis[] = d.devis ?? d.data ?? [];
        setDevis(list);
        if (filter === "all" && !search) updateCache(list);
      }
      if (statsRes.ok) {
        const d = await statsRes.json();
        setStats(d);
      }
    } catch {
      if (cached.length > 0 && devis.length === 0) setDevis(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth, cached, devis.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && devis.length === 0) setDevis(cached);
  }, [isFromCache, cached, devis.length]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setDevis(prev => prev.filter(d => d.id !== id));
    setSelected(null);
    try {
      await fetchAuth(`${API_BASE}/api/devis/${id}`, { method: "DELETE" });
      load();
    } catch { load(); }
  }

  async function handleSend(d: Devis) {
    if (!d.clientEmail) {
      Alert.alert("Email manquant", "Ce devis n'a pas d'email client.");
      return;
    }
    setSending(d.id);
    try {
      const res = await fetchAuth(`${API_BASE}/api/devis/${d.id}/send`, { method: "POST" });
      if (res.ok) {
        Alert.alert("Devis envoyé", `Email envoyé à ${d.clientEmail}`);
        load();
      }
    } catch {}
    finally { setSending(null); }
  }

  async function handleSubmit() {
    if (!formValues.title?.trim() || !formValues.clientName?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/devis/${editId}` : `${API_BASE}/api/devis`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formValues, items: [] }),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ status: "brouillon" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  function openEdit(d: Devis) {
    setEditId(d.id);
    setFormValues({
      title: d.title || "",
      clientName: d.clientName || "",
      clientEmail: d.clientEmail || "",
      clientCompany: d.clientCompany || "",
      status: d.status || "brouillon",
      validUntil: d.validUntil ? d.validUntil.slice(0, 10) : "",
      notes: d.notes || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "brouillon", label: "Brouillons" },
    { key: "envoye", label: "Envoyés" },
    { key: "accepte", label: "Acceptés" },
    { key: "refuse", label: "Refusés" },
  ];

  const localStats = {
    total: devis.length,
    acceptes: devis.filter(d => d.status === "accepte").length,
    montantAccepte: devis.filter(d => d.status === "accepte").reduce((s, d) => s + parseFloat(d.totalAmount || "0"), 0),
    enAttente: devis.filter(d => d.status === "envoye").length,
  };

  const detailFields = selected ? [
    { label: "Référence", value: selected.reference },
    { label: "Statut", value: STATUS_CFG[selected.status]?.label ?? selected.status },
    { label: "Client", value: selected.clientName },
    { label: "Société", value: selected.clientCompany ?? "—" },
    { label: "Email client", value: selected.clientEmail ?? "—", icon: "mail" as const, action: selected.clientEmail ? "email" as const : undefined },
    { label: "Sous-total HT", value: fmtEur(selected.subtotal) },
    { label: "TVA", value: fmtEur(selected.taxAmount) },
    { label: "Total TTC", value: fmtEur(selected.totalAmount) },
    { label: "Valable jusqu'au", value: selected.validUntil ? new Date(selected.validUntil).toLocaleDateString("fr-FR") : "—" },
    { label: "Accepté le", value: selected.acceptedAt ? new Date(selected.acceptedAt).toLocaleDateString("fr-FR") : "—" },
    { label: "Notes", value: selected.notes ?? "—" },
  ] : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Devis</Text>
          {isFromCache && (
            <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
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
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>
        <View style={styles.filterRow}>
          {filters.map(f => (
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

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={devis}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            devis.length > 0 ? (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{localStats.total}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Total</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e" }]}>{localStats.acceptes}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Acceptés</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#3b82f6" }]}>{localStats.enAttente}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En attente</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#6366f1", fontSize: 12 }]}>
                    {fmtEur(String(localStats.montantAccepte))}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Gagné</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="file-text"
              title="Aucun devis"
              subtitle={search ? "Aucun devis ne correspond à votre recherche." : "Créez votre premier devis."}
            />
          }
          renderItem={({ item }) => (
            <SwipeableDevisCard
              item={item}
              colors={colors}
              onDelete={handleDelete}
              onOpen={setSelected}
              onSend={handleSend}
            />
          )}
        />
      )}

      <FAB onPress={() => { setEditId(null); setFormValues({ status: "brouillon" }); setShowForm(true); }} icon="plus" />

      <FormModal
        visible={showForm}
        title={editId ? "Modifier le devis" : "Nouveau devis"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        onSubmit={handleSubmit}
        onClose={() => { setShowForm(false); setEditId(null); }}
        loading={formLoading}
        submitLabel={editId ? "Enregistrer" : "Créer"}
      />

      <DetailModal
        visible={!!selected}
        icon="file-text"
        iconColor={selected ? (STATUS_CFG[selected.status]?.color ?? "#6366f1") : "#6366f1"}
        title={selected?.reference ?? ""}
        subtitle={selected ? `${selected.title} · ${STATUS_CFG[selected.status]?.label ?? selected.status}` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={selected ? [
          ...(selected.status === "brouillon" && selected.clientEmail ? [{
            label: sending === selected.id ? "Envoi..." : "Envoyer par email",
            icon: "send" as const,
            color: "#3b82f6",
            onPress: () => { const snap = selected; setSelected(null); handleSend(snap); },
          }] : []),
          {
            label: "Créer un projet",
            icon: "folder" as const,
            color: "#6366f1",
            onPress: async () => {
              const snap = selected;
              setSelected(null);
              try {
                await fetchAuth(`${API_BASE}/api/projets`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: snap.title,
                    status: "planifie",
                    progress: 0,
                    clientName: snap.clientName,
                    clientCompany: snap.clientCompany ?? undefined,
                    budget: parseFloat(snap.totalAmount || "0"),
                    notes: `Créé depuis devis ${snap.reference}`,
                  }),
                });
                router.push("/projets");
              } catch {}
            },
          },
        ] : undefined}
        onEdit={selected ? () => openEdit(selected) : undefined}
        onDelete={selected ? () => {
          if (Platform.OS === "web") {
            handleDelete(selected.id);
          } else {
            Alert.alert("Supprimer", `Supprimer "${selected.reference}" ?`, [
              { text: "Annuler", style: "cancel" },
              { text: "Supprimer", style: "destructive", onPress: () => handleDelete(selected.id) },
            ]);
          }
        } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  cacheBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  cacheText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDivider: { width: 1, height: 28 },
  row: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  rowHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 },
  reference: { fontSize: 11, fontFamily: "Inter_500Medium", opacity: 0.6 },
  titleText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  clientText: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  rowFooter: { flexDirection: "row", alignItems: "center", gap: 10 },
  amountText: { fontSize: 15, fontFamily: "Inter_700Bold", flex: 1 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  sendBtnText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  swipeAction: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#ef4444" },
  swipeActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
