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

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface AnalyticsData {
  totalCalls: number;
  missedCalls: number;
  totalContacts: number;
  pendingTasks: number;
  completedTasks: number;
  unreadMessages: number;
  avgCallDuration: number;
  answeredRate: number;
  totalRevenue?: number;
  conversionRate?: number;
}

interface WeeklyReport {
  days?: Array<{ label: string; calls: number; tasks: number }>;
  currentWeek?: { calls: number; tasks: number; contacts: number };
  previousWeek?: { calls: number; tasks: number; contacts: number };
}

interface HourlyData {
  hours?: Array<{ hour: string; calls: number }>;
}

type Period = "jour" | "semaine" | "mois";

function VerticalBarChart({ data, color, height = 80 }: { data: Array<{ label: string; value: number }>; color: string; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: height + 20, gap: 3 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
          <Text style={{ fontSize: 8, color: "#94a3b8", marginBottom: 3, fontFamily: "Inter_400Regular" }}>
            {d.value > 0 ? d.value : ""}
          </Text>
          <View
            style={{
              width: "100%",
              height: Math.max((d.value / max) * height, d.value > 0 ? 4 : 2),
              backgroundColor: d.value > 0 ? color : color + "30",
              borderRadius: 4,
            }}
          />
          <Text style={{ fontSize: 9, color: "#94a3b8", marginTop: 4, fontFamily: "Inter_400Regular" }}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

function KpiCard({ icon, label, value, color, sub, trend }: { icon: keyof typeof Feather.glyphMap; label: string; value: string | number; color: string; sub?: string; trend?: { value: number; positive?: boolean } }) {
  const colors = useColors();
  return (
    <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.kpiIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={16} color={color} />
      </View>
      <Text style={[styles.kpiValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sub && <Text style={[styles.kpiSub, { color: colors.mutedForeground }]}>{sub}</Text>}
      {trend && (
        <View style={styles.trendRow}>
          <Feather
            name={trend.value >= 0 ? "trending-up" : "trending-down"}
            size={10}
            color={trend.positive === false ? (trend.value >= 0 ? "#ef4444" : "#22c55e") : (trend.value >= 0 ? "#22c55e" : "#ef4444")}
          />
          <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: trend.positive === false ? (trend.value >= 0 ? "#ef4444" : "#22c55e") : (trend.value >= 0 ? "#22c55e" : "#ef4444") }}>
            {Math.abs(trend.value)}%
          </Text>
        </View>
      )}
    </View>
  );
}

function ProgressRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const colors = useColors();
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <View style={styles.progressItem}>
      <View style={styles.progressHeader}>
        <Text style={[styles.progressLabel, { color: colors.foreground }]}>{label}</Text>
        <View style={styles.progressRight}>
          <Text style={[styles.progressValue, { color }]}>{value}</Text>
          <Text style={[styles.progressPct, { color: colors.mutedForeground }]}>({pct.toFixed(0)}%)</Text>
        </View>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function AnalyticsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [hourly, setHourly] = useState<HourlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>("semaine");

  const fetchAnalytics = useCallback(async () => {
    try {
      const [sumRes, weekRes, hourRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/dashboard/summary`),
        fetchAuth(`${API_BASE}/api/dashboard/weekly-report`),
        fetchAuth(`${API_BASE}/api/dashboard/hourly-performance`),
      ]);
      if (sumRes.ok) {
        const json = await sumRes.json();
        setData({
          totalCalls: json.totalCalls ?? 0,
          missedCalls: json.missedCalls ?? 0,
          totalContacts: json.totalContacts ?? 0,
          pendingTasks: json.pendingTasks ?? 0,
          completedTasks: json.completedTasks ?? 0,
          unreadMessages: json.unreadMessages ?? 0,
          avgCallDuration: json.avgCallDuration ?? 0,
          answeredRate: json.answeredRate ?? 0,
          totalRevenue: json.totalRevenue,
          conversionRate: json.conversionRate,
        });
      }
      if (weekRes.ok) setWeekly(await weekRes.json());
      if (hourRes.ok) setHourly(await hourRes.json());
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);
  function onRefresh() { setRefreshing(true); fetchAnalytics(); }

  const weeklyChartData = (() => {
    if (weekly?.days) {
      return weekly.days.map((d) => ({ label: d.label.slice(0, 3), value: period === "semaine" ? d.calls : d.tasks }));
    }
    const DOW = ["L", "M", "M", "J", "V", "S", "D"];
    return DOW.map((l) => ({ label: l, value: 0 }));
  })();

  const hourlyChartData = (() => {
    if (hourly?.hours) {
      return hourly.hours.map((h) => ({ label: h.hour.replace(":00", "h"), value: h.calls }));
    }
    const hours = ["8h", "9h", "10h", "11h", "12h", "13h", "14h", "15h", "16h", "17h", "18h"];
    return hours.map((l) => ({ label: l, value: 0 }));
  })();

  const answeredCalls = data ? data.totalCalls - data.missedCalls : 0;
  const totalTasks = data ? data.pendingTasks + data.completedTasks : 0;
  const completionRate = totalTasks > 0 ? Math.round((data!.completedTasks / totalTasks) * 100) : 0;

  const PERIODS: Period[] = ["jour", "semaine", "mois"];
  const PERIOD_LABELS: Record<Period, string> = { jour: "Aujourd'hui", semaine: "Semaine", mois: "Mois" };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Analytique</Text>
          <Pressable onPress={onRefresh} hitSlop={12}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={[styles.periodBtn, { backgroundColor: period === p ? colors.primary : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.periodText, { color: period === p ? "#fff" : "rgba(255,255,255,0.7)" }]}>
                {PERIOD_LABELS[p]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : data ? (
          <>
            <View style={styles.kpiGrid}>
              <KpiCard icon="phone" label="Appels" value={data.totalCalls} color="#3b82f6" sub={`${answeredCalls} repondus`} />
              <KpiCard icon="phone-missed" label="Manques" value={data.missedCalls} color="#ef4444" trend={{ value: -5, positive: false }} />
              <KpiCard icon="users" label="Contacts" value={data.totalContacts} color="#22c55e" />
              <KpiCard icon="check-square" label="Taches" value={data.completedTasks} color="#8b5cf6" sub={`${completionRate}% complet`} />
              <KpiCard icon="message-square" label="Non lus" value={data.unreadMessages} color="#f59e0b" />
              <KpiCard icon="clock" label="Dur. moy." value={`${Math.floor(data.avgCallDuration / 60)}m${data.avgCallDuration % 60}s`} color="#64748b" />
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardTitleRow}>
                <Feather name="activity" size={16} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Taux de reponse</Text>
                <View style={[styles.ratePill, { backgroundColor: (data.answeredRate >= 80 ? "#22c55e" : data.answeredRate >= 60 ? "#f59e0b" : "#ef4444") + "20" }]}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: data.answeredRate >= 80 ? "#22c55e" : data.answeredRate >= 60 ? "#f59e0b" : "#ef4444" }}>
                    {data.answeredRate}%
                  </Text>
                </View>
              </View>
              <View style={[styles.rateBar, { backgroundColor: colors.muted }]}>
                <View style={[styles.rateBarFill, {
                  width: `${data.answeredRate}%`,
                  backgroundColor: data.answeredRate >= 80 ? "#22c55e" : data.answeredRate >= 60 ? "#f59e0b" : "#ef4444",
                }]} />
              </View>
              <View style={styles.rateInfo}>
                <Text style={[styles.rateInfoText, { color: colors.mutedForeground }]}>
                  {answeredCalls} repondus · {data.missedCalls} manques · durée moy. {Math.floor(data.avgCallDuration / 60)}m{data.avgCallDuration % 60}s
                </Text>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardTitleRow}>
                <Feather name="bar-chart-2" size={16} color="#3b82f6" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  {period === "jour" ? "Activite par heure" : "Activite par jour"}
                </Text>
              </View>
              {period === "jour" ? (
                <VerticalBarChart data={hourlyChartData} color="#3b82f6" height={80} />
              ) : (
                <VerticalBarChart data={weeklyChartData} color={period === "semaine" ? "#3b82f6" : "#8b5cf6"} height={80} />
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardTitleRow}>
                <Feather name="pie-chart" size={16} color="#f59e0b" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Repartition</Text>
              </View>
              <ProgressRow label="Appels repondus" value={answeredCalls} max={data.totalCalls} color="#22c55e" />
              <ProgressRow label="Appels manques" value={data.missedCalls} max={data.totalCalls} color="#ef4444" />
              <ProgressRow label="Taches terminees" value={data.completedTasks} max={totalTasks} color="#8b5cf6" />
              <ProgressRow label="Taches en attente" value={data.pendingTasks} max={totalTasks} color="#f59e0b" />
            </View>

            {weekly?.currentWeek && weekly?.previousWeek && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardTitleRow}>
                  <Feather name="trending-up" size={16} color="#22c55e" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Comparaison semaine</Text>
                </View>
                {[
                  { label: "Appels", current: weekly.currentWeek.calls, prev: weekly.previousWeek.calls, color: "#3b82f6" },
                  { label: "Taches", current: weekly.currentWeek.tasks, prev: weekly.previousWeek.tasks, color: "#8b5cf6" },
                  { label: "Contacts", current: weekly.currentWeek.contacts, prev: weekly.previousWeek.contacts, color: "#22c55e" },
                ].map((row) => {
                  const diff = row.prev > 0 ? Math.round(((row.current - row.prev) / row.prev) * 100) : 0;
                  return (
                    <View key={row.label} style={[styles.compareRow, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.compareLabel, { color: colors.foreground }]}>{row.label}</Text>
                      <Text style={[styles.compareValue, { color: row.color }]}>{row.current}</Text>
                      <View style={styles.compareDiff}>
                        <Feather
                          name={diff >= 0 ? "arrow-up-right" : "arrow-down-right"}
                          size={12}
                          color={diff >= 0 ? "#22c55e" : "#ef4444"}
                        />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: diff >= 0 ? "#22c55e" : "#ef4444" }}>
                          {Math.abs(diff)}%
                        </Text>
                      </View>
                      <Text style={[styles.comparePrev, { color: colors.mutedForeground }]}>vs {row.prev}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  periodRow: { flexDirection: "row", gap: 8 },
  periodBtn: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 10 },
  periodText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  kpiCard: { width: "31%", borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "flex-start", gap: 4 },
  kpiIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  kpiValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  kpiLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  kpiSub: { fontSize: 9, fontFamily: "Inter_400Regular" },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  ratePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  rateBar: { height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 8 },
  rateBarFill: { height: "100%", borderRadius: 5 },
  rateInfo: {},
  rateInfoText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  progressItem: { marginBottom: 14 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  progressLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  progressValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  progressPct: { fontSize: 11, fontFamily: "Inter_400Regular" },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  compareRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  compareLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  compareValue: { fontSize: 16, fontFamily: "Inter_700Bold", marginRight: 8 },
  compareDiff: { flexDirection: "row", alignItems: "center", gap: 2, width: 50 },
  comparePrev: { fontSize: 12, fontFamily: "Inter_400Regular", width: 40, textAlign: "right" },
});
