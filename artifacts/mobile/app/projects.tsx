import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Project {
  id: number;
  title: string;
  description: string;
  clientName: string;
  clientCompany: string;
  status: string;
  priority: string;
  budget: number;
  spent: number;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  actualEndDate: string | null;
  assignedTo: string;
  teamMembers: string;
  tags: string;
  milestones: string;
  notes: string;
  createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  planifie: { label: "Planifie", color: "#6366f1", icon: "calendar" },
  en_cours: { label: "En cours", color: "#3b82f6", icon: "play-circle" },
  en_pause: { label: "En pause", color: "#f59e0b", icon: "pause-circle" },
  termine: { label: "Termine", color: "#22c55e", icon: "check-circle" },
  annule: { label: "Annule", color: "#ef4444", icon: "x-circle" },
};

const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  basse: { label: "Basse", color: "#22c55e" },
  moyenne: { label: "Moyenne", color: "#f59e0b" },
  haute: { label: "Haute", color: "#f97316" },
  urgente: { label: "Urgente", color: "#ef4444" },
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function formatDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null;
  const diff = new Date(endDate).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

export default function ProjectsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Project | null>(null);
  const [stats, setStats] = useState<any>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const [pRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/projets?${params}`),
        fetchAuth(`${API_BASE}/api/projets/stats`).catch(() => null),
      ]);
      if (pRes.ok) {
        const d = await pRes.json();
        setProjects(d.projets || []);
      }
      if (sRes?.ok) {
        const d = await sRes.json();
        setStats(d);
      }
    } catch (e) {
      console.warn("[Projects] fetch error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, filter, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  function renderProject({ item }: { item: Project }) {
    const st = STATUS_MAP[item.status] || STATUS_MAP.planifie;
    const pr = PRIORITY_MAP[item.priority] || PRIORITY_MAP.moyenne;
    const progress = item.progress || 0;
    const days = daysRemaining(item.endDate);
    const budgetPct = item.budget > 0 ? Math.min(100, Math.round(((item.spent || 0) / item.budget) * 100)) : 0;
    const overBudget = budgetPct > 90;

    return (
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelected(item);
        }}
        style={({ pressed }) => [
          styles.projectCard,
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={styles.cardTop}>
          <View style={[styles.statusBadge, { backgroundColor: st.color + "18" }]}>
            <Feather name={st.icon} size={12} color={st.color} />
            <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
          </View>
          <View style={[styles.priorBadge, { backgroundColor: pr.color + "18" }]}>
            <Text style={[styles.priorText, { color: pr.color }]}>{pr.label}</Text>
          </View>
        </View>

        <Text style={[styles.projectTitle, { color: colors.foreground }]} numberOfLines={2}>{item.title}</Text>

        {(item.clientName || item.clientCompany) && (
          <View style={styles.clientRow}>
            <Feather name="briefcase" size={12} color={colors.mutedForeground} />
            <Text style={[styles.clientText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.clientCompany || item.clientName}
            </Text>
          </View>
        )}

        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>Avancement</Text>
            <Text style={[styles.progressValue, { color: progress >= 100 ? "#22c55e" : colors.foreground }]}>{progress}%</Text>
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.muted }]}>
            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: progress >= 100 ? "#22c55e" : progress >= 50 ? "#3b82f6" : "#f59e0b" }]} />
          </View>
        </View>

        <View style={styles.cardFooter}>
          {item.budget > 0 && (
            <View style={styles.budgetInfo}>
              <Feather name="dollar-sign" size={11} color={overBudget ? "#ef4444" : colors.mutedForeground} />
              <Text style={[styles.budgetText, { color: overBudget ? "#ef4444" : colors.mutedForeground }]}>
                {formatCurrency(item.spent || 0)} / {formatCurrency(item.budget)}
              </Text>
            </View>
          )}
          {days !== null && item.status !== "termine" && item.status !== "annule" && (
            <View style={[styles.daysChip, { backgroundColor: days < 0 ? "#ef444418" : days < 7 ? "#f59e0b18" : "#22c55e18" }]}>
              <Feather name="clock" size={10} color={days < 0 ? "#ef4444" : days < 7 ? "#f59e0b" : "#22c55e"} />
              <Text style={[styles.daysText, { color: days < 0 ? "#ef4444" : days < 7 ? "#f59e0b" : "#22c55e" }]}>
                {days < 0 ? `${Math.abs(days)}j retard` : `${days}j restants`}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Projets</Text>
          <View style={{ width: 34 }} />
        </View>

        {stats && (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.total || 0}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: "rgba(255,255,255,0.2)" }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: "#3b82f6" }]}>{stats.en_cours || 0}</Text>
              <Text style={styles.statLabel}>En cours</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: "rgba(255,255,255,0.2)" }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: "#22c55e" }]}>{stats.termine || 0}</Text>
              <Text style={styles.statLabel}>Termines</Text>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Rechercher un projet..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {[
          { id: "all", label: "Tous", color: "#64748b" },
          ...Object.entries(STATUS_MAP).map(([id, v]) => ({ id, label: v.label, color: v.color })),
        ].map(f => (
          <Pressable
            key={f.id}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFilter(f.id);
            }}
            style={[
              styles.filterChip,
              { backgroundColor: filter === f.id ? f.color + "20" : colors.card, borderColor: filter === f.id ? f.color : colors.border },
            ]}
          >
            <Text style={[styles.filterChipText, { color: filter === f.id ? f.color : colors.mutedForeground }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : projects.length === 0 ? (
        <View style={styles.emptyCenter}>
          <Feather name="folder" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Aucun projet</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Creez des projets depuis le web</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={i => String(i.id)}
          renderItem={renderProject}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal visible={!!selected} animationType="slide" transparent>
        {selected && (
          <View style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
            <View style={[styles.modalContent, { backgroundColor: colors.background, paddingTop: insets.top + 10 }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Detail Projet</Text>
                <Pressable onPress={() => setSelected(null)} style={[styles.closeBtn, { backgroundColor: colors.muted }]}>
                  <Feather name="x" size={18} color={colors.foreground} />
                </Pressable>
              </View>

              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.detailTitle, { color: colors.foreground }]}>{selected.title}</Text>
                  {selected.description && (
                    <Text style={[styles.detailDesc, { color: colors.mutedForeground }]}>{selected.description}</Text>
                  )}

                  <View style={styles.detailStatusRow}>
                    {(() => { const st = STATUS_MAP[selected.status] || STATUS_MAP.planifie; return (
                      <View style={[styles.statusLarge, { backgroundColor: st.color + "18" }]}>
                        <Feather name={st.icon} size={16} color={st.color} />
                        <Text style={[styles.statusLargeText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    ); })()}
                    {(() => { const pr = PRIORITY_MAP[selected.priority] || PRIORITY_MAP.moyenne; return (
                      <View style={[styles.statusLarge, { backgroundColor: pr.color + "18" }]}>
                        <Feather name="flag" size={14} color={pr.color} />
                        <Text style={[styles.statusLargeText, { color: pr.color }]}>{pr.label}</Text>
                      </View>
                    ); })()}
                  </View>

                  <View style={styles.progressDetail}>
                    <View style={styles.progressHeader}>
                      <Text style={[styles.progressLabel, { color: colors.foreground }]}>Avancement global</Text>
                      <Text style={[styles.progressPct, { color: colors.primary }]}>{selected.progress || 0}%</Text>
                    </View>
                    <View style={[styles.progressBarLarge, { backgroundColor: colors.muted }]}>
                      <View style={[styles.progressFillLarge, { width: `${selected.progress || 0}%`, backgroundColor: colors.primary }]} />
                    </View>
                  </View>

                  {selected.budget > 0 && (
                    <View style={styles.budgetDetail}>
                      <View style={styles.progressHeader}>
                        <Text style={[styles.progressLabel, { color: colors.foreground }]}>Budget</Text>
                        <Text style={[styles.budgetPct, { color: ((selected.spent || 0) / selected.budget) > 0.9 ? "#ef4444" : colors.mutedForeground }]}>
                          {formatCurrency(selected.spent || 0)} / {formatCurrency(selected.budget)}
                        </Text>
                      </View>
                      <View style={[styles.progressBarLarge, { backgroundColor: colors.muted }]}>
                        <View style={[styles.progressFillLarge, {
                          width: `${Math.min(100, Math.round(((selected.spent || 0) / selected.budget) * 100))}%`,
                          backgroundColor: ((selected.spent || 0) / selected.budget) > 0.9 ? "#ef4444" : "#22c55e"
                        }]} />
                      </View>
                    </View>
                  )}

                  {[
                    { icon: "briefcase" as const, label: "Client", value: selected.clientCompany || selected.clientName || "-" },
                    { icon: "user" as const, label: "Responsable", value: selected.assignedTo || "-" },
                    { icon: "calendar" as const, label: "Debut", value: formatDate(selected.startDate) },
                    { icon: "flag" as const, label: "Fin prevue", value: formatDate(selected.endDate) },
                  ].map(r => (
                    <View key={r.label} style={[styles.infoRow, { borderColor: colors.border }]}>
                      <Feather name={r.icon} size={14} color={colors.mutedForeground} />
                      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{r.label}</Text>
                      <Text style={[styles.infoValue, { color: colors.foreground }]}>{r.value}</Text>
                    </View>
                  ))}

                  {selected.notes && (
                    <View style={[styles.notesSection, { borderColor: colors.border }]}>
                      <Text style={[styles.notesTitle, { color: colors.foreground }]}>Notes</Text>
                      <Text style={[styles.notesText, { color: colors.mutedForeground }]}>{selected.notes}</Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  statsRow: { flexDirection: "row", marginTop: 14, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12 },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
  statDivider: { width: 1, height: 30 },
  searchBar: { flexDirection: "row", alignItems: "center", margin: 16, marginBottom: 0, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  filterScroll: { maxHeight: 48, marginTop: 12 },
  filterContent: { paddingHorizontal: 16, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  listContent: { padding: 16, gap: 10 },
  projectCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  statusBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, gap: 4 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  priorBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  priorText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  projectTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  clientRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  clientText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  progressSection: { marginTop: 10 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  progressLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  progressValue: { fontSize: 12, fontFamily: "Inter_700Bold" },
  progressBar: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  cardFooter: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 },
  budgetInfo: { flexDirection: "row", alignItems: "center", gap: 4 },
  budgetText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  daysChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: "auto" },
  daysText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalContent: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: 40 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  detailCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 20 },
  detailTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  detailDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 6 },
  detailStatusRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  statusLarge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, gap: 6 },
  statusLargeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  progressDetail: { marginTop: 16 },
  progressPct: { fontSize: 14, fontFamily: "Inter_700Bold" },
  progressBarLarge: { height: 8, borderRadius: 4, overflow: "hidden", marginTop: 4 },
  progressFillLarge: { height: "100%", borderRadius: 4 },
  budgetDetail: { marginTop: 14 },
  budgetPct: { fontSize: 12, fontFamily: "Inter_500Medium" },
  infoRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  infoLabel: { fontSize: 12, fontFamily: "Inter_500Medium", width: 80 },
  infoValue: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1, textAlign: "right" },
  notesSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  notesTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  notesText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
