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
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface AutomationRule {
  id: number | string;
  name: string;
  description: string;
  type: string;
  isActive: boolean;
  isSystem?: boolean;
  schedule?: string;
  lastRun?: string;
  executionCount?: number;
  successRate?: number;
}

interface ExecutionLog {
  id: number;
  ruleName: string;
  status: string;
  itemsProcessed: number;
  duration: number;
  timestamp: string;
  error?: string;
}

const TYPE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  task_overdue: "clock",
  calendar_reminder: "bell",
  unread_messages: "mail",
  stock_alert: "package",
  call_followup: "phone",
  custom: "settings",
};

export default function AutomationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"rules" | "logs">("rules");

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, logsRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/automations`),
        fetchAuth(`${API_BASE}/api/automations/logs?limit=30`),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        const rawRules = data.rules ?? data.automations ?? [];
        setRules(rawRules.map((r: any) => ({ ...r, isActive: r.enabled ?? r.isActive ?? false })));
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs ?? []);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  async function toggleRule(rule: AutomationRule) {
    try {
      await fetchAuth(`${API_BASE}/api/automations/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.isActive }),
      });
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
    } catch {}
  }

  const executionsToday = logs.filter(l => {
    const d = new Date(l.timestamp);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;

  const successRate = logs.length > 0
    ? Math.round(logs.filter(l => l.status === "success").length / logs.length * 100)
    : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Automations</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.tabRow}>
          <Pressable onPress={() => setTab("rules")} style={[styles.tabBtn, tab === "rules" && { backgroundColor: colors.primary }]}>
            <Text style={[styles.tabText, { color: tab === "rules" ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>Regles</Text>
          </Pressable>
          <Pressable onPress={() => setTab("logs")} style={[styles.tabBtn, tab === "logs" && { backgroundColor: colors.primary }]}>
            <Text style={[styles.tabText, { color: tab === "logs" ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>Historique</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statsRow}>
            <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="zap" size={18} color="#f59e0b" />
              <Text style={[styles.statVal, { color: colors.foreground }]}>{executionsToday}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Aujourd'hui</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="check-circle" size={18} color="#22c55e" />
              <Text style={[styles.statVal, { color: colors.foreground }]}>{successRate}%</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Reussite</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="toggle-right" size={18} color="#3b82f6" />
              <Text style={[styles.statVal, { color: colors.foreground }]}>{rules.filter(r => r.isActive).length}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Actives</Text>
            </View>
          </View>

          {tab === "rules" ? (
            rules.length === 0 ? (
              <EmptyState icon="zap" title="Aucune regle" subtitle="Les regles d'automatisation apparaitront ici" />
            ) : (
              rules.map(rule => (
                <View key={String(rule.id)} style={[styles.ruleCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.ruleHeader}>
                    <View style={[styles.ruleIcon, { backgroundColor: (rule.isActive ? "#22c55e" : "#64748b") + "18" }]}>
                      <Feather name={TYPE_ICONS[rule.type] || "settings"} size={18} color={rule.isActive ? "#22c55e" : "#64748b"} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.ruleName, { color: colors.foreground }]}>{rule.name}</Text>
                      <Text style={[styles.ruleDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{rule.description}</Text>
                    </View>
                    <Switch
                      value={rule.isActive}
                      onValueChange={() => toggleRule(rule)}
                      trackColor={{ false: colors.muted, true: "#22c55e80" }}
                      thumbColor={rule.isActive ? "#22c55e" : "#94a3b8"}
                    />
                  </View>
                  {rule.lastRun && (
                    <Text style={[styles.ruleLastRun, { color: colors.mutedForeground }]}>
                      Derniere execution: {new Date(rule.lastRun).toLocaleString("fr-FR")}
                    </Text>
                  )}
                  {rule.isSystem && (
                    <View style={[styles.systemBadge, { backgroundColor: "#3b82f618" }]}>
                      <Text style={[styles.systemBadgeText, { color: "#3b82f6" }]}>Systeme</Text>
                    </View>
                  )}
                </View>
              ))
            )
          ) : (
            logs.length === 0 ? (
              <EmptyState icon="list" title="Aucun historique" subtitle="Les executions apparaitront ici" />
            ) : (
              logs.map(log => (
                <View key={log.id} style={[styles.logCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.logHeader}>
                    <View style={[styles.logDot, { backgroundColor: log.status === "success" ? "#22c55e" : "#ef4444" }]} />
                    <Text style={[styles.logName, { color: colors.foreground }]} numberOfLines={1}>{log.ruleName}</Text>
                    <Text style={[styles.logTime, { color: colors.mutedForeground }]}>
                      {new Date(log.timestamp).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                    </Text>
                  </View>
                  <View style={styles.logMeta}>
                    <Text style={[styles.logMetaText, { color: colors.mutedForeground }]}>
                      {log.itemsProcessed} element(s) • {log.duration}ms
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: (log.status === "success" ? "#22c55e" : "#ef4444") + "18" }]}>
                      <Text style={[styles.statusBadgeText, { color: log.status === "success" ? "#22c55e" : "#ef4444" }]}>
                        {log.status === "success" ? "Reussi" : "Erreur"}
                      </Text>
                    </View>
                  </View>
                  {log.error && (
                    <Text style={[styles.logError, { color: "#ef4444" }]} numberOfLines={2}>{log.error}</Text>
                  )}
                </View>
              ))
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  tabRow: { flexDirection: "row", gap: 8 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  stat: { flex: 1, alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  statVal: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  ruleCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  ruleHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  ruleIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  ruleName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  ruleDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  ruleLastRun: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8, paddingLeft: 52 },
  systemBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 8, marginLeft: 52 },
  systemBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  logCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  logHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  logDot: { width: 8, height: 8, borderRadius: 4 },
  logName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  logTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  logMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  logMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  logError: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6 },
});
