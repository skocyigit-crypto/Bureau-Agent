import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  domain: string;
  icon: string;
}

interface AgentReport {
  id: number;
  agentId: string;
  agentName: string;
  agentIcon?: string;
  score: number;
  status: string;
  summary?: string;
  errorsFound: number;
  warningsFound?: number;
  suggestionsCount?: number;
  errors: any[];
  warnings: any[];
  suggestions: any[];
  corrections: any[];
  createdAt: string;
  isSuperReport?: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "A l'instant";
  if (min < 60) return `Il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `Il y a ${d}j`;
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  const colors = useColors();
  return (
    <View style={styles.scoreBarContainer}>
      <View style={[styles.scoreBarTrack, { backgroundColor: colors.muted }]}>
        <View style={[styles.scoreBarFill, { width: `${score}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.scoreBarLabel, { color }]}>{score}</Text>
    </View>
  );
}

export default function AiAgentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [latestReports, setLatestReports] = useState<Record<string, AgentReport>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, latestRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/ai/agents/config`),
        fetchAuth(`${API_BASE}/api/ai/agents/latest`),
      ]);
      if (configRes.ok) {
        const data = await configRes.json();
        setAgents(data.agents ?? []);
      }
      if (latestRes.ok) {
        const data = await latestRes.json();
        setLatestReports(data ?? {});
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
      if (res.ok) {
        const data = await res.json();
        if (data.status === "started" || data.status === "already_running") {
          pollForCompletion();
        } else {
          fetchData();
          setRunningAll(false);
        }
      } else {
        setRunningAll(false);
      }
    } catch { setRunningAll(false); }
  }

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function pollForCompletion() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollStartRef.current = Date.now();
    const MAX_POLL_MS = 5 * 60 * 1000;
    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStartRef.current > MAX_POLL_MS) {
        clearInterval(pollRef.current!); pollRef.current = null; setRunningAll(false); fetchData(); return;
      }
      try {
        const res = await fetchAuth(`${API_BASE}/api/ai/agents/run/status`);
        if (!res.ok) { clearInterval(pollRef.current!); pollRef.current = null; setRunningAll(false); return; }
        const data = await res.json();
        if (["completed", "failed", "idle"].includes(data.status)) {
          clearInterval(pollRef.current!); pollRef.current = null; setRunningAll(false); fetchData();
        }
      } catch { clearInterval(pollRef.current!); pollRef.current = null; setRunningAll(false); }
    }, 4000);
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

  const ICON_MAP: Record<string, keyof typeof Feather.glyphMap> = {
    phone: "phone", users: "users", clipboard: "clipboard", mail: "mail",
    clock: "clock", shield: "shield", "trending-up": "trending-up", cpu: "cpu",
    "check-square": "check-square", "message-square": "message-square",
    package: "package", calendar: "calendar", "bar-chart-2": "bar-chart-2",
  };

  const AGENT_COLORS: Record<string, string> = {
    agent_appels: "#3b82f6", agent_contacts: "#8b5cf6", agent_taches: "#22c55e",
    agent_messages: "#f59e0b", agent_pointage: "#ec4899", agent_securite: "#ef4444",
    agent_performance: "#6366f1",
  };

  const reports = Object.values(latestReports).filter((r) => !r.isSuperReport);
  const superReport = latestReports["super_agent"] || null;
  const totalErrors = reports.reduce((s, r) => s + (r.errorsFound ?? r.errors?.length ?? 0), 0);
  const totalWarnings = reports.reduce((s, r) => s + (r.warningsFound ?? r.warnings?.length ?? 0), 0);
  const totalSuggestions = reports.reduce((s, r) => s + (r.suggestionsCount ?? r.suggestions?.length ?? 0), 0);
  const avgScore = reports.length > 0 ? Math.round(reports.reduce((s, r) => s + (r.score ?? 0), 0) / reports.length) : 0;
  const lastRunAt = reports.length > 0 ? reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.createdAt : null;

  function renderFinding(item: any, i: number, bgColor: string, textColor: string) {
    const text = typeof item === "string" ? item : item.titre || item.description || item.message || JSON.stringify(item);
    return (
      <View key={i} style={[styles.findingItem, { backgroundColor: bgColor }]}>
        <Text style={[styles.findingText, { color: textColor }]}>{text}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Agents IA</Text>
            {lastRunAt && (
              <Text style={styles.headerSub}>{timeAgo(lastRunAt)}</Text>
            )}
          </View>
          <Pressable
            onPress={runAllAgents}
            disabled={runningAll}
            style={[styles.runAllBtn, { backgroundColor: runningAll ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.2)" }]}
            hitSlop={8}
          >
            {runningAll ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Feather name="play" size={16} color="#ffffff" />
            )}
            <Text style={styles.runAllText}>{runningAll ? "En cours..." : "Tout lancer"}</Text>
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
                  <Text style={[styles.scoreTextSub, { color: colors.mutedForeground }]}>/100</Text>
                </View>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Score moyen</Text>
              </View>
              <View style={styles.statCol}>
                {[
                  { icon: "alert-circle" as const, color: "#ef4444", value: totalErrors, label: "Erreurs" },
                  { icon: "alert-triangle" as const, color: "#f59e0b", value: totalWarnings, label: "Alertes" },
                  { icon: "info" as const, color: "#3b82f6", value: totalSuggestions, label: "Suggestions" },
                ].map((s, i) => (
                  <View key={i} style={[styles.miniStat, { backgroundColor: s.color + "18" }]}>
                    <Feather name={s.icon} size={13} color={s.color} />
                    <Text style={[styles.miniStatVal, { color: s.color }]}>{s.value}</Text>
                    <Text style={[styles.miniStatLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {runningAll && (
              <View style={[styles.runningBanner, { backgroundColor: colors.primary + "18" }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.runningText, { color: colors.primary }]}>Analyse IA en cours, veuillez patienter...</Text>
              </View>
            )}

            {superReport && (
              <View style={[styles.card, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.agentIcon, { backgroundColor: "#8b5cf618" }]}>
                    <Feather name="cpu" size={18} color="#8b5cf6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Super Agent IA</Text>
                    <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>Synthese strategique</Text>
                  </View>
                  <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(superReport.score) + "18" }]}>
                    <Text style={[styles.scoreBadgeText, { color: getScoreColor(superReport.score) }]}>{superReport.score}</Text>
                  </View>
                </View>
                {superReport.summary && (
                  <Text style={[styles.summaryText, { color: colors.foreground }]}>{superReport.summary}</Text>
                )}
                <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
                  {timeAgo(superReport.createdAt)}
                </Text>
              </View>
            )}

            {agents.map((agent) => {
              const report = latestReports[agent.id];
              const isExpanded = expandedAgent === agent.id;
              const isRunning = runningAgent === agent.id;
              const iconName = ICON_MAP[agent.icon] || "cpu";
              const agentColor = AGENT_COLORS[agent.id] || "#3b82f6";
              const scoreColor = report ? getScoreColor(report.score) : agentColor;
              const errCount = report ? (report.errorsFound ?? report.errors?.length ?? 0) : 0;
              const warnCount = report ? (report.warningsFound ?? report.warnings?.length ?? 0) : 0;

              return (
                <View key={agent.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Pressable onPress={() => setExpandedAgent(isExpanded ? null : agent.id)}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.agentIcon, { backgroundColor: agentColor + "18" }]}>
                        <Feather name={iconName} size={18} color={agentColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{agent.name}</Text>
                        <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {agent.domain}
                        </Text>
                      </View>
                      <View style={styles.cardRight}>
                        {report && (
                          <View style={[styles.scoreBadge, { backgroundColor: scoreColor + "18" }]}>
                            <Text style={[styles.scoreBadgeText, { color: scoreColor }]}>{report.score}</Text>
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
                            <Feather name="play" size={13} color={colors.primary} />
                          )}
                        </Pressable>
                        <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                      </View>
                    </View>

                    {!isExpanded && report && (
                      <View style={styles.closedFooter}>
                        <ScoreBar score={report.score} color={scoreColor} />
                        <View style={styles.closedMeta}>
                          {errCount > 0 && (
                            <View style={styles.closedBadge}>
                              <Feather name="alert-circle" size={10} color="#ef4444" />
                              <Text style={[styles.closedBadgeText, { color: "#ef4444" }]}>{errCount}</Text>
                            </View>
                          )}
                          {warnCount > 0 && (
                            <View style={styles.closedBadge}>
                              <Feather name="alert-triangle" size={10} color="#f59e0b" />
                              <Text style={[styles.closedBadgeText, { color: "#f59e0b" }]}>{warnCount}</Text>
                            </View>
                          )}
                          <Text style={[styles.closedTime, { color: colors.mutedForeground }]}>
                            {timeAgo(report.createdAt)}
                          </Text>
                        </View>
                      </View>
                    )}
                  </Pressable>

                  {isExpanded && report && (
                    <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
                      <ScoreBar score={report.score} color={scoreColor} />
                      {report.summary && (
                        <Text style={[styles.reportSummary, { color: colors.foreground }]}>{report.summary}</Text>
                      )}
                      {report.errors?.length > 0 && (
                        <View style={styles.findingSection}>
                          <Text style={[styles.findingTitle, { color: "#ef4444" }]}>
                            Erreurs ({report.errors.length})
                          </Text>
                          {report.errors.map((err: any, i: number) => renderFinding(err, i, "#ef444410", colors.foreground))}
                        </View>
                      )}
                      {report.warnings?.length > 0 && (
                        <View style={styles.findingSection}>
                          <Text style={[styles.findingTitle, { color: "#f59e0b" }]}>
                            Alertes ({report.warnings.length})
                          </Text>
                          {report.warnings.map((w: any, i: number) => renderFinding(w, i, "#f59e0b10", colors.foreground))}
                        </View>
                      )}
                      {report.suggestions?.length > 0 && (
                        <View style={styles.findingSection}>
                          <Text style={[styles.findingTitle, { color: "#3b82f6" }]}>
                            Suggestions ({report.suggestions.length})
                          </Text>
                          {report.suggestions.map((s: any, i: number) => renderFinding(s, i, "#3b82f610", colors.foreground))}
                        </View>
                      )}
                      {(!report.errors?.length && !report.warnings?.length && !report.suggestions?.length) && (
                        <View style={[styles.emptyReport, { backgroundColor: "#22c55e10" }]}>
                          <Feather name="check-circle" size={16} color="#22c55e" />
                          <Text style={[styles.noFindings, { color: "#22c55e" }]}>Tout est en ordre</Text>
                        </View>
                      )}
                      <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
                        {timeAgo(report.createdAt)} · {new Date(report.createdAt).toLocaleString("fr-FR")}
                      </Text>
                    </View>
                  )}

                  {isExpanded && !report && (
                    <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
                      <View style={[styles.emptyReport, { backgroundColor: colors.muted }]}>
                        <Feather name="play-circle" size={16} color={colors.mutedForeground} />
                        <Text style={[styles.noFindings, { color: colors.mutedForeground }]}>
                          Aucun rapport. Lancez une analyse.
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
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
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)" },
  runAllBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  runAllText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#ffffff" },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  statCard: { flex: 1, alignItems: "center", padding: 16, borderRadius: 12, borderWidth: 1 },
  scoreCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  scoreText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  scoreTextSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statCol: { flex: 1, gap: 6 },
  miniStat: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  miniStatVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  miniStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  runningBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, marginBottom: 16 },
  runningText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  cardRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  agentIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  scoreBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  scoreBadgeText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  runBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  closedFooter: { paddingHorizontal: 14, paddingBottom: 12 },
  closedMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  closedBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  closedBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  closedTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  scoreBarContainer: { flexDirection: "row", alignItems: "center", gap: 10 },
  scoreBarTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  scoreBarFill: { height: "100%", borderRadius: 3 },
  scoreBarLabel: { fontSize: 12, fontFamily: "Inter_700Bold", width: 28, textAlign: "right" },
  expandedContent: { borderTopWidth: StyleSheet.hairlineWidth, padding: 14 },
  reportSummary: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 10, marginBottom: 10 },
  findingSection: { marginBottom: 12 },
  findingTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  findingItem: { padding: 10, borderRadius: 8, marginBottom: 4 },
  findingText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  emptyReport: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  noFindings: { fontSize: 13, fontFamily: "Inter_500Medium" },
  timestamp: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 10, textAlign: "right" },
  summaryText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, paddingHorizontal: 14, marginBottom: 6 },
});
