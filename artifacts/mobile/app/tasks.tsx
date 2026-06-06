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
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: string | null;
  assignedTo?: string | null;
  isRecurring?: boolean;
  createdAt: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  en_attente:  { label: "À faire",     color: "#6b7280", icon: "circle"       },
  en_cours:    { label: "En cours",    color: "#3b82f6", icon: "loader"       },
  termine:     { label: "Terminé",     color: "#22c55e", icon: "check-circle" },
  annule:      { label: "Annulé",      color: "#ef4444", icon: "x-circle"    },
};

const PRIORITY_CFG: Record<string, { label: string; color: string }> = {
  basse:    { label: "Basse",  color: "#22c55e" },
  moyenne:  { label: "Moyenne",color: "#f59e0b" },
  haute:    { label: "Haute", color: "#ef4444" },
};

const FORM_FIELDS = [
  { key: "title", label: "Titre de la tâche", required: true },
  {
    key: "status", label: "Statut", type: "select" as const, options: [
      { value: "en_attente",  label: "À faire"   },
      { value: "en_cours",    label: "En cours"  },
      { value: "termine",     label: "Terminé"   },
      { value: "annule",      label: "Annulé"    },
    ],
  },
  {
    key: "priority", label: "Priorité", type: "select" as const, options: [
      { value: "basse",    label: "Basse"    },
      { value: "moyenne",  label: "Moyenne"  },
      { value: "haute",    label: "Haute"    },
    ],
  },
  { key: "dueDate",    label: "Date d'échéance (AAAA-MM-JJ)" },
  { key: "assignedTo", label: "Assigné à" },
  { key: "description", label: "Description", type: "multiline" as const },
];

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeAction, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={20} color="#fff" />
      <Text style={styles.swipeActionText}>Supprimer</Text>
    </Animated.View>
  );
}

function LeftAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeDone, { transform: [{ scale }] }]}>
      <Feather name="check" size={20} color="#fff" />
      <Text style={styles.swipeActionText}>Terminer</Text>
    </Animated.View>
  );
}

function TaskCard({ task, colors, onDelete, onOpen, onToggleDone }: {
  task: Task;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (t: Task) => void;
  onToggleDone: (id: number, current: string) => void;
}) {
  const ref = useRef<Swipeable>(null);
  const sc = STATUS_CFG[task.status] ?? STATUS_CFG.en_attente;
  const pc = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.moyenne;
  const isDone = task.status === "termine";
  const isOverdue = task.dueDate && task.status !== "termine" && task.status !== "annule"
    && new Date(task.dueDate) < new Date();

  function handleSwipeOpen(direction: "left" | "right") {
    ref.current?.close();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (direction === "right") {
      if (Platform.OS === "web") { onDelete(task.id); return; }
      Alert.alert("Supprimer", `Supprimer "${task.title}" ?`, [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: () => onDelete(task.id) },
      ]);
    } else {
      onToggleDone(task.id, task.status);
    }
  }

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootRight={false}
      overshootLeft={false}
      renderRightActions={p => <RightAction progress={p} />}
      renderLeftActions={!isDone ? p => <LeftAction progress={p} /> : undefined}
      onSwipeableOpen={handleSwipeOpen}
    >
      <Pressable
        onPress={() => onOpen(task)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: sc.color + "30",
            borderLeftWidth: 3,
            borderLeftColor: isDone ? "#22c55e" : pc.color,
            opacity: isDone ? 0.75 : 1,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.cardHeader}>
          <Pressable
            onPress={() => onToggleDone(task.id, task.status)}
            style={[styles.checkBtn, { borderColor: sc.color, backgroundColor: isDone ? "#22c55e18" : "transparent" }]}
          >
            {isDone && <Feather name="check" size={12} color="#22c55e" />}
          </Pressable>
          <Text
            style={[styles.taskTitle, { color: colors.foreground, textDecorationLine: isDone ? "line-through" : "none" }]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
          <View style={[styles.priorityDot, { backgroundColor: pc.color }]} />
        </View>

        <View style={styles.cardMeta}>
          <View style={[styles.statusPill, { backgroundColor: sc.color + "18" }]}>
            <Feather name={sc.icon} size={10} color={sc.color} />
            <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
          </View>
          <View style={[styles.priorityPill, { backgroundColor: pc.color + "18" }]}>
            <Text style={[styles.priorityText, { color: pc.color }]}>{pc.label}</Text>
          </View>
          {task.dueDate && (
            <View style={[styles.dueBadge, { backgroundColor: isOverdue ? "#ef444418" : colors.border }]}>
              <Feather name="calendar" size={9} color={isOverdue ? "#ef4444" : colors.mutedForeground} />
              <Text style={[styles.dueText, { color: isOverdue ? "#ef4444" : colors.mutedForeground }]}>
                {new Date(task.dueDate).toLocaleDateString("fr-FR")}
              </Text>
            </View>
          )}
          {task.assignedTo && (
            <View style={styles.assignedBadge}>
              <Feather name="user" size={9} color={colors.mutedForeground} />
              <Text style={[styles.assignedText, { color: colors.mutedForeground }]} numberOfLines={1}>{task.assignedTo}</Text>
            </View>
          )}
        </View>

        {task.description && (
          <Text style={[styles.descText, { color: colors.mutedForeground }]} numberOfLines={1}>{task.description}</Text>
        )}
      </Pressable>
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
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({ status: "en_attente", priority: "moyenne" });
  const [formLoading, setFormLoading] = useState(false);

  const { cached, isFromCache, updateCache } = useOfflineCache<Task[]>("tasks_list", []);

  // Refs pour le fallback hors-ligne : on evite de mettre `cached`/`tasks.length`
  // dans les deps de `load` (sinon `load` change a chaque fetch -> useEffect([load])
  // refetch en boucle continue). reqGen ignore les reponses obsoletes (filtre rapide).
  const cachedRef = useRef(cached);
  cachedRef.current = cached;
  const tasksLenRef = useRef(tasks.length);
  tasksLenRef.current = tasks.length;
  const reqGenRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++reqGenRef.current;
    try {
      const params = new URLSearchParams({ limit: "80", sortBy: "dueDate", sortOrder: "asc" });
      if (filter !== "all") params.set("status", filter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/tasks?${params}`);
      if (gen !== reqGenRef.current) return;
      if (res.ok) {
        const d = await res.json();
        if (gen !== reqGenRef.current) return;
        const list: Task[] = d.tasks ?? d ?? [];
        setTasks(list);
        if (filter === "all" && priorityFilter === "all" && !search) updateCache(list);
      }
    } catch {
      if (gen === reqGenRef.current && cachedRef.current.length > 0 && tasksLenRef.current === 0) setTasks(cachedRef.current);
    } finally { if (gen === reqGenRef.current) { setLoading(false); setRefreshing(false); } }
  }, [filter, priorityFilter, search, fetchAuth, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && tasks.length === 0) setTasks(cached);
  }, [isFromCache, cached, tasks.length]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Vider le badge "tâches non lues" dès que l'écran prend le focus
  // (mirroir du clear côté sidebar web — Tâche #75). Doublon avec
  // (tabs)/tasks.tsx car le menu Plus pointe sur cette route modale.
  useFocusEffect(
    useCallback(() => {
      clearKey("task");
    }, [clearKey]),
  );

  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setTasks(prev => prev.filter(t => t.id !== id));
    setSelected(null);
    try { await fetchAuth(`${API_BASE}/api/tasks/${id}`, { method: "DELETE" }); load(); }
    catch { load(); }
  }

  async function handleToggleDone(id: number, current: string) {
    const next = current === "termine" ? "en_attente" : "termine";
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: next } : t));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status: next } : null);
    try {
      await fetchAuth(`${API_BASE}/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch { load(); }
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
        body: JSON.stringify({ ...formValues }),
      });
      if (res.ok) {
        setShowForm(false); setEditId(null);
        setFormValues({ status: "en_attente", priority: "moyenne" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  function openEdit(t: Task) {
    setEditId(t.id);
    setFormValues({
      title: t.title || "",
      status: t.status || "en_attente",
      priority: t.priority || "moyenne",
      dueDate: t.dueDate ? t.dueDate.split("T")[0] : "",
      assignedTo: t.assignedTo || "",
      description: t.description || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  const statusFilters = [
    { key: "all", label: "Tout" },
    { key: "en_attente", label: "À faire" },
    { key: "en_cours", label: "En cours" },
    { key: "termine", label: "Terminé" },
    { key: "annule", label: "Annulé" },
  ];

  const todo = tasks.filter(t => t.status === "en_attente").length;
  const inProgress = tasks.filter(t => t.status === "en_cours").length;
  const done = tasks.filter(t => t.status === "termine").length;
  const overdue = tasks.filter(t => t.dueDate && t.status !== "termine" && t.status !== "annule" && new Date(t.dueDate) < new Date()).length;

  const detailFields = selected ? [
    { label: "Statut",    value: STATUS_CFG[selected.status]?.label ?? selected.status },
    { label: "Priorité",  value: PRIORITY_CFG[selected.priority]?.label ?? selected.priority },
    { label: "Échéance",  value: selected.dueDate ? new Date(selected.dueDate).toLocaleDateString("fr-FR") : "—" },
    { label: "Assigné à", value: selected.assignedTo ?? "—" },
    { label: "Description", value: selected.description ?? "—" },
    { label: "Créé le",  value: new Date(selected.createdAt).toLocaleDateString("fr-FR") },
  ] : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#1e3a5f", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Tâches</Text>
          {isFromCache && (
            <View style={[styles.cachePill, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.7)" />
            </View>
          )}
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une tâche…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={14} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>

        <View style={styles.filterRow}>
          {statusFilters.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, { backgroundColor: filter === f.key ? "#fff" : "rgba(255,255,255,0.15)" }]}
            >
              <Text style={[styles.filterText, { color: filter === f.key ? "#1e3a5f" : "rgba(255,255,255,0.85)" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1e3a5f" />
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e3a5f" />}
          ListHeaderComponent={
            tasks.length > 0 ? (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#6b7280" }]}>{todo}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>À faire</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#3b82f6" }]}>{inProgress}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En cours</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e" }]}>{done}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Terminés</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#ef4444" }]}>{overdue}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En retard</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="check-square"
              title="Aucune tâche"
              subtitle={search ? "Aucune tâche ne correspond à votre recherche." : "Créez votre première tâche."}
            />
          }
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              colors={colors}
              onDelete={handleDelete}
              onOpen={setSelected}
              onToggleDone={handleToggleDone}
            />
          )}
        />
      )}

      <FAB onPress={() => { setEditId(null); setFormValues({ status: "en_attente", priority: "moyenne" }); setShowForm(true); }} icon="plus" />

      <FormModal
        visible={showForm}
        title={editId ? "Modifier la tâche" : "Nouvelle tâche"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        onSubmit={handleSubmit}
        onClose={() => { setShowForm(false); setEditId(null); }}
        loading={formLoading}
        submitLabel={editId ? "Enregistrer" : "Créer"}
      />

      <DetailModal
        visible={!!selected}
        icon="check-square"
        iconColor={selected ? (STATUS_CFG[selected.status]?.color ?? "#1e3a5f") : "#1e3a5f"}
        title={selected?.title ?? ""}
        subtitle={selected ? `${STATUS_CFG[selected.status]?.label} · ${PRIORITY_CFG[selected.priority]?.label}` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={selected ? [
          {
            label: selected.status === "termine" ? "Rouvrir" : "Marquer terminé",
            icon: selected.status === "termine" ? "rotate-ccw" as const : "check-circle" as const,
            color: selected.status === "termine" ? "#f59e0b" : "#22c55e",
            onPress: () => { handleToggleDone(selected.id, selected.status); setSelected(null); },
          },
        ] : undefined}
        onEdit={selected ? () => openEdit(selected) : undefined}
        onDelete={selected ? () => {
          if (Platform.OS === "web") { handleDelete(selected.id); return; }
          Alert.alert("Supprimer", `Supprimer "${selected.title}" ?`, [
            { text: "Annuler", style: "cancel" },
            { text: "Supprimer", style: "destructive", onPress: () => handleDelete(selected.id) },
          ]);
        } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  cachePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  filterText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDiv: { width: 1, height: 28 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  checkBtn: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  taskTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1, lineHeight: 20 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  priorityPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  priorityText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  dueBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  dueText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  assignedBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  assignedText: { fontSize: 10, fontFamily: "Inter_400Regular", maxWidth: 100 },
  descText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 6 },
  swipeAction: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#ef4444" },
  swipeDone: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#22c55e" },
  swipeActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
