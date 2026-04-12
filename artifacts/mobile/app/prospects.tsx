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

interface Prospect {
  id: number;
  title: string;
  contactName: string;
  company: string;
  email: string;
  phone: string;
  stage: string;
  value: number;
  probability: number;
  priority: string;
  source: string;
  notes: string;
  createdAt: string;
}

interface PipelineStats {
  totalValue: number;
  totalCount: number;
  wonCount: number;
  wonValue: number;
  avgProbability: number;
}

const STAGES = [
  { id: "all", label: "Tous", color: "#64748b" },
  { id: "nouveau", label: "Nouveau", color: "#6366f1" },
  { id: "contact", label: "Contact", color: "#3b82f6" },
  { id: "qualification", label: "Qualif.", color: "#0ea5e9" },
  { id: "proposition", label: "Propos.", color: "#f59e0b" },
  { id: "negociation", label: "Nego.", color: "#f97316" },
  { id: "gagne", label: "Gagne", color: "#22c55e" },
  { id: "perdu", label: "Perdu", color: "#ef4444" },
];

const PRIORITY_COLORS: Record<string, string> = {
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#22c55e",
};

function getLeadScore(p: Prospect): { score: number; grade: string; color: string } {
  let score = 20;
  if (p.email) score += 10;
  if (p.phone) score += 10;
  if (p.company) score += 10;
  if (p.stage === "gagne") score += 30;
  else if (p.stage === "negociation") score += 25;
  else if (p.stage === "proposition") score += 20;
  else if (p.stage === "qualification") score += 15;
  else if (p.stage === "contact") score += 10;
  if ((p.value || 0) > 10000) score += 10;
  else if ((p.value || 0) > 5000) score += 5;
  if (p.priority === "haute") score += 10;
  score = Math.min(score, 100);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : score >= 20 ? "E" : "F";
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  return { score, grade, color };
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

export default function ProspectsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [selected, setSelected] = useState<Prospect | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (stage !== "all") params.set("stage", stage);
      if (search) params.set("search", search);
      const [pRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/prospects?${params}`),
        fetchAuth(`${API_BASE}/api/prospects/pipeline`),
      ]);
      if (pRes.ok) {
        const d = await pRes.json();
        setProspects(d.prospects || []);
      }
      if (sRes.ok) {
        const d = await sRes.json();
        setStats(d.stats || null);
      }
    } catch (e) {
      console.warn("[Prospects] fetch error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, stage, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  const filteredProspects = useMemo(() => {
    if (!search) return prospects;
    const q = search.toLowerCase();
    return prospects.filter(p =>
      p.title?.toLowerCase().includes(q) ||
      p.contactName?.toLowerCase().includes(q) ||
      p.company?.toLowerCase().includes(q)
    );
  }, [prospects, search]);

  const stageInfo = (sid: string) => STAGES.find(s => s.id === sid) || STAGES[0];

  function renderProspect({ item }: { item: Prospect }) {
    const si = stageInfo(item.stage);
    const ls = getLeadScore(item);
    return (
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelected(item);
        }}
        style={({ pressed }) => [
          styles.prospectCard,
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.stageBadge, { backgroundColor: si.color + "20" }]}>
            <View style={[styles.stageDot, { backgroundColor: si.color }]} />
            <Text style={[styles.stageText, { color: si.color }]}>{si.label}</Text>
          </View>
          <View style={[styles.scoreBadge, { backgroundColor: ls.color + "18" }]}>
            <Text style={[styles.scoreText, { color: ls.color }]}>{ls.grade}</Text>
          </View>
        </View>

        <Text style={[styles.prospectTitle, { color: colors.foreground }]} numberOfLines={1}>
          {item.title || item.contactName}
        </Text>

        {item.company ? (
          <View style={styles.infoRow}>
            <Feather name="briefcase" size={12} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]} numberOfLines={1}>{item.company}</Text>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Feather name="user" size={12} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]} numberOfLines={1}>{item.contactName}</Text>
        </View>

        <View style={styles.cardFooter}>
          <Text style={[styles.valueText, { color: colors.primary }]}>
            {formatCurrency(item.value || 0)}
          </Text>
          {item.priority ? (
            <View style={[styles.priorityBadge, { backgroundColor: (PRIORITY_COLORS[item.priority] || "#64748b") + "18" }]}>
              <Text style={[styles.priorityText, { color: PRIORITY_COLORS[item.priority] || "#64748b" }]}>
                {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
              </Text>
            </View>
          ) : null}
          {item.probability ? (
            <Text style={[styles.probText, { color: colors.mutedForeground }]}>{item.probability}%</Text>
          ) : null}
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
          <Text style={styles.headerTitle}>Prospection CRM</Text>
          <View style={{ width: 34 }} />
        </View>

        {stats && (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.totalCount}</Text>
              <Text style={styles.statLabel}>Prospects</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: "rgba(255,255,255,0.2)" }]} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatCurrency(stats.totalValue)}</Text>
              <Text style={styles.statLabel}>Pipeline</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: "rgba(255,255,255,0.2)" }]} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.wonCount}</Text>
              <Text style={styles.statLabel}>Gagnes</Text>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Rechercher..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <Pressable onPress={() => setSearch("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {STAGES.map(s => (
          <Pressable
            key={s.id}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setStage(s.id);
            }}
            style={[
              styles.filterChip,
              { backgroundColor: stage === s.id ? s.color + "25" : colors.card, borderColor: stage === s.id ? s.color : colors.border },
            ]}
          >
            {s.id !== "all" && <View style={[styles.chipDot, { backgroundColor: s.color }]} />}
            <Text style={[styles.filterText, { color: stage === s.id ? s.color : colors.mutedForeground }]}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : filteredProspects.length === 0 ? (
        <View style={styles.emptyCenter}>
          <Feather name="briefcase" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Aucun prospect</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Ajoutez des prospects depuis le web</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProspects}
          keyExtractor={i => String(i.id)}
          renderItem={renderProspect}
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
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Detail Prospect</Text>
                <Pressable onPress={() => setSelected(null)} style={[styles.closeBtn, { backgroundColor: colors.muted }]}>
                  <Feather name="x" size={18} color={colors.foreground} />
                </Pressable>
              </View>

              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.detailHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailName, { color: colors.foreground }]}>{selected.title || selected.contactName}</Text>
                      {selected.company && <Text style={[styles.detailCompany, { color: colors.mutedForeground }]}>{selected.company}</Text>}
                    </View>
                    {(() => { const ls = getLeadScore(selected); return (
                      <View style={[styles.scoreLarge, { backgroundColor: ls.color + "18", borderColor: ls.color }]}>
                        <Text style={[styles.scoreLargeGrade, { color: ls.color }]}>{ls.grade}</Text>
                        <Text style={[styles.scoreLargeNum, { color: ls.color }]}>{ls.score}/100</Text>
                      </View>
                    ); })()}
                  </View>

                  <View style={styles.detailGrid}>
                    {[
                      { icon: "user" as const, label: "Contact", value: selected.contactName },
                      { icon: "mail" as const, label: "Email", value: selected.email || "-" },
                      { icon: "phone" as const, label: "Tel", value: selected.phone || "-" },
                      { icon: "dollar-sign" as const, label: "Valeur", value: formatCurrency(selected.value || 0) },
                      { icon: "target" as const, label: "Probabilite", value: `${selected.probability || 0}%` },
                      { icon: "tag" as const, label: "Source", value: selected.source || "-" },
                    ].map(r => (
                      <View key={r.label} style={[styles.detailRow, { borderColor: colors.border }]}>
                        <Feather name={r.icon} size={14} color={colors.mutedForeground} />
                        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{r.label}</Text>
                        <Text style={[styles.detailValue, { color: colors.foreground }]} numberOfLines={1}>{r.value}</Text>
                      </View>
                    ))}
                  </View>

                  {selected.notes ? (
                    <View style={[styles.notesSection, { borderColor: colors.border }]}>
                      <Text style={[styles.notesTitle, { color: colors.foreground }]}>Notes</Text>
                      <Text style={[styles.notesText, { color: colors.mutedForeground }]}>{selected.notes}</Text>
                    </View>
                  ) : null}

                  <View style={styles.stageTimeline}>
                    {STAGES.filter(s => s.id !== "all").map((s, i) => {
                      const currentIdx = STAGES.findIndex(st => st.id === selected.stage);
                      const isActive = i < currentIdx;
                      const isCurrent = s.id === selected.stage;
                      return (
                        <View key={s.id} style={styles.timelineItem}>
                          <View style={[styles.timelineDot, { backgroundColor: isActive || isCurrent ? s.color : colors.muted }]} />
                          {i < STAGES.length - 2 && (
                            <View style={[styles.timelineLine, { backgroundColor: isActive ? s.color : colors.muted }]} />
                          )}
                          <Text style={[styles.timelineLabel, { color: isCurrent ? s.color : colors.mutedForeground, fontFamily: isCurrent ? "Inter_700Bold" : "Inter_400Regular" }]}>
                            {s.label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
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
  filterChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, gap: 6 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  filterText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  listContent: { padding: 16, gap: 10 },
  prospectCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  stageBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 5 },
  stageDot: { width: 6, height: 6, borderRadius: 3 },
  stageText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  scoreBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  scoreText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  prospectTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  cardFooter: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 },
  valueText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  priorityText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  probText: { fontSize: 11, fontFamily: "Inter_500Medium", marginLeft: "auto" },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalContent: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: 40 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  detailCard: { borderRadius: 12, borderWidth: 1, padding: 16 },
  detailHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  detailName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  detailCompany: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  scoreLarge: { alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 26, borderWidth: 2 },
  scoreLargeGrade: { fontSize: 18, fontFamily: "Inter_700Bold" },
  scoreLargeNum: { fontSize: 9, fontFamily: "Inter_500Medium" },
  detailGrid: {},
  detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  detailLabel: { fontSize: 12, fontFamily: "Inter_500Medium", width: 80 },
  detailValue: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1, textAlign: "right" },
  notesSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  notesTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  notesText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  stageTimeline: { flexDirection: "row", marginTop: 16, alignItems: "flex-start", justifyContent: "space-between" },
  timelineItem: { alignItems: "center", flex: 1 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 4 },
  timelineLine: { position: "absolute", top: 4, left: "60%", right: 0, height: 2 },
  timelineLabel: { fontSize: 8, textAlign: "center" },
});
