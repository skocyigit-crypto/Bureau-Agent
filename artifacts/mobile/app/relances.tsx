import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface OverdueFacture {
  id: number;
  reference: string;
  clientName: string;
  clientEmail?: string | null;
  totalAmount: string;
  paidAmount?: string | null;
  dueDate: string;
  status: string;
}

function daysOverdue(dueDate: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000));
}

function fmtAmount(v: string | null | undefined) {
  if (!v) return "0 €";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(Number(v));
}

function UrgencyBadge({ days, colors }: { days: number; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  const color = days >= 60 ? "#dc2626" : days >= 30 ? "#ef4444" : days >= 7 ? "#f59e0b" : "#64748b";
  const label = days >= 60 ? "Critique" : days >= 30 ? "Urgent" : days >= 7 ? "À relancer" : "Recent";
  return (
    <View style={[styles.urgencyBadge, { backgroundColor: color + "18" }]}>
      <Feather name={days >= 30 ? "alert-triangle" : "clock"} size={10} color={color} />
      <Text style={[styles.urgencyText, { color }]}>{label} · {days}j</Text>
    </View>
  );
}

export default function RelancesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [factures, setFactures] = useState<OverdueFacture[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [retardFilter, setRetardFilter] = useState("all");
  const [selected, setSelected] = useState<OverdueFacture | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/factures-client?overdue=true&limit=100&sortBy=dueDate&sortOrder=asc`);
      if (res.ok) {
        const d = await res.json();
        setFactures(d.data ?? []);
      }
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);

  function onRefresh() { setRefreshing(true); load(); }

  async function sendRelance(f: OverdueFacture) {
    if (!f.clientEmail) {
      Alert.alert("Email manquant", "Aucun email enregistré pour ce client.");
      return;
    }
    setSending(f.id);
    try {
      const res = await fetchAuth(`${API_BASE}/api/factures-client/${f.id}/send`, { method: "POST" });
      if (res.ok) {
        Alert.alert("Relance envoyée", `Email envoyé à ${f.clientEmail}`);
      } else {
        const d = await res.json();
        Alert.alert("Erreur", d.error ?? "Impossible d'envoyer la relance.");
      }
    } catch {
      Alert.alert("Erreur", "Erreur réseau.");
    } finally {
      setSending(null);
    }
  }

  const filters = [
    { key: "all", label: "Toutes" },
    { key: "7", label: "+7j" },
    { key: "30", label: "+30j" },
    { key: "60", label: "+60j" },
  ];

  const filtered = factures.filter(f => {
    const q = search.toLowerCase();
    const matchSearch = !q || f.clientName.toLowerCase().includes(q) || f.reference.toLowerCase().includes(q);
    const days = daysOverdue(f.dueDate);
    const matchFilter = retardFilter === "all" || days >= Number(retardFilter);
    return matchSearch && matchFilter;
  });

  const totalDue = filtered.reduce((acc, f) => acc + Math.max(0, Number(f.totalAmount) - Number(f.paidAmount || 0)), 0);
  const critiques = filtered.filter(f => daysOverdue(f.dueDate) >= 30).length;
  const withEmail = filtered.filter(f => f.clientEmail).length;

  const detailFields = selected ? [
    { label: "Référence", value: selected.reference },
    { label: "Client", value: selected.clientName },
    { label: "Email", value: selected.clientEmail ?? "—", icon: "mail" as const, action: selected.clientEmail ? "email" as const : undefined },
    { label: "Montant total", value: fmtAmount(selected.totalAmount) },
    { label: "Déjà payé", value: fmtAmount(selected.paidAmount) },
    { label: "Solde dû", value: fmtAmount(String(Math.max(0, Number(selected.totalAmount) - Number(selected.paidAmount || 0)))) },
    { label: "Échéance", value: new Date(selected.dueDate).toLocaleDateString("fr-FR") },
    { label: "Retard", value: `${daysOverdue(selected.dueDate)} jours` },
  ] : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#dc2626", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Relances Clients</Text>
          <Pressable onPress={onRefresh} style={styles.refreshBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
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
              onPress={() => setRetardFilter(f.key)}
              style={[styles.filterChip, { backgroundColor: retardFilter === f.key ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.filterText, { color: "#fff" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#dc2626" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#dc2626" />}
          ListHeaderComponent={
            factures.length > 0 ? (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: "#ef444430", borderLeftWidth: 3, borderLeftColor: "#ef4444" }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#ef4444" }]}>{filtered.length}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En retard</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#dc2626", fontSize: 13 }]}>
                    {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalDue)}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>À encaisser</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#dc2626" }]}>{critiques}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Critiques</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e" }]}>{withEmail}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Avec email</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="check-circle"
              title="Aucune relance"
              subtitle={search ? "Aucune facture ne correspond à votre recherche." : "Toutes vos factures sont à jour !"}
            />
          }
          renderItem={({ item }) => {
            const days = daysOverdue(item.dueDate);
            const solde = Math.max(0, Number(item.totalAmount) - Number(item.paidAmount || 0));
            const isSending = sending === item.id;
            const urgencyColor = days >= 60 ? "#dc2626" : days >= 30 ? "#ef4444" : days >= 7 ? "#f59e0b" : "#64748b";

            return (
              <Pressable
                onPress={() => setSelected(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: colors.card,
                    borderColor: urgencyColor + "30",
                    borderLeftWidth: 3,
                    borderLeftColor: urgencyColor,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View style={styles.rowHeader}>
                  <Text style={[styles.reference, { color: colors.foreground }]}>{item.reference}</Text>
                  <UrgencyBadge days={days} colors={colors} />
                </View>

                <Text style={[styles.clientName, { color: colors.foreground }]} numberOfLines={1}>
                  <Feather name="user" size={12} color={colors.mutedForeground} /> {item.clientName}
                </Text>

                <View style={styles.rowMeta}>
                  <View style={styles.metaChip}>
                    <Feather name="calendar" size={10} color={colors.mutedForeground} />
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                      Éch: {new Date(item.dueDate).toLocaleDateString("fr-FR")}
                    </Text>
                  </View>
                  <View style={styles.metaChip}>
                    <Feather name="dollar-sign" size={10} color={urgencyColor} />
                    <Text style={[styles.metaText, { color: urgencyColor, fontFamily: "Inter_600SemiBold" }]}>
                      {fmtAmount(String(solde))}
                    </Text>
                  </View>
                </View>

                <View style={styles.rowActions}>
                  <Pressable
                    onPress={() => sendRelance(item)}
                    disabled={isSending || !item.clientEmail}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: !item.clientEmail ? colors.border : "#3b82f6",
                        opacity: !item.clientEmail ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Feather name={isSending ? "loader" : "mail"} size={13} color="#fff" />
                    <Text style={styles.actionBtnText}>
                      {isSending ? "Envoi..." : item.clientEmail ? "Relancer" : "Pas d'email"}
                    </Text>
                  </Pressable>
                  {item.clientEmail ? (
                    <Pressable
                      style={[styles.iconBtn, { backgroundColor: colors.border }]}
                      onPress={() => {
                        const subject = encodeURIComponent(`Rappel de paiement - Facture ${item.reference}`);
                        const body = encodeURIComponent(`Bonjour,\n\nNous vous rappelons que la facture ${item.reference} d'un montant de ${fmtAmount(String(solde))} est en retard de paiement depuis ${days} jours.\n\nMerci de bien vouloir régulariser cette situation.\n\nCordialement`);
                        const mailtoURL = `mailto:${item.clientEmail}?subject=${subject}&body=${body}`;
                        if (Platform.OS !== "web") {
                          require("react-native").Linking.openURL(mailtoURL);
                        }
                      }}
                    >
                      <Feather name="external-link" size={14} color={colors.foreground} />
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <DetailModal
        visible={!!selected}
        icon="alert-triangle"
        iconColor="#ef4444"
        title={selected?.reference ?? ""}
        subtitle={selected ? `${selected.clientName} · ${daysOverdue(selected.dueDate)}j de retard` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={selected ? [
          {
            label: "Envoyer relance",
            icon: "mail",
            color: "#3b82f6",
            onPress: () => { setSelected(null); sendRelance(selected); },
          },
          {
            label: "Créer un projet",
            icon: "folder",
            color: "#6366f1",
            onPress: async () => {
              const snap = selected;
              setSelected(null);
              try {
                await fetchAuth(`${API_BASE}/api/projets`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: `Recouvrement ${snap.reference}`,
                    status: "planifie",
                    priority: daysOverdue(snap.dueDate) >= 30 ? "haute" : "moyenne",
                    progress: 0,
                    clientName: snap.clientName,
                    notes: `Facture ${snap.reference} en retard de ${daysOverdue(snap.dueDate)} jours`,
                  }),
                });
                router.push("/projets");
              } catch {}
            },
          },
        ] : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  backBtn: { padding: 4 },
  refreshBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDivider: { width: 1, height: 28 },
  row: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  reference: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  clientName: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 6 },
  urgencyBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  urgencyText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowMeta: { flexDirection: "row", gap: 12, marginBottom: 10 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  rowActions: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 32, borderRadius: 8 },
  actionBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  iconBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
