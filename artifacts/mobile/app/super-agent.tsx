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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
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
  stats: AgentStats;
  recentLogs: AgentLog[];
}

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "apercu",   label: "Aperçu",    icon: "zap",          color: "#6366f1" },
  { key: "email",    label: "Email IA",  icon: "mail",         color: "#dc2626" },
  { key: "chantier", label: "Chantier",  icon: "tool",         color: "#f59e0b" },
  { key: "journal",  label: "Journal",   icon: "activity",     color: "#22c55e" },
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

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h}h`;
  return `Il y a ${Math.floor(h / 24)}j`;
}

// ─── APERÇU ──────────────────────────────────────────────────────────────────
function ApercuTab({ status, onRun, running }: { status: AgentStatus | null; onRun: () => void; running: boolean }) {
  const colors = useColors();

  const stats = status?.stats ?? { tasksCreated: 0, tasksFixed: 0, emailsProcessed: 0, reportsProcessed: 0, fixesApplied: 0, cyclesRun: 0 };

  const SOURCES = [
    { icon: "mail" as const,         color: "#dc2626", label: "Emails traités",         value: stats.emailsProcessed },
    { icon: "tool" as const,         color: "#f59e0b", label: "Rapports analysés",       value: stats.reportsProcessed },
    { icon: "check-square" as const, color: "#22c55e", label: "Tâches créées",           value: stats.tasksCreated },
    { icon: "trending-up" as const,  color: "#8b5cf6", label: "Tâches escaladées",       value: stats.tasksFixed },
    { icon: "link" as const,         color: "#3b82f6", label: "Liaisons appels auto",    value: stats.fixesApplied },
    { icon: "refresh-cw" as const,   color: "#6366f1", label: "Cycles exécutés",         value: stats.cyclesRun },
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
            <Text style={[sa.h2, { color: colors.foreground }]}>Super Agent IA</Text>
            <Text style={[sa.sub, { color: colors.mutedForeground }]}>
              {running ? "Analyse en cours — emails, chantiers, tâches..." : status?.lastRun ? `Dernier cycle: ${timeAgo(status.lastRun)}` : "Jamais exécuté"}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Pressable onPress={onRun} disabled={running} style={[sa.btn, { flex: 1, backgroundColor: running ? "#6366f160" : "#6366f1" }]}>
            {running ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="play" size={16} color="#fff" />}
            <Text style={sa.btnText}>{running ? "Agent actif..." : "Lancer un cycle complet"}</Text>
          </Pressable>
        </View>
      </View>

      {/* What the agent does */}
      <View style={[sa.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[sa.sectionLabel, { color: colors.mutedForeground }]}>CE QUE L'AGENT FAIT AUTOMATIQUEMENT</Text>
        {[
          { icon: "mail" as const,         color: "#dc2626", title: "Lecture des emails",          desc: "Analyse chaque email non lu de votre boîte Gmail et crée les tâches correspondantes." },
          { icon: "tool" as const,         color: "#f59e0b", title: "Suivi des chantiers",         desc: "Détecte les projets en retard et génère des tâches de relance automatiquement." },
          { icon: "check-square" as const, color: "#22c55e", title: "Escalade des tâches",         desc: "Les tâches en retard de plus de 3 jours sont automatiquement passées en priorité haute." },
          { icon: "phone" as const,        color: "#3b82f6", title: "Liaison des appels",          desc: "Associe automatiquement les appels sans contact en cherchant le numéro dans le CRM." },
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
      <Text style={[sa.sectionLabel, { color: colors.mutedForeground }]}>STATISTIQUES CUMULÉES</Text>
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
          <Text style={[sa.sectionLabel, { color: colors.mutedForeground }]}>DERNIÈRES ACTIONS</Text>
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
                <Text style={[sa.logTime, { color: colors.mutedForeground }]}>{timeAgo(log.timestamp)}</Text>
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
            <Text style={[sa.h2, { color: colors.foreground }]}>Agent Email IA</Text>
            <Text style={[sa.sub, { color: colors.mutedForeground }]}>Lit votre Gmail et crée les tâches automatiquement</Text>
          </View>
        </View>
        <Text style={[sa.bodyText, { color: colors.mutedForeground, marginTop: 8 }]}>
          L'agent analyse vos emails non lus (hors promotions et réseaux sociaux), détecte les actions requises et les transforme en tâches dans votre système.
        </Text>
        <Pressable onPress={onRun} disabled={running} style={[sa.btn, { backgroundColor: "#dc2626", opacity: running ? 0.6 : 1, marginTop: 10 }]}>
          {running ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="refresh-cw" size={14} color="#fff" />}
          <Text style={sa.btnText}>{running ? "Traitement en cours..." : "Analyser les emails maintenant"}</Text>
        </Pressable>
      </View>

      {emailLogs.length === 0 ? (
        <View style={[sa.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="inbox" size={32} color={colors.mutedForeground} />
          <Text style={[sa.emptyTitle, { color: colors.foreground }]}>Aucune analyse email</Text>
          <Text style={[sa.emptyText, { color: colors.mutedForeground }]}>Lancez un cycle pour analyser votre boîte Gmail</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={[sa.miniStat, { backgroundColor: "#22c55e10", flex: 1 }]}>
              <Feather name="check-square" size={14} color="#22c55e" />
              <Text style={[sa.miniStatVal, { color: "#22c55e" }]}>{taskLogs.length}</Text>
              <Text style={[sa.miniStatLabel, { color: colors.mutedForeground }]}>emails → tâches</Text>
            </View>
            <View style={[sa.miniStat, { backgroundColor: "#3b82f610", flex: 1 }]}>
              <Feather name="mail" size={14} color="#3b82f6" />
              <Text style={[sa.miniStatVal, { color: "#3b82f6" }]}>{emailLogs.length}</Text>
              <Text style={[sa.miniStatLabel, { color: colors.mutedForeground }]}>emails analysés</Text>
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
                <Text style={[sa.logTime, { color: colors.mutedForeground }]}>{timeAgo(log.timestamp)}</Text>
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
  const [report, setReport] = useState("");
  const [reportType, setReportType] = useState("chantier");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const TYPES = [
    { key: "chantier",  label: "Rapport chantier",    icon: "tool" as const,         color: "#f59e0b" },
    { key: "visite",    label: "Compte-rendu visite",  icon: "map-pin" as const,      color: "#3b82f6" },
    { key: "reunion",   label: "Compte-rendu réunion", icon: "users" as const,        color: "#8b5cf6" },
    { key: "email",     label: "Email copié-collé",    icon: "mail" as const,         color: "#dc2626" },
    { key: "note",      label: "Note libre",           icon: "file-text" as const,    color: "#22c55e" },
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
            <Text style={[sa.h2, { color: colors.foreground }]}>Traitement de rapport</Text>
            <Text style={[sa.sub, { color: colors.mutedForeground }]}>Collez n'importe quel rapport — l'IA extrait les actions</Text>
          </View>
        </View>

        {/* Type selector */}
        <Text style={[sa.fieldLabel, { color: colors.mutedForeground }]}>Type de document</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
          {TYPES.map(t => (
            <Pressable key={t.key} onPress={() => setReportType(t.key)} style={[sa.typeChip, { backgroundColor: reportType === t.key ? t.color : colors.background, borderColor: reportType === t.key ? t.color : colors.border }]}>
              <Feather name={t.icon} size={11} color={reportType === t.key ? "#fff" : colors.mutedForeground} />
              <Text style={[sa.typeChipText, { color: reportType === t.key ? "#fff" : colors.mutedForeground }]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Text area */}
        <Text style={[sa.fieldLabel, { color: colors.mutedForeground, marginTop: 10 }]}>Contenu du rapport</Text>
        <TextInput
          style={[sa.textarea, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          placeholder={`Collez ici votre ${TYPES.find(t => t.key === reportType)?.label.toLowerCase() ?? "rapport"}...\n\nExemple:\n• Travaux réalisés aujourd'hui : pose des cloisons RDC\n• Problème détecté : fuite au niveau du plafond bureau 2\n• À faire demain : contacter plombier, commander matériau ref AX-302\n• Réunion chantier vendredi 14h avec maître d'œuvre`}
          placeholderTextColor={colors.mutedForeground}
          value={report}
          onChangeText={setReport}
          multiline
          numberOfLines={10}
          textAlignVertical="top"
        />

        <Pressable onPress={process} disabled={loading || !report.trim()} style={[sa.btn, { backgroundColor: "#f59e0b", opacity: loading || !report.trim() ? 0.6 : 1, marginTop: 8 }]}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="zap" size={14} color="#fff" />}
          <Text style={sa.btnText}>{loading ? "Analyse IA en cours..." : "Analyser et créer les actions"}</Text>
        </Pressable>
      </View>

      {/* Result */}
      {result && (
        <View style={{ gap: 10 }}>
          <View style={[sa.card, { backgroundColor: "#22c55e08", borderColor: "#22c55e30" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="check-circle" size={16} color="#22c55e" />
              <Text style={[sa.h2, { color: colors.foreground }]}>Rapport traité</Text>
              {result.nextStepUrgency && (
                <View style={[sa.urgencyBadge, { backgroundColor: (URGENCY_COLORS[result.nextStepUrgency] ?? "#64748b") + "18" }]}>
                  <Text style={[sa.urgencyText, { color: URGENCY_COLORS[result.nextStepUrgency] ?? "#64748b" }]}>Urgence: {result.nextStepUrgency}</Text>
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
              <Text style={[sa.cardTitle, { color: "#ef4444", marginBottom: 6 }]}>⚠ Problèmes détectés ({result.issues.length})</Text>
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
                ✅ {result.createdTasks.length} tâche{result.createdTasks.length > 1 ? "s" : ""} créée{result.createdTasks.length > 1 ? "s" : ""}
              </Text>
              {result.createdTasks.map((t: any, i: number) => {
                const prioColors: Record<string, string> = { haute: "#ef4444", moyenne: "#f59e0b", basse: "#22c55e" };
                return (
                  <View key={i} style={sa.taskRow}>
                    <View style={[sa.prioDot, { backgroundColor: prioColors[t.priority] ?? "#64748b" }]} />
                    <Text style={[sa.taskTitle, { color: colors.foreground }]}>{t.title}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Created events */}
          {result.createdEvents?.length > 0 && (
            <View style={[sa.card, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
              <Text style={[sa.cardTitle, { color: colors.foreground, marginBottom: 6 }]}>
                📅 {result.createdEvents.length} RDV créé{result.createdEvents.length > 1 ? "s" : ""}
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
              <Text style={[sa.bodyText, { color: colors.mutedForeground }]}>Aucune action ni RDV détectés dans ce rapport.</Text>
            </View>
          )}

          <Pressable onPress={() => { setResult(null); setReport(""); }} style={[sa.btn, { backgroundColor: colors.muted }]}>
            <Feather name="plus" size={14} color={colors.mutedForeground} />
            <Text style={[sa.btnText, { color: colors.mutedForeground }]}>Analyser un autre rapport</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

// ─── JOURNAL ─────────────────────────────────────────────────────────────────
function JournalTab({ logs, refreshing, onRefresh }: { logs: AgentLog[]; refreshing: boolean; onRefresh: () => void }) {
  const colors = useColors();

  const FILTER_OPTIONS: { key: string; label: string }[] = [
    { key: "all", label: "Tout" },
    { key: "success", label: "Succès" },
    { key: "warning", label: "Alertes" },
    { key: "error", label: "Erreurs" },
    { key: "email", label: "Email" },
    { key: "chantier", label: "Chantier" },
    { key: "tache", label: "Tâches" },
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
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[sa.filterChip, { backgroundColor: filter === f.key ? "#6366f1" : colors.card, borderColor: filter === f.key ? "#6366f1" : colors.border }]}>
            <Text style={[sa.filterChipText, { color: filter === f.key ? "#fff" : colors.mutedForeground }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {filtered.length === 0 ? (
        <View style={[sa.emptyBox, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 8 }]}>
          <Feather name="activity" size={32} color={colors.mutedForeground} />
          <Text style={[sa.emptyTitle, { color: colors.foreground }]}>Aucun journal</Text>
          <Text style={[sa.emptyText, { color: colors.mutedForeground }]}>Lancez un cycle pour voir l'activité de l'agent</Text>
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
                <Text style={[sa.logTime, { color: "#94a3b8", marginTop: 2 }]}>{new Date(log.timestamp).toLocaleTimeString("fr-FR")} · {timeAgo(log.timestamp)}</Text>
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
  const [tab, setTab] = useState<Tab>("apercu");
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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

  function onRefresh() { setRefreshing(true); loadStatus(); }

  const logs = status?.recentLogs ?? [];
  const activeTab = TABS.find(t => t.key === tab)!;

  return (
    <View style={[sa.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[sa.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={sa.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={sa.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={sa.headerTitle}>Super Agent IA</Text>
            <Text style={sa.headerSub}>
              {running ? "⚡ Analyse autonome en cours..." : status?.lastRun ? `Dernier cycle: ${timeAgo(status.lastRun)}` : "Agent otonom — email · chantier · système"}
            </Text>
          </View>
          {running && <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />}
          {!running && (
            <Pressable onPress={runCycle} style={[sa.runBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Feather name="play" size={14} color="#fff" />
              <Text style={sa.runBtnText}>Lancer</Text>
            </Pressable>
          )}
        </View>

        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
          {TABS.map(t => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[sa.tabChip, { backgroundColor: tab === t.key ? t.color : "rgba(255,255,255,0.12)" }]}>
              <Feather name={t.icon} size={12} color={tab === t.key ? "#fff" : "rgba(255,255,255,0.7)"} />
              <Text style={[sa.tabChipText, { color: tab === t.key ? "#fff" : "rgba(255,255,255,0.7)" }]}>{t.label}</Text>
              {t.key === "email" && logs.filter(l => l.source === "email" && l.level === "success").length > 0 && (
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
        {tab === "apercu"   && <ApercuTab  status={status}   onRun={runCycle} running={running} />}
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
