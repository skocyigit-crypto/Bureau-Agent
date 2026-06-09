import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  listProjets,
  getProjetStats,
  createProjet,
  updateProjet,
  deleteProjet,
  type Projet,
  type ListProjetsParams,
  type CreateProjetBody,
  type UpdateProjetBody,
} from "@workspace/api-client-react";

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

const STATUS_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  planifie: { label: "Planifie", color: "#64748b", icon: "calendar" },
  en_cours: { label: "En cours", color: "#3b82f6", icon: "play-circle" },
  en_pause: { label: "En pause", color: "#f59e0b", icon: "pause-circle" },
  termine: { label: "Termine", color: "#22c55e", icon: "check-circle" },
  annule: { label: "Annule", color: "#ef4444", icon: "x-circle" },
};

const PRIORITY_COLORS: Record<string, string> = {
  critique: "#dc2626",
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#22c55e",
};

const PRIORITY_LABELS: Record<string, string> = {
  critique: "Critique",
  haute: "Haute",
  moyenne: "Moyenne",
  basse: "Basse",
};

const FORM_FIELDS = [
  { key: "title", label: "Titre du projet", required: true },
  { key: "clientName", label: "Nom du client" },
  { key: "clientCompany", label: "Entreprise" },
  {
    key: "priority", label: "Priorite", type: "select" as const, options: [
      { value: "basse", label: "Basse" },
      { value: "moyenne", label: "Moyenne" },
      { value: "haute", label: "Haute" },
      { value: "critique", label: "Critique" },
    ],
  },
  {
    key: "status", label: "Statut", type: "select" as const, options: [
      { value: "planifie", label: "Planifie" },
      { value: "en_cours", label: "En cours" },
      { value: "en_pause", label: "En pause" },
      { value: "termine", label: "Termine" },
      { value: "annule", label: "Annule" },
    ],
  },
  { key: "assignedTo", label: "Responsable" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeAction, styles.swipeRight, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Supprimer</Text>
    </Animated.View>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <View style={styles.progressBarTrack}>
      <View style={[styles.progressBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}

interface SwipeableProjetProps {
  item: Projet;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (projet: Projet) => void;
}

function SwipeableProjet({ item, colors, onDelete, onOpen }: SwipeableProjetProps) {
  const swipeRef = useRef<Swipeable>(null);
  const status = STATUS_MAP[item.status] ?? { label: item.status, color: "#64748b", icon: "circle" as const };
  const prioColor = PRIORITY_COLORS[item.priority] ?? colors.mutedForeground;

  const isOverdue = item.endDate && new Date(item.endDate) < new Date() && item.status !== "termine" && item.status !== "annule";
  const daysLeft = item.endDate ? Math.ceil((new Date(item.endDate).getTime() - Date.now()) / 86400000) : null;

  function handleSwipeOpen(direction: "left" | "right") {
    swipeRef.current?.close();
    if (direction === "right") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (Platform.OS === "web") {
        onDelete(item.id);
      } else {
        Alert.alert("Supprimer", `Supprimer "${item.title}" ?`, [
          { text: "Annuler", style: "cancel" },
          { text: "Supprimer", style: "destructive", onPress: () => onDelete(item.id) },
        ]);
      }
    }
  }

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      renderRightActions={(progress) => <RightAction progress={progress} />}
      onSwipeableOpen={handleSwipeOpen}
    >
      <Pressable
        onPress={() => onOpen(item)}
        style={({ pressed }) => [
          styles.projetRow,
          { backgroundColor: colors.card, borderColor: isOverdue ? "#ef444440" : colors.border },
          isOverdue && { borderLeftWidth: 3, borderLeftColor: "#ef4444" },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.projetHeader}>
          <View style={styles.projetTitleRow}>
            <View style={[styles.prioDot, { backgroundColor: prioColor }]} />
            <Text style={[styles.projetTitle, { color: colors.foreground }]} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: status.color + "18" }]}>
            <Feather name={status.icon} size={11} color={status.color} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        {item.clientName ? (
          <Text style={[styles.projetClient, { color: colors.mutedForeground }]} numberOfLines={1}>
            <Feather name="briefcase" size={11} color={colors.mutedForeground} /> {item.clientName}{item.clientCompany ? ` · ${item.clientCompany}` : ""}
          </Text>
        ) : null}

        <View style={styles.projetProgressRow}>
          <ProgressBar value={item.progress} color={status.color} />
          <Text style={[styles.projetProgressPct, { color: colors.mutedForeground }]}>{item.progress}%</Text>
        </View>

        <View style={styles.projetMeta}>
          {daysLeft !== null && item.status !== "termine" && item.status !== "annule" ? (
            <View style={[styles.dueBadge, { backgroundColor: isOverdue ? "#ef444415" : "#3b82f615" }]}>
              <Feather name={isOverdue ? "alert-circle" : "clock"} size={10} color={isOverdue ? "#ef4444" : "#3b82f6"} />
              <Text style={[styles.dueBadgeText, { color: isOverdue ? "#ef4444" : "#3b82f6" }]}>
                {isOverdue ? `${Math.abs(daysLeft)}j retard` : `${daysLeft}j restant`}
              </Text>
            </View>
          ) : null}
          {item.assignedTo ? (
            <View style={styles.metaChip}>
              <Feather name="user" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaChipText, { color: colors.mutedForeground }]} numberOfLines={1}>{item.assignedTo}</Text>
            </View>
          ) : null}
          {item.budget && Number(item.budget) > 0 ? (
            <View style={styles.metaChip}>
              <Feather name="dollar-sign" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>
                {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(item.budget))} €
              </Text>
            </View>
          ) : null}
          {item.milestones && item.milestones.length > 0 ? (
            <View style={styles.metaChip}>
              <Feather name="check-square" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>
                {item.milestones.filter(m => m.completed).length}/{item.milestones.length}
              </Text>
            </View>
          ) : null}
        </View>
        {item.tags && item.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {item.tags.slice(0, 3).map(t => (
              <View key={t} style={styles.tagPill}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
            {item.tags.length > 3 ? (
              <View style={styles.tagPill}>
                <Text style={styles.tagText}>+{item.tags.length - 3}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Swipeable>
  );
}

export default function ProjetsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const [projets, setProjets] = useState<Projet[]>([]);
  const [stats, setStats] = useState({ total: 0, actifs: 0, enRetard: 0, termines: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ priority: "moyenne", status: "planifie" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<Projet | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const { cached, isFromCache, updateCache } = useOfflineCache<Projet[]>("projets_list", []);

  const fetchProjets = useCallback(async () => {
    try {
      const params: ListProjetsParams = { limit: 50, sortOrder: "desc" };
      if (filter !== "all") params.status = filter as ListProjetsParams["status"];
      if (search) params.search = search;
      const [projData, statsData] = await Promise.all([
        listProjets(params),
        getProjetStats(),
      ]);
      const list = projData.projets;
      setProjets(list);
      if (filter === "all" && !search) updateCache(list);
      setStats({
        total: statsData.total,
        actifs: statsData.active,
        enRetard: statsData.overdue,
        termines: statsData.termine,
      });
    } catch {
      if (cached.length > 0 && projets.length === 0) setProjets(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, cached, projets.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && projets.length === 0) setProjets(cached);
  }, [isFromCache, cached, projets.length]);

  useEffect(() => { setLoading(true); fetchProjets(); }, [fetchProjets]);

  function onRefresh() { setRefreshing(true); fetchProjets(); }

  async function handleDelete(id: number) {
    setProjets(prev => prev.filter(p => p.id !== id));
    try {
      await deleteProjet(id);
      setSelected(null);
      fetchProjets();
    } catch {
      fetchProjets();
    }
  }

  async function handleSubmit() {
    const title = formValues.title?.trim();
    if (!title) return;
    setFormLoading(true);
    try {
      const status = formValues.status as UpdateProjetBody["status"];
      const fields = {
        clientName: formValues.clientName ?? "",
        clientCompany: formValues.clientCompany ?? "",
        priority: formValues.priority || undefined,
        status,
        assignedTo: formValues.assignedTo ?? "",
        notes: formValues.notes ?? "",
      };
      if (editId) {
        await updateProjet(editId, { title, ...fields } satisfies UpdateProjetBody);
      } else {
        await createProjet({ title, ...fields } satisfies CreateProjetBody);
      }
      setShowForm(false);
      setEditId(null);
      setFormValues({ priority: "moyenne", status: "planifie" });
      fetchProjets();
    } catch {
      if (Platform.OS !== "web") Alert.alert("Erreur", "Impossible de sauvegarder le projet.");
    } finally { setFormLoading(false); }
  }

  function openEdit(projet: Projet) {
    setEditId(projet.id);
    setFormValues({
      title: projet.title || "",
      clientName: projet.clientName || "",
      clientCompany: projet.clientCompany || "",
      priority: projet.priority || "moyenne",
      status: projet.status || "planifie",
      assignedTo: projet.assignedTo || "",
      notes: projet.notes || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  function openNew() {
    setEditId(null);
    setFormValues({ priority: "moyenne", status: "planifie" });
    setShowForm(true);
  }

  const localStats = {
    total: projets.length,
    actifs: projets.filter(p => p.status === "en_cours").length,
    enRetard: projets.filter(p => p.endDate && new Date(p.endDate) < new Date() && p.status !== "termine" && p.status !== "annule").length,
    termines: projets.filter(p => p.status === "termine").length,
  };

  const filters = [
    { key: "all", label: "Tous" },
    { key: "en_cours", label: "En cours" },
    { key: "planifie", label: "Planifies" },
    { key: "termine", label: "Termines" },
  ];

  const hintText = isWeb ? "" : "Glisser → Supprimer";

  const detailFields = selected ? [
    { label: "Statut", value: STATUS_MAP[selected.status]?.label ?? selected.status },
    { label: "Priorite", value: PRIORITY_LABELS[selected.priority] ?? selected.priority },
    { label: "Client", value: selected.clientName ?? "—" },
    { label: "Entreprise", value: selected.clientCompany ?? "—" },
    { label: "Progression", value: `${selected.progress}%` },
    { label: "Responsable", value: selected.assignedTo ?? "—" },
    { label: "Budget", value: selected.budget && Number(selected.budget) > 0 ? `${new Intl.NumberFormat("fr-FR").format(Number(selected.budget))} €` : "—" },
    { label: "Depenses", value: selected.spent && Number(selected.spent) > 0 ? `${new Intl.NumberFormat("fr-FR").format(Number(selected.spent))} €` : "—" },
    { label: "Debut", value: selected.startDate ? new Date(selected.startDate).toLocaleDateString("fr-FR") : "—" },
    { label: "Echeance", value: selected.endDate ? new Date(selected.endDate).toLocaleDateString("fr-FR") : "—" },
    ...(selected.milestones && selected.milestones.length > 0 ? [{
      label: "Jalons",
      value: `${selected.milestones.filter(m => m.completed).length}/${selected.milestones.length} completes — ${selected.milestones.map(m => `${m.completed ? "✓" : "○"} ${m.title}`).join(", ")}`,
      icon: "check-square" as const,
    }] : []),
    ...(selected.tags && selected.tags.length > 0 ? [{
      label: "Tags",
      value: selected.tags.join(", "),
      icon: "tag" as const,
    }] : []),
    { label: "Notes", value: selected.notes ?? "—" },
  ] : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Projets</Text>
          {isFromCache && (
            <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
              <Text style={styles.cacheText}>Cache</Text>
            </View>
          )}
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un projet..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>
        <View style={styles.filterRow}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, { backgroundColor: filter === f.key ? colors.primary : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.filterText, { color: filter === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={projets}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            projets.length > 0 ? (
              <>
                <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: colors.foreground }]}>{localStats.total}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Total</Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: "#3b82f6" }]}>{localStats.actifs}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En cours</Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: localStats.enRetard > 0 ? "#ef4444" : colors.foreground }]}>{localStats.enRetard}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En retard</Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: "#22c55e" }]}>{localStats.termines}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Termines</Text>
                  </View>
                </View>
                {!isWeb && <Text style={[styles.swipeHint, { color: colors.mutedForeground }]}>{hintText}</Text>}
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="folder"
              title="Aucun projet"
              subtitle={search ? "Aucun projet ne correspond a votre recherche." : "Commencez par creer votre premier projet."}
            />
          }
          renderItem={({ item }) => (
            <SwipeableProjet
              item={item}
              colors={colors}
              onDelete={handleDelete}
              onOpen={setSelected}
            />
          )}
        />
      )}

      <FAB onPress={openNew} icon="plus" />

      <FormModal
        visible={showForm}
        title={editId ? "Modifier le projet" : "Nouveau projet"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        onSubmit={handleSubmit}
        onClose={() => { setShowForm(false); setEditId(null); }}
        loading={formLoading}
        submitLabel={editId ? "Enregistrer" : "Creer"}
      />

      <DetailModal
        visible={!!selected}
        icon="folder"
        iconColor="#6366f1"
        title={selected?.title ?? ""}
        subtitle={selected ? `${STATUS_MAP[selected.status]?.label ?? selected.status} · ${selected.progress}%` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        onEdit={selected ? () => openEdit(selected) : undefined}
        onDelete={selected ? () => {
          if (Platform.OS === "web") {
            handleDelete(selected.id);
          } else {
            Alert.alert("Supprimer", `Supprimer "${selected.title}" ?`, [
              { text: "Annuler", style: "cancel" },
              { text: "Supprimer", style: "destructive", onPress: () => handleDelete(selected.id) },
            ]);
          }
        } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  cacheBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  cacheText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDivider: { width: 1, height: 28 },
  swipeHint: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 10, opacity: 0.5 },
  projetRow: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  projetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  projetTitleRow: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 },
  prioDot: { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  projetTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  projetClient: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  projetProgressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  progressBarTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#e2e8f0", overflow: "hidden" },
  progressBarFill: { height: "100%", borderRadius: 3 },
  projetProgressPct: { fontSize: 11, fontFamily: "Inter_600SemiBold", minWidth: 30, textAlign: "right" },
  projetMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  dueBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  dueBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaChipText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  swipeAction: {
    justifyContent: "center",
    alignItems: "center",
    width: 90,
    borderRadius: 12,
    marginBottom: 8,
    gap: 4,
  },
  swipeRight: { backgroundColor: "#ef4444" },
  swipeActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  tagPill: { backgroundColor: "#6366f118", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  tagText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6366f1" },
});
