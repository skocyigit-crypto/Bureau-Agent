import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface ExecutiveSummary {
  period: { days: number; start: string; end: string };
  score: number;
  calls: {
    total: number; answered: number; missed: number;
    avgDuration: number; totalDuration: number;
    trend: number; responseRate: number; prevResponseRate: number;
  };
  contacts: { total: number; newThisPeriod: number };
  tasks: {
    total: number; completed: number; inProgress: number;
    overdue: number; highPriority: number;
    completionRate: number; prevCompletionRate: number;
  };
  messages: { total: number; unread: number };
  prospects: {
    total: number; won: number; lost: number;
    totalValue: number; wonValue: number;
    winRate: number; prevWinRate: number; avgProbability: number;
  };
  events: { total: number; upcoming: number };
  projets: { total: number; active: number; termine: number; overdue: number; avgProgress: number };
  insights: Array<{ type: string; severity: string; message: string; metric?: string }>;
  trends: { callTrend: number; taskTrend: number; prospectTrend: number; responseTrend: number };
}

const PERIOD_OPTIONS = [
  { val: 7,  label: "7 jours"  },
  { val: 30, label: "30 jours" },
  { val: 90, label: "90 jours" },
];

const SEVERITY_CFG: Record<string, { color: string; bg: string; icon: keyof typeof Feather.glyphMap }> = {
  positif:  { color: "#22c55e", bg: "#22c55e18", icon: "trending-up"   },
  critique: { color: "#ef4444", bg: "#ef444418", icon: "alert-triangle" },
  alerte:   { color: "#f59e0b", bg: "#f59e0b18", icon: "alert-circle"   },
  info:     { color: "#3b82f6", bg: "#3b82f618", icon: "info"           },
};

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Bon";
  if (score >= 40) return "À améliorer";
  return "Critique";
}

function fmtDuration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s > 0 ? s + "s" : ""}` : `${s}s`;
}

function TrendBadge({ val, colors }: { val: number; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  if (val === 0) return null;
  const up = val > 0;
  return (
    <View style={[styles.trendBadge, { backgroundColor: up ? "#22c55e18" : "#ef444418" }]}>
      <Feather name={up ? "trending-up" : "trending-down"} size={10} color={up ? "#22c55e" : "#ef4444"} />
      <Text style={[styles.trendText, { color: up ? "#22c55e" : "#ef4444" }]}>{up ? "+" : ""}{val}%</Text>
    </View>
  );
}

function KpiCard({ icon, iconColor, label, value, sub, trend, colors }: {
  icon: keyof typeof Feather.glyphMap;
  iconColor: string;
  label: string;
  value: string | number;
  sub?: string;
  trend?: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.kpiIcon, { backgroundColor: iconColor + "18" }]}>
        <Feather name={icon} size={16} color={iconColor} />
      </View>
      <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.kpiValueRow}>
        <Text style={[styles.kpiValue, { color: colors.foreground }]}>{value}</Text>
        {trend !== undefined && <TrendBadge val={trend} colors={colors} />}
      </View>
      {sub && <Text style={[styles.kpiSub, { color: colors.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}

function SectionTitle({ title, icon, color, colors }: {
  title: string; icon: keyof typeof Feather.glyphMap; color: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={[styles.sectionIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <Text style={[styles.sectionTitleText, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

export default function RapportExecutifScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [data, setData] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/smart-reports/executive-summary?days=${days}`);
      if (res.ok) setData(await res.json());
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, days]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  const sc = data ? scoreColor(data.score) : "#6b7280";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#1e293b", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Rapport Exécutif</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <View style={styles.periodRow}>
          {PERIOD_OPTIONS.map(p => (
            <Pressable
              key={p.val}
              onPress={() => setDays(p.val)}
              style={[styles.periodChip, { backgroundColor: days === p.val ? "#fff" : "rgba(255,255,255,0.15)" }]}
            >
              <Text style={[styles.periodText, { color: days === p.val ? "#1e293b" : "rgba(255,255,255,0.85)" }]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        {data && (
          <View style={[styles.scoreStrip, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
            <View style={[styles.scoreDial, { borderColor: sc }]}>
              <Text style={[styles.scoreNum, { color: sc }]}>{data.score}</Text>
              <Text style={[styles.scoreMax, { color: "rgba(255,255,255,0.5)" }]}>/100</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.scoreLabel, { color: sc }]}>{scoreLabel(data.score)}</Text>
              <Text style={styles.scoreSub}>Score de performance global</Text>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#1e293b" /></View>
      ) : !data ? (
        <EmptyState icon="bar-chart" title="Aucune donnée" subtitle="Impossible de charger le rapport." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e293b" />}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 }]}
        >
          {/* Insights */}
          {data.insights.length > 0 && (
            <View style={styles.section}>
              <SectionTitle title="Points clés" icon="zap" color="#f59e0b" colors={colors} />
              <View style={styles.insightsList}>
                {data.insights.map((ins, i) => {
                  const sev = SEVERITY_CFG[ins.severity] ?? SEVERITY_CFG.info;
                  return (
                    <View key={i} style={[styles.insightCard, { backgroundColor: sev.bg, borderColor: sev.color + "30" }]}>
                      <Feather name={sev.icon} size={14} color={sev.color} style={{ marginTop: 1 }} />
                      <Text style={[styles.insightText, { color: colors.foreground }]}>{ins.message}</Text>
                      {ins.metric && (
                        <Text style={[styles.insightMetric, { color: sev.color }]}>{ins.metric}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Calls */}
          <View style={styles.section}>
            <SectionTitle title="Appels" icon="phone" color="#22c55e" colors={colors} />
            <View style={styles.kpiGrid}>
              <KpiCard icon="phone" iconColor="#22c55e" label="Total appels" value={data.calls.total} trend={data.calls.trend} colors={colors} />
              <KpiCard icon="check-circle" iconColor="#3b82f6" label="Taux de réponse" value={`${data.calls.responseRate}%`} trend={data.trends.responseTrend} colors={colors} />
              <KpiCard icon="phone-missed" iconColor="#ef4444" label="Appels manqués" value={data.calls.missed} colors={colors} />
              <KpiCard icon="clock" iconColor="#f59e0b" label="Durée moy." value={fmtDuration(data.calls.avgDuration)} colors={colors} />
            </View>
          </View>

          {/* Tasks */}
          <View style={styles.section}>
            <SectionTitle title="Tâches" icon="check-square" color="#3b82f6" colors={colors} />
            <View style={styles.kpiGrid}>
              <KpiCard icon="check-square" iconColor="#3b82f6" label="Total tâches" value={data.tasks.total} colors={colors} />
              <KpiCard icon="check-circle" iconColor="#22c55e" label="Taux complétion" value={`${data.tasks.completionRate}%`} trend={data.trends.taskTrend} colors={colors} />
              <KpiCard icon="alert-triangle" iconColor="#ef4444" label="En retard" value={data.tasks.overdue} colors={colors} />
              <KpiCard icon="zap" iconColor="#f59e0b" label="Haute priorité" value={data.tasks.highPriority} colors={colors} />
            </View>
          </View>

          {/* Prospects */}
          <View style={styles.section}>
            <SectionTitle title="Prospects" icon="target" color="#8b5cf6" colors={colors} />
            <View style={styles.kpiGrid}>
              <KpiCard icon="users" iconColor="#8b5cf6" label="Total prospects" value={data.prospects.total} colors={colors} />
              <KpiCard icon="trending-up" iconColor="#22c55e" label="Taux de gain" value={`${data.prospects.winRate}%`} trend={data.trends.prospectTrend} colors={colors} />
              <KpiCard icon="dollar-sign" iconColor="#f59e0b" label="Valeur gagnée" value={`${Number(data.prospects.wonValue).toLocaleString("fr-FR")} €`} colors={colors} />
              <KpiCard icon="x-circle" iconColor="#ef4444" label="Perdus" value={data.prospects.lost} colors={colors} />
            </View>
          </View>

          {/* Projets */}
          <View style={styles.section}>
            <SectionTitle title="Projets" icon="folder" color="#0ea5e9" colors={colors} />
            <View style={styles.kpiGrid}>
              <KpiCard icon="folder" iconColor="#0ea5e9" label="Total projets" value={data.projets.total} colors={colors} />
              <KpiCard icon="activity" iconColor="#22c55e" label="Actifs" value={data.projets.active} sub={`Avancement moy. ${data.projets.avgProgress}%`} colors={colors} />
              <KpiCard icon="check-circle" iconColor="#3b82f6" label="Terminés" value={data.projets.termine} colors={colors} />
              <KpiCard icon="alert-triangle" iconColor="#ef4444" label="En retard" value={data.projets.overdue} colors={colors} />
            </View>
          </View>

          {/* Contacts & Messages */}
          <View style={styles.section}>
            <SectionTitle title="Contacts & Messages" icon="users" color="#6366f1" colors={colors} />
            <View style={styles.kpiGrid}>
              <KpiCard icon="users" iconColor="#6366f1" label="Total contacts" value={data.contacts.total} sub={`+${data.contacts.newThisPeriod} nouveaux`} colors={colors} />
              <KpiCard icon="message-square" iconColor="#3b82f6" label="Messages" value={data.messages.total} sub={`${data.messages.unread} non lus`} colors={colors} />
              <KpiCard icon="calendar" iconColor="#f59e0b" label="Événements" value={data.events.total} sub={`${data.events.upcoming} à venir`} colors={colors} />
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  periodRow: { flexDirection: "row", gap: 8 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  periodText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scoreStrip: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 12, padding: 12 },
  scoreDial: { width: 60, height: 60, borderRadius: 30, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  scoreNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  scoreMax: { fontSize: 10, fontFamily: "Inter_400Regular" },
  scoreLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  scoreSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16, gap: 6 },
  section: { gap: 10, marginBottom: 10 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionTitleText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  insightsList: { gap: 6 },
  insightCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  insightText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  insightMetric: { fontSize: 12, fontFamily: "Inter_700Bold" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: { width: "47%", padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  kpiIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  kpiLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  kpiValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kpiValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  kpiSub: { fontSize: 9, fontFamily: "Inter_400Regular" },
  trendBadge: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6 },
  trendText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
});
