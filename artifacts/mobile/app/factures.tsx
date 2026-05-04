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

interface Facture {
  id: number;
  reference: string;
  title: string;
  clientName: string;
  clientEmail?: string | null;
  clientCompany?: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  currency: string;
  status: string;
  dueDate?: string | null;
  paidAt?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  isOverdue?: boolean;
  remainingAmount?: number;
  createdAt: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  brouillon:           { label: "Brouillon",    color: "#64748b", icon: "edit-2" },
  emise:               { label: "Émise",        color: "#3b82f6", icon: "file-text" },
  partiellement_payee: { label: "Part. payée",  color: "#f59e0b", icon: "dollar-sign" },
  payee:               { label: "Payée",        color: "#22c55e", icon: "check-circle" },
  en_retard:           { label: "En retard",    color: "#ef4444", icon: "alert-triangle" },
  annulee:             { label: "Annulée",      color: "#94a3b8", icon: "x-circle" },
};

const FORM_FIELDS = [
  { key: "title", label: "Titre de la facture", required: true },
  { key: "clientName", label: "Nom du client", required: true },
  { key: "clientEmail", label: "Email client", type: "email" as const },
  { key: "clientCompany", label: "Société client" },
  { key: "clientPhone", label: "Téléphone client" },
  { key: "clientAddress", label: "Adresse client" },
  {
    key: "status", label: "Statut", type: "select" as const, options: [
      { value: "brouillon", label: "Brouillon" },
      { value: "emise", label: "Émise" },
      { value: "partiellement_payee", label: "Partiellement payée" },
      { value: "payee", label: "Payée" },
      { value: "en_retard", label: "En retard" },
      { value: "annulee", label: "Annulée" },
    ],
  },
  { key: "dueDate", label: "Date d'échéance" },
  {
    key: "paymentMethod", label: "Moyen de paiement", type: "select" as const, options: [
      { value: "virement", label: "Virement" },
      { value: "cheque", label: "Chèque" },
      { value: "carte", label: "Carte" },
      { value: "especes", label: "Espèces" },
      { value: "prelevement", label: "Prélèvement" },
      { value: "autre", label: "Autre" },
    ],
  },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function fmtEur(v: string | number | null | undefined) {
  if (v == null || v === "") return "0 €";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parseFloat(String(v)));
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
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

interface SwipeableFactureProps {
  item: Facture;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (f: Facture) => void;
  onSend: (f: Facture) => void;
}

function SwipeableFacture({ item, colors, onDelete, onOpen, onSend }: SwipeableFactureProps) {
  const swipeRef = useRef<Swipeable>(null);
  const isOverdue = item.isOverdue && !["payee", "annulee"].includes(item.status);
  const sc = isOverdue ? STATUS_CFG.en_retard : (STATUS_CFG[item.status] ?? STATUS_CFG.emise);
  const solde = item.remainingAmount ?? Math.max(0, parseFloat(item.totalAmount || "0") - parseFloat(item.paidAmount || "0"));
  const isPaid = item.status === "payee";
  const isCancelled = item.status === "annulee";

  function handleSwipeOpen(direction: "left" | "right") {
    swipeRef.current?.close();
    if (direction === "right") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (Platform.OS === "web") {
        onDelete(item.id);
      } else {
        Alert.alert("Supprimer", `Supprimer la facture "${item.reference}" ?`, [
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
            borderLeftColor: sc.color,
            opacity: isCancelled ? 0.6 : 1,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.rowHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.reference, { color: colors.mutedForeground }]}>{item.reference}</Text>
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
          <View>
            <Text style={[styles.amountText, { color: isPaid ? "#22c55e" : isOverdue ? "#ef4444" : colors.foreground }]}>
              {fmtEur(item.totalAmount)}
            </Text>
            {solde > 0 && !isPaid && (
              <Text style={[styles.soldeText, { color: "#ef4444" }]}>Reste: {fmtEur(solde)}</Text>
            )}
          </View>
          <View style={styles.metaGroup}>
            {item.dueDate && (
              <View style={styles.metaChip}>
                <Feather name="calendar" size={10} color={isOverdue ? "#ef4444" : colors.mutedForeground} />
                <Text style={[styles.metaText, { color: isOverdue ? "#ef4444" : colors.mutedForeground }]}>
                  {fmtDate(item.dueDate)}
                </Text>
              </View>
            )}
            {item.status === "emise" && item.clientEmail && (
              <Pressable
                onPress={() => onSend(item)}
                style={[styles.sendBtn, { backgroundColor: "#3b82f6" }]}
              >
                <Feather name="mail" size={11} color="#fff" />
                <Text style={styles.sendBtnText}>Relancer</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
}

export default function FacturesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [factures, setFactures] = useState<Facture[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Facture | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({ status: "emise" });
  const [formLoading, setFormLoading] = useState(false);
  const [sending, setSending] = useState<number | null>(null);

  const { cached, isFromCache, updateCache } = useOfflineCache<Facture[]>("factures_list", []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (filter !== "all") {
        if (filter === "overdue") params.set("overdue", "true");
        else params.set("status", filter);
      }
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/factures-client?${params}`);
      if (res.ok) {
        const d = await res.json();
        const list: Facture[] = d.data ?? d.factures ?? [];
        setFactures(list);
        if (filter === "all" && !search) updateCache(list);
      }
    } catch {
      if (cached.length > 0 && factures.length === 0) setFactures(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth, cached, factures.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && factures.length === 0) setFactures(cached);
  }, [isFromCache, cached, factures.length]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setFactures(prev => prev.filter(f => f.id !== id));
    setSelected(null);
    try {
      await fetchAuth(`${API_BASE}/api/factures-client/${id}`, { method: "DELETE" });
      load();
    } catch { load(); }
  }

  async function handleSend(f: Facture) {
    if (!f.clientEmail) {
      Alert.alert("Email manquant", "Cette facture n'a pas d'email client.");
      return;
    }
    setSending(f.id);
    try {
      const res = await fetchAuth(`${API_BASE}/api/factures-client/${f.id}/send`, { method: "POST" });
      if (res.ok) {
        Alert.alert("Facture envoyée", `Email envoyé à ${f.clientEmail}`);
        load();
      }
    } catch {}
    finally { setSending(null); }
  }

  async function handleSubmit() {
    if (!formValues.title?.trim() || !formValues.clientName?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/factures-client/${editId}` : `${API_BASE}/api/factures-client`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formValues, items: [] }),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ status: "emise" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  function openEdit(f: Facture) {
    setEditId(f.id);
    setFormValues({
      title: f.title || "",
      clientName: f.clientName || "",
      clientEmail: f.clientEmail || "",
      clientCompany: f.clientCompany || "",
      status: f.status || "emise",
      dueDate: f.dueDate ? f.dueDate.slice(0, 10) : "",
      paymentMethod: f.paymentMethod || "",
      notes: f.notes || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  const filters = [
    { key: "all", label: "Toutes" },
    { key: "emise", label: "Émises" },
    { key: "overdue", label: "En retard" },
    { key: "partiellement_payee", label: "Partielles" },
    { key: "payee", label: "Payées" },
  ];

  const totalAmount = factures.reduce((s, f) => s + parseFloat(f.totalAmount || "0"), 0);
  const totalPaid = factures.reduce((s, f) => s + parseFloat(f.paidAmount || "0"), 0);
  const overdue = factures.filter(f => f.isOverdue && !["payee", "annulee"].includes(f.status));
  const paid = factures.filter(f => f.status === "payee");

  const detailFields = selected ? [
    { label: "Référence", value: selected.reference },
    { label: "Statut", value: STATUS_CFG[selected.status]?.label ?? selected.status },
    { label: "Client", value: selected.clientName },
    { label: "Société", value: selected.clientCompany ?? "—" },
    { label: "Email", value: selected.clientEmail ?? "—", icon: "mail" as const, action: selected.clientEmail ? "email" as const : undefined },
    { label: "Sous-total HT", value: fmtEur(selected.subtotal) },
    { label: "TVA", value: fmtEur(selected.taxAmount) },
    { label: "Total TTC", value: fmtEur(selected.totalAmount) },
    { label: "Déjà payé", value: fmtEur(selected.paidAmount) },
    { label: "Solde restant", value: fmtEur(selected.remainingAmount ?? Math.max(0, parseFloat(selected.totalAmount || "0") - parseFloat(selected.paidAmount || "0"))) },
    { label: "Échéance", value: fmtDate(selected.dueDate) },
    { label: "Payé le", value: fmtDate(selected.paidAt) },
    { label: "Moyen de paiement", value: selected.paymentMethod ?? "—" },
    { label: "Notes", value: selected.notes ?? "—" },
  ] : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#0891b2", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Factures</Text>
          {isFromCache && (
            <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
              <Text style={styles.cacheText}>Cache</Text>
            </View>
          )}
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.6)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.6)" onPress={() => setSearch("")} /> : null}
        </View>
        <View style={styles.filterRow}>
          {filters.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, { backgroundColor: filter === f.key ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.filterText, { color: "#fff" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0891b2" />
        </View>
      ) : (
        <FlatList
          data={factures}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0891b2" />}
          ListHeaderComponent={
            factures.length > 0 ? (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{factures.length}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Total</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e" }]}>{paid.length}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Payées</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#ef4444" }]}>{overdue.length}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En retard</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e", fontSize: 12 }]}>
                    {fmtEur(totalPaid)}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Encaissé</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="file"
              title="Aucune facture"
              subtitle={search ? "Aucune facture ne correspond à votre recherche." : "Créez votre première facture."}
            />
          }
          renderItem={({ item }) => (
            <SwipeableFacture
              item={item}
              colors={colors}
              onDelete={handleDelete}
              onOpen={setSelected}
              onSend={handleSend}
            />
          )}
        />
      )}

      <FAB onPress={() => { setEditId(null); setFormValues({ status: "emise" }); setShowForm(true); }} icon="plus" />

      <FormModal
        visible={showForm}
        title={editId ? "Modifier la facture" : "Nouvelle facture"}
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
        icon="file"
        iconColor={selected ? (STATUS_CFG[selected.status]?.color ?? "#0891b2") : "#0891b2"}
        title={selected?.reference ?? ""}
        subtitle={selected ? `${selected.title} · ${selected.clientName}` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={selected ? [
          ...(selected.clientEmail && !["payee", "annulee"].includes(selected.status) ? [{
            label: sending === selected.id ? "Envoi..." : "Envoyer relance",
            icon: "mail" as const,
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
                    notes: `Créé depuis facture ${snap.reference}`,
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
  reference: { fontSize: 11, fontFamily: "Inter_500Medium" },
  titleText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  clientText: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  rowFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  amountText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  soldeText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  metaGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  sendBtnText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  swipeAction: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#ef4444" },
  swipeActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
