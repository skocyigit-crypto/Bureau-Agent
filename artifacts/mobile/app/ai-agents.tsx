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

interface AgentConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

interface AgentReport {
  agentId: string;
  agentName: string;
  score: number;
  errors: any[];
  warnings: any[];
  suggestions: any[];
  corrections: any[];
  actionPlan: any[];
  timestamp: string;
}

interface SuperReport {
  summary: string;
  recommendations: string[];
  timestamp: string;
}

export default function AiAgentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [superReport, setSuperReport] = useState<SuperReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, reportsRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/ai/agents/config`),
        fetchAuth(`${API_BASE}/api/ai/agents/reports`),
      ]);
      if (configRes.ok) {
        const data = await configRes.json();
        setAgents(data.agents ?? []);
      }
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        setReports(data.reports ?? []);
        if (data.superReport) setSuperReport(data.superReport);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  async function runAllAgents() {
    setRunningAll(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/agents/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) fetchData();
    } catch {} finally { setRunningAll(false); }
  }

  async function runSingleAgent(agentId: string) {
    setRunningAgent(agentId);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/agents/run/${agentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) fetchData();
    } catch {} finally { setRunningAgent(null); }
  }

  function getScoreColor(score: number) {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#f59e0b";
    return "#ef4444";
  }

  function getReportForAgent(agentId: string) {
    return reports.find(r => r.agentId === agentId);
  }

  const ICON_MAP: Record<string, keyof typeof Feather.glyphMap> = {
    phone: "phone",
    users: "users",
    "check-square": "check-square",
    "message-square": "message-square",
    package: "package",
    calendar: "calendar",
    "bar-chart-2": "bar-chart-2",
    cpu: "cpu",
  };

  const totalErrors = reports.reduce((s, r) => s + (r.errors?.length ?? 0), 0);
  const totalWarnings = reports.reduce((s, r) => s + (r.warnings?.length ?? 0), 0);
  const totalSuggestions = reports.reduce((s, r) => s + (r.suggestions?.length ?? 0), 0);
  const avgScore = reports.length > 0 ? Math.round(reports.reduce((s, r) => s + (r.score ?? 0), 0) / reports.length) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Agents IA</Text>
          <Pressable onPress={runAllAgents} disabled={runningAll} hitSlop={12}>
            {runningAll ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Feather name="play" size={22} color="#ffffff" />
            )}
          </Pressable>
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
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.scoreCircle, { borderColor: getScoreColor(avgScore) }]}>
                  <Text style={[styles.scoreText, { color: getScoreColor(avgScore) }]}>{avgScore}</Text>
                </View>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Score moyen</Text>
              </View>
              <View style={styles.statCol}>
                <View style={[styles.miniStat, { backgroundColor: "#ef444418" }]}>
                  <Feather name="alert-circle" size={14} color="#ef4444" />
                  <Text style={[styles.miniStatVal, { color: "#ef4444" }]}>{totalErrors}</Text>
                  <Text style={[styles.miniStatLabel, { color: colors.mutedForeground }]}>Erreurs</Text>
                </View>
                <View style={[styles.miniStat, { backgroundColor: "#f59e0b18" }]}>
                  <Feather name="alert-triangle" size={14} color="#f59e0b" />
                  <Text style={[styles.miniStatVal, { color: "#f59e0b" }]}>{totalWarnings}</Text>
                  <Text style={[styles.miniStatLabel, { color: colors.mutedForeground }]}>Alertes</Text>
                </View>
                <View style={[styles.miniStat, { backgroundColor: "#3b82f618" }]}>
                  <Feather name="info" size={14} color="#3b82f6" />
                  <Text style={[styles.miniStatVal, { color: "#3b82f6" }]}>{totalSuggestions}</Text>
                  <Text style={[styles.miniStatLabel, { color: colors.mutedForeground }]}>Suggestions</Text>
                </View>
              </View>
            </View>

            {runningAll && (
              <View style={[styles.runningBanner, { backgroundColor: colors.primary + "18" }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.runningText, { color: colors.primary }]}>Analyse en cours...</Text>
              </View>
            )}

            {superReport && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.agentIcon, { backgroundColor: "#8b5cf618" }]}>
                    <Feather name="cpu" size={18} color="#8b5cf6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Super Agent IA</Text>
                    <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>Synthese strategique</Text>
                  </View>
                </View>
                <Text style={[styles.summaryText, { color: colors.foreground }]}>{superReport.summary}</Text>
                {superReport.recommendations?.map((rec, i) => (
                  <View key={i} style={styles.recRow}>
                    <Feather name="chevron-right" size={14} color={colors.primary} />
                    <Text style={[styles.recText, { color: colors.foreground }]}>{rec}</Text>
                  </View>
                ))}
              </View>
            )}

            {agents.map((agent) => {
              const report = getReportForAgent(agent.id);
              const isExpanded = expandedAgent === agent.id;
              const isRunning = runningAgent === agent.id;
              const iconName = ICON_MAP[agent.icon] || "cpu";

              return (
                <Pressable
                  key={agent.id}
                  onPress={() => setExpandedAgent(isExpanded ? null : agent.id)}
                  style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.cardHeader}>
                    <View style={[styles.agentIcon, { backgroundColor: (agent.color || "#3b82f6") + "18" }]}>
                      <Feather name={iconName} size={18} color={agent.color || "#3b82f6"} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{agent.name}</Text>
                      <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{agent.description}</Text>
                    </View>
                    {report && (
                      <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(report.score) + "18" }]}>
                        <Text style={[styles.scoreBadgeText, { color: getScoreColor(report.score) }]}>{report.score}</Text>
                      </View>
                    )}
                    <Pressable
                      onPress={(e) => { e.stopPropagation?.(); runSingleAgent(agent.id); }}
                      disabled={isRunning}
                      hitSlop={8}
                      style={[styles.runBtn, { backgroundColor: colors.primary + "18" }]}
                    >
                      {isRunning ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Feather name="play" size={14} color={colors.primary} />
                      )}
                    </Pressable>
                  </View>

                  {isExpanded && report && (
                    <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
                      {report.errors?.length > 0 && (
                        <View style={styles.findingSection}>
                          <Text style={[styles.findingTitle, { color: "#ef4444" }]}>Erreurs ({report.errors.length})</Text>
                          {report.errors.map((err: any, i: number) => (
                            <View key={i} style={[styles.findingItem, { backgroundColor: "#ef444410" }]}>
                              <Text style={[styles.findingText, { color: colors.foreground }]}>{typeof err === "string" ? err : err.message || err.description || JSON.stringify(err)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {report.warnings?.length > 0 && (
                        <View style={styles.findingSection}>
                          <Text style={[styles.findingTitle, { color: "#f59e0b" }]}>Alertes ({report.warnings.length})</Text>
                          {report.warnings.map((w: any, i: number) => (
                            <View key={i} style={[styles.findingItem, { backgroundColor: "#f59e0b10" }]}>
                              <Text style={[styles.findingText, { color: colors.foreground }]}>{typeof w === "string" ? w : w.message || w.description || JSON.stringify(w)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {report.suggestions?.length > 0 && (
                        <View style={styles.findingSection}>
                          <Text style={[styles.findingTitle, { color: "#3b82f6" }]}>Suggestions ({report.suggestions.length})</Text>
                          {report.suggestions.map((s: any, i: number) => (
                            <View key={i} style={[styles.findingItem, { backgroundColor: "#3b82f610" }]}>
                              <Text style={[styles.findingText, { color: colors.foreground }]}>{typeof s === "string" ? s : s.message || s.description || JSON.stringify(s)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {report.actionPlan?.length > 0 && (
                        <View style={styles.findingSection}>
                          <Text style={[styles.findingTitle, { color: "#22c55e" }]}>Plan d'action ({report.actionPlan.length})</Text>
                          {report.actionPlan.map((a: any, i: number) => (
                            <View key={i} style={[styles.findingItem, { backgroundColor: "#22c55e10" }]}>
                              <Text style={[styles.findingText, { color: colors.foreground }]}>{typeof a === "string" ? a : a.task || a.description || JSON.stringify(a)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {(!report.errors?.length && !report.warnings?.length && !report.suggestions?.length && !report.actionPlan?.length) && (
                        <Text style={[styles.noFindings, { color: colors.mutedForeground }]}>Aucun resultat pour cet agent. Lancez une analyse.</Text>
                      )}
                      <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
                        Derniere analyse: {new Date(report.timestamp).toLocaleString("fr-FR")}
                      </Text>
                    </View>
                  )}

                  {isExpanded && !report && (
                    <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
                      <Text style={[styles.noFindings, { color: colors.mutedForeground }]}>Aucun rapport. Appuyez sur le bouton pour lancer l'analyse.</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  statCard: { flex: 1, alignItems: "center", padding: 16, borderRadius: 12, borderWidth: 1 },
  scoreCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  scoreText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statCol: { flex: 1, gap: 6 },
  miniStat: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  miniStatVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  miniStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  runningBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, marginBottom: 16 },
  runningText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  agentIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  scoreBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  scoreBadgeText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  runBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  expandedContent: { borderTopWidth: 1, padding: 14 },
  findingSection: { marginBottom: 12 },
  findingTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  findingItem: { padding: 10, borderRadius: 8, marginBottom: 4 },
  findingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  noFindings: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", padding: 16 },
  timestamp: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8, textAlign: "right" },
  summaryText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, paddingHorizontal: 14, marginBottom: 10 },
  recRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 14, marginBottom: 6 },
  recText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
});
