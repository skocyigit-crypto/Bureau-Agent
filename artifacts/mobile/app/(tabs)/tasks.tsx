import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
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

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useUnreadBadges } from "@/contexts/UnreadBadgesContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  en_attente: { label: "En attente", color: "#f59e0b", icon: "clock" },
  en_cours: { label: "En cours", color: "#3b82f6", icon: "play-circle" },
  termine: { label: "Termine", color: "#22c55e", icon: "check-circle" },
  annule: { label: "Annule", color: "#64748b", icon: "x-circle" },
};

const PRIORITY_COLORS: Record<string, string> = {
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#22c55e",
};

const PRIORITY_LABELS: Record<string, string> = {
  haute: "Haute",
  moyenne: "Moyenne",
  basse: "Basse",
};

const FORM_FIELDS = [
  { key: "title", label: "Titre", required: true },
  { key: "description", label: "Description", type: "multiline" as const },
  {
    key: "priority", label: "Priorite", type: "select" as const, options: [
      { value: "basse", label: "Basse" },
      { value: "moyenne", label: "Moyenne" },
      { value: "haute", label: "Haute" },
    ],
  },
  {
    key: "status", label: "Statut", type: "select" as const, options: [
      { value: "en_attente", label: "En attente" },
      { value: "en_cours", label: "En cours" },
      { value: "termine", label: "Termine" },
    ],
  },
  { key: "assignedTo", label: "Assigne a" },
];

function LeftAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeAction, styles.swipeLeft, { transform: [{ scale }] }]}>
      <Feather name="check-circle" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Terminer</Text>
    </Animated.View>
  );
}

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeAction, styles.swipeRight, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Supprimer</Text>
    </Animated.View>
  );
}

interface SwipeableTaskProps {
  item: Task;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onToggle: (task: Task) => void;
  onDelete: (id: number) => void;
  onOpen: (task: Task) => void;
}

function SwipeableTask({ item, colors, onToggle, onDelete, onOpen }: SwipeableTaskProps) {
  const swipeRef = useRef<Swipeable>(null);
  const status = STATUS_MAP[item.status] ?? { label: item.status, color: "#64748b", icon: "circle" as const };
  const prioColor = PRIORITY_COLORS[item.priority] ?? colors.mutedForeground;

  function getDueDateInfo(dateStr: string | null) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / 86400000);
    if (diffDays < 0) return { label: `${Math.abs(diffDays)}j retard`, color: "#ef4444", urgent: true };
    if (diffDays === 0) return { label: "Aujourd'hui", color: "#f59e0b", urgent: true };
    if (diffDays === 1) return { label: "Demain", color: "#f59e0b", urgent: false };
    if (diffDays <= 3) return { label: `${diffDays}j`, color: "#3b82f6", urgent: false };
    return { label: new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), color: colors.mutedForeground, urgent: false };
  }

  const dueInfo = item.status !== "termine" ? getDueDateInfo(item.dueDate) : null;

  function handleSwipeOpen(direction: "left" | "right") {
    swipeRef.current?.close();
    if (direction === "left") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onToggle(item);
    } else {
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
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={(progress) => <LeftAction progress={progress} />}
      renderRightActions={(progress) => <RightAction progress={progress} />}
      onSwipeableOpen={handleSwipeOpen}
      enabled={item.status !== "annule"}
    >
      <View
        style={[
          styles.taskRow,
          { backgroundColor: colors.card, borderColor: dueInfo?.urgent ? dueInfo.color + "40" : colors.border },
          dueInfo?.urgent && { borderLeftWidth: 3, borderLeftColor: dueInfo.color },
        ]}
      >
        <Pressable onPress={() => onToggle(item)} style={[styles.checkCircle, { borderColor: status.color }]}>
          {item.status === "termine" ? <Feather name="check" size={14} color={status.color} /> : null}
        </Pressable>
        <Pressable onPress={() => onOpen(item)} style={styles.taskContent}>
          <Text
            style={[styles.taskTitle, { color: colors.foreground }, item.status === "termine" && styles.taskDone]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <View style={styles.taskMeta}>
            <View style={[styles.prioDot, { backgroundColor: prioColor }]} />
            <Text style={[styles.taskMetaText, { color: colors.mutedForeground }]}>
              {PRIORITY_LABELS[item.priority] ?? item.priority}
            </Text>
            {dueInfo ? (
              <View style={[styles.dueBadge, { backgroundColor: dueInfo.color + "15" }]}>
                <Feather name={dueInfo.urgent ? "alert-circle" : "clock"} size={10} color={dueInfo.color} />
                <Text style={[styles.dueBadgeText, { color: dueInfo.color }]}>{dueInfo.label}</Text>
              </View>
            ) : item.dueDate ? (
              <>
                <Text style={[styles.taskMetaText, { color: colors.mutedForeground }]}> · </Text>
                <Text style={[styles.taskMetaText, { color: colors.mutedForeground }]}>
                  {new Date(item.dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                </Text>
              </>
            ) : null}
          </View>
        </Pressable>
        <View style={[styles.statusPill, { backgroundColor: status.color + "18" }]}>
          <Feather name={status.icon} size={12} color={status.color} />
        </View>
      </View>
    </Swipeable>
  );
}

export default function TasksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const { clearKey } = useUnreadBadges();
  const isWeb = Platform.OS === "web";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ priority: "moyenne", status: "en_attente" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const { cached, isFromCache, updateCache } = useOfflineCache<Task[]>("tasks_list", []);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/tasks?${params}`);
      if (res.ok) {
        const data = await res.json();
        const list: Task[] = data.tasks ?? [];
        setTasks(list);
        if (filter === "all" && !search) updateCache(list);
      }
    } catch {
      if (cached.length > 0 && tasks.length === 0) setTasks(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth, cached, tasks.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && tasks.length === 0) setTasks(cached);
  }, [isFromCache, cached, tasks.length]);

  useEffect(() => { setLoading(true); fetchTasks(); }, [fetchTasks]);

  // Vider le badge "tâches non lues" dès que l'écran prend le focus
  // (mirroir du clear côté sidebar web — Tâche #75).
  useFocusEffect(
    useCallback(() => {
      clearKey("task");
    }, [clearKey]),
  );

  function onRefresh() { setRefreshing(true); fetchTasks(); }

  async function toggleStatus(task: Task) {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const nextStatus = task.status === "termine" ? "en_attente" : task.status === "en_attente" ? "en_cours" : "termine";
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: nextStatus } : t));
    try {
      await fetchAuth(`${API_BASE}/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      fetchTasks();
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    }
  }

  async function handleDelete(id: number) {
    setTasks(prev => prev.filter(t => t.id !== id));
    try {
      await fetchAuth(`${API_BASE}/api/tasks/${id}`, { method: "DELETE" });
      setSelected(null);
    } catch {
      fetchTasks();
    }
  }

  async function handleSubmit() {
    if (!formValues.title?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/tasks/${editId}` : `${API_BASE}/api/tasks`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ priority: "moyenne", status: "en_attente" });
        fetchTasks();
      }
    } catch {
      if (Platform.OS !== "web") Alert.alert("Erreur", "Impossible de sauvegarder la tache.");
    } finally { setFormLoading(false); }
  }

  function openEdit(task: Task) {
    setEditId(task.id);
    setFormValues({
      title: task.title || "",
      description: task.description || "",
      priority: task.priority || "moyenne",
      status: task.status || "en_attente",
      assignedTo: task.assignedTo || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  function openNew() {
    setEditId(null);
    setFormValues({ priority: "moyenne", status: "en_attente" });
    setShowForm(true);
  }

  const statsRow = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === "en_attente").length,
    inProgress: tasks.filter(t => t.status === "en_cours").length,
    done: tasks.filter(t => t.status === "termine").length,
    overdue: tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "termine").length,
  };

  const filters = [
    { key: "all", label: "Toutes" },
    { key: "en_attente", label: "Attente" },
    { key: "en_cours", label: "En cours" },
    { key: "termine", label: "Terminees" },
  ];

  const hintText = isWeb ? "" : "← Terminer  |  Supprimer →";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Taches</Text>
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
            placeholder="Rechercher une tache..."
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
          data={tasks}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            tasks.length > 0 ? (
              <>
                <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: colors.primary }]}>{statsRow.total}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Total</Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: "#f59e0b" }]}>{statsRow.pending}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Attente</Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: "#3b82f6" }]}>{statsRow.inProgress}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En cours</Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statNum, { color: "#22c55e" }]}>{statsRow.done}</Text>
                    <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Faites</Text>
                  </View>
                  {statsRow.overdue > 0 && (
                    <>
                      <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                      <View style={styles.statItem}>
                        <Text style={[styles.statNum, { color: "#ef4444" }]}>{statsRow.overdue}</Text>
                        <Text style={[styles.statLbl, { color: "#ef4444" }]}>Retard</Text>
                      </View>
                    </>
                  )}
                </View>
                {!isWeb && (
                  <Text style={[styles.swipeHint, { color: colors.mutedForeground }]}>{hintText}</Text>
                )}
              </>
            ) : null
          }
          ListEmptyComponent={<EmptyState icon="check-square" title="Aucune tache" subtitle="Vos taches apparaitront ici" />}
          renderItem={({ item }) => (
            <SwipeableTask
              item={item}
              colors={colors}
              onToggle={toggleStatus}
              onDelete={handleDelete}
              onOpen={setSelected}
            />
          )}
        />
      )}

      <FAB icon="plus" onPress={openNew} />

      <FormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditId(null); }}
        onSubmit={handleSubmit}
        title={editId ? "Modifier la tache" : "Nouvelle tache"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="check-square"
        submitLabel={editId ? "Enregistrer" : "Creer"}
      />

      {selected ? (
        <DetailModal
          visible
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => handleDelete(selected.id)}
          title={selected.title}
          subtitle={selected.description}
          icon={(STATUS_MAP[selected.status]?.icon ?? "check-square") as keyof typeof Feather.glyphMap}
          iconColor={STATUS_MAP[selected.status]?.color}
          badge={{ label: STATUS_MAP[selected.status]?.label ?? selected.status, color: STATUS_MAP[selected.status]?.color ?? "#64748b" }}
          fields={[
            { label: "Priorite", value: PRIORITY_LABELS[selected.priority] ?? selected.priority, icon: "flag", color: PRIORITY_COLORS[selected.priority] },
            { label: "Statut", value: STATUS_MAP[selected.status]?.label ?? selected.status, icon: "info" },
            ...(selected.dueDate ? [{ label: "Echeance", value: new Date(selected.dueDate).toLocaleDateString("fr-FR"), icon: "calendar" as const }] : []),
            ...(selected.assignedTo ? [{ label: "Assigne a", value: selected.assignedTo, icon: "user" as const }] : []),
            ...(selected.description ? [{ label: "Description", value: selected.description, icon: "file-text" as const }] : []),
          ]}
          extraActions={[{
            label: "Créer un projet",
            icon: "folder",
            color: "#6366f1",
            onPress: async () => {
              try {
                const res = await fetchAuth(`${API_BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: selected.title, status: "planifie", priority: selected.priority || "moyenne", progress: 0, notes: `Créé depuis la tâche mobile` }) });
                if (res.ok) { setSelected(null); router.push("/projets" as any); }
              } catch {}
            },
          }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
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
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  checkCircle: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  taskContent: { flex: 1, marginRight: 8 },
  taskTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  taskDone: { textDecorationLine: "line-through", opacity: 0.5 },
  taskMeta: { flexDirection: "row", alignItems: "center", marginTop: 4, flexWrap: "wrap", gap: 4 },
  prioDot: { width: 6, height: 6, borderRadius: 3, marginRight: 2 },
  taskMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dueBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 4 },
  dueBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  statusPill: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  swipeAction: {
    justifyContent: "center",
    alignItems: "center",
    width: 90,
    borderRadius: 12,
    marginBottom: 8,
    gap: 4,
  },
  swipeLeft: { backgroundColor: "#22c55e" },
  swipeRight: { backgroundColor: "#ef4444" },
  swipeActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
