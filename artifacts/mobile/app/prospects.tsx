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

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

interface Prospect {
  id: number;
  title: string;
  contactName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  stage: string;
  priority: string;
  value?: string | null;
  currency: string;
  probability: number;
  source?: string | null;
  assignedTo?: string | null;
  expectedCloseDate?: string | null;
  notes?: string | null;
  createdAt: string;
}

const STAGES: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  nouveau:       { label: "Nouveau",       color: "#64748b", icon: "star" },
  contact:       { label: "Contact",       color: "#3b82f6", icon: "phone" },
  qualification: { label: "Qualification", color: "#8b5cf6", icon: "filter" },
  proposition:   { label: "Proposition",  color: "#f59e0b", icon: "file-text" },
  negociation:   { label: "Négociation",  color: "#f97316", icon: "refresh-cw" },
  gagne:         { label: "Gagné",        color: "#22c55e", icon: "check-circle" },
  perdu:         { label: "Perdu",        color: "#ef4444", icon: "x-circle" },
};

const PRIORITY_COLORS: Record<string, string> = {
  haute:   "#ef4444",
  moyenne: "#f59e0b",
  basse:   "#64748b",
};

const FORM_FIELDS = [
  { key: "title", label: "Titre de l'opportunité", required: true },
  { key: "contactName", label: "Contact" },
  { key: "company", label: "Entreprise" },
  { key: "email", label: "Email", type: "email" as const },
  { key: "phone", label: "Téléphone" },
  {
    key: "stage", label: "Étape", type: "select" as const, options: [
      { value: "nouveau", label: "Nouveau" },
      { value: "contact", label: "Contact" },
      { value: "qualification", label: "Qualification" },
      { value: "proposition", label: "Proposition" },
      { value: "negociation", label: "Négociation" },
      { value: "gagne", label: "Gagné" },
      { value: "perdu", label: "Perdu" },
    ],
  },
  {
    key: "priority", label: "Priorité", type: "select" as const, options: [
      { value: "basse", label: "Basse" },
      { value: "moyenne", label: "Moyenne" },
      { value: "haute", label: "Haute" },
    ],
  },
  { key: "value", label: "Valeur estimée (€)" },
  { key: "probability", label: "Probabilité (%)" },
  { key: "source", label: "Source" },
  { key: "assignedTo", label: "Responsable" },
  { key: "expectedCloseDate", label: "Date de clôture prévue" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function fmtEur(v: string | null | undefined) {
  if (!v || isNaN(Number(v))) return null;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v));
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

interface SwipeableProspectProps {
  item: Prospect;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (p: Prospect) => void;
}

function SwipeableProspect({ item, colors, onDelete, onOpen }: SwipeableProspectProps) {
  const swipeRef = useRef<Swipeable>(null);
  const stage = STAGES[item.stage] ?? { label: item.stage, color: "#64748b", icon: "circle" as const };
  const prioColor = PRIORITY_COLORS[item.priority] ?? colors.mutedForeground;
  const isWon = item.stage === "gagne";
  const isLost = item.stage === "perdu";

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
          styles.row,
          {
            backgroundColor: colors.card,
            borderColor: isWon ? "#22c55e40" : isLost ? "#ef444430" : colors.border,
            borderLeftWidth: isWon || isLost ? 3 : 1,
            borderLeftColor: isWon ? "#22c55e" : isLost ? "#ef4444" : colors.border,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.rowHeader}>
          <View style={styles.rowTitleRow}>
            <View style={[styles.prioDot, { backgroundColor: prioColor }]} />
            <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <View style={[styles.stagePill, { backgroundColor: stage.color + "18" }]}>
            <Feather name={stage.icon} size={10} color={stage.color} />
            <Text style={[styles.stageText, { color: stage.color }]}>{stage.label}</Text>
          </View>
        </View>

        {(item.contactName || item.company) ? (
          <Text style={[styles.subText, { color: colors.mutedForeground }]} numberOfLines={1}>
            <Feather name="user" size={10} /> {[item.contactName, item.company].filter(Boolean).join(" · ")}
          </Text>
        ) : null}

        <View style={styles.rowMeta}>
          {fmtEur(item.value) ? (
            <View style={styles.metaChip}>
              <Feather name="dollar-sign" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{fmtEur(item.value)}</Text>
            </View>
          ) : null}
          <View style={styles.metaChip}>
            <Feather name="percent" size={10} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.probability}%</Text>
          </View>
          {item.expectedCloseDate ? (
            <View style={styles.metaChip}>
              <Feather name="calendar" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {new Date(item.expectedCloseDate).toLocaleDateString("fr-FR")}
              </Text>
            </View>
          ) : null}
          {item.assignedTo ? (
            <View style={styles.metaChip}>
              <Feather name="user" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>{item.assignedTo}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Swipeable>
  );
}

export default function ProspectsScreen() {
  // Module backoffice SaaS — accessible super-admin uniquement (Tâche #52).
  // IMPORTANT: tous les hooks doivent etre appeles AVANT tout return
  // conditionnel sinon React detecte une rupture d'ordre des hooks et
  // crashe au prochain rendu. Le garde-fou agit donc apres l'init.
  const { user: authUser, fetchAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [stats, setStats] = useState({ total: 0, pipelineValue: 0, gagnes: 0, perdus: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ stage: "nouveau", priority: "moyenne", probability: "50" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const { cached, isFromCache, updateCache } = useOfflineCache<Prospect[]>("prospects_list", []);

  const fetchProspects = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (filter !== "all") params.set("stage", filter);
      if (search) params.set("search", search);
      const [listRes, statsRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/prospects?${params}`),
        fetchAuth(`${API_BASE}/api/prospects/stats`),
      ]);
      if (listRes.ok) {
        const d = await listRes.json();
        const list: Prospect[] = d.prospects ?? d.data ?? [];
        setProspects(list);
        if (filter === "all" && !search) updateCache(list);
      }
      if (statsRes.ok) {
        const d = await statsRes.json();
        setStats({
          total: d.total ?? d.stats?.total ?? 0,
          pipelineValue: d.totalValue ?? d.stats?.totalValue ?? 0,
          gagnes: d.gagnes ?? d.stats?.gagne ?? 0,
          perdus: d.perdus ?? d.stats?.perdu ?? 0,
        });
      }
    } catch {
      if (cached.length > 0 && prospects.length === 0) setProspects(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth, cached, prospects.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && prospects.length === 0) setProspects(cached);
  }, [isFromCache, cached, prospects.length]);

  useEffect(() => { setLoading(true); fetchProspects(); }, [fetchProspects]);

  function onRefresh() { setRefreshing(true); fetchProspects(); }

  async function handleDelete(id: number) {
    setProspects(prev => prev.filter(p => p.id !== id));
    try {
      await fetchAuth(`${API_BASE}/api/prospects/${id}`, { method: "DELETE" });
      setSelected(null);
      fetchProspects();
    } catch { fetchProspects(); }
  }

  async function handleSubmit() {
    if (!formValues.title?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/prospects/${editId}` : `${API_BASE}/api/prospects`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formValues, probability: Number(formValues.probability || 50) }),
      });
      if (res.ok) {
        setShowForm(false); setEditId(null);
        setFormValues({ stage: "nouveau", priority: "moyenne", probability: "50" });
        fetchProspects();
      }
    } catch {
      if (Platform.OS !== "web") Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally { setFormLoading(false); }
  }

  function openEdit(p: Prospect) {
    setEditId(p.id);
    setFormValues({
      title: p.title || "",
      contactName: p.contactName || "",
      company: p.company || "",
      email: p.email || "",
      phone: p.phone || "",
      stage: p.stage || "nouveau",
      priority: p.priority || "moyenne",
      value: p.value || "",
      probability: String(p.probability ?? 50),
      source: p.source || "",
      assignedTo: p.assignedTo || "",
      expectedCloseDate: p.expectedCloseDate ? p.expectedCloseDate.slice(0, 10) : "",
      notes: p.notes || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  function openNew() {
    setEditId(null);
    setFormValues({ stage: "nouveau", priority: "moyenne", probability: "50" });
    setShowForm(true);
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "nouveau", label: "Nouveaux" },
    { key: "en_cours", label: "En cours" },
    { key: "gagne", label: "Gagnés" },
    { key: "perdu", label: "Perdus" },
  ];

  const localStats = {
    total: prospects.length,
    pipelineValue: prospects.filter(p => p.stage !== "perdu").reduce((s, p) => s + Number(p.value || 0), 0),
    gagnes: prospects.filter(p => p.stage === "gagne").length,
    perdus: prospects.filter(p => p.stage === "perdu").length,
  };

  const detailFields = selected ? [
    { label: "Étape", value: STAGES[selected.stage]?.label ?? selected.stage },
    { label: "Priorité", value: selected.priority },
    { label: "Contact", value: selected.contactName ?? "—" },
    { label: "Entreprise", value: selected.company ?? "—" },
    { label: "Email", value: selected.email ?? "—", icon: "mail" as const, action: selected.email ? "email" as const : undefined },
    { label: "Téléphone", value: selected.phone ?? "—", icon: "phone" as const, action: selected.phone ? "call" as const : undefined },
    { label: "Valeur", value: fmtEur(selected.value) ?? "—" },
    { label: "Probabilité", value: `${selected.probability}%` },
    { label: "Responsable", value: selected.assignedTo ?? "—" },
    { label: "Source", value: selected.source ?? "—" },
    { label: "Clôture prévue", value: selected.expectedCloseDate ? new Date(selected.expectedCloseDate).toLocaleDateString("fr-FR") : "—" },
    { label: "Notes", value: selected.notes ?? "—" },
  ] : [];

  // Garde-fou super-admin (Tâche #52). Place APRES tous les hooks pour
  // preserver l'ordre des hooks React. Si l'utilisateur n'a pas le bon
  // role, on rend une vue "Acces refuse" plutot que de rediriger
  // silencieusement (signal explicite de policy boundary).
  if (!authUser || authUser.role !== "super_admin") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center", padding: 24 }]}>
        <Feather name="lock" size={48} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "600", marginTop: 16, textAlign: "center" }}>
          Acces reserve
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 14, marginTop: 8, textAlign: "center" }}>
          Ce module est reserve au backoffice SaaS (super-admin uniquement).
        </Text>
        <Pressable
          onPress={() => router.replace("/(tabs)")}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 8 }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Prospects</Text>
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
            placeholder="Rechercher..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>

        <View style={styles.filterRow}>
          {filters.map(f => (
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
          data={prospects}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            prospects.length > 0 ? (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{localStats.total}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Total</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e" }]}>{localStats.gagnes}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Gagnés</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#ef4444" }]}>{localStats.perdus}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Perdus</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#6366f1", fontSize: 13 }]}>
                    {localStats.pipelineValue > 0
                      ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(localStats.pipelineValue)
                      : "—"}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Pipeline</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="trending-up"
              title="Aucun prospect"
              subtitle={search ? "Aucun prospect ne correspond à votre recherche." : "Ajoutez votre premier prospect."}
            />
          }
          renderItem={({ item }) => (
            <SwipeableProspect
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
        title={editId ? "Modifier le prospect" : "Nouveau prospect"}
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
        icon="trending-up"
        iconColor={selected ? (STAGES[selected.stage]?.color ?? "#6366f1") : "#6366f1"}
        title={selected?.title ?? ""}
        subtitle={selected ? `${STAGES[selected.stage]?.label ?? selected.stage} · ${selected.probability}%` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={selected ? [
          {
            label: "Créer un projet",
            icon: "folder",
            color: "#6366f1",
            onPress: async () => {
              try {
                const res = await fetchAuth(`${API_BASE}/api/projets`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    title: selected.title,
                    status: "planifie",
                    priority: selected.priority === "haute" ? "haute" : "moyenne",
                    progress: 0,
                    clientName: selected.contactName ?? undefined,
                    clientCompany: selected.company ?? undefined,
                    notes: `Créé depuis prospect: ${selected.title}`,
                  }),
                });
                if (res.ok) {
                  setSelected(null);
                  router.push("/projets");
                }
              } catch {}
            },
          },
        ] : undefined}
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
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDivider: { width: 1, height: 28 },
  row: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  rowTitleRow: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 },
  prioDot: { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  subText: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  stagePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  stageText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  swipeAction: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4 },
  swipeRight: { backgroundColor: "#ef4444" },
  swipeActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
