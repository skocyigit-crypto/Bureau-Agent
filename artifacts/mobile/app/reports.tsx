import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
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
import { useTranslation } from "@/lib/i18n";

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

const STATUS_MAP: Record<string, { labelKey: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  nouveau:   { labelKey: "reportsScreen.status.nouveau",  color: "#3b82f6", icon: "circle" },
  en_cours:  { labelKey: "reportsScreen.status.en_cours", color: "#f59e0b", icon: "clock" },
  resolu:    { labelKey: "reportsScreen.status.resolu",   color: "#22c55e", icon: "check-circle" },
  ferme:     { labelKey: "reportsScreen.status.ferme",    color: "#94a3b8", icon: "x-circle" },
  rejete:    { labelKey: "reportsScreen.status.rejete",   color: "#ef4444", icon: "slash" },
};

// Les valeurs sont celles de PRIORITES_RAPPORT (routes/admin-reports.ts) : ce
// sont les seules que la base stocke et que la route accepte. « normale » et
// « critique » n existaient nulle part ailleurs qu ici.
const PRIORITY_MAP: Record<string, { labelKey: string; color: string }> = {
  basse:   { labelKey: "reportsScreen.priority.basse",   color: "#22c55e" },
  normal:  { labelKey: "reportsScreen.priority.normal",  color: "#64748b" },
  haute:   { labelKey: "reportsScreen.priority.haute",   color: "#f59e0b" },
  urgente: { labelKey: "reportsScreen.priority.urgente", color: "#ef4444" },
};

// Idem pour CATEGORIES_RAPPORT. Sans cela, un rapport range en « securite »
// s affichait « Autre » (valeur inconnue, repli de la ligne 240) : la categorie
// la plus urgente etait aussi la plus invisible.
const CATEGORY_MAP: Record<string, { labelKey: string; icon: keyof typeof Feather.glyphMap }> = {
  general:     { labelKey: "reportsScreen.category.general",     icon: "help-circle" },
  technique:   { labelKey: "reportsScreen.category.technique",   icon: "alert-triangle" },
  facturation: { labelKey: "reportsScreen.category.facturation", icon: "credit-card" },
  securite:    { labelKey: "reportsScreen.category.securite",    icon: "shield" },
  autre:       { labelKey: "reportsScreen.category.autre",       icon: "file-text" },
};

const STATUS_FILTERS = [
  { key: "all",      labelKey: "reportsScreen.filterAll" },
  { key: "nouveau",  labelKey: "reportsScreen.status.nouveau" },
  { key: "en_cours", labelKey: "reportsScreen.status.en_cours" },
  { key: "resolu",   labelKey: "reportsScreen.status.resolu" },
];

function fmtDate(d: string | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const FORM_FIELDS = [
    { key: "subject", label: t("reportsScreen.fieldSubject"), required: true },
    { key: "message", label: t("reportsScreen.fieldMessage"), required: true, type: "multiline" as const },
    { key: "category", label: t("reportsScreen.fieldCategory"), type: "select" as const, options: [
      { value: "general",     label: t("reportsScreen.catOption.general") },
      { value: "technique",   label: t("reportsScreen.catOption.technique") },
      { value: "facturation", label: t("reportsScreen.catOption.facturation") },
      { value: "securite",    label: t("reportsScreen.catOption.securite") },
      { value: "autre",       label: t("reportsScreen.catOption.autre") },
    ]},
    { key: "priority", label: t("reportsScreen.fieldPriority"), type: "select" as const, options: [
      { value: "basse",   label: t("reportsScreen.priority.basse") },
      { value: "normal",  label: t("reportsScreen.priority.normal") },
      { value: "haute",   label: t("reportsScreen.priority.haute") },
      { value: "urgente", label: t("reportsScreen.priority.urgente") },
    ]},
  ];

  const [reports, setReports] = useState<AdminReport[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminReport | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ category: "general", priority: "normal" });
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
        setFormValues({ category: "general", priority: "normal" });
        load();
      } else { Alert.alert(t("common.error"), t("common.actionFailed")); }
    } finally { setFormLoading(false); }
  }

  const filtered = reports.filter(r =>
    !search || r.subject.toLowerCase().includes(search.toLowerCase()) || r.message.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>{t("reportsScreen.headerTitle")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.refresh")} onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={16} color="#fff" />
          </Pressable>
        </View>

        {stats && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                { key: "total",    label: t("reportsScreen.statTotal"),   value: stats.total,    color: "#fff" },
                { key: "nouveau",  label: t("reportsScreen.status.nouveau"),  value: stats.nouveau,  color: "#93c5fd" },
                { key: "en_cours", label: t("reportsScreen.status.en_cours"), value: stats.en_cours, color: "#fde68a" },
                { key: "resolu",   label: t("reportsScreen.status.resolu"),   value: stats.resolu,   color: "#86efac" },
              ].map(s => (
                <View key={s.key} style={[styles.statChip, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
                  <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
                  <Text style={styles.statLbl}>{s.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.6)" />
          <TextInput accessibilityLabel={t("reportsScreen.searchPlaceholder")}
            style={styles.searchInput}
            placeholder={t("reportsScreen.searchPlaceholder")}
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={() => setSearch("")}><Feather name="x" size={14} color="rgba(255,255,255,0.6)" /></Pressable> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {STATUS_FILTERS.map(f => (
              <Pressable accessibilityRole="button"
                key={f.key}
                onPress={() => setFilterStatus(f.key)}
                style={[styles.filterChip, { backgroundColor: filterStatus === f.key ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)" }]}
              >
                <Text style={styles.filterText}>{t(f.labelKey)}</Text>
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
              title={t("reportsScreen.emptyTitle")}
              subtitle={t("reportsScreen.emptySubtitle")}
            />
          }
          renderItem={({ item }) => {
            const st = STATUS_MAP[item.status] ?? STATUS_MAP.nouveau;
            const pr = PRIORITY_MAP[item.priority] ?? PRIORITY_MAP.normal;
            const cat = CATEGORY_MAP[item.category] ?? CATEGORY_MAP.autre;
            return (
              <Pressable accessibilityRole="button"
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
                    <Text style={[styles.cardCategory, { color: colors.mutedForeground }]}>{t(cat.labelKey)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <View style={[styles.statusPill, { backgroundColor: st.color + "20" }]}>
                      <Feather name={st.icon} size={9} color={st.color} />
                      <Text style={[styles.statusText, { color: st.color }]}>{t(st.labelKey)}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: pr.color + "20" }]}>
                      <Text style={[styles.statusText, { color: pr.color }]}>{t(pr.labelKey)}</Text>
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
                      <Text style={[styles.cardDate, { color: "#22c55e" }]}>{t("reportsScreen.resolvedOn", { date: fmtDate(item.resolvedAt) })}</Text>
                    </>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <FAB accessibilityLabel={t("reportsScreen.formTitle")} icon="plus" onPress={() => setShowForm(true)} />

      <FormModal
        visible={showForm}
        title={t("reportsScreen.formTitle")}
        icon="file-text"
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        onClose={() => { setShowForm(false); setFormValues({ category: "bug", priority: "normale" }); }}
        onSubmit={handleCreate}
        loading={formLoading}
        submitLabel={t("reportsScreen.formSubmit")}
      />

      {selected && (
        <DetailModal
          visible
          title={selected.subject}
          subtitle={CATEGORY_MAP[selected.category] ? t(CATEGORY_MAP[selected.category].labelKey) : selected.category}
          icon={CATEGORY_MAP[selected.category]?.icon ?? "file-text"}
          iconColor="#7c3aed"
          badge={{ label: STATUS_MAP[selected.status] ? t(STATUS_MAP[selected.status].labelKey) : selected.status, color: STATUS_MAP[selected.status]?.color ?? "#64748b" }}
          onClose={() => setSelected(null)}
          fields={[
            { label: t("reportsScreen.detailStatut"),     value: STATUS_MAP[selected.status] ? t(STATUS_MAP[selected.status].labelKey) : selected.status },
            { label: t("reportsScreen.fieldPriority"),    value: PRIORITY_MAP[selected.priority] ? t(PRIORITY_MAP[selected.priority].labelKey) : selected.priority },
            { label: t("reportsScreen.fieldCategory"),    value: CATEGORY_MAP[selected.category] ? t(CATEGORY_MAP[selected.category].labelKey) : selected.category },
            { label: t("reportsScreen.fieldMessageShort"), value: selected.message },
            ...(selected.resolution ? [{ label: t("reportsScreen.detailResolution"), value: selected.resolution }] : []),
            { label: t("reportsScreen.detailCreatedOn"),  value: fmtDate(selected.createdAt) },
            ...(selected.resolvedAt ? [{ label: t("reportsScreen.detailResolvedOn"), value: fmtDate(selected.resolvedAt) }] : []),
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
