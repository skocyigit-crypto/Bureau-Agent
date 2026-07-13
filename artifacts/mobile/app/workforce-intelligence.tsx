/**
 * workforce-intelligence.tsx — AI Ekip Takip Sistemi
 *
 * Tüm çalışanların performansını takip eden admin-only ekran.
 * Gemini AI ile sürekli güncellenen analiz ve öneriler.
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

interface Employee {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  role: string;
  departement: string | null;
  dernierAcces: string | null;
  score: number;
  calls7d: number;
  callsAnswered7d: number;
  callsMissed7d: number;
  tasksCreated7d: number;
  tasksCompleted7d: number;
  tasksOverdue: number;
  notes7d: number;
  actions7d: number;
  callsToday: number;
  tasksCompletedToday: number;
  notesToday: number;
}

interface AiResult {
  sante_equipe: number;
  tendance: "hausse" | "stable" | "baisse";
  message_manager: string;
  top_performeurs: { nom: string; score: number; raison: string }[];
  en_difficulte: { nom: string; score: number; probleme: string; action_recommandee: string }[];
  alertes: { type: string; collaborateur: string; message: string; urgence: string }[];
  recommandations: { action: string; impact: string; priorite: string }[];
  previsions: string;
}

interface WIResponse {
  date: string;
  managerName: string;
  teamSize: number;
  teamAvgScore: number;
  employees: Employee[];
  ai: AiResult | null;
  generatedAt: string;
}

// ── Renk sabitleri ────────────────────────────────────────────────────────────

const SCORE_COLOR = (s: number) => s >= 75 ? "#22c55e" : s >= 50 ? "#f59e0b" : "#ef4444";
const SCORE_BG = (s: number) => s >= 75 ? "#f0fdf4" : s >= 50 ? "#fefce8" : "#fef2f2";

const URGENCE_COLORS = {
  haute: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", dot: "#ef4444" },
  moyenne: { bg: "#fefce8", border: "#fde047", text: "#713f12", dot: "#f59e0b" },
  basse: { bg: "#f0fdf4", border: "#86efac", text: "#166534", dot: "#22c55e" },
};

const TENDANCE_ICONS = {
  hausse: { name: "trending-up" as const, color: "#22c55e" },
  stable: { name: "minus" as const, color: "#f59e0b" },
  baisse: { name: "trending-down" as const, color: "#ef4444" },
};

const ALERTE_ICONS = {
  absence: "user-x" as const,
  surcharge: "alert-triangle" as const,
  qualite: "star" as const,
  retard: "clock" as const,
  inactivite: "moon" as const,
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  administrateur: "Admin",
  agent: "Agent",
  lecture_seule: "Lecture",
};

// Auto-refresh interval — 10 dakika (millisaniye)
const AUTO_REFRESH_MS = 10 * 60 * 1000;

// ── Küçük bileşenler ──────────────────────────────────────────────────────────

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const color = SCORE_COLOR(score);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.32, fontFamily: "Inter_700Bold", color }}>{score}</Text>
    </View>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <View style={[styles.statusDot, { backgroundColor: active ? "#22c55e" : "#94a3b8" }]} />
  );
}

function EmployeeCard({ emp, colors }: { emp: Employee; colors: ReturnType<typeof useColors> }) {
  const isActiveToday = emp.callsToday + emp.tasksCompletedToday + emp.notesToday > 0;
  const scoreColor = SCORE_COLOR(emp.score);
  const scoreBg = SCORE_BG(emp.score);
  const initials = `${emp.prenom[0] ?? ""}${emp.nom[0] ?? ""}`.toUpperCase();

  return (
    <View style={[styles.empCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.empHeader}>
        {/* Avatar */}
        <View style={[styles.empAvatar, { backgroundColor: colors.primary + "22" }]}>
          <Text style={[styles.empInitials, { color: colors.primary }]}>{initials}</Text>
          <StatusDot active={isActiveToday} />
        </View>
        {/* Info */}
        <View style={styles.empInfo}>
          <Text style={[styles.empName, { color: colors.foreground }]}>{emp.prenom} {emp.nom}</Text>
          <Text style={[styles.empRole, { color: colors.mutedForeground }]}>
            {ROLE_LABELS[emp.role] ?? emp.role}{emp.departement ? ` · ${emp.departement}` : ""}
          </Text>
        </View>
        {/* Score */}
        <View style={[styles.empScoreBadge, { backgroundColor: scoreBg }]}>
          <Text style={[styles.empScoreNum, { color: scoreColor }]}>{emp.score}</Text>
          <Text style={[styles.empScoreLabel, { color: scoreColor }]}>/100</Text>
        </View>
      </View>

      {/* Mini stats */}
      <View style={[styles.empStats, { borderTopColor: colors.border }]}>
        <MiniStat icon="phone-call" value={emp.calls7d} label="appels" color="#22c55e" colors={colors} />
        <MiniStat icon="phone-missed" value={emp.callsMissed7d} label="manques" color={emp.callsMissed7d > 0 ? "#ef4444" : colors.mutedForeground} colors={colors} />
        <MiniStat icon="check-square" value={emp.tasksCompleted7d} label="terminees" color="#3b82f6" colors={colors} />
        <MiniStat icon="alert-triangle" value={emp.tasksOverdue} label="retard" color={emp.tasksOverdue > 0 ? "#ef4444" : colors.mutedForeground} colors={colors} />
        <MiniStat icon="edit-2" value={emp.notes7d} label="notes" color="#8b5cf6" colors={colors} />
      </View>

      {/* Dernier accès */}
      <View style={styles.empFooter}>
        <Feather name="clock" size={10} color={colors.mutedForeground} />
        <Text style={[styles.empLastSeen, { color: colors.mutedForeground }]}>
          {emp.dernierAcces
            ? `Vu ${new Date(emp.dernierAcces).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : "Jamais connecte"}
        </Text>
        {isActiveToday && (
          <View style={styles.activeTodayBadge}>
            <Text style={styles.activeTodayText}>Actif aujourd'hui</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function MiniStat({ icon, value, label, color, colors }: {
  icon: keyof typeof Feather.glyphMap;
  value: number;
  label: string;
  color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.miniStat}>
      <Feather name={icon} size={12} color={color} />
      <Text style={[styles.miniStatVal, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.miniStatLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ── Ekran ─────────────────────────────────────────────────────────────────────

export default function WorkforceIntelligenceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";

  const [data, setData] = useState<WIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_MS / 1000);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Yetki kontrolü
  const isAdmin = user?.role === "administrateur" || user?.role === "super_admin";

  const load = useCallback(async (silent = false) => {
    if (!isAdmin) return;
    if (!silent) setLoading(true);
    else setAiLoading(true);
    setError(null);

    try {
      const res = await fetchAuth(`${API_BASE}/api/workforce-intelligence`);
      if (res.status === 403) {
        setError("Acces reserve aux administrateurs.");
        return;
      }
      if (!res.ok) throw new Error("Erreur serveur");
      const json: WIResponse = await res.json();
      setData(json);
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: Platform.OS !== "web" }).start();
    } catch {
      setError("Impossible de charger les donnees. Verifiez votre connexion.");
    } finally {
      setLoading(false);
      setAiLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, isAdmin, fadeAnim]);

  // Auto-refresh kurulumu
  const scheduleAutoRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);

    setCountdown(AUTO_REFRESH_MS / 1000);

    countdownTimer.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);

    refreshTimer.current = setTimeout(() => {
      load(true);
      scheduleAutoRefresh();
    }, AUTO_REFRESH_MS);
  }, [load]);

  useEffect(() => {
    load();
    scheduleAutoRefresh();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [load, scheduleAutoRefresh]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    scheduleAutoRefresh();
    load(false);
  }, [load, scheduleAutoRefresh]);

  // Countdown formatı: mm:ss
  const countdownStr = `${String(Math.floor(countdown / 60)).padStart(2, "0")}:${String(countdown % 60).padStart(2, "0")}`;

  // ── Access denied ─────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="arrow-left" size={22} color="#ffffff" />
            </Pressable>
            <Text style={styles.headerTitle}>Intelligence Equipe</Text>
            <View style={{ width: 22 }} />
          </View>
        </View>
        <View style={styles.center}>
          <Feather name="lock" size={48} color={colors.mutedForeground} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Acces reserve</Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>Cette section est accessible uniquement aux administrateurs.</Text>
        </View>
      </View>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="arrow-left" size={22} color="#ffffff" />
            </Pressable>
            <Text style={styles.headerTitle}>Intelligence Equipe</Text>
            <View style={{ width: 22 }} />
          </View>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Analyse IA en cours...</Text>
          <Text style={[styles.loadingSub, { color: colors.mutedForeground }]}>Gemini evalue les performances de l'equipe</Text>
        </View>
      </View>
    );
  }

  // ── Hata ─────────────────────────────────────────────────────────────────

  if (error || !data) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="arrow-left" size={22} color="#ffffff" />
            </Pressable>
            <Text style={styles.headerTitle}>Intelligence Equipe</Text>
            <View style={{ width: 22 }} />
          </View>
        </View>
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.destructive} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>{error ?? "Erreur inconnue"}</Text>
          <Pressable style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => load()}>
            <Text style={[styles.retryText, { color: colors.secondary }]}>Reessayer</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { ai, employees, teamAvgScore, teamSize, managerName, date } = data;
  const tendance = ai?.tendance ?? "stable";
  const tendanceIcon = TENDANCE_ICONS[tendance as keyof typeof TENDANCE_ICONS] ?? TENDANCE_ICONS.stable;

  // Sıralama: score desc
  const sortedEmployees = [...employees].sort((a, b) => b.score - a.score);
  const activeToday = employees.filter((e) => e.callsToday + e.tasksCompletedToday + e.notesToday > 0).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Intelligence Equipe</Text>
          <Pressable onPress={onRefresh} hitSlop={12}>
            {aiLoading
              ? <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
              : <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
            }
          </Pressable>
        </View>
        <View style={styles.headerMeta}>
          <Text style={styles.headerDate}>{date}</Text>
          <View style={styles.autoRefreshBadge}>
            <Feather name="zap" size={10} color="#f59e0b" />
            <Text style={styles.autoRefreshText}>IA dans {countdownStr}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: isWeb ? 120 : 48 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Animated.View style={{ opacity: fadeAnim }}>

          {/* Hero — santé équipe */}
          <LinearGradient
            colors={teamAvgScore >= 70 ? ["#065f46", "#0f766e"] : teamAvgScore >= 45 ? ["#1e3a5f", "#1e40af"] : ["#7c2d12", "#9a3412"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroTop}>
              <View style={styles.heroLeft}>
                <Text style={styles.heroTitle}>Bonjour, {managerName}</Text>
                <Text style={styles.heroSub}>Votre equipe — {teamSize} collaborateur{teamSize > 1 ? "s" : ""}</Text>
              </View>
              <ScoreRing score={ai?.sante_equipe ?? teamAvgScore} size={64} />
            </View>

            {/* Tendance + actifs */}
            <View style={styles.heroStats}>
              <View style={styles.heroStatItem}>
                <Feather name={tendanceIcon.name} size={14} color={tendanceIcon.color} />
                <Text style={[styles.heroStatText, { color: tendanceIcon.color }]}>
                  {tendance === "hausse" ? "En hausse" : tendance === "baisse" ? "En baisse" : "Stable"}
                </Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStatItem}>
                <Feather name="users" size={14} color="#ffffff" />
                <Text style={styles.heroStatText}>{activeToday}/{teamSize} actifs aujourd'hui</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStatItem}>
                <Feather name="bar-chart-2" size={14} color="#ffffff" />
                <Text style={styles.heroStatText}>Moy. {teamAvgScore}/100</Text>
              </View>
            </View>

            {ai?.message_manager ? (
              <Text style={styles.heroMessage}>{ai.message_manager}</Text>
            ) : null}
          </LinearGradient>

          {/* Alertes IA */}
          {ai?.alertes && ai.alertes.length > 0 && (
            <>
              <SectionTitle label="ALERTES IA" icon="alert-triangle" color="#ef4444" colors={colors} />
              {ai.alertes.map((a, i) => {
                const urgenceConfig = URGENCE_COLORS[a.urgence as keyof typeof URGENCE_COLORS] ?? URGENCE_COLORS.basse;
                const alerteIcon = ALERTE_ICONS[a.type as keyof typeof ALERTE_ICONS] ?? "alert-circle";
                return (
                  <View key={i} style={[styles.alerteCard, { backgroundColor: urgenceConfig.bg, borderColor: urgenceConfig.border }]}>
                    <View style={styles.alerteHeader}>
                      <Feather name={alerteIcon} size={14} color={urgenceConfig.dot} />
                      <Text style={[styles.alerteCollab, { color: urgenceConfig.text }]}>{a.collaborateur}</Text>
                      <View style={[styles.urgenceBadge, { backgroundColor: urgenceConfig.dot + "22" }]}>
                        <Text style={[styles.urgenceText, { color: urgenceConfig.dot }]}>{a.urgence}</Text>
                      </View>
                    </View>
                    <Text style={[styles.alerteMsg, { color: urgenceConfig.text }]}>{a.message}</Text>
                  </View>
                );
              })}
            </>
          )}

          {/* Top performers */}
          {ai?.top_performeurs && ai.top_performeurs.length > 0 && (
            <>
              <SectionTitle label="TOP PERFORMEURS" icon="award" color="#f59e0b" colors={colors} />
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {ai.top_performeurs.map((p, i) => (
                  <View key={i} style={[styles.perfRow, { borderBottomColor: colors.border, borderBottomWidth: i < ai.top_performeurs.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                    <View style={styles.perfRank}>
                      <Text style={[styles.perfRankText, { color: i === 0 ? "#f59e0b" : colors.mutedForeground }]}>#{i + 1}</Text>
                    </View>
                    <View style={styles.perfInfo}>
                      <Text style={[styles.perfName, { color: colors.foreground }]}>{p.nom}</Text>
                      <Text style={[styles.perfRaison, { color: colors.mutedForeground }]}>{p.raison}</Text>
                    </View>
                    <View style={[styles.perfScore, { backgroundColor: SCORE_BG(p.score) }]}>
                      <Text style={[styles.perfScoreText, { color: SCORE_COLOR(p.score) }]}>{p.score}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* En difficulté */}
          {ai?.en_difficulte && ai.en_difficulte.length > 0 && (
            <>
              <SectionTitle label="NECESSITE ATTENTION" icon="user-x" color="#ef4444" colors={colors} />
              {ai.en_difficulte.map((e, i) => (
                <View key={i} style={[styles.diffCard, { backgroundColor: colors.card, borderColor: "#fca5a5" }]}>
                  <View style={styles.diffHeader}>
                    <View style={[styles.diffAvatar, { backgroundColor: "#fef2f2" }]}>
                      <Text style={styles.diffInitials}>{e.nom.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <View style={styles.diffInfo}>
                      <Text style={[styles.diffName, { color: colors.foreground }]}>{e.nom}</Text>
                      <Text style={[styles.diffProbleme, { color: "#ef4444" }]}>{e.probleme}</Text>
                    </View>
                    <View style={[styles.perfScore, { backgroundColor: SCORE_BG(e.score) }]}>
                      <Text style={[styles.perfScoreText, { color: SCORE_COLOR(e.score) }]}>{e.score}</Text>
                    </View>
                  </View>
                  <View style={[styles.diffAction, { backgroundColor: "#eff6ff", borderColor: "#93c5fd" }]}>
                    <Feather name="zap" size={12} color="#3b82f6" />
                    <Text style={[styles.diffActionText, { color: "#1e40af" }]}>{e.action_recommandee}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {/* Recommandations */}
          {ai?.recommandations && ai.recommandations.length > 0 && (
            <>
              <SectionTitle label="RECOMMANDATIONS MANAGER" icon="compass" color="#8b5cf6" colors={colors} />
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {ai.recommandations.map((r, i) => {
                  const pColor = r.priorite === "haute" ? "#ef4444" : r.priorite === "moyenne" ? "#f59e0b" : "#22c55e";
                  return (
                    <View key={i} style={[styles.recommRow, { borderBottomColor: colors.border, borderBottomWidth: i < ai.recommandations.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                      <View style={[styles.recommDot, { backgroundColor: pColor }]} />
                      <View style={styles.recommContent}>
                        <Text style={[styles.recommAction, { color: colors.foreground }]}>{r.action}</Text>
                        <Text style={[styles.recommImpact, { color: colors.mutedForeground }]}>{r.impact}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* Tous les collaborateurs */}
          <SectionTitle label={`TOUS LES COLLABORATEURS (${teamSize})`} icon="users" color={colors.primary} colors={colors} />
          {sortedEmployees.map((emp) => (
            <EmployeeCard key={emp.id} emp={emp} colors={colors} />
          ))}

          {/* Prévisions */}
          {ai?.previsions && (
            <View style={[styles.previsionsCard, { borderColor: colors.primary + "44" }]}>
              <LinearGradient colors={["rgba(99,102,241,0.08)", "rgba(99,102,241,0.02)"]} style={styles.previsionsGradient}>
                <View style={styles.previsionsHeader}>
                  <Feather name="eye" size={15} color="#6366f1" />
                  <Text style={[styles.previsionsTitle, { color: colors.foreground }]}>Previsions semaine prochaine</Text>
                </View>
                <Text style={[styles.previsionsText, { color: colors.foreground }]}>{ai.previsions}</Text>
              </LinearGradient>
            </View>
          )}

          {/* Footer */}
          <View style={styles.footerRow}>
            <Feather name="zap" size={11} color={colors.mutedForeground} />
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Analyse Gemini AI · {new Date(data.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · Prochaine mise a jour dans {countdownStr}
            </Text>
          </View>

        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ── Yardımcı bileşen ──────────────────────────────────────────────────────────

function SectionTitle({ label, icon, color, colors }: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <Feather name={icon} size={12} color={color} />
      <Text style={[styles.sectionTitleText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ── Stiller ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  headerDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)" },
  autoRefreshBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.15)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  autoRefreshText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#f59e0b" },

  scroll: { padding: 16, gap: 10 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  loadingText: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center" },
  loadingSub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  errorTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  errorSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Hero
  hero: { borderRadius: 16, padding: 20, gap: 14 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroLeft: { flex: 1 },
  heroTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  heroSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", marginTop: 2 },
  heroStats: { flexDirection: "row", alignItems: "center", gap: 0 },
  heroStatItem: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  heroStatText: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.85)" },
  heroStatDivider: { width: 1, height: 14, backgroundColor: "rgba(255,255,255,0.2)", marginHorizontal: 6 },
  heroMessage: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", lineHeight: 20 },

  // Section title
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, marginBottom: 2 },
  sectionTitleText: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },

  // Card
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },

  // Alertes
  alerteCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  alerteHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  alerteCollab: { fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 },
  urgenceBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  urgenceText: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  alerteMsg: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  // Top performers
  perfRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  perfRank: { width: 28 },
  perfRankText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  perfInfo: { flex: 1 },
  perfName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  perfRaison: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  perfScore: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  perfScoreText: { fontSize: 14, fontFamily: "Inter_700Bold" },

  // En difficulté
  diffCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  diffHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  diffAvatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  diffInitials: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#ef4444" },
  diffInfo: { flex: 1 },
  diffName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  diffProbleme: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  diffAction: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 8, borderWidth: 1, padding: 10 },
  diffActionText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18 },

  // Recommandations
  recommRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  recommDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  recommContent: { flex: 1 },
  recommAction: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  recommImpact: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Employee card
  empCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  empHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  empAvatar: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  empInitials: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statusDot: { position: "absolute", bottom: -2, right: -2, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: "#ffffff" },
  empInfo: { flex: 1 },
  empName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empRole: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  empScoreBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, flexDirection: "row", alignItems: "baseline", gap: 1 },
  empScoreNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  empScoreLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  empStats: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, paddingHorizontal: 14, justifyContent: "space-around" },
  empFooter: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  empLastSeen: { fontSize: 10, fontFamily: "Inter_400Regular", flex: 1 },
  activeTodayBadge: { backgroundColor: "#dcfce7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  activeTodayText: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#166534" },
  miniStat: { alignItems: "center", gap: 2 },
  miniStatVal: { fontSize: 13, fontFamily: "Inter_700Bold" },
  miniStatLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },

  // Prévisions
  previsionsCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  previsionsGradient: { padding: 16 },
  previsionsHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  previsionsTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  previsionsText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 22 },

  // Footer
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 8 },
  footerText: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
});
