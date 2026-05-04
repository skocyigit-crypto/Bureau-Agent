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

interface AutopilotStatus {
  active: boolean;
  lastRun?: string;
  nextRun?: string;
  tasksCreated?: number;
  tasksUpdated?: number;
  notificationsSent?: number;
  cyclesRun?: number;
  recentLogs?: AutopilotLog[];
}

interface AutopilotLog {
  timestamp: string;
  level: string;
  message: string;
  module?: string;
  priority?: string;
}

interface Anomaly {
  type: string;
  severity: "critique" | "haute" | "moyenne" | "basse";
  title: string;
  description: string;
  metric?: string;
  suggestedAction?: string;
}

type MainTab = "agents" | "autopilot" | "anomalies";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  return `Il y a ${Math.floor(h / 24)}j`;
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

function SeverityBadge({ severity }: { severity: string }) {
  const cfg: Record<string, { color: string; label: string }> = {
    critique: { color: "#ef4444", label: "Critique" },
    haute:    { color: "#f97316", label: "Haute" },
    moyenne:  { color: "#f59e0b", label: "Moyenne" },
    basse:    { color: "#22c55e", label: "Basse" },
  };
  const c = cfg[severity] ?? cfg.basse;
  return (
    <View style={[styles.severityBadge, { backgroundColor: c.color + "18" }]}>
      <Text style={[styles.severityBadgeText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

// ─── AGENTS TAB ──────────────────────────────────────────────────────────────
function AgentsTab() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [latestReports, setLatestReports] = useState<Record<string, AgentReport>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [autoFixLoading, setAutoFixLoading] = useState(false);
  const [autoFixResult, setAutoFixResult] = useState<any>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, latestRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/ai/agents/config`),
        fetchAuth(`${API_BASE}/api/ai/agents/latest`),
      ]);
      if (configRes.ok) { const d = await configRes.json(); setAgents(d.agents ?? []); }
      if (latestRes.ok) { const d = await latestRes.json(); setLatestReports(d ?? {}); }
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth]);

  useEffect(() => { fetchData(); }, [fetchData]);
  function onRefresh() { setRefreshing(true); fetchData(); }

  function pollForCompletion() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollStartRef.current = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStartRef.current > 5 * 60 * 1000) {
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

  async function runAllAgents() {
    setRunningAll(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/agents/run`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "started" || data.status === "already_running") pollForCompletion();
        else { fetchData(); setRunningAll(false); }
      } else setRunningAll(false);
    } catch { setRunningAll(false); }
  }

  async function runSingleAgent(agentId: string) {
    setRunningAgent(agentId);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/agents/run/${agentId}`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) fetchData();
    } catch {} finally { setRunningAgent(null); }
  }

  async function runAutoFix() {
    setAutoFixLoading(true); setAutoFixResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/agents/auto-fix`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) { const d = await res.json(); setAutoFixResult(d); }
    } catch {} finally { setAutoFixLoading(false); }
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

  const reports = Object.values(latestReports).filter(r => !r.isSuperReport);
  const superReport = latestReports["super_agent"] || null;
  const totalErrors = reports.reduce((s, r) => s + (r.errorsFound ?? r.errors?.length ?? 0), 0);
  const totalWarnings = reports.reduce((s, r) => s + (r.warningsFound ?? r.warnings?.length ?? 0), 0);
  const totalSuggestions = reports.reduce((s, r) => s + (r.suggestionsCount ?? r.suggestions?.length ?? 0), 0);
  const avgScore = reports.length > 0 ? Math.round(reports.reduce((s, r) => s + (r.score ?? 0), 0) / reports.length) : 0;
  const lastRunAt = reports.length > 0 ? [...reports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.createdAt : null;

  function renderFinding(item: any, i: number, bgColor: string, textColor: string) {
    const text = typeof item === "string" ? item : item.titre || item.description || item.message || JSON.stringify(item);
    return (
      <View key={i} style={[styles.findingItem, { backgroundColor: bgColor }]}>
        <Text style={[styles.findingText, { color: textColor }]}>{text}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <>
          {/* Stats row */}
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
                { icon: "alert-circle" as const,   color: "#ef4444", value: totalErrors,      label: "Erreurs" },
                { icon: "alert-triangle" as const,  color: "#f59e0b", value: totalWarnings,    label: "Alertes" },
                { icon: "info" as const,            color: "#3b82f6", value: totalSuggestions, label: "Suggestions" },
              ].map((s, i) => (
                <View key={i} style={[styles.miniStat, { backgroundColor: s.color + "18" }]}>
                  <Feather name={s.icon} size={13} color={s.color} />
                  <Text style={[styles.miniStatVal, { color: s.color }]}>{s.value}</Text>
                  <Text style={[styles.miniStatLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Auto-fix */}
          <Pressable onPress={runAutoFix} disabled={autoFixLoading} style={[styles.autoFixBtn, { backgroundColor: "#0369a118" }]}>
            {autoFixLoading ? <ActivityIndicator size="small" color="#0369a1" /> : <Feather name="tool" size={14} color="#0369a1" />}
            <Text style={[styles.autoFixBtnText, { color: "#0369a1" }]}>{autoFixLoading ? "Correction auto en cours..." : "Correction automatique IA"}</Text>
            <Feather name="chevron-right" size={14} color="#0369a1" />
          </Pressable>

          {autoFixResult && (
            <View style={[styles.card, { backgroundColor: "#0369a110", borderColor: "#0369a130" }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: 6 }]}>🔧 Résultats de la correction</Text>
              {autoFixResult.fixes?.map((f: any, i: number) => (
                <View key={i} style={styles.fixRow}>
                  <Feather name="check" size={12} color="#22c55e" />
                  <Text style={[styles.fixText, { color: colors.foreground }]}>{f.description} ({f.count} éléments)</Text>
                </View>
              ))}
              {autoFixResult.fixes?.length === 0 && (
                <Text style={[styles.fixText, { color: colors.mutedForeground }]}>Aucune correction nécessaire — tout est en ordre.</Text>
              )}
            </View>
          )}

          {runningAll && (
            <View style={[styles.runningBanner, { backgroundColor: colors.primary + "18" }]}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.runningText, { color: colors.primary }]}>Analyse IA en cours, veuillez patienter...</Text>
            </View>
          )}

          {/* Super agent */}
          {superReport && (
            <View style={[styles.card, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.agentIcon, { backgroundColor: "#8b5cf618" }]}>
                  <Feather name="cpu" size={18} color="#8b5cf6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Super Agent IA</Text>
                  <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>Synthèse stratégique</Text>
                </View>
                <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(superReport.score) + "18" }]}>
                  <Text style={[styles.scoreBadgeText, { color: getScoreColor(superReport.score) }]}>{superReport.score}</Text>
                </View>
              </View>
              {superReport.summary && <Text style={[styles.summaryText, { color: colors.foreground }]}>{superReport.summary}</Text>}
              <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{timeAgo(superReport.createdAt)}</Text>
            </View>
          )}

          {/* Individual agents */}
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
                      <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{agent.domain}</Text>
                    </View>
                    <View style={styles.cardRight}>
                      {report && (
                        <View style={[styles.scoreBadge, { backgroundColor: scoreColor + "18" }]}>
                          <Text style={[styles.scoreBadgeText, { color: scoreColor }]}>{report.score}</Text>
                        </View>
                      )}
                      <Pressable onPress={(e) => { e.stopPropagation?.(); runSingleAgent(agent.id); }} disabled={isRunning} hitSlop={8} style={[styles.runBtn, { backgroundColor: colors.primary + "18" }]}>
                        {isRunning ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="play" size={13} color={colors.primary} />}
                      </Pressable>
                      <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                    </View>
                  </View>

                  {!isExpanded && report && (
                    <View style={styles.closedFooter}>
                      <ScoreBar score={report.score} color={scoreColor} />
                      <View style={styles.closedMeta}>
                        {errCount > 0 && <View style={styles.closedBadge}><Feather name="alert-circle" size={10} color="#ef4444" /><Text style={[styles.closedBadgeText, { color: "#ef4444" }]}>{errCount}</Text></View>}
                        {warnCount > 0 && <View style={styles.closedBadge}><Feather name="alert-triangle" size={10} color="#f59e0b" /><Text style={[styles.closedBadgeText, { color: "#f59e0b" }]}>{warnCount}</Text></View>}
                        <Text style={[styles.closedTime, { color: colors.mutedForeground }]}>{timeAgo(report.createdAt)}</Text>
                      </View>
                    </View>
                  )}
                </Pressable>

                {isExpanded && report && (
                  <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
                    <ScoreBar score={report.score} color={scoreColor} />
                    {report.summary && <Text style={[styles.reportSummary, { color: colors.foreground }]}>{report.summary}</Text>}
                    {report.errors?.length > 0 && (
                      <View style={styles.findingSection}>
                        <Text style={[styles.findingTitle, { color: "#ef4444" }]}>Erreurs ({report.errors.length})</Text>
                        {report.errors.map((err: any, i: number) => renderFinding(err, i, "#ef444410", colors.foreground))}
                      </View>
                    )}
                    {report.warnings?.length > 0 && (
                      <View style={styles.findingSection}>
                        <Text style={[styles.findingTitle, { color: "#f59e0b" }]}>Alertes ({report.warnings.length})</Text>
                        {report.warnings.map((w: any, i: number) => renderFinding(w, i, "#f59e0b10", colors.foreground))}
                      </View>
                    )}
                    {report.suggestions?.length > 0 && (
                      <View style={styles.findingSection}>
                        <Text style={[styles.findingTitle, { color: "#3b82f6" }]}>Suggestions ({report.suggestions.length})</Text>
                        {report.suggestions.map((s: any, i: number) => renderFinding(s, i, "#3b82f610", colors.foreground))}
                      </View>
                    )}
                    {(!report.errors?.length && !report.warnings?.length && !report.suggestions?.length) && (
                      <View style={[styles.emptyReport, { backgroundColor: "#22c55e10" }]}>
                        <Feather name="check-circle" size={16} color="#22c55e" />
                        <Text style={[styles.noFindings, { color: "#22c55e" }]}>Tout est en ordre</Text>
                      </View>
                    )}
                    <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{timeAgo(report.createdAt)} · {new Date(report.createdAt).toLocaleString("fr-FR")}</Text>
                  </View>
                )}
                {isExpanded && !report && (
                  <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
                    <View style={[styles.emptyReport, { backgroundColor: colors.muted }]}>
                      <Feather name="play-circle" size={16} color={colors.mutedForeground} />
                      <Text style={[styles.noFindings, { color: colors.mutedForeground }]}>Aucun rapport. Lancez une analyse.</Text>
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {lastRunAt && (
            <Text style={[styles.timestamp, { color: colors.mutedForeground, textAlign: "center", marginBottom: 8 }]}>
              Dernière analyse : {new Date(lastRunAt).toLocaleString("fr-FR")}
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── AUTOPILOT TAB ───────────────────────────────────────────────────────────
function AutopilotTab() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/autopilot/status`);
      if (res.ok) { const d = await res.json(); setStatus(d); }
    } catch {} finally { setLoading(false); }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);

  async function toggle() {
    if (!status) return;
    setToggling(true);
    try {
      const endpoint = status.active ? "/api/ai/autopilot/stop" : "/api/ai/autopilot/start";
      const res = await fetchAuth(`${API_BASE}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) { const d = await res.json(); setStatus(prev => ({ ...prev, active: d.status === "active", ...d })); }
      load();
    } catch {} finally { setToggling(false); }
  }

  async function runOnce() {
    setRunning(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/autopilot/run`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) {
        setTimeout(() => { load(); setRunning(false); }, 3000);
      } else setRunning(false);
    } catch { setRunning(false); }
  }

  const LOG_LEVEL_COLORS: Record<string, string> = {
    info: "#3b82f6", success: "#22c55e", warning: "#f59e0b",
    error: "#ef4444", system: "#8b5cf6",
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#6366f1" /></View>;

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Status card */}
      <View style={[styles.card, { backgroundColor: status?.active ? "#22c55e10" : colors.card, borderColor: status?.active ? "#22c55e40" : colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[styles.autopilotIcon, { backgroundColor: status?.active ? "#22c55e18" : colors.muted }]}>
            <Feather name="zap" size={24} color={status?.active ? "#22c55e" : colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Oto-Pilot IA</Text>
            <Text style={[styles.cardSubtitle, { color: status?.active ? "#22c55e" : colors.mutedForeground }]}>
              {status?.active ? "Actif — cycles toutes les 30 min" : "Inactif"}
            </Text>
            {status?.lastRun && (
              <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
                Dernier cycle : {timeAgo(status.lastRun)}
              </Text>
            )}
          </View>
          <Pressable onPress={toggle} disabled={toggling} style={[styles.toggleBtn, { backgroundColor: status?.active ? "#ef4444" : "#22c55e" }]}>
            {toggling
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name={status?.active ? "pause" : "play"} size={16} color="#fff" />
            }
            <Text style={styles.toggleBtnText}>{status?.active ? "Arrêter" : "Activer"}</Text>
          </Pressable>
        </View>
      </View>

      {/* Stats */}
      {status && (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Cycles",         value: status.cyclesRun ?? 0,           color: "#6366f1", icon: "refresh-cw" as const },
            { label: "Tâches créées",  value: status.tasksCreated ?? 0,        color: "#22c55e", icon: "check-square" as const },
            { label: "Tâches màj",     value: status.tasksUpdated ?? 0,        color: "#3b82f6", icon: "edit" as const },
            { label: "Notifications",  value: status.notificationsSent ?? 0,   color: "#f59e0b", icon: "bell" as const },
          ].map(s => (
            <View key={s.label} style={[styles.miniStatCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name={s.icon} size={14} color={s.color} />
              <Text style={[styles.miniStatCardVal, { color: colors.foreground }]}>{s.value}</Text>
              <Text style={[styles.miniStatCardLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Run once */}
      <Pressable onPress={runOnce} disabled={running} style={[styles.generateBtn, { backgroundColor: "#6366f1", opacity: running ? 0.6 : 1 }]}>
        {running ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="play" size={16} color="#fff" />}
        <Text style={styles.generateBtnText}>{running ? "Cycle en cours..." : "Lancer un cycle maintenant"}</Text>
      </Pressable>

      {/* Recent logs */}
      {status?.recentLogs && status.recentLogs.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Journaux récents ({status.recentLogs.length})</Text>
          {status.recentLogs.slice(-20).reverse().map((log, i) => {
            const levelColor = LOG_LEVEL_COLORS[log.level] ?? "#64748b";
            return (
              <View key={i} style={[styles.logRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.logDot, { backgroundColor: levelColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.logMsg, { color: colors.foreground }]}>{log.message}</Text>
                  {log.module && <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>{log.module}</Text>}
                </View>
                <Text style={[styles.logTime, { color: colors.mutedForeground }]}>{timeAgo(log.timestamp)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// ─── ANOMALIES TAB ───────────────────────────────────────────────────────────
function AnomaliesTab() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/anomalies`);
      if (res.ok) {
        const d = await res.json();
        setAnomalies(d.anomalies ?? []);
      }
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  const SEVERITY_ORDER = { critique: 0, haute: 1, moyenne: 2, basse: 3 };
  const sorted = [...anomalies].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4));

  const critiques = anomalies.filter(a => a.severity === "critique").length;
  const hautes    = anomalies.filter(a => a.severity === "haute").length;

  const TYPE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
    volume_drop: "trending-down", volume_spike: "trending-up",
    missed_calls: "phone-missed", overdue_tasks: "check-square",
    stuck_tasks: "clock", unread_messages: "message-circle",
    out_of_stock: "package", low_stock: "alert-triangle",
    inactive_users: "user-x", no_mfa: "shield-off",
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#ef4444" /></View>;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ef4444" />}
      showsVerticalScrollIndicator={false}
    >
      {/* Summary */}
      {anomalies.length > 0 ? (
        <View style={[styles.card, { backgroundColor: critiques > 0 ? "#ef444410" : "#f59e0b10", borderColor: critiques > 0 ? "#ef444440" : "#f59e0b40" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Feather name="alert-triangle" size={20} color={critiques > 0 ? "#ef4444" : "#f59e0b"} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{anomalies.length} anomalie{anomalies.length > 1 ? "s" : ""} détectée{anomalies.length > 1 ? "s" : ""}</Text>
              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
                {critiques > 0 ? `${critiques} critique${critiques > 1 ? "s" : ""}` : ""}
                {critiques > 0 && hautes > 0 ? " · " : ""}
                {hautes > 0 ? `${hautes} haute${hautes > 1 ? "s" : ""}` : ""}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: "#22c55e10", borderColor: "#22c55e40" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Feather name="check-circle" size={20} color="#22c55e" />
            <View>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Aucune anomalie détectée</Text>
              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>Tout fonctionne normalement</Text>
            </View>
          </View>
        </View>
      )}

      {/* Anomaly list */}
      {sorted.map((anomaly, i) => {
        const severityColors: Record<string, string> = {
          critique: "#ef4444", haute: "#f97316", moyenne: "#f59e0b", basse: "#22c55e",
        };
        const color = severityColors[anomaly.severity] ?? "#64748b";
        const icon = TYPE_ICONS[anomaly.type] ?? "alert-circle";

        return (
          <View key={i} style={[styles.anomalyCard, { backgroundColor: colors.card, borderColor: color + "30", borderLeftColor: color, borderLeftWidth: 3 }]}>
            <View style={styles.anomalyHeader}>
              <View style={[styles.anomalyIcon, { backgroundColor: color + "18" }]}>
                <Feather name={icon} size={16} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.anomalyTitle, { color: colors.foreground }]}>{anomaly.title}</Text>
                {anomaly.metric && (
                  <Text style={[styles.anomalyMetric, { color: color }]}>{anomaly.metric}</Text>
                )}
              </View>
              <SeverityBadge severity={anomaly.severity} />
            </View>
            <Text style={[styles.anomalyDesc, { color: colors.mutedForeground }]}>{anomaly.description}</Text>
            {anomaly.suggestedAction && (
              <View style={[styles.suggestionRow, { backgroundColor: "#22c55e10" }]}>
                <Feather name="arrow-right" size={11} color="#22c55e" />
                <Text style={[styles.suggestionText, { color: "#16a34a" }]}>{anomaly.suggestedAction}</Text>
              </View>
            )}
          </View>
        );
      })}

      <Pressable onPress={() => { setLoading(true); load(); }} style={[styles.generateBtn, { backgroundColor: "#ef4444", marginTop: 8, marginBottom: 24 }]}>
        <Feather name="refresh-cw" size={16} color="#fff" />
        <Text style={styles.generateBtnText}>Relancer la détection</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function AiAgentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [tab, setTab] = useState<MainTab>("agents");
  const [runningAll, setRunningAll] = useState(false);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [latestReports, setLatestReports] = useState<Record<string, AgentReport>>({});
  const [loadingInit, setLoadingInit] = useState(true);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, latestRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/ai/agents/config`),
        fetchAuth(`${API_BASE}/api/ai/agents/latest`),
      ]);
      if (configRes.ok) { const d = await configRes.json(); setAgents(d.agents ?? []); }
      if (latestRes.ok) { const d = await latestRes.json(); setLatestReports(d ?? {}); }
    } catch {} finally { setLoadingInit(false); }
  }, [fetchAuth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function runAllAgents() {
    setRunningAll(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/agents/run`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "started" || data.status === "already_running") {
          if (pollRef.current) clearInterval(pollRef.current);
          const start = Date.now();
          pollRef.current = setInterval(async () => {
            if (Date.now() - start > 5 * 60 * 1000) { clearInterval(pollRef.current!); pollRef.current = null; setRunningAll(false); return; }
            const r = await fetchAuth(`${API_BASE}/api/ai/agents/run/status`).catch(() => null);
            if (!r) return;
            const d = await r.json().catch(() => ({}));
            if (["completed", "failed", "idle"].includes(d.status)) {
              clearInterval(pollRef.current!); pollRef.current = null; setRunningAll(false); fetchData();
            }
          }, 4000);
        } else { setRunningAll(false); fetchData(); }
      } else setRunningAll(false);
    } catch { setRunningAll(false); }
  }

  const reports = Object.values(latestReports).filter(r => !r.isSuperReport);
  const lastRunAt = reports.length > 0 ? [...reports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.createdAt : null;

  const MAIN_TABS: { key: MainTab; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
    { key: "agents",    label: "Agents",     icon: "cpu",            color: "#6366f1" },
    { key: "autopilot", label: "Oto-Pilot",  icon: "zap",            color: "#22c55e" },
    { key: "anomalies", label: "Anomalies",  icon: "alert-triangle", color: "#ef4444" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Agents IA</Text>
            {lastRunAt && <Text style={styles.headerSub}>{timeAgo(lastRunAt)}</Text>}
          </View>
          <Pressable onPress={runAllAgents} disabled={runningAll} style={[styles.runAllBtn, { backgroundColor: runningAll ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.2)" }]} hitSlop={8}>
            {runningAll ? <ActivityIndicator size="small" color="#ffffff" /> : <Feather name="play" size={16} color="#ffffff" />}
            <Text style={styles.runAllText}>{runningAll ? "En cours..." : "Tout lancer"}</Text>
          </Pressable>
        </View>

        {/* Tab bar */}
        <View style={styles.mainTabRow}>
          {MAIN_TABS.map(t => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.mainTabBtn, { backgroundColor: tab === t.key ? t.color : "rgba(255,255,255,0.1)" }]}>
              <Feather name={t.icon} size={13} color={tab === t.key ? "#fff" : "rgba(255,255,255,0.7)"} />
              <Text style={[styles.mainTabBtnText, { color: tab === t.key ? "#fff" : "rgba(255,255,255,0.7)" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.tabContent, { paddingBottom: isWeb ? 118 : 40 }]}>
        {tab === "agents"    && <AgentsTab />}
        {tab === "autopilot" && <AutopilotTab />}
        {tab === "anomalies" && <AnomaliesTab />}
      </View>
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
  mainTabRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  mainTabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 20 },
  mainTabBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tabContent: { flex: 1 },
  scrollContent: { padding: 16, gap: 10 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 8, letterSpacing: 0.3 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 4 },
  statCard: { flex: 1, alignItems: "center", padding: 16, borderRadius: 12, borderWidth: 1 },
  scoreCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  scoreText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  scoreTextSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statCol: { flex: 1, gap: 6 },
  miniStat: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  miniStatVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  miniStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  miniStatCard: { flex: 1, minWidth: "47%", alignItems: "center", padding: 10, borderRadius: 12, borderWidth: 1, gap: 4 },
  miniStatCardVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  miniStatCardLabel: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
  autoFixBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 },
  autoFixBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  runningBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12 },
  runningText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden", padding: 0 },
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
  scoreBarFill: { height: "100%" as any, borderRadius: 3 },
  scoreBarLabel: { fontSize: 12, fontFamily: "Inter_700Bold", width: 28, textAlign: "right" },
  expandedContent: { borderTopWidth: StyleSheet.hairlineWidth, padding: 14 },
  reportSummary: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 10, marginBottom: 10 },
  findingSection: { marginBottom: 12 },
  findingTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  findingItem: { padding: 10, borderRadius: 8, marginBottom: 4 },
  findingText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  emptyReport: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  noFindings: { fontSize: 13, fontFamily: "Inter_500Medium" },
  timestamp: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 10 },
  summaryText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, paddingHorizontal: 14, marginBottom: 6 },
  fixRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 4 },
  fixText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  autopilotIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  toggleBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  toggleBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  generateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12 },
  generateBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  logRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 4 },
  logDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  logMsg: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  logMeta: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  logTime: { fontSize: 10, fontFamily: "Inter_400Regular", flexShrink: 0 },
  anomalyCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  anomalyHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  anomalyIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  anomalyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  anomalyMetric: { fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 2 },
  anomalyDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  suggestionRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 8, borderRadius: 8 },
  suggestionText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 17 },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  severityBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
});
