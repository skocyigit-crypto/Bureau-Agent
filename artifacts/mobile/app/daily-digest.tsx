/**
 * daily-digest.tsx — Mon Bilan du Jour
 *
 * Kullanıcının günlük çalışma özetini ve AI önerilerini gösterir.
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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

interface DigestStats {
  calls: {
    total: number;
    answered: number;
    missed: number;
    recent: { contact: string | null; direction: string; status: string; duration: number }[];
  };
  tasks: {
    created: number;
    completed: number;
    overdue: number;
    recentCompleted: { title: string }[];
    upcoming: { title: string; dueDate: string | null; priority: string }[];
  };
  notes: number;
  events: { today: number; upcoming: { title: string; startDate: string }[] };
  messages: number;
  actions: number;
}

interface AiResult {
  resume: string;
  humeur: "positif" | "neutre" | "attention";
  score: number;
  points_forts: string[];
  suggestions: { type: string; texte: string; priorite: string }[];
  demain: { message: string; priorites: string[] };
}

interface DigestResponse {
  date: string;
  prenom: string;
  stats: DigestStats;
  ai: AiResult | null;
  generatedAt: string;
}

// ── Renk sabitleri ────────────────────────────────────────────────────────────

const SUGGESTION_COLORS = {
  alerte: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", icon: "#ef4444" as const, name: "alert-circle" as const },
  action: { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", icon: "#3b82f6" as const, name: "zap" as const },
  conseil: { bg: "#f0fdf4", border: "#86efac", text: "#166534", icon: "#22c55e" as const, name: "info" as const },
  felicitation: { bg: "#fefce8", border: "#fde047", text: "#713f12", icon: "#f59e0b" as const, name: "award" as const },
};

const HUMEUR_COLORS = {
  positif: { gradient: ["#065f46", "#0f766e"] as const, label: "Excellente journee !" },
  neutre: { gradient: ["#1e3a5f", "#1e40af"] as const, label: "Journee correcte" },
  attention: { gradient: ["#7c2d12", "#9a3412"] as const, label: "Points a ameliorer" },
};

const PRIORITY_DOTS = {
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#22c55e",
};

// ── Bileşenler ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color, sublabel }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: number | string;
  color: string;
  sublabel?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIconWrap, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sublabel ? <Text style={[styles.statSub, { color: color }]}>{sublabel}</Text> : null}
    </View>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <View style={styles.scoreRing}>
      <View style={[styles.scoreCircle, { borderColor: color }]}>
        <Text style={[styles.scoreNumber, { color }]}>{score}</Text>
        <Text style={[styles.scoreUnit, { color }]}>/100</Text>
      </View>
      <Text style={[styles.scoreLabel, { color }]}>Score de productivite</Text>
    </View>
  );
}

function SuggestionCard({ item }: { item: { type: string; texte: string; priorite: string } }) {
  const config = SUGGESTION_COLORS[item.type as keyof typeof SUGGESTION_COLORS] ?? SUGGESTION_COLORS.conseil;
  const dotColor = PRIORITY_DOTS[item.priorite as keyof typeof PRIORITY_DOTS] ?? "#94a3b8";
  return (
    <View style={[styles.suggCard, { backgroundColor: config.bg, borderColor: config.border }]}>
      <View style={styles.suggHeader}>
        <View style={[styles.suggIconWrap, { backgroundColor: config.icon + "22" }]}>
          <Feather name={config.name} size={14} color={config.icon} />
        </View>
        <View style={[styles.suggPriorityDot, { backgroundColor: dotColor }]} />
        <Text style={[styles.suggPriorityText, { color: dotColor }]}>{item.priorite}</Text>
      </View>
      <Text style={[styles.suggText, { color: config.text }]}>{item.texte}</Text>
    </View>
  );
}

// ── Ekran ─────────────────────────────────────────────────────────────────────

export default function DailyDigestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [digest, setDigest] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/daily-digest`);
      if (!res.ok) throw new Error("Erreur serveur");
      const data: DigestResponse = await res.json();
      setDigest(data);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: Platform.OS !== "web" }).start();
    } catch {
      setError("Impossible de charger le bilan. Verifiez votre connexion.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, fadeAnim]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fadeAnim.setValue(0);
    load(true);
  }, [load, fadeAnim]);

  const humeur = digest?.ai?.humeur ?? "neutre";
  const humeurConfig = HUMEUR_COLORS[humeur as keyof typeof HUMEUR_COLORS] ?? HUMEUR_COLORS.neutre;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="arrow-left" size={22} color="#ffffff" />
            </Pressable>
            <Text style={styles.headerTitle}>Mon Bilan du Jour</Text>
            <View style={{ width: 22 }} />
          </View>
        </View>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Analyse de votre journee en cours...
          </Text>
          <Text style={[styles.loadingHint, { color: colors.mutedForeground }]}>
            L'IA compile vos activites
          </Text>
        </View>
      </View>
    );
  }

  // ── Hata ─────────────────────────────────────────────────────────────────

  if (error || !digest) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="arrow-left" size={22} color="#ffffff" />
            </Pressable>
            <Text style={styles.headerTitle}>Mon Bilan du Jour</Text>
            <View style={{ width: 22 }} />
          </View>
        </View>
        <View style={styles.loadingCenter}>
          <Feather name="alert-circle" size={40} color={colors.destructive} />
          <Text style={[styles.loadingText, { color: colors.foreground }]}>{error ?? "Erreur inconnue"}</Text>
          <Pressable style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => load()}>
            <Text style={[styles.retryText, { color: colors.secondary }]}>Reessayer</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { stats, ai, prenom, date } = digest;

  // ── Ekran ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Mon Bilan du Jour</Text>
          <Pressable onPress={onRefresh} hitSlop={12}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>
        <Text style={styles.headerDate}>{date}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: isWeb ? 120 : 48 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Animated.View style={{ opacity: fadeAnim }}>

          {/* Hero — AI humeur banner */}
          <LinearGradient
            colors={[...humeurConfig.gradient] as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroBanner}
          >
            <View style={styles.heroTop}>
              <View>
                <Text style={styles.heroGreeting}>Bonsoir, {prenom} !</Text>
                <Text style={styles.heroMood}>{humeurConfig.label}</Text>
              </View>
              {ai ? <ScoreRing score={ai.score} /> : null}
            </View>
            {ai?.resume ? (
              <Text style={styles.heroResume}>{ai.resume}</Text>
            ) : (
              <Text style={styles.heroResume}>Voici un apercu de votre journee.</Text>
            )}
          </LinearGradient>

          {/* Stats */}
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACTIVITE DU JOUR</Text>
          <View style={styles.statsGrid}>
            <StatCard
              icon="phone-call"
              label="Appels"
              value={stats.calls.total}
              color="#22c55e"
              sublabel={stats.calls.missed > 0 ? `${stats.calls.missed} manque` : undefined}
            />
            <StatCard
              icon="check-square"
              label="Taches"
              value={stats.tasks.completed}
              color="#3b82f6"
              sublabel={stats.tasks.overdue > 0 ? `${stats.tasks.overdue} en retard` : undefined}
            />
            <StatCard
              icon="edit-2"
              label="Notes"
              value={stats.notes}
              color="#f59e0b"
            />
            <StatCard
              icon="calendar"
              label="Evenements"
              value={stats.events.today}
              color="#8b5cf6"
            />
          </View>

          {/* Activité détail */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="activity" size={16} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Detail de l'activite</Text>
            </View>
            <DetailRow icon="phone" label="Appels repondus" value={`${stats.calls.answered}`} color="#22c55e" colors={colors} />
            <DetailRow icon="phone-missed" label="Appels manques" value={`${stats.calls.missed}`} color={stats.calls.missed > 0 ? "#ef4444" : colors.mutedForeground} colors={colors} />
            <DetailRow icon="plus-square" label="Taches creees" value={`${stats.tasks.created}`} color={colors.mutedForeground} colors={colors} />
            <DetailRow icon="check-circle" label="Taches terminees" value={`${stats.tasks.completed}`} color="#22c55e" colors={colors} />
            {stats.tasks.overdue > 0 && (
              <DetailRow icon="alert-triangle" label="Taches en retard" value={`${stats.tasks.overdue}`} color="#ef4444" colors={colors} />
            )}
            <DetailRow icon="message-square" label="Messages" value={`${stats.messages}`} color={colors.mutedForeground} colors={colors} />
            <DetailRow icon="zap" label="Actions totales" value={`${stats.actions}`} color={colors.mutedForeground} colors={colors} last />
          </View>

          {/* Points forts */}
          {ai?.points_forts && ai.points_forts.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Feather name="star" size={16} color="#f59e0b" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Points forts</Text>
              </View>
              <View style={styles.pointsContainer}>
                {ai.points_forts.map((p, i) => (
                  <View key={i} style={[styles.pointRow, { borderBottomColor: colors.border }]}>
                    <View style={styles.pointDot} />
                    <Text style={[styles.pointText, { color: colors.foreground }]}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* AI Öneriler */}
          {ai?.suggestions && ai.suggestions.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>RECOMMANDATIONS IA</Text>
              {ai.suggestions.map((s, i) => (
                <SuggestionCard key={i} item={s} />
              ))}
            </>
          )}

          {/* Tamamlanan görevler listesi */}
          {stats.tasks.recentCompleted.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Feather name="check-circle" size={16} color="#22c55e" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Taches accomplies</Text>
              </View>
              <View style={styles.listContainer}>
                {stats.tasks.recentCompleted.map((t, i) => (
                  <View key={i} style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: i < stats.tasks.recentCompleted.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                    <Feather name="check" size={13} color="#22c55e" style={styles.listIcon} />
                    <Text style={[styles.listText, { color: colors.foreground }]}>{t.title}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Yarın / bu hafta görevler */}
          {stats.tasks.upcoming.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Feather name="calendar" size={16} color="#8b5cf6" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>A venir cette semaine</Text>
              </View>
              <View style={styles.listContainer}>
                {stats.tasks.upcoming.map((t, i) => (
                  <View key={i} style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: i < stats.tasks.upcoming.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                    <View style={[styles.priorityDot, { backgroundColor: PRIORITY_DOTS[t.priority as keyof typeof PRIORITY_DOTS] ?? "#94a3b8" }]} />
                    <Text style={[styles.listText, { color: colors.foreground, flex: 1 }]}>{t.title}</Text>
                    {t.dueDate ? (
                      <Text style={[styles.dueText, { color: colors.mutedForeground }]}>
                        {new Date(t.dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Yaklaşan etkinlikler */}
          {stats.events.upcoming.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Feather name="clock" size={16} color="#ec4899" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Prochains rendez-vous</Text>
              </View>
              <View style={styles.listContainer}>
                {stats.events.upcoming.map((e, i) => (
                  <View key={i} style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: i < stats.events.upcoming.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                    <Feather name="calendar" size={13} color="#ec4899" style={styles.listIcon} />
                    <Text style={[styles.listText, { color: colors.foreground, flex: 1 }]}>{e.title}</Text>
                    <Text style={[styles.dueText, { color: colors.mutedForeground }]}>
                      {new Date(e.startDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Yarın için mesaj */}
          {ai?.demain && (
            <View style={[styles.demainCard, { borderColor: colors.primary + "44" }]}>
              <LinearGradient
                colors={["rgba(245,158,11,0.08)", "rgba(245,158,11,0.02)"]}
                style={styles.demainGradient}
              >
                <View style={styles.cardHeader}>
                  <Feather name="sunrise" size={16} color={colors.primary} />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Pour demain</Text>
                </View>
                <Text style={[styles.demainMessage, { color: colors.foreground }]}>{ai.demain.message}</Text>
                {ai.demain.priorites.map((p, i) => (
                  <View key={i} style={styles.demainPriority}>
                    <Text style={[styles.demainNum, { color: colors.primary }]}>{i + 1}</Text>
                    <Text style={[styles.demainText, { color: colors.foreground }]}>{p}</Text>
                  </View>
                ))}
              </LinearGradient>
            </View>
          )}

          {/* Oluşturulma zamanı */}
          <Text style={[styles.generatedAt, { color: colors.mutedForeground }]}>
            Bilan genere le {new Date(digest.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </Text>

        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ── Küçük yardımcı bileşen ────────────────────────────────────────────────────

function DetailRow({ icon, label, value, color, colors, last }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  color: string;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View style={[styles.detailRow, { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
      <Feather name={icon} size={14} color={color} style={styles.detailIcon} />
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ── Stiller ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", textAlign: "center", marginTop: 4 },
  scroll: { padding: 16, gap: 12 },

  // Loading
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  loadingText: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center" },
  loadingHint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Hero
  heroBanner: { borderRadius: 16, padding: 20, marginBottom: 4 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  heroGreeting: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  heroMood: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2 },
  heroResume: { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", lineHeight: 22 },

  // Score ring
  scoreRing: { alignItems: "center", gap: 4 },
  scoreCircle: { width: 60, height: 60, borderRadius: 30, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
  scoreNumber: { fontSize: 20, fontFamily: "Inter_700Bold" },
  scoreUnit: { fontSize: 9, fontFamily: "Inter_400Regular" },
  scoreLabel: { fontSize: 9, fontFamily: "Inter_500Medium", textAlign: "center", maxWidth: 70 },

  // Stats grid
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginTop: 4, marginBottom: 2 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: { flex: 1, minWidth: "45%", borderRadius: 12, borderWidth: 1, padding: 14, alignItems: "center", gap: 4 },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  statValue: { fontSize: 24, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  statSub: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Card
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Detail rows
  detailRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  detailIcon: { marginRight: 10 },
  detailLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  detailValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Points
  pointsContainer: { paddingHorizontal: 16, paddingBottom: 14 },
  pointRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  pointDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b", marginTop: 5 },
  pointText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },

  // Suggestions
  suggCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 0 },
  suggHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  suggIconWrap: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  suggPriorityDot: { width: 7, height: 7, borderRadius: 3.5 },
  suggPriorityText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  suggText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },

  // List
  listContainer: { paddingHorizontal: 16, paddingBottom: 12 },
  listRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  listIcon: { marginRight: 10 },
  listText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  priorityDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 10 },
  dueText: { fontSize: 11, fontFamily: "Inter_500Medium" },

  // Demain
  demainCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  demainGradient: { padding: 16 },
  demainMessage: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 22, marginBottom: 14, paddingHorizontal: 4 },
  demainPriority: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 7 },
  demainNum: { fontSize: 16, fontFamily: "Inter_700Bold", width: 20, textAlign: "center" },
  demainText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },

  generatedAt: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
});
