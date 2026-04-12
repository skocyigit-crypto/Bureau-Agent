import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Invoice {
  id: number;
  reference: string;
  title: string;
  clientName: string;
  status: string;
  subtotal: number;
  taxRate: number;
  totalAmount: number;
  paidAmount: number;
  dueDate: string | null;
  createdAt: string;
  currency: string;
}

interface InvoiceStats {
  total: number;
  brouillon: number;
  envoyee: number;
  payee: number;
  en_retard: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  brouillon: { label: "Brouillon", color: "#64748b", icon: "edit-3" },
  envoyee: { label: "Envoyee", color: "#3b82f6", icon: "send" },
  payee: { label: "Payee", color: "#22c55e", icon: "check-circle" },
  partielle: { label: "Partielle", color: "#f59e0b", icon: "clock" },
  annulee: { label: "Annulee", color: "#ef4444", icon: "x-circle" },
};

function formatCurrency(v: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}

function formatDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function isOverdue(inv: Invoice) {
  return inv.status === "envoyee" && inv.dueDate && new Date(inv.dueDate) < new Date();
}

export default function InvoicesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const [iRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/factures-client?${params}`),
        fetchAuth(`${API_BASE}/api/factures-client/stats`),
      ]);
      if (iRes.ok) {
        const d = await iRes.json();
        setInvoices(d.factures || []);
      }
      if (sRes.ok) {
        const d = await sRes.json();
        setStats(d);
      }
    } catch (e) {
      console.warn("[Invoices] fetch error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, filter, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  const filteredInvoices = useMemo(() => {
    if (!search) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(i =>
      i.title?.toLowerCase().includes(q) ||
      i.clientName?.toLowerCase().includes(q) ||
      i.reference?.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  function renderInvoice({ item }: { item: Invoice }) {
    const st = STATUS_MAP[item.status] || STATUS_MAP.brouillon;
    const overdue = isOverdue(item);
    const paidPct = item.totalAmount > 0 ? Math.min(100, Math.round((item.paidAmount / item.totalAmount) * 100)) : 0;

    return (
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelected(item);
        }}
        style={({ pressed }) => [
          styles.invoiceCard,
          { backgroundColor: colors.card, borderColor: overdue ? "#ef4444" : colors.border, borderWidth: overdue ? 1.5 : 1 },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.invoiceRef, { color: colors.mutedForeground }]}>{item.reference || `#${item.id}`}</Text>
            <Text style={[styles.invoiceTitle, { color: colors.foreground }]} numberOfLines={1}>
              {item.title || item.clientName}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: st.color + "18" }]}>
            <Feather name={st.icon} size={12} color={st.color} />
            <Text style={[styles.statusText, { color: st.color }]}>{overdue ? "En retard" : st.label}</Text>
          </View>
        </View>

        <View style={styles.clientRow}>
          <Feather name="user" size={12} color={colors.mutedForeground} />
          <Text style={[styles.clientName, { color: colors.mutedForeground }]} numberOfLines={1}>{item.clientName}</Text>
          {item.dueDate && (
            <>
              <Feather name="calendar" size={12} color={overdue ? "#ef4444" : colors.mutedForeground} style={{ marginLeft: 12 }} />
              <Text style={[styles.dueDate, { color: overdue ? "#ef4444" : colors.mutedForeground }]}>{formatDate(item.dueDate)}</Text>
            </>
          )}
        </View>

        <View style={styles.amountRow}>
          <Text style={[styles.totalAmount, { color: colors.foreground }]}>{formatCurrency(item.totalAmount, item.currency || "EUR")}</Text>
          {item.status !== "brouillon" && item.status !== "annulee" && (
            <View style={styles.progressContainer}>
              <View style={[styles.progressBar, { backgroundColor: colors.muted }]}>
                <View style={[styles.progressFill, { width: `${paidPct}%`, backgroundColor: paidPct >= 100 ? "#22c55e" : "#3b82f6" }]} />
              </View>
              <Text style={[styles.paidText, { color: colors.mutedForeground }]}>{paidPct}% paye</Text>
            </View>
          )}
        </View>

        {overdue && (
          <View style={[styles.overdueBanner, { backgroundColor: "#ef444410" }]}>
            <Feather name="alert-triangle" size={12} color="#ef4444" />
            <Text style={styles.overdueText}>
              En retard de {Math.ceil((Date.now() - new Date(item.dueDate!).getTime()) / 86400000)} jours
            </Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Factures</Text>
          <View style={{ width: 34 }} />
        </View>

        {stats && (
          <View style={styles.statsGrid}>
            <View style={[styles.miniStat, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <Text style={styles.miniStatValue}>{stats.total}</Text>
              <Text style={styles.miniStatLabel}>Total</Text>
            </View>
            <View style={[styles.miniStat, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <Text style={[styles.miniStatValue, { color: "#22c55e" }]}>{stats.payee}</Text>
              <Text style={styles.miniStatLabel}>Payees</Text>
            </View>
            <View style={[styles.miniStat, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <Text style={[styles.miniStatValue, { color: "#ef4444" }]}>{stats.en_retard}</Text>
              <Text style={styles.miniStatLabel}>Retard</Text>
            </View>
            <View style={[styles.miniStat, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
              <Text style={[styles.miniStatValue, { color: "#f59e0b" }]}>{formatCurrency(stats.unpaidAmount)}</Text>
              <Text style={styles.miniStatLabel}>Impaye</Text>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Rechercher facture..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <Pressable onPress={() => setSearch("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {[
          { id: "all", label: "Toutes", color: "#64748b" },
          { id: "brouillon", label: "Brouillon", color: "#64748b" },
          { id: "envoyee", label: "Envoyee", color: "#3b82f6" },
          { id: "payee", label: "Payee", color: "#22c55e" },
          { id: "partielle", label: "Partielle", color: "#f59e0b" },
          { id: "annulee", label: "Annulee", color: "#ef4444" },
        ].map(f => (
          <Pressable
            key={f.id}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFilter(f.id);
            }}
            style={[
              styles.filterChip,
              { backgroundColor: filter === f.id ? f.color + "20" : colors.card, borderColor: filter === f.id ? f.color : colors.border },
            ]}
          >
            <Text style={[styles.filterText, { color: filter === f.id ? f.color : colors.mutedForeground }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : filteredInvoices.length === 0 ? (
        <View style={styles.emptyCenter}>
          <Feather name="file-text" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Aucune facture</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Creez des factures depuis le web</Text>
        </View>
      ) : (
        <FlatList
          data={filteredInvoices}
          keyExtractor={i => String(i.id)}
          renderItem={renderInvoice}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal visible={!!selected} animationType="slide" transparent>
        {selected && (
          <View style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
            <View style={[styles.modalContent, { backgroundColor: colors.background, paddingTop: insets.top + 10 }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Detail Facture</Text>
                <Pressable onPress={() => setSelected(null)} style={[styles.closeBtn, { backgroundColor: colors.muted }]}>
                  <Feather name="x" size={18} color={colors.foreground} />
                </Pressable>
              </View>

              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.detailTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailRef, { color: colors.mutedForeground }]}>{selected.reference || `FAC-${selected.id}`}</Text>
                      <Text style={[styles.detailTitle, { color: colors.foreground }]}>{selected.title || selected.clientName}</Text>
                    </View>
                    {(() => { const st = STATUS_MAP[selected.status] || STATUS_MAP.brouillon; return (
                      <View style={[styles.statusLarge, { backgroundColor: st.color + "18" }]}>
                        <Feather name={st.icon} size={18} color={st.color} />
                        <Text style={[styles.statusLargeText, { color: st.color }]}>{isOverdue(selected) ? "En retard" : st.label}</Text>
                      </View>
                    ); })()}
                  </View>

                  <View style={[styles.amountCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
                    <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>Montant TTC</Text>
                    <Text style={[styles.amountBig, { color: colors.primary }]}>{formatCurrency(selected.totalAmount)}</Text>
                    <View style={styles.amountBreakdown}>
                      <Text style={[styles.breakdownText, { color: colors.mutedForeground }]}>HT: {formatCurrency(selected.subtotal || 0)}</Text>
                      <Text style={[styles.breakdownText, { color: colors.mutedForeground }]}>TVA: {selected.taxRate || 20}%</Text>
                    </View>
                  </View>

                  <View style={styles.paymentSection}>
                    <View style={styles.paymentRow}>
                      <Text style={[styles.paymentLabel, { color: colors.mutedForeground }]}>Paye</Text>
                      <Text style={[styles.paymentValue, { color: "#22c55e" }]}>{formatCurrency(selected.paidAmount || 0)}</Text>
                    </View>
                    <View style={styles.paymentRow}>
                      <Text style={[styles.paymentLabel, { color: colors.mutedForeground }]}>Reste</Text>
                      <Text style={[styles.paymentValue, { color: "#ef4444" }]}>{formatCurrency(selected.totalAmount - (selected.paidAmount || 0))}</Text>
                    </View>
                    {selected.totalAmount > 0 && (
                      <View style={[styles.progressBarLarge, { backgroundColor: colors.muted }]}>
                        <View style={[styles.progressFillLarge, { 
                          width: `${Math.min(100, Math.round(((selected.paidAmount || 0) / selected.totalAmount) * 100))}%`,
                          backgroundColor: selected.paidAmount >= selected.totalAmount ? "#22c55e" : "#3b82f6"
                        }]} />
                      </View>
                    )}
                  </View>

                  {[
                    { icon: "user" as const, label: "Client", value: selected.clientName },
                    { icon: "calendar" as const, label: "Date", value: formatDate(selected.createdAt) },
                    { icon: "clock" as const, label: "Echeance", value: formatDate(selected.dueDate) },
                  ].map(r => (
                    <View key={r.label} style={[styles.infoRowDetail, { borderColor: colors.border }]}>
                      <Feather name={r.icon} size={14} color={colors.mutedForeground} />
                      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{r.label}</Text>
                      <Text style={[styles.infoValue, { color: colors.foreground }]}>{r.value}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  miniStat: { flex: 1, minWidth: "22%", alignItems: "center", paddingVertical: 8, borderRadius: 10 },
  miniStatValue: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  miniStatLabel: { fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
  searchBar: { flexDirection: "row", alignItems: "center", margin: 16, marginBottom: 0, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  filterScroll: { maxHeight: 48, marginTop: 12 },
  filterContent: { paddingHorizontal: 16, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  listContent: { padding: 16, gap: 10 },
  invoiceCard: { borderRadius: 12, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  invoiceRef: { fontSize: 11, fontFamily: "Inter_500Medium" },
  invoiceTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, gap: 4 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  clientRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  clientName: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  dueDate: { fontSize: 11, fontFamily: "Inter_500Medium" },
  amountRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 12 },
  totalAmount: { fontSize: 17, fontFamily: "Inter_700Bold" },
  progressContainer: { flex: 1, alignItems: "flex-end" },
  progressBar: { width: "100%", height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  paidText: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 3 },
  overdueBanner: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  overdueText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#ef4444" },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalContent: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: 40 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  detailCard: { borderRadius: 12, borderWidth: 1, padding: 16 },
  detailTopRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16, gap: 12 },
  detailRef: { fontSize: 12, fontFamily: "Inter_500Medium" },
  detailTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 2 },
  statusLarge: { alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, gap: 4 },
  statusLargeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amountCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16, alignItems: "center" },
  amountLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  amountBig: { fontSize: 28, fontFamily: "Inter_700Bold", marginTop: 4 },
  amountBreakdown: { flexDirection: "row", gap: 16, marginTop: 6 },
  breakdownText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  paymentSection: { marginBottom: 16 },
  paymentRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  paymentLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  paymentValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  progressBarLarge: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 4 },
  progressFillLarge: { height: "100%", borderRadius: 3 },
  infoRowDetail: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  infoLabel: { fontSize: 12, fontFamily: "Inter_500Medium", width: 80 },
  infoValue: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1, textAlign: "right" },
});
