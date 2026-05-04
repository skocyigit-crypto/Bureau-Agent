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

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface UserMetrics {
  userId: number;
  userName: string;
  email?: string;
  role?: string;
  actionsTotal: number;
  tasksCount?: number;
  tachesTerminees: number;
  heuresTravaillees: number;
  appelsTotal?: number;
  messagesTotal?: number;
}

type Periode = "jour" | "semaine" | "mois";

const PERIOD_OPTIONS: { val: Periode; label: string }[] = [
  { val: "jour",    label: "Aujourd'hui" },
  { val: "semaine", label: "7 jours"    },
  { val: "mois",    label: "30 jours"   },
];

function roleColor(role?: string): string {
  switch (role) {
    case "super_admin":    return "#ef4444";
    case "administrateur": return "#f97316";
    case "manager":        return "#8b5cf6";
    case "agent":          return "#3b82f6";
    case "operateur":      return "#22c55e";
    default:               return "#6b7280";
  }
}

function roleLabel(role?: string): string {
  switch (role) {
    case "super_admin":    return "Super Admin";
    case "administrateur": return "Admin";
    case "manager":        return "Manager";
    case "agent":          return "Agent";
    case "operateur":      return "Opérateur";
    default:               return role || "—";
  }
}

function initials(name: string): string {
  return name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function MiniStat({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <View style={[miniStyles.item, { backgroundColor: color + "10" }]}>
      <Feather name={icon} size={12} color={color} />
      <Text style={[miniStyles.val, { color }]}>{value}</Text>
      <Text style={[miniStyles.lbl, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const miniStyles = StyleSheet.create({
  item: { flex: 1, alignItems: "center", padding: 8, borderRadius: 8, gap: 3 },
  val: { fontSize: 15, fontFamily: "Inter_700Bold" },
  lbl: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
});

function EmployeeCard({ emp, maxActions, colors }: {
  emp: UserMetrics;
  maxActions: number;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const pct = maxActions > 0 ? Math.min(100, Math.round((emp.actionsTotal / maxActions) * 100)) : 0;
  const rc = roleColor(emp.role);

  return (
    <View style={[styles.empCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.empHeader}>
        <View style={[styles.avatar, { backgroundColor: rc + "20" }]}>
          <Text style={[styles.avatarText, { color: rc }]}>{initials(emp.userName)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.empName, { color: colors.foreground }]} numberOfLines={1}>{emp.userName}</Text>
          <View style={styles.empMeta}>
            <View style={[styles.rolePill, { backgroundColor: rc + "18" }]}>
              <Text style={[styles.roleText, { color: rc }]}>{roleLabel(emp.role)}</Text>
            </View>
            {emp.email && (
              <Text style={[styles.empEmail, { color: colors.mutedForeground }]} numberOfLines={1}>
                {emp.email}
              </Text>
            )}
          </View>
        </View>
        <View style={[styles.actionsCircle, { borderColor: rc }]}>
          <Text style={[styles.actionsNum, { color: rc }]}>{emp.actionsTotal}</Text>
          <Text style={[styles.actionsLbl, { color: colors.mutedForeground }]}>actions</Text>
        </View>
      </View>

      {/* Activity bar */}
      <View style={styles.barSection}>
        <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: rc }]} />
        </View>
        <Text style={[styles.barPct, { color: rc }]}>{pct}%</Text>
      </View>

      <View style={styles.statsRow}>
        <MiniStat label="Tâches ✓" value={emp.tachesTerminees}   color="#22c55e" icon="check-circle"  />
        <MiniStat label="Heures"  value={`${emp.heuresTravaillees}h`} color="#3b82f6" icon="clock"     />
        {emp.appelsTotal !== undefined && <MiniStat label="Appels" value={emp.appelsTotal}  color="#f59e0b" icon="phone" />}
        {emp.messagesTotal !== undefined && <MiniStat label="Messages" value={emp.messagesTotal} color="#8b5cf6" icon="message-square" />}
      </View>
    </View>
  );
}

export default function PerformanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [metriques, setMetriques] = useState<UserMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [periode, setPeriode] = useState<Periode>("semaine");
  const [rapportLoading, setRapportLoading] = useState(false);
  const [rapport, setRapport] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/performance/metriques?periode=${periode}`);
      if (res.ok) {
        const d = await res.json();
        setMetriques(d.metriques ?? []);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, periode]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function generateRapport() {
    setRapportLoading(true);
    setRapport(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/performance/rapport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periode }),
      });
      if (res.ok) {
        const d = await res.json();
        setRapport(d.rapport ?? d.summary ?? JSON.stringify(d));
      }
    } finally { setRapportLoading(false); }
  }

  const totalActions = metriques.reduce((s, m) => s + m.actionsTotal, 0);
  const totalHeures  = metriques.reduce((s, m) => s + m.heuresTravaillees, 0);
  const totalTaches  = metriques.reduce((s, m) => s + m.tachesTerminees, 0);
  const maxActions   = metriques.length > 0 ? Math.max(...metriques.map(m => m.actionsTotal), 1) : 1;

  // Sort by actionsTotal desc
  const sorted = [...metriques].sort((a, b) => b.actionsTotal - a.actionsTotal);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#0f4c81", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Performance Équipe</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <View style={styles.periodRow}>
          {PERIOD_OPTIONS.map(p => (
            <Pressable
              key={p.val}
              onPress={() => setPeriode(p.val)}
              style={[styles.periodChip, { backgroundColor: periode === p.val ? "#fff" : "rgba(255,255,255,0.15)" }]}
            >
              <Text style={[styles.periodText, { color: periode === p.val ? "#0f4c81" : "rgba(255,255,255,0.85)" }]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {!loading && metriques.length > 0 && (
          <View style={[styles.summaryStrip, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <View style={styles.sumItem}>
              <Text style={styles.sumNum}>{metriques.length}</Text>
              <Text style={styles.sumLbl}>Employés</Text>
            </View>
            <View style={styles.sumDivider} />
            <View style={styles.sumItem}>
              <Text style={[styles.sumNum, { color: "#86efac" }]}>{totalActions}</Text>
              <Text style={styles.sumLbl}>Actions</Text>
            </View>
            <View style={styles.sumDivider} />
            <View style={styles.sumItem}>
              <Text style={[styles.sumNum, { color: "#93c5fd" }]}>{totalHeures.toFixed(1)}h</Text>
              <Text style={styles.sumLbl}>Heures</Text>
            </View>
            <View style={styles.sumDivider} />
            <View style={styles.sumItem}>
              <Text style={[styles.sumNum, { color: "#6ee7b7" }]}>{totalTaches}</Text>
              <Text style={styles.sumLbl}>Tâches ✓</Text>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0f4c81" />
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0f4c81" />}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 }]}
        >
          {sorted.length === 0 ? (
            <EmptyState
              icon="bar-chart-2"
              title="Aucune métrique"
              subtitle="Les métriques apparaîtront ici au fur et à mesure que l'équipe utilise l'application."
            />
          ) : (
            <>
              {sorted.map((emp) => (
                <EmployeeCard key={emp.userId} emp={emp} maxActions={maxActions} colors={colors} />
              ))}

              {/* AI Report Section */}
              <View style={[styles.rapportSection, { backgroundColor: colors.card, borderColor: "#8b5cf630" }]}>
                <View style={styles.rapportHeader}>
                  <View style={[styles.rapportIcon, { backgroundColor: "#8b5cf618" }]}>
                    <Feather name="zap" size={16} color="#8b5cf6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rapportTitle, { color: colors.foreground }]}>Rapport IA de performance</Text>
                    <Text style={[styles.rapportSubtitle, { color: colors.mutedForeground }]}>
                      Analyse automatique générée par l'IA
                    </Text>
                  </View>
                </View>

                {rapport && (
                  <View style={[styles.rapportContent, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
                    <Text style={[styles.rapportText, { color: colors.foreground }]}>{rapport}</Text>
                  </View>
                )}

                <Pressable
                  onPress={generateRapport}
                  disabled={rapportLoading}
                  style={[styles.rapportBtn, { backgroundColor: "#8b5cf6", opacity: rapportLoading ? 0.7 : 1 }]}
                >
                  {rapportLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Feather name="zap" size={14} color="#fff" />
                  )}
                  <Text style={styles.rapportBtnText}>
                    {rapportLoading ? "Génération en cours…" : rapport ? "Régénérer le rapport" : "Générer le rapport IA"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  periodRow: { flexDirection: "row", gap: 8 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  periodText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  summaryStrip: { flexDirection: "row", borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  sumItem: { flex: 1, alignItems: "center" },
  sumNum: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  sumLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", marginTop: 2 },
  sumDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.2)" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16, gap: 10 },
  empCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  empHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  empName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  empMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  rolePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  roleText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  empEmail: { fontSize: 10, fontFamily: "Inter_400Regular", flex: 1 },
  actionsCircle: { alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 27, borderWidth: 2 },
  actionsNum: { fontSize: 16, fontFamily: "Inter_700Bold" },
  actionsLbl: { fontSize: 8, fontFamily: "Inter_400Regular" },
  barSection: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  barPct: { fontSize: 11, fontFamily: "Inter_600SemiBold", width: 32, textAlign: "right" },
  statsRow: { flexDirection: "row", gap: 6 },
  rapportSection: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
  rapportHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  rapportIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rapportTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rapportSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  rapportContent: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
  rapportText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  rapportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, borderRadius: 10 },
  rapportBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
