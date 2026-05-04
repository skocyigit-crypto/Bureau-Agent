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

// ── Types ─────────────────────────────────────────────────────────────────────
type Periode = "semaine" | "mois" | "trimestre";
type Tab = "classement" | "individuel" | "ia";

interface EmpMetrics {
  tasksAssigned: number; tasksCompleted: number; tasksOverdue: number;
  tasksPrioriteHaute: number; completionRate: number; overduePenalty: number;
  punctualityScore: number; activityScore: number; engagementScore: number;
  heuresTravaillees: number; pausesMinutes: number; sessionCount: number;
  avgCheckinHour: number | null; actionsTotal: number; connexions: number;
  messagesEnvoyes: number; appelsTraites: number; contactsCrees: number;
}

interface Employee {
  id: number; name: string; email: string; role: string; department: string | null;
  qualityScore: number; efficiencyScore: number; overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F"; risk: "low" | "medium" | "high";
  metrics: EmpMetrics;
}

interface AiAnalysis {
  globalInsight?: string; teamHealth?: string;
  topPerformers?: { name: string; score: number; strengths: string[]; recognitionMessage: string }[];
  needsAttention?: { name: string; score: number; issues: string[]; rootCause: string; actionPlan: string[] }[];
  perEmployee?: { name: string; strengths: string[]; weaknesses: string[]; tip: string; riskFlag: string | null }[];
  teamRecommendations?: string[];
  workloadBalance?: string;
  qualityAlert?: string | null;
}

interface QualityData {
  teamScore: number; teamQuality: number; teamEfficiency: number;
  employees: Employee[]; analysis: AiAnalysis; periode: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function roleColor(role?: string): string {
  switch (role) {
    case "super_admin": return "#ef4444";
    case "administrateur": return "#f97316";
    case "manager": return "#8b5cf6";
    case "agent": return "#3b82f6";
    case "operateur": return "#22c55e";
    default: return "#6b7280";
  }
}

function gradeColor(g: string): string {
  return g === "A" ? "#22c55e" : g === "B" ? "#84cc16" : g === "C" ? "#f59e0b" : g === "D" ? "#f97316" : "#ef4444";
}

function riskColor(r: string): string {
  return r === "low" ? "#22c55e" : r === "medium" ? "#f59e0b" : "#ef4444";
}

function riskLabel(r: string): string {
  return r === "low" ? "Faible" : r === "medium" ? "Modéré" : "Élevé";
}

function scoreColor(s: number): string {
  return s >= 75 ? "#22c55e" : s >= 55 ? "#f59e0b" : "#ef4444";
}

function initials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function hourStr(h: number | null): string {
  if (h === null) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function healthColor(h?: string): string {
  if (!h) return "#64748b";
  return h === "excellent" ? "#22c55e" : h === "bon" ? "#84cc16" : h === "moyen" ? "#f59e0b" : "#ef4444";
}

// ── Radial Score Badge ─────────────────────────────────────────────────────────
function ScoreBadge({ score, size = 56, label }: { score: number; size?: number; label?: string }) {
  const col = scoreColor(score);
  return (
    <View style={{ alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: col + "40", backgroundColor: col + "10" }}>
      <Text style={{ fontSize: size * 0.28, fontFamily: "Inter_700Bold", color: col }}>{score}</Text>
      {label && <Text style={{ fontSize: 7, fontFamily: "Inter_400Regular", color: col, marginTop: -1 }}>{label}</Text>}
    </View>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ value, max = 100, color, height = 6 }: { value: number; max?: number; color: string; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ height, backgroundColor: color + "20", borderRadius: height / 2, overflow: "hidden" }}>
      <View style={{ height, width: `${pct}%` as any, backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

// ── Metric Row ────────────────────────────────────────────────────────────────
function MetricRow({ icon, label, value, color, sub }: { icon: keyof typeof Feather.glyphMap; label: string; value: string | number; color: string; sub?: string }) {
  const colors = useColors();
  return (
    <View style={pr.metricRow}>
      <View style={[pr.metricIcon, { backgroundColor: color + "15" }]}>
        <Feather name={icon} size={13} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[pr.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
        {sub && <Text style={[pr.metricSub, { color: colors.mutedForeground }]}>{sub}</Text>}
      </View>
      <Text style={[pr.metricValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ── CLASSEMENT TAB ─────────────────────────────────────────────────────────────
function ClassementTab({ data, onSelectEmployee }: { data: QualityData; onSelectEmployee: (e: Employee) => void }) {
  const colors = useColors();
  const { employees, teamScore, teamQuality, teamEfficiency } = data;

  const green = employees.filter(e => e.risk === "low").length;
  const orange = employees.filter(e => e.risk === "medium").length;
  const red = employees.filter(e => e.risk === "high").length;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      {/* Team overview strip */}
      <View style={[pr.teamCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[pr.sectionLabel, { color: colors.mutedForeground }]}>VUE D'ENSEMBLE ÉQUIPE</Text>
        <View style={pr.teamRow}>
          <ScoreBadge score={teamScore} size={64} label="global" />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={pr.teamMetaRow}>
              <View style={[pr.teamMetaItem, { backgroundColor: "#22c55e10" }]}>
                <Feather name="star" size={11} color="#22c55e" />
                <Text style={[pr.teamMetaVal, { color: "#22c55e" }]}>{teamQuality}</Text>
                <Text style={[pr.teamMetaLabel, { color: colors.mutedForeground }]}>Qualité</Text>
              </View>
              <View style={[pr.teamMetaItem, { backgroundColor: "#3b82f610" }]}>
                <Feather name="zap" size={11} color="#3b82f6" />
                <Text style={[pr.teamMetaVal, { color: "#3b82f6" }]}>{teamEfficiency}</Text>
                <Text style={[pr.teamMetaLabel, { color: colors.mutedForeground }]}>Efficacité</Text>
              </View>
            </View>
            <View style={pr.riskStrip}>
              <View style={[pr.riskDot, { backgroundColor: "#22c55e" }]} />
              <Text style={[pr.riskText, { color: colors.mutedForeground }]}>{green} performants</Text>
              <View style={[pr.riskDot, { backgroundColor: "#f59e0b" }]} />
              <Text style={[pr.riskText, { color: colors.mutedForeground }]}>{orange} à surveiller</Text>
              <View style={[pr.riskDot, { backgroundColor: "#ef4444" }]} />
              <Text style={[pr.riskText, { color: colors.mutedForeground }]}>{red} en risque</Text>
            </View>
          </View>
        </View>
        {data.analysis.qualityAlert && (
          <View style={[pr.alertBanner, { backgroundColor: "#ef444410", borderColor: "#ef444430" }]}>
            <Feather name="alert-triangle" size={12} color="#ef4444" />
            <Text style={[pr.alertText, { color: "#ef4444" }]}>{data.analysis.qualityAlert}</Text>
          </View>
        )}
      </View>

      <Text style={[pr.sectionLabel, { color: colors.mutedForeground }]}>CLASSEMENT INDIVIDUEL ({employees.length})</Text>

      {employees.map((emp, idx) => {
        const rc = roleColor(emp.role);
        const gc = gradeColor(emp.grade);
        const sc = scoreColor(emp.overallScore);
        return (
          <Pressable key={emp.id} onPress={() => onSelectEmployee(emp)}
            style={[pr.empCard, { backgroundColor: colors.card, borderColor: emp.risk === "high" ? "#ef444430" : colors.border }]}>
            {/* Rank badge */}
            <View style={[pr.rankBadge, { backgroundColor: idx < 3 ? ["#f59e0b20", "#94a3b820", "#cd7f3220"][idx] : colors.background }]}>
              <Text style={[pr.rankText, { color: idx < 3 ? ["#f59e0b", "#64748b", "#cd7f32"][idx] : colors.mutedForeground }]}>#{idx + 1}</Text>
            </View>

            <View style={[pr.avatar, { backgroundColor: rc + "20" }]}>
              <Text style={[pr.avatarText, { color: rc }]}>{initials(emp.name)}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <View style={pr.empNameRow}>
                <Text style={[pr.empName, { color: colors.foreground }]} numberOfLines={1}>{emp.name}</Text>
                <View style={[pr.gradeBadge, { backgroundColor: gc + "18" }]}>
                  <Text style={[pr.gradeText, { color: gc }]}>{emp.grade}</Text>
                </View>
              </View>
              <Text style={[pr.empRole, { color: colors.mutedForeground }]}>{emp.role}{emp.department ? ` · ${emp.department}` : ""}</Text>
              <View style={{ marginTop: 6, gap: 3 }}>
                <View style={pr.scoreBarRow}>
                  <Text style={[pr.scoreBarLabel, { color: colors.mutedForeground }]}>Qualité</Text>
                  <ProgressBar value={emp.qualityScore} color="#22c55e" height={5} />
                  <Text style={[pr.scoreBarVal, { color: "#22c55e" }]}>{emp.qualityScore}</Text>
                </View>
                <View style={pr.scoreBarRow}>
                  <Text style={[pr.scoreBarLabel, { color: colors.mutedForeground }]}>Efficacité</Text>
                  <ProgressBar value={emp.efficiencyScore} color="#3b82f6" height={5} />
                  <Text style={[pr.scoreBarVal, { color: "#3b82f6" }]}>{emp.efficiencyScore}</Text>
                </View>
              </View>
            </View>

            <View style={{ alignItems: "center", gap: 4 }}>
              <ScoreBadge score={emp.overallScore} size={44} />
              <View style={[pr.riskPill, { backgroundColor: riskColor(emp.risk) + "15" }]}>
                <View style={[pr.riskDot, { backgroundColor: riskColor(emp.risk) }]} />
                <Text style={[pr.riskPillText, { color: riskColor(emp.risk) }]}>{riskLabel(emp.risk)}</Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── INDIVIDUEL TAB ────────────────────────────────────────────────────────────
function IndividuelTab({ data, selected, onSelect }: { data: QualityData; selected: Employee | null; onSelect: (e: Employee) => void }) {
  const colors = useColors();
  const emp = selected ?? data.employees[0];
  if (!emp) return null;

  const m = emp.metrics;
  const aiEmp = data.analysis.perEmployee?.find(p => p.name === emp.name);
  const rc = roleColor(emp.role);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      {/* Employee picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {data.employees.map(e => (
          <Pressable key={e.id} onPress={() => onSelect(e)}
            style={[pr.pickerChip, { backgroundColor: emp.id === e.id ? scoreColor(e.overallScore) : colors.card, borderColor: emp.id === e.id ? scoreColor(e.overallScore) : colors.border }]}>
            <Text style={[pr.pickerChipText, { color: emp.id === e.id ? "#fff" : colors.foreground }]}>{e.name.split(" ")[0]}</Text>
            <View style={[pr.pickerScore, { backgroundColor: emp.id === e.id ? "rgba(255,255,255,0.25)" : scoreColor(e.overallScore) + "20" }]}>
              <Text style={[{ fontSize: 9, fontFamily: "Inter_700Bold", color: emp.id === e.id ? "#fff" : scoreColor(e.overallScore) }]}>{e.overallScore}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* Employee header card */}
      <View style={[pr.indHeaderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={[pr.avatarLg, { backgroundColor: rc + "20" }]}>
            <Text style={[pr.avatarLgText, { color: rc }]}>{initials(emp.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[pr.indName, { color: colors.foreground }]}>{emp.name}</Text>
            <Text style={[pr.indRole, { color: colors.mutedForeground }]}>{emp.role}{emp.department ? ` · ${emp.department}` : ""}</Text>
            <Text style={[pr.indEmail, { color: colors.mutedForeground }]}>{emp.email}</Text>
          </View>
          <View style={{ alignItems: "center", gap: 4 }}>
            <View style={[pr.gradeBadgeLg, { backgroundColor: gradeColor(emp.grade) + "18" }]}>
              <Text style={[pr.gradeLgText, { color: gradeColor(emp.grade) }]}>{emp.grade}</Text>
            </View>
            <Text style={[{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }]}>Grade</Text>
          </View>
        </View>

        {/* 3 score pills */}
        <View style={pr.scoreTriple}>
          <View style={[pr.scoreTripleItem, { backgroundColor: scoreColor(emp.overallScore) + "10" }]}>
            <Text style={[pr.scoreTripleVal, { color: scoreColor(emp.overallScore) }]}>{emp.overallScore}</Text>
            <Text style={[pr.scoreTripleLbl, { color: colors.mutedForeground }]}>Global</Text>
          </View>
          <View style={[pr.scoreTripleItem, { backgroundColor: "#22c55e10" }]}>
            <Text style={[pr.scoreTripleVal, { color: "#22c55e" }]}>{emp.qualityScore}</Text>
            <Text style={[pr.scoreTripleLbl, { color: colors.mutedForeground }]}>Qualité</Text>
          </View>
          <View style={[pr.scoreTripleItem, { backgroundColor: "#3b82f610" }]}>
            <Text style={[pr.scoreTripleVal, { color: "#3b82f6" }]}>{emp.efficiencyScore}</Text>
            <Text style={[pr.scoreTripleLbl, { color: colors.mutedForeground }]}>Efficacité</Text>
          </View>
        </View>

        {emp.risk === "high" && (
          <View style={[pr.alertBanner, { backgroundColor: "#ef444410", borderColor: "#ef444430" }]}>
            <Feather name="alert-circle" size={12} color="#ef4444" />
            <Text style={[pr.alertText, { color: "#ef4444" }]}>Profil à risque — intervention recommandée</Text>
          </View>
        )}
      </View>

      {/* Sub-scores breakdown */}
      <View style={[pr.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[pr.cardTitle, { color: colors.foreground }]}>Détail des scores composants</Text>
        {[
          { label: "Taux de complétion tâches", value: m.completionRate, color: "#22c55e", icon: "check-circle" as const },
          { label: "Score ponctualité", value: m.punctualityScore, color: "#6366f1", icon: "clock" as const },
          { label: "Score engagement", value: m.engagementScore, color: "#f59e0b", icon: "activity" as const },
          { label: "Score d'activité", value: m.activityScore, color: "#3b82f6", icon: "zap" as const },
        ].map(s => (
          <View key={s.label} style={{ gap: 4, marginTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name={s.icon} size={12} color={s.color} />
              <Text style={[{ fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, color: colors.foreground }]}>{s.label}</Text>
              <Text style={[{ fontSize: 12, fontFamily: "Inter_700Bold", color: s.color }]}>{s.value}/100</Text>
            </View>
            <ProgressBar value={s.value} color={s.color} height={7} />
          </View>
        ))}
      </View>

      {/* Tasks breakdown */}
      <View style={[pr.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[pr.cardTitle, { color: colors.foreground }]}>Gestion des tâches</Text>
        <View style={pr.metricsGrid}>
          {[
            { icon: "list" as const, label: "Assignées", value: m.tasksAssigned, color: "#64748b" },
            { icon: "check-circle" as const, label: "Terminées", value: m.tasksCompleted, color: "#22c55e" },
            { icon: "alert-circle" as const, label: "En retard", value: m.tasksOverdue, color: "#ef4444" },
            { icon: "star" as const, label: "Haute prio", value: m.tasksPrioriteHaute, color: "#f59e0b" },
          ].map(item => (
            <View key={item.label} style={[pr.miniStatCard, { backgroundColor: item.color + "08", borderColor: item.color + "20" }]}>
              <Feather name={item.icon} size={14} color={item.color} />
              <Text style={[pr.miniStatVal, { color: item.color }]}>{item.value}</Text>
              <Text style={[pr.miniStatLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
            </View>
          ))}
        </View>
        {m.tasksAssigned > 0 && (
          <View style={{ marginTop: 8, gap: 3 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={[{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground }]}>Taux de complétion</Text>
              <Text style={[{ fontSize: 11, fontFamily: "Inter_700Bold", color: scoreColor(m.completionRate) }]}>{m.completionRate}%</Text>
            </View>
            <ProgressBar value={m.completionRate} color={scoreColor(m.completionRate)} height={8} />
          </View>
        )}
      </View>

      {/* Présence et activité */}
      <View style={[pr.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[pr.cardTitle, { color: colors.foreground }]}>Présence et activité</Text>
        <MetricRow icon="clock" label="Heures travaillées" value={`${m.heuresTravaillees}h`} color="#6366f1" />
        <MetricRow icon="log-in" label="Sessions de présence" value={m.sessionCount} color="#3b82f6" />
        <MetricRow icon="sunrise" label="Heure d'arrivée moy." value={hourStr(m.avgCheckinHour)} color="#f59e0b"
          sub={m.avgCheckinHour !== null ? m.avgCheckinHour <= 9.25 ? "✓ Ponctuel" : "⚠ Arrivée tardive" : "Aucun pointage"} />
        <MetricRow icon="coffee" label="Pauses totales" value={`${m.pausesMinutes}min`} color="#94a3b8" />
        <MetricRow icon="refresh-cw" label="Connexions" value={m.connexions} color="#22c55e" />
        <MetricRow icon="bar-chart-2" label="Actions totales" value={m.actionsTotal} color="#8b5cf6" />
      </View>

      {/* Communication */}
      <View style={[pr.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[pr.cardTitle, { color: colors.foreground }]}>Communication & CRM</Text>
        <MetricRow icon="phone" label="Appels traités" value={m.appelsTraites} color="#f59e0b" />
        <MetricRow icon="message-square" label="Messages envoyés" value={m.messagesEnvoyes} color="#6366f1" />
        <MetricRow icon="user-plus" label="Contacts créés" value={m.contactsCrees} color="#22c55e" />
      </View>

      {/* AI tip for this employee */}
      {aiEmp && (
        <View style={[pr.sectionCard, { backgroundColor: "#6366f108", borderColor: "#6366f130" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <View style={[pr.aiIconBox, { backgroundColor: "#6366f118" }]}>
              <Feather name="zap" size={14} color="#6366f1" />
            </View>
            <Text style={[pr.cardTitle, { color: colors.foreground }]}>Analyse IA personnalisée</Text>
          </View>
          {aiEmp.strengths?.length > 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={[pr.aiSubtitle, { color: "#22c55e" }]}>Points forts</Text>
              {aiEmp.strengths.map((s, i) => (
                <View key={i} style={pr.aiListRow}>
                  <Feather name="check" size={11} color="#22c55e" />
                  <Text style={[pr.aiListText, { color: colors.foreground }]}>{s}</Text>
                </View>
              ))}
            </View>
          )}
          {aiEmp.weaknesses?.length > 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={[pr.aiSubtitle, { color: "#f59e0b" }]}>Axes d'amélioration</Text>
              {aiEmp.weaknesses.map((w, i) => (
                <View key={i} style={pr.aiListRow}>
                  <Feather name="arrow-up-right" size={11} color="#f59e0b" />
                  <Text style={[pr.aiListText, { color: colors.foreground }]}>{w}</Text>
                </View>
              ))}
            </View>
          )}
          {aiEmp.tip && (
            <View style={[pr.tipBox, { backgroundColor: "#6366f110" }]}>
              <Feather name="info" size={12} color="#6366f1" />
              <Text style={[pr.tipText, { color: colors.foreground }]}>{aiEmp.tip}</Text>
            </View>
          )}
          {aiEmp.riskFlag && (
            <View style={[pr.alertBanner, { backgroundColor: "#ef444410", borderColor: "#ef444430", marginTop: 6 }]}>
              <Feather name="flag" size={11} color="#ef4444" />
              <Text style={[pr.alertText, { color: "#ef4444" }]}>{aiEmp.riskFlag}</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

// ── IA ANALYSE TAB ────────────────────────────────────────────────────────────
function IAAnalyseTab({ analysis, employees }: { analysis: AiAnalysis; employees: Employee[] }) {
  const colors = useColors();

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      {/* Team health */}
      <View style={[pr.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <View style={[pr.aiIconBox, { backgroundColor: healthColor(analysis.teamHealth) + "18" }]}>
            <Feather name="heart" size={14} color={healthColor(analysis.teamHealth)} />
          </View>
          <Text style={[pr.cardTitle, { color: colors.foreground }]}>Santé globale de l'équipe</Text>
          {analysis.teamHealth && (
            <View style={[pr.healthPill, { backgroundColor: healthColor(analysis.teamHealth) + "18" }]}>
              <Text style={[pr.healthText, { color: healthColor(analysis.teamHealth) }]}>{analysis.teamHealth}</Text>
            </View>
          )}
        </View>
        {analysis.globalInsight && (
          <Text style={[pr.insightText, { color: colors.foreground }]}>{analysis.globalInsight}</Text>
        )}
        {analysis.workloadBalance && (
          <View style={[pr.tipBox, { backgroundColor: "#3b82f610", marginTop: 8 }]}>
            <Feather name="bar-chart" size={12} color="#3b82f6" />
            <Text style={[pr.tipText, { color: colors.foreground }]}>{analysis.workloadBalance}</Text>
          </View>
        )}
      </View>

      {/* Top performers */}
      {analysis.topPerformers && analysis.topPerformers.length > 0 && (
        <View style={[pr.sectionCard, { backgroundColor: "#22c55e08", borderColor: "#22c55e30" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Feather name="award" size={16} color="#22c55e" />
            <Text style={[pr.cardTitle, { color: colors.foreground }]}>Top Performers</Text>
          </View>
          {analysis.topPerformers.map((p, i) => {
            const emp = employees.find(e => e.name === p.name);
            const rc = emp ? roleColor(emp.role) : "#22c55e";
            return (
              <View key={i} style={[pr.performerCard, { backgroundColor: "#22c55e08", borderColor: "#22c55e20" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <View style={[pr.avatar, { backgroundColor: rc + "20" }]}>
                    <Text style={[pr.avatarText, { color: rc }]}>{initials(p.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[pr.performerName, { color: colors.foreground }]}>{p.name}</Text>
                    {p.score > 0 && <Text style={[pr.performerScore, { color: "#22c55e" }]}>{p.score}/100</Text>}
                  </View>
                  <Feather name="star" size={16} color="#f59e0b" />
                </View>
                {p.strengths?.map((s, j) => (
                  <View key={j} style={pr.aiListRow}>
                    <Feather name="check-circle" size={11} color="#22c55e" />
                    <Text style={[pr.aiListText, { color: colors.foreground }]}>{s}</Text>
                  </View>
                ))}
                {p.recognitionMessage && (
                  <View style={[pr.tipBox, { backgroundColor: "#22c55e10", marginTop: 6 }]}>
                    <Feather name="message-circle" size={11} color="#22c55e" />
                    <Text style={[pr.tipText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>"{p.recognitionMessage}"</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Needs attention */}
      {analysis.needsAttention && analysis.needsAttention.length > 0 && (
        <View style={[pr.sectionCard, { backgroundColor: "#f59e0b08", borderColor: "#f59e0b30" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Feather name="alert-triangle" size={16} color="#f59e0b" />
            <Text style={[pr.cardTitle, { color: colors.foreground }]}>Nécessite attention</Text>
          </View>
          {analysis.needsAttention.map((n, i) => {
            const emp = employees.find(e => e.name === n.name);
            const rc = emp ? roleColor(emp.role) : "#ef4444";
            return (
              <View key={i} style={[pr.performerCard, { backgroundColor: "#ef444408", borderColor: "#ef444420" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <View style={[pr.avatar, { backgroundColor: rc + "20" }]}>
                    <Text style={[pr.avatarText, { color: rc }]}>{initials(n.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[pr.performerName, { color: colors.foreground }]}>{n.name}</Text>
                    {n.score > 0 && <Text style={[pr.performerScore, { color: "#ef4444" }]}>Score: {n.score}/100</Text>}
                  </View>
                </View>
                {n.issues?.map((issue, j) => (
                  <View key={j} style={pr.aiListRow}>
                    <Feather name="x-circle" size={11} color="#ef4444" />
                    <Text style={[pr.aiListText, { color: colors.foreground }]}>{issue}</Text>
                  </View>
                ))}
                {n.rootCause && (
                  <View style={[pr.tipBox, { backgroundColor: "#f59e0b10", marginTop: 6 }]}>
                    <Feather name="search" size={11} color="#f59e0b" />
                    <Text style={[pr.tipText, { color: colors.foreground }]}>{n.rootCause}</Text>
                  </View>
                )}
                {n.actionPlan && n.actionPlan.length > 0 && (
                  <View style={{ marginTop: 6 }}>
                    <Text style={[pr.aiSubtitle, { color: "#3b82f6", marginBottom: 3 }]}>Plan d'action</Text>
                    {n.actionPlan.map((a, j) => (
                      <View key={j} style={pr.aiListRow}>
                        <Feather name="arrow-right" size={11} color="#3b82f6" />
                        <Text style={[pr.aiListText, { color: colors.foreground }]}>{a}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Team recommendations */}
      {analysis.teamRecommendations && analysis.teamRecommendations.length > 0 && (
        <View style={[pr.sectionCard, { backgroundColor: "#6366f108", borderColor: "#6366f130" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Feather name="target" size={16} color="#6366f1" />
            <Text style={[pr.cardTitle, { color: colors.foreground }]}>Recommandations stratégiques</Text>
          </View>
          {analysis.teamRecommendations.map((r, i) => (
            <View key={i} style={[pr.aiListRow, { marginTop: 4 }]}>
              <View style={[{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#6366f118", alignItems: "center", justifyContent: "center", flexShrink: 0 }]}>
                <Text style={[{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#6366f1" }]}>{i + 1}</Text>
              </View>
              <Text style={[pr.aiListText, { color: colors.foreground, lineHeight: 18 }]}>{r}</Text>
            </View>
          ))}
        </View>
      )}

      {analysis.qualityAlert && (
        <View style={[pr.sectionCard, { backgroundColor: "#ef444408", borderColor: "#ef444430" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="alert-octagon" size={16} color="#ef4444" />
            <Text style={[pr.cardTitle, { color: "#ef4444" }]}>Alerte qualité</Text>
          </View>
          <Text style={[pr.insightText, { color: colors.foreground, marginTop: 6 }]}>{analysis.qualityAlert}</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────
const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "classement", label: "Classement",  icon: "bar-chart-2",  color: "#0f4c81" },
  { key: "individuel", label: "Individuel",  icon: "user",         color: "#7c3aed" },
  { key: "ia",         label: "IA Analyse",  icon: "zap",          color: "#ea580c" },
];

const PERIODES: { val: Periode; label: string }[] = [
  { val: "semaine",   label: "7 jours"  },
  { val: "mois",      label: "30 jours" },
  { val: "trimestre", label: "90 jours" },
];

export default function PerformanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [tab, setTab] = useState<Tab>("classement");
  const [periode, setPeriode] = useState<Periode>("mois");
  const [data, setData] = useState<QualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  const load = useCallback(async (showAi = true) => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/employee-quality?periode=${periode}`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (d.employees?.length > 0 && !selectedEmployee) setSelectedEmployee(d.employees[0]);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, periode]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  function handleSelectEmployee(e: Employee) {
    setSelectedEmployee(e);
    setTab("individuel");
  }

  const activeTab = TABS.find(t => t.key === tab)!;

  return (
    <View style={[pr.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[pr.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={pr.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={pr.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={pr.headerTitle}>Qualité & Efficacité</Text>
            <Text style={pr.headerSub}>
              {data ? `${data.employees.length} employés · Score équipe: ${data.teamScore}/100` : "Analyse de performance IA"}
            </Text>
          </View>
          <Pressable onPress={onRefresh} hitSlop={10}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        {/* Période selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 6 }}>
          {PERIODES.map(p => (
            <Pressable key={p.val} onPress={() => setPeriode(p.val)}
              style={[pr.periodChip, { backgroundColor: periode === p.val ? "#fff" : "rgba(255,255,255,0.15)" }]}>
              <Text style={[pr.periodText, { color: periode === p.val ? "#0f4c81" : "rgba(255,255,255,0.85)" }]}>{p.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Team score strip */}
        {data && !loading && (
          <View style={pr.teamStrip}>
            {[
              { label: "Global", value: data.teamScore,      color: "#fff"     },
              { label: "Qualité", value: data.teamQuality,   color: "#86efac"  },
              { label: "Efficacité", value: data.teamEfficiency, color: "#93c5fd" },
              { label: "Équipe", value: data.employees.length, color: "#fde68a", isCount: true },
            ].map((item, i, arr) => (
              <React.Fragment key={item.label}>
                <View style={pr.stripItem}>
                  <Text style={[pr.stripVal, { color: item.color }]}>{item.isCount ? item.value : `${item.value}`}</Text>
                  <Text style={pr.stripLabel}>{item.label}</Text>
                </View>
                {i < arr.length - 1 && <View style={pr.stripDivider} />}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>
          {TABS.map(t => (
            <Pressable key={t.key} onPress={() => setTab(t.key)}
              style={[pr.tabChip, { backgroundColor: tab === t.key ? "#fff" : "rgba(255,255,255,0.15)" }]}>
              <Feather name={t.icon} size={12} color={tab === t.key ? t.color : "rgba(255,255,255,0.8)"} />
              <Text style={[pr.tabChipText, { color: tab === t.key ? t.color : "rgba(255,255,255,0.8)" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={pr.center}>
          <ActivityIndicator size="large" color="#0f4c81" />
          <Text style={[{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 10 }]}>Analyse en cours...</Text>
        </View>
      ) : !data || data.employees.length === 0 ? (
        <View style={pr.center}>
          <Feather name="users" size={48} color={colors.mutedForeground} />
          <Text style={[{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginTop: 12 }]}>Aucun employé trouvé</Text>
          <Text style={[{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 4, textAlign: "center" }]}>Ajoutez des membres d'équipe pour voir leur analyse</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[pr.body, { paddingBottom: isWeb ? 120 : 48 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={activeTab.color} />}
        >
          {tab === "classement"  && <ClassementTab data={data} onSelectEmployee={handleSelectEmployee} />}
          {tab === "individuel"  && <IndividuelTab data={data} selected={selectedEmployee} onSelect={setSelectedEmployee} />}
          {tab === "ia"          && <IAAnalyseTab  analysis={data.analysis} employees={data.employees} />}
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const pr = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#0f4c81", paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", marginTop: 1 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  periodText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  teamStrip: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingVertical: 8, alignItems: "center", marginTop: 10 },
  stripItem: { flex: 1, alignItems: "center" },
  stripVal: { fontSize: 17, fontFamily: "Inter_700Bold" },
  stripLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 1 },
  stripDivider: { width: 1, height: 26, backgroundColor: "rgba(255,255,255,0.2)" },
  tabChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  tabChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  body: { padding: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  // Team card
  teamCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  teamMetaRow: { flexDirection: "row", gap: 8 },
  teamMetaItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, padding: 8, borderRadius: 8 },
  teamMetaVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  teamMetaLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  riskStrip: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  riskDot: { width: 7, height: 7, borderRadius: 4 },
  riskText: { fontSize: 10, fontFamily: "Inter_400Regular", marginRight: 4 },
  alertBanner: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 8, borderRadius: 8, borderWidth: 1 },
  alertText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 17 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  // Employee card
  empCard: { borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rankText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  avatarLg: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarLgText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  empNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  empName: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  empRole: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  scoreBarRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  scoreBarLabel: { fontSize: 9, fontFamily: "Inter_400Regular", width: 44 },
  scoreBarVal: { fontSize: 10, fontFamily: "Inter_700Bold", width: 20, textAlign: "right" },
  gradeBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  gradeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  gradeBadgeLg: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  gradeLgText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  riskPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  riskPillText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  // Individuel
  pickerChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  pickerChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  pickerScore: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6 },
  indHeaderCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  indName: { fontSize: 17, fontFamily: "Inter_700Bold" },
  indRole: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  indEmail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  scoreTriple: { flexDirection: "row", gap: 8, marginTop: 12 },
  scoreTripleItem: { flex: 1, alignItems: "center", padding: 10, borderRadius: 10 },
  scoreTripleVal: { fontSize: 20, fontFamily: "Inter_700Bold" },
  scoreTripleLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  // Section cards
  sectionCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  miniStatCard: { minWidth: "22%", flex: 1, alignItems: "center", padding: 10, borderRadius: 10, borderWidth: 1, gap: 4 },
  miniStatVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  miniStatLabel: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.06)", marginTop: 4 },
  metricIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  metricLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  metricSub: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  metricValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  // AI
  aiIconBox: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  aiSubtitle: { fontSize: 11, fontFamily: "Inter_700Bold", marginBottom: 2 },
  aiListRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 3 },
  aiListText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  tipBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 8, borderRadius: 8 },
  tipText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 18 },
  insightText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  // Top/attention cards
  performerCard: { borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 6 },
  performerName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  performerScore: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  healthPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  healthText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
