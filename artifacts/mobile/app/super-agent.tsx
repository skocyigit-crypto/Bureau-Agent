import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTranslation, type TFunction } from "@/lib/i18n";
import { AvatarDock } from "@/components/AvatarDock";

type Tab = "apercu" | "email" | "chantier" | "journal";

interface AgentLog {
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  source: "email" | "chantier" | "system" | "tache" | "appel";
  message: string;
  detail?: string;
}

interface AgentStats {
  tasksCreated: number;
  tasksFixed: number;
  emailsProcessed: number;
  reportsProcessed: number;
  fixesApplied: number;
  cyclesRun: number;
}

interface AgentStatus {
  running: boolean;
  lastRun?: string;
  /** Passage quotidien automatique — decide par l'organisation, faux par defaut. */
  autoRunEnabled?: boolean;
  stats: AgentStats;
  recentLogs: AgentLog[];
}

const TABS: { key: Tab; labelKey: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "apercu",   labelKey: "superAgentScreen.tabApercu",    icon: "zap",          color: "#6366f1" },
  { key: "email",    labelKey: "superAgentScreen.tabEmail",  icon: "mail",         color: "#dc2626" },
  { key: "chantier", labelKey: "superAgentScreen.tabChantier",  icon: "tool",         color: "#f59e0b" },
  { key: "journal",  labelKey: "superAgentScreen.tabJournal",   icon: "activity",     color: "#22c55e" },
];

const LOG_LEVEL_CFG: Record<string, { color: string; icon: keyof typeof Feather.glyphMap; bg: string }> = {
  info:    { color: "#3b82f6", icon: "info",           bg: "#3b82f610" },
  success: { color: "#22c55e", icon: "check-circle",   bg: "#22c55e10" },
  warning: { color: "#f59e0b", icon: "alert-triangle", bg: "#f59e0b10" },
  error:   { color: "#ef4444", icon: "x-circle",       bg: "#ef444410" },
};

const SOURCE_CFG: Record<string, { color: string; label: string; icon: keyof typeof Feather.glyphMap }> = {
  email:    { color: "#dc2626", label: "Email",    icon: "mail" },
  chantier: { color: "#f59e0b", label: "Chantier", icon: "tool" },
  system:   { color: "#6366f1", label: "Système",  icon: "cpu" },
  tache:    { color: "#22c55e", label: "Tâche",    icon: "check-square" },
  appel:    { color: "#3b82f6", label: "Appel",    icon: "phone" },
};

function timeAgo(d: string, t: TFunction): string {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("superAgentScreen.justNow");
  if (min < 60) return t("superAgentScreen.minAgo", { min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("superAgentScreen.hoursAgo", { h });
  return t("superAgentScreen.daysAgo", { d: Math.floor(h / 24) });
}

// ─── APERÇU ──────────────────────────────────────────────────────────────────
function ApercuTab({ status, onRun, running, onToggleAutoRun, autoRunBusy }: { status: AgentStatus | null; onRun: () => void; running: boolean; onToggleAutoRun: (next: boolean) => void; autoRunBusy: boolean }) {
  const colors = useColors();
  const { t } = useTranslation();

  const stats = status?.stats ?? { tasksCreated: 0, tasksFixed: 0, emailsProcessed: 0, reportsProcessed: 0, fixesApplied: 0, cyclesRun: 0 };

  const SOURCES = [
    { icon: "mail" as const,         color: "#dc2626", label: t("superAgentScreen.sourceEmails"),         value: stats.emailsProcessed },
    { icon: "tool" as const,         color: "#f59e0b", label: t("superAgentScreen.sourceReports"),       value: stats.reportsProcessed },
    { icon: "check-square" as const, color: "#22c55e", label: t("superAgentScreen.sourceTasksCreated"),           value: stats.tasksCreated },
    { icon: "trending-up" as const,  color: "#8b5cf6", label: t("superAgentScreen.sourceTasksEscalated"),       value: stats.tasksFixed },
    { icon: "link" as const,         color: "#3b82f6", label: t("superAgentScreen.sourceCallLinks"),    value: stats.fixesApplied },
    { icon: "refresh-cw" as const,   color: "#6366f1", label: t("superAgentScreen.sourceCycles"),         value: stats.cyclesRun },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
      {/* Main control card */}
      <View style={[sa.card, { backgroundColor: running ? "#6366f110" : colors.card, borderColor: running ? "#6366f140" : colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={[sa.iconBox, { backgroundColor: running ? "#6366f120" : "#6366f110" }]}>
            {running
              ? <ActivityIndicator size="large" color="#6366f1" />
              : <Feather name="zap" size={28} color="#6366f1" />
            }
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[sa.h2, { color: colors.foreground }]}>{t("superAgentScreen.title")}</Text>
            <Text style={[sa.sub, { color: colors.mutedForeground }]}>
              {running ? t("superAgentScreen.analyzingInProgress") : status?.lastRun ? t("superAgentScreen.lastCycle", { time: timeAgo(status.lastRun, t) }) : t("superAgentScreen.neverRun")}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Pressable accessibilityRole="button" onPress={onRun} disabled={running} style={[sa.btn, { flex: 1, backgroundColor: running ? "#6366f160" : "#6366f1" }]}>
            {running ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="play" size={16} color="#fff" />}
            <Text style={sa.btnText}>{running ? t("superAgentScreen.agentActive") : t("superAgentScreen.runFullCycle")}</Text>
          </Pressable>
        </View>

        {/* Passage quotidien automatique. Eteint par defaut: l'agent cree des
            taches et remonte des priorites, donc c'est l'organisation qui
            decide de le laisser tourner seul. */}
        <View style={[sa.autoRunRow, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[sa.autoRunTitle, { color: colors.foreground }]}>{t("superAgentScreen.autoRunTitle")}</Text>
            <Text style={[sa.sub, { color: colors.mutedForeground }]}>
              {status?.autoRunEnabled ? t("superAgentScreen.autoRunOn") : t("superAgentScreen.autoRunOff")}
            </Text>
          </View>
          <Switch
            value={Boolean(status?.autoRunEnabled)}
            onValueChange={onToggleAutoRun}
            disabled={autoRunBusy}
          />
        </View>
      </View>

      {/* What the agent does */}
      <View style={[sa.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[sa.sectionLabel, { color: colors.mutedForeground }]}>{t("superAgentScreen.whatAgentDoes")}</Text>
        {[
          { icon: "mail" as const,         color: "#dc2626", title: t("superAgentScreen.feature1Title"),          desc: t("superAgentScreen.feature1Desc") },
          { icon: "tool" as const,         color: "#f59e0b", title: t("superAgentScreen.feature2Title"),         desc: t("superAgentScreen.feature2Desc") },
          { icon: "check-square" as const, color: "#22c55e", title: t("superAgentScreen.feature3Title"),         desc: t("superAgentScreen.feature3Desc") },
          { icon: "phone" as const,        color: "#3b82f6", title: t("superAgentScreen.feature4Title"),          desc: t("superAgentScreen.feature4Desc") },
        ].map((item, i) => (
          <View key={i} style={[sa.featureRow, { borderTopColor: colors.border }]}>
            <View style={[sa.featureIcon, { backgroundColor: item.color + "18" }]}>
              <Feather name={item.icon} size={15} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[sa.featureTitle, { color: colors.foreground }]}>{item.title}</Text>
              <Text style={[sa.featureDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Stats grid */}
      <Text style={[sa.sectionLabel, { color: colors.mutedForeground }]}>{t("superAgentScreen.cumulativeStats")}</Text>
      <View style={sa.statsGrid}>
        {SOURCES.map(s => (
          <View key={s.label} style={[sa.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={s.icon} size={16} color={s.color} />
            <Text style={[sa.statVal, { color: colors.foreground }]}>{s.value}</Text>
            <Text style={[sa.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Recent activity preview */}
      {status?.recentLogs && status.recentLogs.length > 0 && (
        <>
          <Text style={[sa.sectionLabel, { color: colors.mutedForeground }]}>{t("superAgentScreen.lastActions")}</Text>
          {status.recentLogs.slice(-5).reverse().map((log, i) => {
            const cfg = LOG_LEVEL_CFG[log.level] ?? LOG_LEVEL_CFG.info;
            const src = SOURCE_CFG[log.source] ?? SOURCE_CFG.system;
            return (
              <View key={i} style={[sa.logCard, { backgroundColor: cfg.bg, borderColor: cfg.color + "30" }]}>
                <View style={[sa.logIconBox, { backgroundColor: src.color + "20" }]}>
                  <Feather name={src.icon} size={12} color={src.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sa.logMsg, { color: colors.foreground }]}>{log.message}</Text>
                  {log.detail && <Text style={[sa.logDetail, { color: colors.mutedForeground }]}>{log.detail}</Text>}
                </View>
                <Text style={[sa.logTime, { color: colors.mutedForeground }]}>{timeAgo(log.timestamp, t)}</Text>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

// ─── EMAIL IA ─────────────────────────────────────────────────────────────────
function EmailTab({ onRun, running, logs }: { onRun: () => void; running: boolean; logs: AgentLog[] }) {
  const colors = useColors();
  const { t } = useTranslation();

  const emailLogs = logs.filter(l => l.source === "email");
  const taskLogs = emailLogs.filter(l => l.level === "success" && l.detail?.includes("tâche"));
  const noActionLogs = emailLogs.filter(l => l.level === "info" && l.message.includes("analysé"));

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      <View style={[sa.card, { backgroundColor: "#dc262608", borderColor: "#dc262630" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={[sa.iconBoxSm, { backgroundColor: "#dc262618" }]}>
            <Feather name="mail" size={18} color="#dc2626" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[sa.h2, { color: colors.foreground }]}>{t("superAgentScreen.emailTitle")}</Text>
            <Text style={[sa.sub, { color: colors.mutedForeground }]}>{t("superAgentScreen.emailSub")}</Text>
          </View>
        </View>
        <Text style={[sa.bodyText, { color: colors.mutedForeground, marginTop: 8 }]}>
          {t("superAgentScreen.emailBody")}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRun} disabled={running} style={[sa.btn, { backgroundColor: "#dc2626", opacity: running ? 0.6 : 1, marginTop: 10 }]}>
          {running ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="refresh-cw" size={14} color="#fff" />}
          <Text style={sa.btnText}>{running ? t("superAgentScreen.processing") : t("superAgentScreen.analyzeEmailsNow")}</Text>
        </Pressable>
      </View>

      {emailLogs.length === 0 ? (
        <View style={[sa.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="inbox" size={32} color={colors.mutedForeground} />
          <Text style={[sa.emptyTitle, { color: colors.foreground }]}>{t("superAgentScreen.noEmailAnalysis")}</Text>
          <Text style={[sa.emptyText, { color: colors.mutedForeground }]}>{t("superAgentScreen.noEmailAnalysisSub")}</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={[sa.miniStat, { backgroundColor: "#22c55e10", flex: 1 }]}>
              <Feather name="check-square" size={14} color="#22c55e" />
              <Text style={[sa.miniStatVal, { color: "#22c55e" }]}>{taskLogs.length}</Text>
              <Text style={[sa.miniStatLabel, { color: colors.mutedForeground }]}>{t("superAgentScreen.emailsToTasks")}</Text>
            </View>
            <View style={[sa.miniStat, { backgroundColor: "#3b82f610", flex: 1 }]}>
              <Feather name="mail" size={14} color="#3b82f6" />
              <Text style={[sa.miniStatVal, { color: "#3b82f6" }]}>{emailLogs.length}</Text>
              <Text style={[sa.miniStatLabel, { color: colors.mutedForeground }]}>{t("superAgentScreen.emailsAnalyzed")}</Text>
            </View>
          </View>

          {emailLogs.slice().reverse().map((log, i) => {
            const cfg = LOG_LEVEL_CFG[log.level] ?? LOG_LEVEL_CFG.info;
            return (
              <View key={i} style={[sa.logCard, { backgroundColor: cfg.bg, borderColor: cfg.color + "30" }]}>
                <Feather name={cfg.icon} size={14} color={cfg.color} />
                <View style={{ flex: 1 }}>
                  <Text style={[sa.logMsg, { color: colors.foreground }]}>{log.message}</Text>
                  {log.detail && <Text style={[sa.logDetail, { color: colors.mutedForeground }]}>{log.detail}</Text>}
                </View>
                <Text style={[sa.logTime, { color: colors.mutedForeground }]}>{timeAgo(log.timestamp, t)}</Text>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

// ─── CHANTIER ────────────────────────────────────────────────────────────────
function ChantierTab() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const { t } = useTranslation();
  const [report, setReport] = useState("");
  const [reportType, setReportType] = useState("chantier");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const TYPES = [
    { key: "chantier",  label: t("superAgentScreen.typeChantier"),    icon: "tool" as const,         color: "#f59e0b" },
    { key: "visite",    label: t("superAgentScreen.typeVisite"),  icon: "map-pin" as const,      color: "#3b82f6" },
    { key: "reunion",   label: t("superAgentScreen.typeReunion"), icon: "users" as const,        color: "#8b5cf6" },
    { key: "email",     label: t("superAgentScreen.typeEmail"),    icon: "mail" as const,         color: "#dc2626" },
    { key: "note",      label: t("superAgentScreen.typeNote"),           icon: "file-text" as const,    color: "#22c55e" },
  ];

  async function process() {
    if (!report.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/super-agent/process-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, reportType }),
      });
      if (res.ok) { const d = await res.json(); setResult(d); }
    } catch {} finally { setLoading(false); }
  }

  const URGENCY_COLORS: Record<string, string> = { normal: "#22c55e", eleve: "#f59e0b", critique: "#ef4444" };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      <View style={[sa.card, { backgroundColor: "#f59e0b08", borderColor: "#f59e0b30" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <View style={[sa.iconBoxSm, { backgroundColor: "#f59e0b18" }]}>
            <Feather name="tool" size={18} color="#f59e0b" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[sa.h2, { color: colors.foreground }]}>{t("superAgentScreen.reportProcessing")}</Text>
            <Text style={[sa.sub, { color: colors.mutedForeground }]}>{t("superAgentScreen.reportSub")}</Text>
          </View>
        </View>

        {/* Type selector */}
        <Text style={[sa.fieldLabel, { color: colors.mutedForeground }]}>{t("superAgentScreen.documentType")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
          {TYPES.map(ty => (
            <Pressable accessibilityRole="button" key={ty.key} onPress={() => setReportType(ty.key)} style={[sa.typeChip, { backgroundColor: reportType === ty.key ? ty.color : colors.background, borderColor: reportType === ty.key ? ty.color : colors.border }]}>
              <Feather name={ty.icon} size={11} color={reportType === ty.key ? "#fff" : colors.mutedForeground} />
              <Text style={[sa.typeChipText, { color: reportType === ty.key ? "#fff" : colors.mutedForeground }]}>{ty.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Text area */}
        <Text style={[sa.fieldLabel, { color: colors.mutedForeground, marginTop: 10 }]}>{t("superAgentScreen.reportContent")}</Text>
        <TextInput
          style={[sa.textarea, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          placeholder={t("superAgentScreen.contentPlaceholder", { type: TYPES.find(ty => ty.key === reportType)?.label.toLowerCase() ?? t("superAgentScreen.typeFallback") })}
          placeholderTextColor={colors.mutedForeground}
          value={report}
          onChangeText={setReport}
          multiline
          numberOfLines={10}
          textAlignVertical="top"
        />

        <Pressable accessibilityRole="button" onPress={process} disabled={loading || !report.trim()} style={[sa.btn, { backgroundColor: "#f59e0b", opacity: loading || !report.trim() ? 0.6 : 1, marginTop: 8 }]}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="zap" size={14} color="#fff" />}
          <Text style={sa.btnText}>{loading ? t("superAgentScreen.aiAnalyzing") : t("superAgentScreen.analyzeAndCreate")}</Text>
        </Pressable>
      </View>

      {/* Result */}
      {result && (
        <View style={{ gap: 10 }}>
          <View style={[sa.card, { backgroundColor: "#22c55e08", borderColor: "#22c55e30" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="check-circle" size={16} color="#22c55e" />
              <Text style={[sa.h2, { color: colors.foreground }]}>{t("superAgentScreen.reportProcessed")}</Text>
              {result.nextStepUrgency && (
                <View style={[sa.urgencyBadge, { backgroundColor: (URGENCY_COLORS[result.nextStepUrgency] ?? "#64748b") + "18" }]}>
                  <Text style={[sa.urgencyText, { color: URGENCY_COLORS[result.nextStepUrgency] ?? "#64748b" }]}>{t("superAgentScreen.urgency", { level: result.nextStepUrgency })}</Text>
                </View>
              )}
            </View>
            {result.summary && <Text style={[sa.bodyText, { color: colors.foreground, marginTop: 6 }]}>{result.summary}</Text>}
            {result.summary ? (
              <View style={{ marginTop: 8 }}>
                <AvatarDock text={result.summary} autoSpeak={false} storageKey="buro.superagent.voice" />
              </View>
            ) : null}
          </View>

          {/* Issues found */}
          {result.issues?.length > 0 && (
            <View style={[sa.card, { backgroundColor: "#ef444408", borderColor: "#ef444430" }]}>
              <Text style={[sa.cardTitle, { color: "#ef4444", marginBottom: 6 }]}>{t("superAgentScreen.issuesDetected", { count: result.issues.length })}</Text>
              {result.issues.map((issue: any, i: number) => {
                const sevColors: Record<string, string> = { haute: "#ef4444", moyenne: "#f59e0b", basse: "#22c55e" };
                const col = sevColors[issue.severity] ?? "#64748b";
                return (
                  <View key={i} style={[sa.issueRow, { backgroundColor: col + "10" }]}>
                    <Feather name="alert-triangle" size={11} color={col} />
                    <Text style={[sa.issueText, { color: colors.foreground }]}>{issue.description}</Text>
                    <View style={[sa.issueSev, { backgroundColor: col + "18" }]}>
                      <Text style={[sa.issueSevText, { color: col }]}>{issue.severity}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Created tasks */}
          {result.createdTasks?.length > 0 && (
            <View style={[sa.card, { backgroundColor: "#22c55e08", borderColor: "#22c55e30" }]}>
              <Text style={[sa.cardTitle, { color: colors.foreground, marginBottom: 6 }]}>
                {t("superAgentScreen.tasksCreatedResult", { count: result.createdTasks.length })}
              </Text>
              {result.createdTasks.map((tk: any, i: number) => {
                const prioColors: Record<string, string> = { haute: "#ef4444", moyenne: "#f59e0b", basse: "#22c55e" };
                return (
                  <View key={i} style={sa.taskRow}>
                    <View style={[sa.prioDot, { backgroundColor: prioColors[tk.priority] ?? "#64748b" }]} />
                    <Text style={[sa.taskTitle, { color: colors.foreground }]}>{tk.title}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Created events */}
          {result.createdEvents?.length > 0 && (
            <View style={[sa.card, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
              <Text style={[sa.cardTitle, { color: colors.foreground, marginBottom: 6 }]}>
                {t("superAgentScreen.eventsCreatedResult", { count: result.createdEvents.length })}
              </Text>
              {result.createdEvents.map((e: any, i: number) => (
                <View key={i} style={sa.taskRow}>
                  <Feather name="calendar" size={11} color="#8b5cf6" />
                  <Text style={[sa.taskTitle, { color: colors.foreground }]}>{e.title}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Nothing created */}
          {result.tasksCount === 0 && result.eventsCount === 0 && (
            <View style={[sa.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[sa.bodyText, { color: colors.mutedForeground }]}>{t("superAgentScreen.nothingDetected")}</Text>
            </View>
          )}

          <Pressable accessibilityRole="button" onPress={() => { setResult(null); setReport(""); }} style={[sa.btn, { backgroundColor: colors.muted }]}>
            <Feather name="plus" size={14} color={colors.mutedForeground} />
            <Text style={[sa.btnText, { color: colors.mutedForeground }]}>{t("superAgentScreen.analyzeAnother")}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

// ─── JOURNAL ─────────────────────────────────────────────────────────────────
function JournalTab({ logs, refreshing, onRefresh }: { logs: AgentLog[]; refreshing: boolean; onRefresh: () => void }) {
  const colors = useColors();
  const { t } = useTranslation();

  const FILTER_OPTIONS: { key: string; label: string }[] = [
    { key: "all", label: t("superAgentScreen.filterAll") },
    { key: "success", label: t("superAgentScreen.filterSuccess") },
    { key: "warning", label: t("superAgentScreen.filterWarning") },
    { key: "error", label: t("superAgentScreen.filterError") },
    { key: "email", label: t("superAgentScreen.filterEmail") },
    { key: "chantier", label: t("superAgentScreen.filterChantier") },
    { key: "tache", label: t("superAgentScreen.filterTache") },
  ];
  const [filter, setFilter] = useState("all");

  const filtered = [...logs].reverse().filter(l => {
    if (filter === "all") return true;
    if (["success", "warning", "error", "info"].includes(filter)) return l.level === filter;
    return l.source === filter;
  });

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
    >
      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {FILTER_OPTIONS.map(f => (
          <Pressable accessibilityRole="button" key={f.key} onPress={() => setFilter(f.key)} style={[sa.filterChip, { backgroundColor: filter === f.key ? "#6366f1" : colors.card, borderColor: filter === f.key ? "#6366f1" : colors.border }]}>
            <Text style={[sa.filterChipText, { color: filter === f.key ? "#fff" : colors.mutedForeground }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filtered.length === 0 ? (
        <View style={[sa.emptyBox, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 8 }]}>
          <Feather name="activity" size={32} color={colors.mutedForeground} />
          <Text style={[sa.emptyTitle, { color: colors.foreground }]}>{t("superAgentScreen.noJournal")}</Text>
          <Text style={[sa.emptyText, { color: colors.mutedForeground }]}>{t("superAgentScreen.noJournalSub")}</Text>
        </View>
      ) : (
        filtered.map((log, i) => {
          const cfg = LOG_LEVEL_CFG[log.level] ?? LOG_LEVEL_CFG.info;
          const src = SOURCE_CFG[log.source] ?? SOURCE_CFG.system;
          return (
            <View key={i} style={[sa.logCard, { backgroundColor: cfg.bg, borderColor: cfg.color + "25" }]}>
              <View style={{ flexDirection: "column", alignItems: "center", gap: 4 }}>
                <View style={[sa.logIconBox, { backgroundColor: src.color + "20" }]}>
                  <Feather name={src.icon} size={11} color={src.color} />
                </View>
                <View style={[sa.levelDot, { backgroundColor: cfg.color }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[sa.logMsg, { color: "#1e293b" }]}>{log.message}</Text>
                {log.detail && <Text style={[sa.logDetail, { color: "#64748b" }]}>{log.detail}</Text>}
                <Text style={[sa.logTime, { color: "#94a3b8", marginTop: 2 }]}>{new Date(log.timestamp).toLocaleTimeString("fr-FR")} · {timeAgo(log.timestamp, t)}</Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function SuperAgentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { fetchAuth } = useAuth();
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("apercu");
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRunBusy, setAutoRunBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/super-agent/status`);
      if (res.ok) { const d = await res.json(); setStatus(d); setRunning(d.running); }
    } catch {} finally { setRefreshing(false); }
  }, [fetchAuth]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    const start = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - start > 5 * 60 * 1000) { clearInterval(pollRef.current!); pollRef.current = null; setRunning(false); loadStatus(); return; }
      try {
        const res = await fetchAuth(`${API_BASE}/api/ai/super-agent/status`);
        if (res.ok) {
          const d = await res.json();
          setStatus(d);
          if (!d.running) { clearInterval(pollRef.current!); pollRef.current = null; setRunning(false); }
        }
      } catch {}
    }, 3000);
  }

  async function runCycle() {
    setRunning(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/super-agent/run`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) { startPolling(); }
      else setRunning(false);
    } catch { setRunning(false); }
  }

  /**
   * Le reglage n'est affiche comme change qu'apres confirmation du serveur:
   * un interrupteur qui s'allume tout seul, alors que le serveur a refuse,
   * ferait croire a un passage quotidien qui n'aura jamais lieu.
   */
  async function toggleAutoRun(next: boolean) {
    setAutoRunBusy(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/ai/super-agent/auto-run`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        const d = await res.json();
        setStatus((prev) => (prev ? { ...prev, autoRunEnabled: d.autoRunEnabled } : prev));
      } else {
        Alert.alert(t("superAgentScreen.autoRunTitle"), t("superAgentScreen.autoRunFailed"));
      }
    } catch {
      Alert.alert(t("superAgentScreen.autoRunTitle"), t("superAgentScreen.autoRunFailed"));
    } finally {
      setAutoRunBusy(false);
    }
  }

  function onRefresh() { setRefreshing(true); loadStatus(); }

  const logs = status?.recentLogs ?? [];
  const activeTab = TABS.find(tb => tb.key === tab)!;

  return (
    <View style={[sa.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[sa.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={sa.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} hitSlop={12} style={sa.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={sa.headerTitle}>{t("superAgentScreen.title")}</Text>
            <Text style={sa.headerSub}>
              {running ? t("superAgentScreen.autonomousAnalyzing") : status?.lastRun ? t("superAgentScreen.lastCycle", { time: timeAgo(status.lastRun, t) }) : t("superAgentScreen.headerSubDefault")}
            </Text>
          </View>
          {running && <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />}
          {!running && (
            <Pressable accessibilityRole="button" onPress={runCycle} style={[sa.runBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Feather name="play" size={14} color="#fff" />
              <Text style={sa.runBtnText}>{t("superAgentScreen.run")}</Text>
            </Pressable>
          )}
        </View>

        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
          {TABS.map(tb => (
            <Pressable accessibilityRole="button" key={tb.key} onPress={() => setTab(tb.key)} style={[sa.tabChip, { backgroundColor: tab === tb.key ? tb.color : "rgba(255,255,255,0.12)" }]}>
              <Feather name={tb.icon} size={12} color={tab === tb.key ? "#fff" : "rgba(255,255,255,0.7)"} />
              <Text style={[sa.tabChipText, { color: tab === tb.key ? "#fff" : "rgba(255,255,255,0.7)" }]}>{t(tb.labelKey)}</Text>
              {tb.key === "email" && logs.filter(l => l.source === "email" && l.level === "success").length > 0 && (
                <View style={sa.tabBadge}>
                  <Text style={sa.tabBadgeText}>{logs.filter(l => l.source === "email" && l.level === "success").length}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={[sa.body, { paddingBottom: isWeb ? 120 : 48 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={tab === "journal" ? undefined : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={activeTab.color} />}
      >
        {tab === "apercu"   && <ApercuTab  status={status}   onRun={runCycle} running={running} onToggleAutoRun={toggleAutoRun} autoRunBusy={autoRunBusy} />}
        {tab === "email"    && <EmailTab   onRun={runCycle} running={running} logs={logs} />}
        {tab === "chantier" && <ChantierTab />}
        {tab === "journal"  && <JournalTab logs={logs} refreshing={refreshing} onRefresh={onRefresh} />}
      </ScrollView>
    </View>
  );
}

const sa = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#0f172a", paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 1 },
  runBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  runBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  tabChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  tabChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tabBadge: { backgroundColor: "#ef4444", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  tabBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  body: { padding: 14, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  h2: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  autoRunRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  autoRunTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  bodyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  iconBox: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  iconBoxSm: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13, borderRadius: 10 },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: { minWidth: "30%", flex: 1, alignItems: "center", padding: 10, borderRadius: 10, borderWidth: 1, gap: 4 },
  statVal: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  featureIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  featureTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  featureDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
  logCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  logIconBox: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  logMsg: { fontSize: 12, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  logDetail: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15, marginTop: 1 },
  logTime: { fontSize: 10, fontFamily: "Inter_400Regular", flexShrink: 0 },
  levelDot: { width: 6, height: 6, borderRadius: 3 },
  emptyBox: { borderRadius: 12, borderWidth: 1, padding: 32, alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  miniStat: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  miniStatVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  miniStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  typeChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  textarea: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 160, textAlignVertical: "top" },
  urgencyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  urgencyText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  issueRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 8, borderRadius: 8, marginTop: 4 },
  issueText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  issueSev: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, flexShrink: 0 },
  issueSevText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  taskRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 4 },
  prioDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  taskTitle: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
});
