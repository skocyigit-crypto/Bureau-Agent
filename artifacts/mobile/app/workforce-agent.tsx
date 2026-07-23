/**
 * workforce-agent.tsx — Otonom AI Ekip Ajanı Paneli
 *
 * 4-aşamalı ajan döngüsünü görselleştirir:
 *   SCOUT → DIAGNOSE → PRESCRIBE → FORECAST
 *
 * Geçmiş raporlar, trend grafiği ve canlı ajan logu gösterir.
 * Admin-only. Her 15 dakikada bir otomatik yenilenir.
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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

// ── Tipler ────────────────────────────────────────────────────────────────────

interface ScoutResult {
  kritik_sinyaller: string[];
  risk_seviyesi: "kirmizi" | "sari" | "yesil";
  acil_mudahale: string[];
  guclu_yonler: string[];
  ekip_enerjisi: string;
  skor_tahmini: number;
}

interface EmployeeRecord {
  id: number;
  nom: string;
  role: string;
  departement: string | null;
  score: number;
  calls7d: number;
  callsAnswered7d: number;
  callsMissed7d: number;
  tasksCompleted7d: number;
  tasksOverdue: number;
  notes7d: number;
  logins7d: number;
  isActiveToday: boolean;
  daysSinceLastAccess: number;
}

interface DiagnoseResult {
  bireysel_teshis: {
    nom: string;
    durum: "kritik" | "dikkat" | "normal" | "mukemmel";
    guc: string;
    zayiflik: string;
    kok_neden: string;
  }[];
  ekip_dinamikleri: string;
  darbogazlar: string[];
}

interface PrescribeResult {
  acil_aksiyonlar: { aksiyon: string; hedef?: string; sure: string; etki: "yuksek" | "orta" | "dusuk" }[];
  haftalik_plan: string[];
  bireysel_gorusme: string[];
  surec_iyilestirme: string[];
}

interface ForecastResult {
  haftalik_tahmin: string;
  trend: "yukselis" | "stabil" | "dusus";
  risk_faktoru: string;
  firsat: string;
  gecmis_karsilastirma: string;
  oneri_skoru: number;
}

interface PhaseLog {
  phase: string;
  label: string;
  durationMs: number;
  result: unknown;
}

interface AgentResponse {
  agentName: string;
  managerName: string;
  date: string;
  teamScore: number;
  employeeCount: number;
  phases: {
    scout: ScoutResult | null;
    diagnose: DiagnoseResult | null;
    prescribe: PrescribeResult | null;
    forecast: ForecastResult | null;
  };
  agentLog: PhaseLog[];
  employees: EmployeeRecord[];
  generatedAt: string;
}

interface HistoryReport {
  id: number;
  reportDate: string;
  score: number;
  summary: string;
  errorsFound: number;
  warningsFound: number;
  suggestionsCount: number;
  executionTimeMs: number;
  createdAt: string;
}

// ── Sabitler ──────────────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 15 * 60 * 1000;

const RISK_CONFIG = {
  kirmizi: { bg: ["#7c2d12", "#9a3412"] as [string, string], label: "RISQUE CRITIQUE", icon: "alert-octagon" as const, color: "#ef4444" },
  sari: { bg: ["#78350f", "#92400e"] as [string, string], label: "RISQUE MODERE", icon: "alert-triangle" as const, color: "#f59e0b" },
  yesil: { bg: ["#065f46", "#0f766e"] as [string, string], label: "EQUIPE EN BONNE SANTE", icon: "check-circle" as const, color: "#22c55e" },
};

const DURUM_CONFIG = {
  kritik: { color: "#ef4444", bg: "#fef2f2", border: "#fca5a5", label: "Critique", icon: "alert-circle" as const },
  dikkat: { color: "#f59e0b", bg: "#fefce8", border: "#fde047", label: "Attention", icon: "alert-triangle" as const },
  normal: { color: "#3b82f6", bg: "#eff6ff", border: "#93c5fd", label: "Normal", icon: "check" as const },
  mukemmel: { color: "#22c55e", bg: "#f0fdf4", border: "#86efac", label: "Excellent", icon: "star" as const },
};

const ETKI_COLORS = { yuksek: "#ef4444", orta: "#f59e0b", dusuk: "#22c55e" };
const TREND_CONFIG = {
  yukselis: { icon: "trending-up" as const, color: "#22c55e", label: "En hausse" },
  stabil: { icon: "minus" as const, color: "#f59e0b", label: "Stable" },
  dusus: { icon: "trending-down" as const, color: "#ef4444", label: "En baisse" },
};

const PHASES_ORDERED = [
  { key: "SCOUT", label: "Reconnaissance", icon: "search" as const, color: "#8b5cf6" },
  { key: "DIAGNOSE", label: "Diagnostic", icon: "activity" as const, color: "#3b82f6" },
  { key: "PRESCRIBE", label: "Plan d'action", icon: "zap" as const, color: "#f59e0b" },
  { key: "FORECAST", label: "Prevision", icon: "eye" as const, color: "#22c55e" },
];

// ── Bileşenler ────────────────────────────────────────────────────────────────

function PhaseStatusRow({ phase, completed, durationMs, colors }: {
  phase: typeof PHASES_ORDERED[0];
  completed: boolean;
  durationMs?: number;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.phaseRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.phaseIcon, { backgroundColor: completed ? phase.color + "22" : colors.muted + "30" }]}>
        {completed
          ? <Feather name={phase.icon} size={14} color={phase.color} />
          : <View style={[styles.phaseDot, { backgroundColor: colors.mutedForeground + "40" }]} />
        }
      </View>
      <Text style={[styles.phaseLabel, { color: completed ? colors.foreground : colors.mutedForeground }]}>{phase.label}</Text>
      {completed && durationMs && (
        <Text style={[styles.phaseDuration, { color: colors.mutedForeground }]}>{(durationMs / 1000).toFixed(1)}s</Text>
      )}
      {completed && <Feather name="check" size={12} color="#22c55e" />}
    </View>
  );
}

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <View style={styles.scoreBarTrack}>
      <View style={[styles.scoreBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function EmployeeRow({ emp, colors }: { emp: EmployeeRecord; colors: ReturnType<typeof useColors> }) {
  const sc = emp.score;
  const color = sc >= 75 ? "#22c55e" : sc >= 50 ? "#f59e0b" : "#ef4444";
  const initials = emp.nom.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <View style={[styles.empRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.empAvatar, { backgroundColor: color + "18" }]}>
        <Text style={[styles.empInitials, { color }]}>{initials}</Text>
        {emp.isActiveToday && <View style={styles.empActiveDot} />}
      </View>
      <View style={styles.empInfo}>
        <Text style={[styles.empName, { color: colors.foreground }]}>{emp.nom}</Text>
        <ScoreBar value={sc} color={color} />
      </View>
      <Text style={[styles.empScore, { color }]}>{sc}</Text>
    </View>
  );
}

// ── Ekran ─────────────────────────────────────────────────────────────────────

export default function WorkforceAgentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";
  const isAdmin = user?.role === "administrateur" || user?.role === "super_admin";

  const [data, setData] = useState<AgentResponse | null>(null);
  const [history, setHistory] = useState<HistoryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_MS / 1000);
  const [activeTab, setActiveTab] = useState<"rapport" | "equipe" | "historique">("rapport");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulse animasyonu — yükleme sırasında
  useEffect(() => {
    if (loading) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, useNativeDriver: Platform.OS !== "web" }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== "web" }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [loading, pulseAnim]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/workforce-agent/history`);
      if (res.ok) {
        const json = await res.json();
        setHistory(json.reports ?? []);
      }
    } catch {}
  }, [fetchAuth]);

  const load = useCallback(async (silent = false) => {
    if (!isAdmin) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [agentRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/workforce-agent`),
      ]);
      if (agentRes.status === 403) { setError("Acces reserve aux administrateurs."); return; }
      if (!agentRes.ok) throw new Error("Erreur serveur");
      const json: AgentResponse = await agentRes.json();
      setData(json);
      await loadHistory();
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: Platform.OS !== "web" }).start();
    } catch {
      setError("Analyse impossible. Verifiez la connexion.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, isAdmin, fadeAnim, loadHistory]);

  const scheduleAuto = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setCountdown(AUTO_REFRESH_MS / 1000);
    countdownTimer.current = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    refreshTimer.current = setTimeout(() => { load(true); scheduleAuto(); }, AUTO_REFRESH_MS);
  }, [load]);

  useEffect(() => {
    load();
    scheduleAuto();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [load, scheduleAuto]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    scheduleAuto();
    load(false);
  }, [load, scheduleAuto]);

  const mm = String(Math.floor(countdown / 60)).padStart(2, "0");
  const ss = String(countdown % 60).padStart(2, "0");
  const countdownStr = `${mm}:${ss}`;

  const topBar = (
    <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color="#ffffff" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Agent IA Equipe</Text>
          <View style={styles.agentBadge}>
            <View style={styles.agentDot} />
            <Text style={styles.agentBadgeText}>ACTIF</Text>
          </View>
        </View>
        <Pressable onPress={onRefresh} hitSlop={12}>
          {refreshing ? <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" /> : <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />}
        </Pressable>
      </View>
      <View style={styles.headerMeta}>
        <View style={styles.autoRefreshRow}>
          <Feather name="zap" size={10} color="#f59e0b" />
          <Text style={styles.autoRefreshText}>Prochaine analyse: {countdownStr}</Text>
        </View>
      </View>
    </View>
  );

  // Access denied
  if (!isAdmin) return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {topBar}
      <View style={styles.center}>
        <Feather name="lock" size={48} color={colors.mutedForeground} />
        <Text style={[styles.centerTitle, { color: colors.foreground }]}>Acces reserve aux administrateurs</Text>
      </View>
    </View>
  );

  // Loading — 4 phase animation
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {topBar}
        <View style={styles.center}>
          <Animated.View style={{ opacity: pulseAnim }}>
            <LinearGradient colors={["#4f46e5", "#7c3aed"]} style={styles.agentOrb}>
              <Feather name="cpu" size={32} color="#ffffff" />
            </LinearGradient>
          </Animated.View>
          <Text style={[styles.centerTitle, { color: colors.foreground }]}>Agent IA en cours d'analyse...</Text>
          <Text style={[styles.centerSub, { color: colors.mutedForeground }]}>4 phases de raisonnement Gemini</Text>
          <View style={styles.phaseList}>
            {PHASES_ORDERED.map((p, i) => (
              <View key={p.key} style={styles.loadingPhaseRow}>
                <Animated.View style={[styles.loadingPhaseIcon, { backgroundColor: p.color + "22", opacity: pulseAnim }]}>
                  <Feather name={p.icon} size={13} color={p.color} />
                </Animated.View>
                <Text style={[styles.loadingPhaseLabel, { color: colors.mutedForeground }]}>{p.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  // Error
  if (error || !data) return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {topBar}
      <View style={styles.center}>
        <Feather name="alert-circle" size={40} color={colors.destructive} />
        <Text style={[styles.centerTitle, { color: colors.foreground }]}>{error ?? "Erreur inconnue"}</Text>
        <Pressable style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => load()}>
          <Text style={[styles.retryText, { color: colors.secondary }]}>Relancer l'agent</Text>
        </Pressable>
      </View>
    </View>
  );

  const { phases, agentLog, employees, teamScore, employeeCount, managerName, date } = data;
  const risk = phases.scout?.risk_seviyesi ?? "sari";
  // Repli si le backend renvoie une valeur inattendue: `?? "sari"` ne couvre
  // que null/undefined, une autre chaine donnerait riskCfg = undefined et
  // riskCfg.bg planterait TOUT l'ecran (crash RN, pas juste un panneau vide).
  // Les autres lookups du fichier utilisent deja ce repli.
  const riskCfg = RISK_CONFIG[risk] ?? RISK_CONFIG.sari;
  const totalAgentTime = agentLog.reduce((s, l) => s + l.durationMs, 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {topBar}

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {([
          { key: "rapport", label: "Rapport IA", icon: "cpu" as const },
          { key: "equipe", label: "Equipe", icon: "users" as const },
          { key: "historique", label: "Historique", icon: "clock" as const },
        ] as const).map((tab) => (
          <Pressable key={tab.key} style={[styles.tab, activeTab === tab.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} onPress={() => setActiveTab(tab.key)}>
            <Feather name={tab.icon} size={14} color={activeTab === tab.key ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.tabLabel, { color: activeTab === tab.key ? colors.primary : colors.mutedForeground }]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: isWeb ? 120 : 48 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Animated.View style={{ opacity: fadeAnim }}>

          {/* ── TAB: RAPPORT ── */}
          {activeTab === "rapport" && (
            <>
              {/* Hero banner */}
              <LinearGradient colors={riskCfg.bg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
                <View style={styles.heroTop}>
                  <View style={styles.heroLeft}>
                    <View style={styles.heroRiskBadge}>
                      <Feather name={riskCfg.icon} size={12} color={riskCfg.color} />
                      <Text style={[styles.heroRiskText, { color: riskCfg.color }]}>{riskCfg.label}</Text>
                    </View>
                    <Text style={styles.heroTitle}>Rapport Agent IA</Text>
                    <Text style={styles.heroDate}>{date}</Text>
                  </View>
                  <View style={styles.heroScoreWrap}>
                    <Text style={styles.heroScoreNum}>{teamScore}</Text>
                    <Text style={styles.heroScoreUnit}>/100</Text>
                    <Text style={styles.heroScoreLabel}>score equipe</Text>
                  </View>
                </View>
                {phases.scout?.ekip_enerjisi && (
                  <Text style={styles.heroEnergy}>{phases.scout.ekip_enerjisi}</Text>
                )}
                <View style={styles.heroFooter}>
                  <Feather name="cpu" size={11} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.heroFooterText}>{employeeCount} collaborateurs · {(totalAgentTime / 1000).toFixed(1)}s d'analyse · 4 phases Gemini</Text>
                </View>
              </LinearGradient>

              {/* Phase log — ajanın adımları */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Feather name="terminal" size={15} color="#8b5cf6" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Journal de l'agent IA</Text>
                  <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>{(totalAgentTime / 1000).toFixed(1)}s total</Text>
                </View>
                {PHASES_ORDERED.map((phase) => {
                  const log = agentLog.find((l) => l.phase === phase.key);
                  return <PhaseStatusRow key={phase.key} phase={phase} completed={!!log} durationMs={log?.durationMs} colors={colors} />;
                })}
              </View>

              {/* SCOUT — Signaux */}
              {phases.scout && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Feather name="search" size={15} color="#8b5cf6" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phase 1 — Signaux detectes</Text>
                  </View>
                  {phases.scout.kritik_sinyaller?.map((s, i) => (
                    <View key={i} style={[styles.signalRow, { borderBottomColor: colors.border }]}>
                      <View style={[styles.signalDot, { backgroundColor: "#8b5cf6" }]} />
                      <Text style={[styles.signalText, { color: colors.foreground }]}>{s}</Text>
                    </View>
                  ))}
                  {phases.scout.guclu_yonler?.map((g, i) => (
                    <View key={i} style={[styles.signalRow, { borderBottomColor: colors.border }]}>
                      <View style={[styles.signalDot, { backgroundColor: "#22c55e" }]} />
                      <Text style={[styles.signalText, { color: colors.foreground }]}>{g}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* DIAGNOSE — Dynamiques */}
              {phases.diagnose && (
                <>
                  {phases.diagnose.ekip_dinamikleri && (
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.cardHeader}>
                        <Feather name="activity" size={15} color="#3b82f6" />
                        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phase 2 — Dynamique equipe</Text>
                      </View>
                      <Text style={[styles.cardBodyText, { color: colors.foreground }]}>{phases.diagnose.ekip_dinamikleri}</Text>
                      {phases.diagnose.darbogazlar?.length > 0 && (
                        <View style={[styles.bottleneckWrap, { borderTopColor: colors.border }]}>
                          <Text style={[styles.bottleneckTitle, { color: colors.mutedForeground }]}>GOULOTS D'ETRANGLEMENT</Text>
                          {phases.diagnose.darbogazlar.map((d, i) => (
                            <View key={i} style={styles.bottleneckRow}>
                              <Feather name="arrow-right" size={12} color="#ef4444" />
                              <Text style={[styles.bottleneckText, { color: colors.foreground }]}>{d}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {/* Diagnoses individuels */}
                  {phases.diagnose.bireysel_teshis && phases.diagnose.bireysel_teshis.length > 0 && (
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.cardHeader}>
                        <Feather name="users" size={15} color="#3b82f6" />
                        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Diagnostic individuel</Text>
                      </View>
                      {phases.diagnose.bireysel_teshis.map((t, i) => {
                        const cfg = DURUM_CONFIG[t.durum] ?? DURUM_CONFIG.normal;
                        return (
                          <View key={i} style={[styles.diagRow, { borderBottomColor: colors.border, borderBottomWidth: i < phases.diagnose!.bireysel_teshis.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                            <View style={[styles.diagStatus, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                              <Feather name={cfg.icon} size={11} color={cfg.color} />
                              <Text style={[styles.diagStatusText, { color: cfg.color }]}>{cfg.label}</Text>
                            </View>
                            <Text style={[styles.diagName, { color: colors.foreground }]}>{t.nom}</Text>
                            <Text style={[styles.diagDetail, { color: "#22c55e" }]}>{t.guc}</Text>
                            {t.durum !== "mukemmel" && t.durum !== "normal" && (
                              <Text style={[styles.diagDetail, { color: "#ef4444" }]}>{t.zayiflik}</Text>
                            )}
                            {t.kok_neden && t.durum !== "mukemmel" && (
                              <Text style={[styles.diagKok, { color: colors.mutedForeground }]}>Cause: {t.kok_neden}</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              )}

              {/* PRESCRIBE — Actions */}
              {phases.prescribe && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Feather name="zap" size={15} color="#f59e0b" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phase 3 — Plan d'action</Text>
                  </View>
                  {phases.prescribe.acil_aksiyonlar?.map((a, i) => (
                    <View key={i} style={[styles.actionRow, { borderBottomColor: colors.border, borderBottomWidth: i < (phases.prescribe!.acil_aksiyonlar?.length ?? 0) - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                      <View style={[styles.actionEtki, { backgroundColor: ETKI_COLORS[a.etki] + "20", borderColor: ETKI_COLORS[a.etki] + "60" }]}>
                        <Text style={[styles.actionEtkiText, { color: ETKI_COLORS[a.etki] }]}>{a.etki === "yuksek" ? "URGENT" : a.etki === "orta" ? "MOYEN" : "FAIBLE"}</Text>
                      </View>
                      <View style={styles.actionContent}>
                        <Text style={[styles.actionText, { color: colors.foreground }]}>{a.aksiyon}</Text>
                        <View style={styles.actionMeta}>
                          {a.hedef && <Text style={[styles.actionMini, { color: colors.primary }]}>{a.hedef}</Text>}
                          <Text style={[styles.actionMini, { color: colors.mutedForeground }]}>{a.sure}</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                  {phases.prescribe.bireysel_gorusme?.length > 0 && (
                    <View style={[styles.meetingSection, { borderTopColor: colors.border }]}>
                      <Text style={[styles.meetingTitle, { color: colors.mutedForeground }]}>ENTRETIENS INDIVIDUELS RECOMMANDES</Text>
                      {phases.prescribe.bireysel_gorusme.map((g, i) => (
                        <View key={i} style={styles.meetingRow}>
                          <Feather name="user" size={12} color="#8b5cf6" />
                          <Text style={[styles.meetingText, { color: colors.foreground }]}>{g}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* FORECAST */}
              {phases.forecast && (
                <View style={[styles.forecastCard, { borderColor: colors.primary + "44" }]}>
                  <LinearGradient colors={["rgba(99,102,241,0.1)", "rgba(99,102,241,0.02)"]} style={styles.forecastGradient}>
                    <View style={styles.cardHeader}>
                      <Feather name="eye" size={15} color="#6366f1" />
                      <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phase 4 — Prevision & Apprentissage</Text>
                    </View>
                    <View style={styles.forecastTrendRow}>
                      {(() => {
                        const tc = TREND_CONFIG[phases.forecast!.trend] ?? TREND_CONFIG.stabil;
                        return (
                          <>
                            <Feather name={tc.icon} size={18} color={tc.color} />
                            <Text style={[styles.forecastTrendLabel, { color: tc.color }]}>{tc.label}</Text>
                            <Text style={[styles.forecastConfidence, { color: colors.mutedForeground }]}>Confiance: {phases.forecast!.oneri_skoru}%</Text>
                          </>
                        );
                      })()}
                    </View>
                    <Text style={[styles.forecastText, { color: colors.foreground }]}>{phases.forecast.haftalik_tahmin}</Text>
                    <View style={[styles.forecastRow, { backgroundColor: colors.background + "aa" }]}>
                      <Feather name="alert-triangle" size={12} color="#ef4444" />
                      <Text style={[styles.forecastMini, { color: colors.foreground }]}>{phases.forecast.risk_faktoru}</Text>
                    </View>
                    <View style={[styles.forecastRow, { backgroundColor: colors.background + "aa" }]}>
                      <Feather name="star" size={12} color="#f59e0b" />
                      <Text style={[styles.forecastMini, { color: colors.foreground }]}>{phases.forecast.firsat}</Text>
                    </View>
                    {phases.forecast.gecmis_karsilastirma && (
                      <Text style={[styles.forecastHistory, { color: colors.mutedForeground }]}>{phases.forecast.gecmis_karsilastirma}</Text>
                    )}
                  </LinearGradient>
                </View>
              )}
            </>
          )}

          {/* ── TAB: EQUIPE ── */}
          {activeTab === "equipe" && (
            <>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Feather name="users" size={15} color={colors.primary} />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Tous les collaborateurs ({employeeCount})</Text>
                </View>
                {[...employees].sort((a, b) => b.score - a.score).map((emp, i) => (
                  <EmployeeRow key={emp.id} emp={emp} colors={colors} />
                ))}
              </View>

              {/* Diagnoses rapides */}
              {phases.diagnose?.bireysel_teshis?.map((t, i) => {
                const cfg = DURUM_CONFIG[t.durum] ?? DURUM_CONFIG.normal;
                return (
                  <View key={i} style={[styles.diagCard, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                    <View style={styles.diagCardHeader}>
                      <Feather name={cfg.icon} size={14} color={cfg.color} />
                      <Text style={[styles.diagCardName, { color: cfg.color }]}>{t.nom}</Text>
                      <View style={[styles.diagCardBadge, { backgroundColor: cfg.color + "20" }]}>
                        <Text style={[styles.diagCardBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                      </View>
                    </View>
                    <Text style={[styles.diagCardGuc, { color: cfg.color }]}>{t.guc}</Text>
                    {t.durum !== "mukemmel" && <Text style={[styles.diagCardZayif, { color: colors.mutedForeground }]}>{t.zayiflik}</Text>}
                  </View>
                );
              })}
            </>
          )}

          {/* ── TAB: HISTORIQUE ── */}
          {activeTab === "historique" && (
            <>
              {history.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="clock" size={32} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucun historique disponible.</Text>
                  <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Ce rapport sera sauvegarde apres chaque analyse.</Text>
                </View>
              ) : (
                history.map((r, i) => {
                  const sc = r.score;
                  const color = sc >= 70 ? "#22c55e" : sc >= 45 ? "#f59e0b" : "#ef4444";
                  return (
                    <View key={r.id} style={[styles.histCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.histHeader}>
                        <View style={[styles.histScoreBadge, { backgroundColor: color + "18" }]}>
                          <Text style={[styles.histScore, { color }]}>{sc}</Text>
                        </View>
                        <View style={styles.histInfo}>
                          <Text style={[styles.histDate, { color: colors.foreground }]}>{r.reportDate}</Text>
                          <Text style={[styles.histTime, { color: colors.mutedForeground }]}>
                            {new Date(r.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {(r.executionTimeMs / 1000).toFixed(1)}s
                          </Text>
                        </View>
                      </View>
                      <View style={styles.histStats}>
                        <View style={styles.histStat}>
                          <Feather name="alert-circle" size={11} color="#ef4444" />
                          <Text style={[styles.histStatText, { color: colors.mutedForeground }]}>{r.errorsFound} critique(s)</Text>
                        </View>
                        <View style={styles.histStat}>
                          <Feather name="alert-triangle" size={11} color="#f59e0b" />
                          <Text style={[styles.histStatText, { color: colors.mutedForeground }]}>{r.warningsFound} attention</Text>
                        </View>
                        <View style={styles.histStat}>
                          <Feather name="zap" size={11} color="#22c55e" />
                          <Text style={[styles.histStatText, { color: colors.mutedForeground }]}>{r.suggestionsCount} actions</Text>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </>
          )}

          {/* Footer */}
          <View style={styles.footerRow}>
            <Feather name="cpu" size={11} color={colors.mutedForeground} />
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Gemini AI · {new Date(data.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · Auto-analyse {countdownStr}
            </Text>
          </View>

        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ── Stiller ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, gap: 12 },

  // Header
  header: { paddingHorizontal: 20, paddingBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerCenter: { alignItems: "center", gap: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  agentBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(34,197,94,0.2)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  agentDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },
  agentBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#22c55e", letterSpacing: 1 },
  headerMeta: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  autoRefreshRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  autoRefreshText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#f59e0b" },

  // Tab
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10 },
  tabLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  centerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  centerSub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Loading
  agentOrb: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  phaseList: { gap: 8, marginTop: 8, alignSelf: "stretch" },
  loadingPhaseRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  loadingPhaseIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  loadingPhaseLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // Hero
  hero: { borderRadius: 16, padding: 20, gap: 12 },
  heroTop: { flexDirection: "row", justifyContent: "space-between" },
  heroLeft: { flex: 1, gap: 6 },
  heroRiskBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.3)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  heroRiskText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  heroTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  heroDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  heroScoreWrap: { alignItems: "center", justifyContent: "center" },
  heroScoreNum: { fontSize: 42, fontFamily: "Inter_700Bold", color: "#ffffff" },
  heroScoreUnit: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: -6 },
  heroScoreLabel: { fontSize: 9, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)", letterSpacing: 0.5 },
  heroEnergy: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", lineHeight: 20 },
  heroFooter: { flexDirection: "row", alignItems: "center", gap: 5 },
  heroFooterText: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)" },

  // Card
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  cardTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  cardBodyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 21, paddingHorizontal: 16, paddingBottom: 14 },

  // Phase rows
  phaseRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  phaseIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  phaseDot: { width: 6, height: 6, borderRadius: 3 },
  phaseLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  phaseDuration: { fontSize: 11, fontFamily: "Inter_400Regular", marginRight: 4 },

  // Signals
  signalRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  signalDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 4 },
  signalText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },

  // Bottleneck
  bottleneckWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  bottleneckTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, marginBottom: 6 },
  bottleneckRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingVertical: 4 },
  bottleneckText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },

  // Diagnose rows
  diagRow: { paddingHorizontal: 16, paddingVertical: 12 },
  diagStatus: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, marginBottom: 5 },
  diagStatusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  diagName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  diagDetail: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  diagKok: { fontSize: 11, fontFamily: "Inter_400Regular", fontStyle: "italic", marginTop: 2 },

  // Actions
  actionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  actionEtki: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, alignSelf: "flex-start", marginTop: 2 },
  actionEtkiText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  actionContent: { flex: 1 },
  actionText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19 },
  actionMeta: { flexDirection: "row", gap: 8, marginTop: 3 },
  actionMini: { fontSize: 11, fontFamily: "Inter_400Regular" },
  meetingSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  meetingTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, marginBottom: 6 },
  meetingRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingVertical: 4 },
  meetingText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },

  // Forecast
  forecastCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  forecastGradient: { padding: 16, gap: 10 },
  forecastTrendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  forecastTrendLabel: { fontSize: 16, fontFamily: "Inter_700Bold", flex: 1 },
  forecastConfidence: { fontSize: 11, fontFamily: "Inter_500Medium" },
  forecastText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 21 },
  forecastRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8 },
  forecastMini: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  forecastHistory: { fontSize: 11, fontFamily: "Inter_400Regular", fontStyle: "italic", lineHeight: 17 },

  // Employee rows
  empRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  empAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  empInitials: { fontSize: 13, fontFamily: "Inter_700Bold" },
  empActiveDot: { position: "absolute", bottom: -2, right: -2, width: 9, height: 9, borderRadius: 4.5, backgroundColor: "#22c55e", borderWidth: 1.5, borderColor: "#fff" },
  empInfo: { flex: 1 },
  empName: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  empScore: { fontSize: 16, fontFamily: "Inter_700Bold" },

  // Score bar
  scoreBarTrack: { height: 4, backgroundColor: "#e2e8f0", borderRadius: 2, overflow: "hidden" },
  scoreBarFill: { height: 4, borderRadius: 2 },

  // Diagnose cards (equipe tab)
  diagCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 5 },
  diagCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  diagCardName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  diagCardBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  diagCardBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  diagCardGuc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  diagCardZayif: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  // History
  histCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  histHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  histScoreBadge: { width: 50, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  histScore: { fontSize: 22, fontFamily: "Inter_700Bold" },
  histInfo: { flex: 1 },
  histDate: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  histTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  histStats: { flexDirection: "row", gap: 16 },
  histStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  histStatText: { fontSize: 11, fontFamily: "Inter_400Regular" },

  // Empty
  emptyCard: { borderRadius: 14, borderWidth: 1, padding: 30, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  emptySub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },

  // Footer
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 8 },
  footerText: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
});
