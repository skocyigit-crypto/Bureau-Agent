import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
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
import { useColors } from "@/hooks/useColors";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

interface Facture {
  id: number;
  reference: string;
  title: string;
  clientName: string;
  clientEmail?: string;
  clientCompany?: string;
  items: LineItem[];
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  currency: string;
  status: string;
  dueDate?: string;
  paidAt?: string;
  paymentMethod?: string;
  notes?: string;
  isOverdue?: boolean;
  remainingAmount?: number;
  createdAt: string;
}

interface Stats {
  total: number;
  montantTotal: number;
  montantEncaisse: number;
  montantEnAttente: number;
  enRetard: number;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: keyof typeof Feather.glyphMap }> = {
  brouillon:           { label: "Brouillon",      color: "#64748b", bg: "#f1f5f9", icon: "edit-2" },
  emise:               { label: "Émise",           color: "#3b82f6", bg: "#eff6ff", icon: "file-text" },
  partiellement_payee: { label: "Part. payée",    color: "#f59e0b", bg: "#fffbeb", icon: "dollar-sign" },
  payee:               { label: "Payée",           color: "#22c55e", bg: "#f0fdf4", icon: "check-circle" },
  en_retard:           { label: "En retard",       color: "#ef4444", bg: "#fef2f2", icon: "alert-triangle" },
  annulee:             { label: "Annulée",         color: "#94a3b8", bg: "#f8fafc", icon: "x-circle" },
};

const FORM_FIELDS = [
  { key: "title",         label: "Titre",             required: true },
  { key: "clientName",    label: "Client",             required: true },
  { key: "clientEmail",   label: "Email client",       type: "email" as const },
  { key: "clientCompany", label: "Société" },
  { key: "status",        label: "Statut",             type: "select" as const, options: [
    { value: "brouillon", label: "Brouillon" },
    { value: "emise",     label: "Émise" },
  ]},
  { key: "dueDate",       label: "Date d'échéance" },
  { key: "notes",         label: "Notes",              type: "multiline" as const },
];

const PAYMENT_FIELDS = [
  { key: "paymentMethod", label: "Mode de paiement", type: "select" as const, options: [
    { value: "virement",    label: "Virement bancaire" },
    { value: "cheque",      label: "Chèque" },
    { value: "carte",       label: "Carte bancaire" },
    { value: "especes",     label: "Espèces" },
    { value: "prelevement", label: "Prélèvement" },
    { value: "autre",       label: "Autre" },
  ]},
  { key: "notes", label: "Notes de paiement", type: "multiline" as const },
];

function fmtEur(v: string | number | undefined) {
  if (!v) return "0,00 €";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(String(v)));
}

function fmtDate(d: string | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type FilterStatus = "all" | "emise" | "en_retard" | "payee" | "brouillon";

const FILTERS: { key: FilterStatus; label: string }[] = [
  { key: "all",       label: "Tout" },
  { key: "emise",     label: "Émises" },
  { key: "en_retard", label: "En retard" },
  { key: "payee",     label: "Payées" },
  { key: "brouillon", label: "Brouillons" },
];

export default function FacturesClientScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [factures, setFactures] = useState<Facture[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selected, setSelected] = useState<Facture | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createValues, setCreateValues] = useState<Record<string, string>>({ status: "emise" });
  const [createLoading, setCreateLoading] = useState(false);

  // Payment form
  const [showPaiement, setShowPaiement] = useState(false);
  const [paiementTarget, setPaiementTarget] = useState<Facture | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payValues, setPayValues] = useState<Record<string, string>>({ paymentMethod: "virement" });
  const [payLoading, setPayLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search) params.set("search", search);
      if (filterStatus !== "all") params.set("status", filterStatus);
      const [fRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/factures-client?${params}`),
        fetchAuth(`${API_BASE}/api/factures-client/stats`),
      ]);
      if (fRes.ok) {
        const d = await fRes.json();
        setFactures(d.factures ?? d.data ?? d ?? []);
      }
      if (sRes.ok) setStats(await sRes.json());
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, search, filterStatus]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function handleCreate() {
    if (!createValues.title?.trim() || !createValues.clientName?.trim()) return;
    setCreateLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/factures-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createValues,
          items: [{ description: "Prestation de service", quantity: 1, unitPrice: 100, taxRate: 20, total: 120 }],
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreateValues({ status: "emise" });
        load();
      }
    } finally { setCreateLoading(false); }
  }

  async function handleSend(id: number) {
    setActionLoading("send-" + id);
    try {
      await fetchAuth(`${API_BASE}/api/factures-client/${id}/send`, { method: "POST" });
      load(); setSelected(null);
    } finally { setActionLoading(null); }
  }

  async function handleDuplicate(id: number) {
    setActionLoading("dup-" + id);
    try {
      await fetchAuth(`${API_BASE}/api/factures-client/${id}/duplicate`, { method: "POST" });
      load();
    } finally { setActionLoading(null); }
  }

  function openPaiement(f: Facture) {
    setPaiementTarget(f);
    const remaining = Math.max(0, parseFloat(f.totalAmount || "0") - parseFloat(f.paidAmount || "0"));
    setPayAmount(remaining.toFixed(2));
    setPayValues({ paymentMethod: "virement" });
    setSelected(null);
    setShowPaiement(true);
  }

  async function handlePaiement() {
    if (!paiementTarget || !payAmount) return;
    setPayLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/factures-client/${paiementTarget.id}/paiement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(payAmount),
          paymentMethod: payValues.paymentMethod,
          notes: payValues.notes,
        }),
      });
      if (res.ok) {
        setShowPaiement(false);
        setPaiementTarget(null);
        load();
      }
    } finally { setPayLoading(false); }
  }

  function renderRightActions(f: Facture) {
    return () => (
      <View style={{ flexDirection: "row" }}>
        {["emise", "partiellement_payee", "en_retard"].includes(f.status) && (
          <Pressable onPress={() => openPaiement(f)} style={[styles.swipeBtn, { backgroundColor: "#22c55e" }]}>
            <Feather name="check-circle" size={16} color="#fff" />
            <Text style={styles.swipeBtnText}>Paiement</Text>
          </Pressable>
        )}
        <Pressable onPress={() => handleDuplicate(f.id)} style={[styles.swipeBtn, { backgroundColor: "#8b5cf6" }]}>
          <Feather name="copy" size={16} color="#fff" />
          <Text style={styles.swipeBtnText}>Dupliquer</Text>
        </Pressable>
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
          <Text style={styles.headerTitle}>Factures clients</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={16} color="#fff" />
          </Pressable>
        </View>

        {stats && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { label: "Total", value: fmtEur(stats.montantTotal), color: "#fff" },
                { label: "Encaissé", value: fmtEur(stats.montantEncaisse), color: "#86efac" },
                { label: "Attente", value: fmtEur(stats.montantEnAttente), color: "#fde68a" },
                { label: "Retard", value: String(stats.enRetard), color: "#fca5a5" },
              ].map(s => (
                <View key={s.label} style={[styles.statChip, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
                  <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
                  <Text style={styles.statLbl}>{s.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.6)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Feather name="x" size={14} color="rgba(255,255,255,0.6)" /></Pressable> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {FILTERS.map(f => (
              <Pressable
                key={f.key}
                onPress={() => setFilterStatus(f.key)}
                style={[styles.filterChip, { backgroundColor: filterStatus === f.key ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)" }]}
              >
                <Text style={styles.filterText}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#0f766e" /></View>
      ) : (
        <FlatList
          data={factures}
          keyExtractor={f => String(f.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0f766e" />}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          ListEmptyComponent={<EmptyState icon="file-text" title="Aucune facture" subtitle="Créez votre première facture." />}
          renderItem={({ item }) => {
            const st = STATUS_MAP[item.status] ?? STATUS_MAP.brouillon;
            const overdue = !!item.isOverdue && !["payee", "annulee"].includes(item.status);
            return (
              <Swipeable renderRightActions={renderRightActions(item)}>
                <Pressable
                  onPress={() => setSelected(item)}
                  style={({ pressed }) => [
                    styles.card,
                    { backgroundColor: colors.card, borderColor: overdue ? "#ef4444" : colors.border, borderLeftWidth: 3, borderLeftColor: overdue ? "#ef4444" : st.color, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardRef, { color: colors.mutedForeground }]}>{item.reference}</Text>
                      <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                      <Text style={[styles.cardClient, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.clientName}{item.clientCompany ? ` · ${item.clientCompany}` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={[styles.cardAmount, { color: item.status === "payee" ? "#22c55e" : overdue ? "#ef4444" : colors.foreground }]}>
                        {fmtEur(item.totalAmount)}
                      </Text>
                      <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                        <Feather name={st.icon} size={9} color={st.color} />
                        <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Feather name="calendar" size={10} color={colors.mutedForeground} />
                      <Text style={[styles.cardMeta, { color: overdue ? "#ef4444" : colors.mutedForeground }]}>
                        {item.dueDate ? `Échéance : ${fmtDate(item.dueDate)}` : fmtDate(item.createdAt)}
                      </Text>
                    </View>
                    {(item.remainingAmount ?? 0) > 0 && (
                      <View style={[styles.remainChip, { backgroundColor: "#fef2f2" }]}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#ef4444" }}>
                          Reste {fmtEur(item.remainingAmount)}
                        </Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              </Swipeable>
            );
          }}
        />
      )}

      <FAB icon="plus" onPress={() => setShowCreate(true)} />

      {/* Create Modal */}
      <FormModal
        visible={showCreate}
        title="Nouvelle facture"
        icon="file-text"
        fields={FORM_FIELDS}
        values={createValues}
        onChange={(key, val) => setCreateValues(prev => ({ ...prev, [key]: val }))}
        onClose={() => { setShowCreate(false); setCreateValues({ status: "emise" }); }}
        onSubmit={handleCreate}
        loading={createLoading}
        submitLabel="Créer la facture"
      />

      {/* Payment amount + FormModal */}
      {showPaiement && paiementTarget && (
        <FormModal
          visible
          title={`Paiement — ${paiementTarget.reference}`}
          icon="dollar-sign"
          fields={PAYMENT_FIELDS}
          values={payValues}
          onChange={(key, val) => setPayValues(prev => ({ ...prev, [key]: val }))}
          onClose={() => { setShowPaiement(false); setPaiementTarget(null); }}
          onSubmit={handlePaiement}
          loading={payLoading}
          submitLabel="Enregistrer le paiement"
        />
      )}

      {/* Detail Modal */}
      {selected && (
        <DetailModal
          visible
          title={selected.reference}
          subtitle={selected.title}
          icon={STATUS_MAP[selected.status]?.icon ?? "file-text"}
          iconColor={STATUS_MAP[selected.status]?.color}
          badge={{ label: STATUS_MAP[selected.status]?.label ?? selected.status, color: STATUS_MAP[selected.status]?.color ?? "#64748b" }}
          onClose={() => setSelected(null)}
          extraActions={[
            ...(selected.status === "brouillon" ? [{
              label: "Envoyer",
              icon: "send" as const,
              color: "#3b82f6",
              onPress: () => handleSend(selected.id),
            }] : []),
            ...(["emise", "partiellement_payee", "en_retard"].includes(selected.status) ? [{
              label: "Enreg. paiement",
              icon: "check-circle" as const,
              color: "#22c55e",
              onPress: () => openPaiement(selected),
            }] : []),
          ]}
          fields={[
            { label: "Référence",      value: selected.reference },
            { label: "Client",         value: selected.clientName },
            { label: "Société",        value: selected.clientCompany ?? "—" },
            { label: "Email",          value: selected.clientEmail ?? "—", action: "email" as const },
            { label: "Statut",         value: STATUS_MAP[selected.status]?.label ?? selected.status },
            { label: "Total HT",       value: fmtEur(selected.subtotal) },
            { label: "TVA",            value: fmtEur(selected.taxAmount) },
            { label: "Total TTC",      value: fmtEur(selected.totalAmount) },
            { label: "Déjà payé",      value: fmtEur(selected.paidAmount) },
            ...(selected.remainingAmount != null ? [{ label: "Reste à payer", value: fmtEur(selected.remainingAmount) }] : []),
            { label: "Échéance",       value: fmtDate(selected.dueDate) },
            ...(selected.paidAt ? [{ label: "Payée le", value: fmtDate(selected.paidAt) }] : []),
            ...(selected.notes ? [{ label: "Notes", value: selected.notes }] : []),
            { label: "Créée le",       value: fmtDate(selected.createdAt) },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#0f766e", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  statChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, alignItems: "center" },
  statVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 10, height: 38, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 2 },
  cardTop: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 8 },
  cardRef: { fontSize: 10, fontFamily: "Inter_400Regular", marginBottom: 2 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  cardClient: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  cardAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, paddingTop: 8 },
  cardMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  remainChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  swipeBtn: { justifyContent: "center", alignItems: "center", width: 72, borderRadius: 10, marginLeft: 5, marginBottom: 2, gap: 2 },
  swipeBtnText: { color: "#fff", fontSize: 9, fontFamily: "Inter_600SemiBold" },
});
