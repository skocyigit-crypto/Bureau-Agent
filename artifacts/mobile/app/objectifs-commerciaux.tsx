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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Objectif {
  id: number;
  title: string;
  metric: string;
  targetValue: string;
  currentValue: string;
  period: string;
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  notes?: string | null;
}

const METRIC_LABELS: Record<string, { label: string; icon: keyof typeof Feather.glyphMap; color: string }> = {
  revenue:          { label: "Chiffre d'affaires",  icon: "dollar-sign", color: "#22c55e" },
  devis:            { label: "Devis",               icon: "file-text",   color: "#3b82f6" },
  factures:         { label: "Factures",            icon: "file",        color: "#0891b2" },
  prospects:        { label: "Prospects",           icon: "trending-up", color: "#8b5cf6" },
  calls:            { label: "Appels",              icon: "phone",       color: "#f59e0b" },
  contacts:         { label: "Contacts",            icon: "users",       color: "#ec4899" },
  projets:          { label: "Projets",             icon: "folder",      color: "#6366f1" },
  projets_termines: { label: "Projets terminés",   icon: "check-circle", color: "#22c55e" },
};

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Hebdo", monthly: "Mensuel", quarterly: "Trimestriel", yearly: "Annuel",
};

const FORM_FIELDS = [
  { key: "title", label: "Titre de l'objectif", required: true },
  {
    key: "metric", label: "Métrique", type: "select" as const, options: [
      { value: "revenue",          label: "Chiffre d'affaires (€)" },
      { value: "devis",            label: "Nombre de devis" },
      { value: "factures",         label: "Nombre de factures" },
      { value: "prospects",        label: "Nombre de prospects" },
      { value: "calls",            label: "Nombre d'appels" },
      { value: "contacts",         label: "Nombre de contacts" },
      { value: "projets",          label: "Nombre de projets" },
      { value: "projets_termines", label: "Projets terminés" },
    ],
  },
  { key: "targetValue", label: "Valeur cible", required: true },
  { key: "currentValue", label: "Valeur actuelle" },
  {
    key: "period", label: "Période", type: "select" as const, options: [
      { value: "weekly",    label: "Hebdomadaire" },
      { value: "monthly",   label: "Mensuel" },
      { value: "quarterly", label: "Trimestriel" },
      { value: "yearly",    label: "Annuel" },
    ],
  },
  { key: "startDate", label: "Date de début" },
  { key: "endDate", label: "Date de fin" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function ProgressRing({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: 5, borderColor: color + "20",
        alignItems: "center", justifyContent: "center",
        position: "absolute",
      }} />
      <View style={{
        width: size - 10, height: size - 10, borderRadius: (size - 10) / 2,
        borderWidth: 4, borderColor: color,
        borderTopColor: clamped > 75 ? color : (clamped > 50 ? color + "cc" : clamped > 25 ? color + "66" : "transparent"),
        alignItems: "center", justifyContent: "center",
        transform: [{ rotate: `${(clamped / 100) * 360}deg` }],
      }} />
      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color, position: "absolute" }}>
        {clamped}%
      </Text>
    </View>
  );
}

function ObjectifCard({ obj, colors, onDelete }: {
  obj: Objectif;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
}) {
  const current = parseFloat(obj.currentValue || "0");
  const target = parseFloat(obj.targetValue || "1");
  const pct = Math.round((current / target) * 100);
  const m = METRIC_LABELS[obj.metric] ?? { label: obj.metric, icon: "target" as const, color: "#6366f1" };
  const periodLabel = PERIOD_LABELS[obj.period] ?? obj.period;
  const isRevenue = obj.metric === "revenue";
  const done = pct >= 100;

  function fmtVal(v: number) {
    if (isRevenue) return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
    return v.toLocaleString("fr-FR");
  }

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: colors.card,
        borderColor: done ? "#22c55e40" : m.color + "20",
        borderLeftWidth: 3,
        borderLeftColor: done ? "#22c55e" : m.color,
      },
    ]}>
      <View style={styles.cardHeader}>
        <View style={[styles.metricIcon, { backgroundColor: m.color + "15" }]}>
          <Feather name={m.icon} size={16} color={m.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>{obj.title}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.periodBadge, { backgroundColor: colors.border }]}>
              <Text style={[styles.periodText, { color: colors.mutedForeground }]}>{periodLabel}</Text>
            </View>
            <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
          </View>
        </View>
        <Pressable onPress={() => {
          if (Platform.OS === "web") { onDelete(obj.id); return; }
          Alert.alert("Supprimer", `Supprimer "${obj.title}" ?`, [
            { text: "Annuler", style: "cancel" },
            { text: "Supprimer", style: "destructive", onPress: () => onDelete(obj.id) },
          ]);
        }} hitSlop={8} style={styles.deleteBtn}>
          <Feather name="trash-2" size={15} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressValues}>
          <View>
            <Text style={[styles.currentValue, { color: done ? "#22c55e" : m.color }]}>{fmtVal(current)}</Text>
            <Text style={[styles.targetValue, { color: colors.mutedForeground }]}>sur {fmtVal(target)}</Text>
          </View>
          {done && (
            <View style={[styles.doneBadge, { backgroundColor: "#22c55e18" }]}>
              <Feather name="check-circle" size={14} color="#22c55e" />
              <Text style={[styles.doneBadgeText, { color: "#22c55e" }]}>Atteint !</Text>
            </View>
          )}
        </View>
        <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
          <View style={[
            styles.progressFill,
            { width: `${Math.min(100, pct)}%` as any, backgroundColor: done ? "#22c55e" : m.color },
          ]} />
        </View>
        <Text style={[styles.progressPct, { color: done ? "#22c55e" : m.color }]}>{pct}% atteint</Text>
      </View>

      {obj.notes && (
        <Text style={[styles.notesText, { color: colors.mutedForeground }]} numberOfLines={2}>{obj.notes}</Text>
      )}

      {(obj.startDate || obj.endDate) && (
        <View style={styles.datesRow}>
          {obj.startDate && (
            <View style={styles.dateChip}>
              <Feather name="play-circle" size={10} color={colors.mutedForeground} />
              <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
                {new Date(obj.startDate).toLocaleDateString("fr-FR")}
              </Text>
            </View>
          )}
          {obj.endDate && (
            <View style={styles.dateChip}>
              <Feather name="flag" size={10} color={colors.mutedForeground} />
              <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
                {new Date(obj.endDate).toLocaleDateString("fr-FR")}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function ObjectifsCommerciauxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [objectifs, setObjectifs] = useState<Objectif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ metric: "revenue", period: "monthly", currentValue: "0" });
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/objectifs-commerciaux`);
      if (res.ok) setObjectifs(await res.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setObjectifs(prev => prev.filter(o => o.id !== id));
    try { await fetchAuth(`${API_BASE}/api/objectifs-commerciaux/${id}`, { method: "DELETE" }); load(); }
    catch { load(); }
  }

  async function handleSubmit() {
    if (!formValues.title?.trim() || !formValues.targetValue) return;
    setFormLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/objectifs-commerciaux`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formValues,
          targetValue: parseFloat(formValues.targetValue),
          currentValue: parseFloat(formValues.currentValue || "0"),
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormValues({ metric: "revenue", period: "monthly", currentValue: "0" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  const totalObjectifs = objectifs.length;
  const completed = objectifs.filter(o => {
    const pct = (parseFloat(o.currentValue || "0") / parseFloat(o.targetValue || "1")) * 100;
    return pct >= 100;
  }).length;
  const avgPct = objectifs.length === 0 ? 0 : Math.round(
    objectifs.reduce((s, o) => s + Math.min(100, (parseFloat(o.currentValue || "0") / parseFloat(o.targetValue || "1")) * 100), 0) / objectifs.length
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#0d9488", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Objectifs Commerciaux</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        {!loading && objectifs.length > 0 && (
          <View style={[styles.summaryBar, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>{totalObjectifs}</Text>
              <Text style={styles.summaryLbl}>Objectifs</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: "#4ade80" }]}>{completed}</Text>
              <Text style={styles.summaryLbl}>Atteints</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryNum, { color: "#fcd34d" }]}>{avgPct}%</Text>
              <Text style={styles.summaryLbl}>Moy. atteinte</Text>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0d9488" />
        </View>
      ) : (
        <FlatList
          data={objectifs}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0d9488" />}
          ListEmptyComponent={
            <EmptyState
              icon="target"
              title="Aucun objectif"
              subtitle="Définissez des objectifs commerciaux pour votre équipe."
            />
          }
          renderItem={({ item }) => (
            <ObjectifCard obj={item} colors={colors} onDelete={handleDelete} />
          )}
        />
      )}

      <FAB onPress={() => setShowForm(true)} icon="plus" />

      <FormModal
        visible={showForm}
        title="Nouvel objectif"
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        onSubmit={handleSubmit}
        onClose={() => setShowForm(false)}
        loading={formLoading}
        submitLabel="Créer"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  summaryBar: { flexDirection: "row", borderRadius: 12, padding: 12, alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryNum: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  summaryLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2 },
  summaryDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.2)" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  metricIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1, lineHeight: 21 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  periodBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  periodText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  metricLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  deleteBtn: { padding: 4 },
  progressSection: { marginBottom: 8 },
  progressValues: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  currentValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  targetValue: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  doneBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  doneBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  progressBar: { height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 4 },
  progressFill: { height: "100%", borderRadius: 4 },
  progressPct: { fontSize: 11, fontFamily: "Inter_500Medium" },
  notesText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 18 },
  datesRow: { flexDirection: "row", gap: 12, marginTop: 10 },
  dateChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  dateText: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
