import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FormModal } from "@/components/FormModal";
import { FAB } from "@/components/FAB";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface AdminReport {
  id: number;
  subject: string;
  message: string;
  category: string;
  priority: string;
  status: string;
  organisationId: number;
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

interface ReportStats {
  total: number;
  nouveau: number;
  en_cours: number;
  resolu: number;
  ferme: number;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  nouveau:   { label: "Nouveau",   color: "#3b82f6", icon: "circle" },
  en_cours:  { label: "En cours",  color: "#f59e0b", icon: "clock" },
  resolu:    { label: "Résolu",    color: "#22c55e", icon: "check-circle" },
  ferme:     { label: "Fermé",     color: "#94a3b8", icon: "x-circle" },
  rejete:    { label: "Rejeté",    color: "#ef4444", icon: "slash" },
};

const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  basse:    { label: "Basse",    color: "#22c55e" },
  normale:  { label: "Normale",  color: "#64748b" },
  haute:    { label: "Haute",    color: "#f59e0b" },
  critique: { label: "Critique", color: "#ef4444" },
};

const CATEGORY_MAP: Record<string, { label: string; icon: keyof typeof Feather.glyphMap }> = {
  bug:          { label: "Bug",            icon: "alert-triangle" },
  amelioration: { label: "Amélioration",   icon: "trending-up" },
  question:     { label: "Question",       icon: "help-circle" },
  facturation:  { label: "Facturation",    icon: "credit-card" },
  acces:        { label: "Accès",          icon: "lock" },
  autre:        { label: "Autre",          icon: "file-text" },
};

const FORM_FIELDS = [
  { key: "subject", label: "Sujet", required: true },
  { key: "message", label: "Message détaillé", required: true, type: "multiline" as const },
  { key: "category", label: "Catégorie", type: "select" as const, options: [
    { value: "bug",          label: "Bug / Problème technique" },
    { value: "amelioration", label: "Demande d'amélioration" },
    { value: "question",     label: "Question" },
    { value: "facturation",  label: "Facturation" },
    { value: "acces",        label: "Accès / Permissions" },
    { value: "autre",        label: "Autre" },
  ]},
  { key: "priority", label: "Priorité", type: "select" as const, options: [
    { value: "basse",    label: "Basse" },
    { value: "normale",  label: "Normale" },
    { value: "haute",    label: "Haute" },
    { value: "critique", label: "Critique" },
  ]},
];

const STATUS_FILTERS = [
  { key: "all",      label: "Tout" },
  { key: "nouveau",  label: "Nouveau" },
  { key: "en_cours", label: "En cours" },
  { key: "resolu",   label: "Résolu" },
];

function fmtDate(d: string | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [reports, setReports] = useState<AdminReport[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminReport | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ category: "bug", priority: "normale" });
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (filterStatus !== "all") params.set("status", filterStatus);
      const [rRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/admin-reports?${params}`),
        fetchAuth(`${API_BASE}/api/admin-reports/stats`),
      ]);
      if (rRes.ok) {
        const d = await rRes.json();
        setReports(d.reports ?? []);
      }
      if (sRes.ok) setStats(await sRes.json());
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, filterStatus]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function handleCreate() {
    if (!formValues.subject?.trim() || !formValues.message?.trim()) return;
    setFormLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/admin-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (res.ok) {
        setShowForm(false);
        setFormValues({ category: "bug", priority: "normale" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  const filtered = reports.filter(r =>
    !search || r.subject.toLowerCase().includes(search.toLowerCase()) || r.message.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Rapports & Tickets</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={16} color="#fff" />
          </Pressable>
        </View>

        {stats && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { label: "Total",    value: stats.total,    color: "#fff" },
                { label: "Nouveau",  value: stats.nouveau,  color: "#93c5fd" },
                { label: "En cours", value: stats.en_cours, color: "#fde68a" },
                { label: "Résolu",   value: stats.resolu,   color: "#86efac" },
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
            placeholder="Rechercher un rapport..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Feather name="x" size={14} color="rgba(255,255,255,0.6)" /></Pressable> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {STATUS_FILTERS.map(f => (
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
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#7c3aed" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => String(r.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          ListEmptyComponent={
            <EmptyState
              icon="file-text"
              title="Aucun rapport"
              subtitle="Soumettez un ticket ou une demande d'assistance."
            />
          }
          renderItem={({ item }) => {
            const st = STATUS_MAP[item.status] ?? STATUS_MAP.nouveau;
            const pr = PRIORITY_MAP[item.priority] ?? PRIORITY_MAP.normale;
            const cat = CATEGORY_MAP[item.category] ?? CATEGORY_MAP.autre;
            return (
              <Pressable
                onPress={() => setSelected(item)}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: st.color, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.catIcon, { backgroundColor: "#7c3aed18" }]}>
                    <Feather name={cat.icon} size={14} color="#7c3aed" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardSubject, { color: colors.foreground }]} numberOfLines={1}>{item.subject}</Text>
                    <Text style={[styles.cardCategory, { color: colors.mutedForeground }]}>{cat.label}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <View style={[styles.statusPill, { backgroundColor: st.color + "20" }]}>
                      <Feather name={st.icon} size={9} color={st.color} />
                      <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: pr.color + "20" }]}>
                      <Text style={[styles.statusText, { color: pr.color }]}>{pr.label}</Text>
                    </View>
                  </View>
                </View>
                <Text style={[styles.cardMessage, { color: colors.mutedForeground }]} numberOfLines={2}>{item.message}</Text>
                <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
                  <Feather name="calendar" size={10} color={colors.mutedForeground} />
                  <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>{fmtDate(item.createdAt)}</Text>
                  {item.resolvedAt && (
                    <>
                      <Feather name="check" size={10} color="#22c55e" />
                      <Text style={[styles.cardDate, { color: "#22c55e" }]}>Résolu le {fmtDate(item.resolvedAt)}</Text>
                    </>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <FAB icon="plus" onPress={() => setShowForm(true)} />

      <FormModal
        visible={showForm}
        title="Nouveau rapport"
        icon="file-text"
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        onClose={() => { setShowForm(false); setFormValues({ category: "bug", priority: "normale" }); }}
        onSubmit={handleCreate}
        loading={formLoading}
        submitLabel="Envoyer le rapport"
      />

      {selected && (
        <DetailModal
          visible
          title={selected.subject}
          subtitle={CATEGORY_MAP[selected.category]?.label ?? selected.category}
          icon={CATEGORY_MAP[selected.category]?.icon ?? "file-text"}
          iconColor="#7c3aed"
          badge={{ label: STATUS_MAP[selected.status]?.label ?? selected.status, color: STATUS_MAP[selected.status]?.color ?? "#64748b" }}
          onClose={() => setSelected(null)}
          fields={[
            { label: "Statut",     value: STATUS_MAP[selected.status]?.label ?? selected.status },
            { label: "Priorité",   value: PRIORITY_MAP[selected.priority]?.label ?? selected.priority },
            { label: "Catégorie",  value: CATEGORY_MAP[selected.category]?.label ?? selected.category },
            { label: "Message",    value: selected.message },
            ...(selected.resolution ? [{ label: "Résolution", value: selected.resolution }] : []),
            { label: "Créé le",    value: fmtDate(selected.createdAt) },
            ...(selected.resolvedAt ? [{ label: "Résolu le", value: fmtDate(selected.resolvedAt) }] : []),
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#7c3aed", paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  statChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, alignItems: "center" },
  statVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 10, height: 38, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 2 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
  catIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardSubject: { fontSize: 14, fontFamily: "Inter_700Bold" },
  cardCategory: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  statusText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  cardMessage: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 8 },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 4, borderTopWidth: 1, paddingTop: 8 },
  cardDate: { fontSize: 10, fontFamily: "Inter_400Regular" },
});
