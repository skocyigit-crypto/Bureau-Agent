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
import { useColors } from "@/hooks/useColors";

interface Commande {
  id: number;
  reference: string;
  fournisseurName: string;
  fournisseurEmail?: string | null;
  fournisseurPhone?: string | null;
  fournisseurAddress?: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  status: string;
  expectedDelivery?: string | null;
  receivedAt?: string | null;
  notes?: string | null;
  conditions?: string | null;
  createdAt: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  brouillon: { label: "Brouillon", color: "#6b7280", icon: "edit"        },
  envoye:    { label: "Envoyé",    color: "#3b82f6", icon: "send"        },
  confirme:  { label: "Confirmé",  color: "#f59e0b", icon: "check"       },
  recu:      { label: "Reçu",      color: "#22c55e", icon: "check-circle" },
  annule:    { label: "Annulé",    color: "#ef4444", icon: "x-circle"    },
};

const STATUS_TRANSITIONS: Record<string, { label: string; next: string } | null> = {
  brouillon: { label: "Marquer envoyé",   next: "envoye"   },
  envoye:    { label: "Marquer confirmé", next: "confirme" },
  confirme:  { label: "Marquer reçu",     next: "recu"     },
  recu:      null,
  annule:    null,
};

const FORM_FIELDS = [
  { key: "fournisseurName", label: "Nom du fournisseur", required: true },
  { key: "fournisseurEmail", label: "Email du fournisseur" },
  { key: "fournisseurPhone", label: "Téléphone" },
  { key: "fournisseurAddress", label: "Adresse" },
  { key: "expectedDelivery", label: "Livraison prévue (AAAA-MM-JJ)" },
  { key: "notes", label: "Notes", type: "multiline" as const },
  { key: "conditions", label: "Conditions", type: "multiline" as const },
];

function fmtEur(v: string | number | null | undefined, currency = "EUR"): string {
  if (!v || v === "0" || v === "0.00") return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(parseFloat(String(v)));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeDelete, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>Supprimer</Text>
    </Animated.View>
  );
}

function CommandeCard({ cmd, colors, onDelete, onOpen, onAdvance }: {
  cmd: Commande;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (c: Commande) => void;
  onAdvance: (id: number, next: string) => void;
}) {
  const ref = useRef<Swipeable>(null);
  const sc = STATUS_CFG[cmd.status] ?? STATUS_CFG.brouillon;
  const transition = STATUS_TRANSITIONS[cmd.status];
  const isOverdue = cmd.expectedDelivery && cmd.status !== "recu" && cmd.status !== "annule"
    && new Date(cmd.expectedDelivery) < new Date();

  function handleSwipeOpen(direction: "left" | "right") {
    ref.current?.close();
    if (direction === "right") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (Platform.OS === "web") {
        onDelete(cmd.id);
      } else {
        Alert.alert("Supprimer", `Supprimer la commande "${cmd.reference}" ?`, [
          { text: "Annuler", style: "cancel" },
          { text: "Supprimer", style: "destructive", onPress: () => onDelete(cmd.id) },
        ]);
      }
    }
  }

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootRight={false}
      renderRightActions={(progress) => <RightAction progress={progress} />}
      onSwipeableOpen={handleSwipeOpen}
    >
      <Pressable
        onPress={() => onOpen(cmd)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: sc.color + "30",
            borderLeftColor: sc.color,
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.reference, { color: colors.foreground }]}>{cmd.reference}</Text>
            <Text style={[styles.supplier, { color: colors.mutedForeground }]} numberOfLines={1}>
              <Feather name="truck" size={11} color={colors.mutedForeground} /> {cmd.fournisseurName}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: sc.color + "18" }]}>
            <Feather name={sc.icon} size={10} color={sc.color} />
            <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
          </View>
        </View>

        <View style={styles.cardMid}>
          <Text style={[styles.amount, { color: colors.foreground }]}>{fmtEur(cmd.totalAmount, cmd.currency)}</Text>
          {cmd.expectedDelivery && (
            <View style={[styles.deliveryBadge, { backgroundColor: isOverdue ? "#ef444418" : colors.border }]}>
              <Feather name="calendar" size={10} color={isOverdue ? "#ef4444" : colors.mutedForeground} />
              <Text style={[styles.deliveryText, { color: isOverdue ? "#ef4444" : colors.mutedForeground }]}>
                {isOverdue ? "Retard · " : ""}{fmtDate(cmd.expectedDelivery)}
              </Text>
            </View>
          )}
        </View>

        {transition && (
          <Pressable
            onPress={() => onAdvance(cmd.id, transition.next)}
            style={[styles.advanceBtn, { backgroundColor: sc.color + "15", borderColor: sc.color + "40" }]}
          >
            <Feather name="arrow-right-circle" size={13} color={sc.color} />
            <Text style={[styles.advanceBtnText, { color: sc.color }]}>{transition.label}</Text>
          </Pressable>
        )}
      </Pressable>
    </Swipeable>
  );
}

export default function CommandesFournisseurScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Commande | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({ currency: "EUR" });
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "60" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const [r1, r2] = await Promise.all([
        fetchAuth(`${API_BASE}/api/commandes-fournisseur?${params}`),
        fetchAuth(`${API_BASE}/api/commandes-fournisseur/stats`),
      ]);
      if (r1.ok) { const d = await r1.json(); setCommandes(d.commandes ?? d ?? []); }
      if (r2.ok) setStats(await r2.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, filter, search]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setCommandes(prev => prev.filter(c => c.id !== id));
    setSelected(null);
    try { await fetchAuth(`${API_BASE}/api/commandes-fournisseur/${id}`, { method: "DELETE" }); load(); }
    catch { load(); }
  }

  async function handleAdvance(id: number, next: string) {
    try {
      await fetchAuth(`${API_BASE}/api/commandes-fournisseur/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      load();
    } catch {}
  }

  async function handleSubmit() {
    if (!formValues.fournisseurName?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/commandes-fournisseur/${editId}` : `${API_BASE}/api/commandes-fournisseur`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formValues, items: [], currency: formValues.currency || "EUR" }),
      });
      if (res.ok) {
        setShowForm(false); setEditId(null);
        setFormValues({ currency: "EUR" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  function openEdit(c: Commande) {
    setEditId(c.id);
    setFormValues({
      fournisseurName: c.fournisseurName || "",
      fournisseurEmail: c.fournisseurEmail || "",
      fournisseurPhone: c.fournisseurPhone || "",
      fournisseurAddress: c.fournisseurAddress || "",
      expectedDelivery: c.expectedDelivery ? c.expectedDelivery.split("T")[0] : "",
      notes: c.notes || "",
      conditions: c.conditions || "",
      currency: c.currency || "EUR",
    });
    setSelected(null);
    setShowForm(true);
  }

  const filters = [
    { key: "all",      label: "Tout"      },
    { key: "brouillon",label: "Brouillon" },
    { key: "envoye",   label: "Envoyé"    },
    { key: "confirme", label: "Confirmé"  },
    { key: "recu",     label: "Reçu"      },
    { key: "annule",   label: "Annulé"    },
  ];

  const detailFields = selected ? [
    { label: "Référence",        value: selected.reference },
    { label: "Fournisseur",      value: selected.fournisseurName },
    { label: "Email",            value: selected.fournisseurEmail ?? "—" },
    { label: "Téléphone",        value: selected.fournisseurPhone ?? "—" },
    { label: "Adresse",          value: selected.fournisseurAddress ?? "—" },
    { label: "Sous-total",       value: fmtEur(selected.subtotal, selected.currency) },
    { label: "Taxes",            value: fmtEur(selected.taxAmount, selected.currency) },
    { label: "Total",            value: fmtEur(selected.totalAmount, selected.currency) },
    { label: "Livraison prévue", value: fmtDate(selected.expectedDelivery) },
    { label: "Reçu le",         value: fmtDate(selected.receivedAt) },
    { label: "Notes",            value: selected.notes ?? "—" },
    { label: "Conditions",       value: selected.conditions ?? "—" },
    { label: "Créé le",         value: fmtDate(selected.createdAt) },
  ] : [];

  const detailExtraActions = selected ? (() => {
    const tr = STATUS_TRANSITIONS[selected.status];
    return tr ? [{ label: tr.label, icon: "arrow-right-circle" as const, color: STATUS_CFG[selected.status]?.color ?? "#6366f1", onPress: () => { handleAdvance(selected.id, tr.next); setSelected(null); } }] : undefined;
  })() : undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#b45309", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Commandes Fournisseur</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
          <Feather name="search" size={15} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={15} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>

        <View style={styles.filterRow}>
          {filters.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, { backgroundColor: filter === f.key ? "#fff" : "rgba(255,255,255,0.15)" }]}
            >
              <Text style={[styles.filterText, { color: filter === f.key ? "#b45309" : "rgba(255,255,255,0.85)" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#b45309" />
        </View>
      ) : (
        <FlatList
          data={commandes}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b45309" />}
          ListHeaderComponent={
            stats && (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{commandes.length}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Total</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#f59e0b" }]}>{stats.confirme ?? 0}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Confirmés</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e" }]}>{stats.recu ?? 0}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Reçus</Text>
                </View>
                <View style={[styles.statDiv, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#b45309", fontSize: 12 }]}>
                    {stats.pendingAmount > 0
                      ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(stats.pendingAmount)
                      : "—"}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>En attente</Text>
                </View>
              </View>
            )
          }
          ListEmptyComponent={
            <EmptyState
              icon="shopping-cart"
              title="Aucune commande"
              subtitle={search ? "Aucune commande trouvée." : "Créez votre première commande fournisseur."}
            />
          }
          renderItem={({ item }) => (
            <CommandeCard
              cmd={item}
              colors={colors}
              onDelete={handleDelete}
              onOpen={setSelected}
              onAdvance={handleAdvance}
            />
          )}
        />
      )}

      <FAB onPress={() => { setEditId(null); setFormValues({ currency: "EUR" }); setShowForm(true); }} icon="plus" />

      <FormModal
        visible={showForm}
        title={editId ? "Modifier la commande" : "Nouvelle commande"}
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
        icon="shopping-cart"
        iconColor={selected ? (STATUS_CFG[selected.status]?.color ?? "#b45309") : "#b45309"}
        title={selected?.reference ?? ""}
        subtitle={selected ? `${selected.fournisseurName} · ${STATUS_CFG[selected.status]?.label ?? selected.status}` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={detailExtraActions}
        onEdit={selected ? () => openEdit(selected) : undefined}
        onDelete={selected ? () => {
          if (Platform.OS === "web") {
            handleDelete(selected.id);
          } else {
            Alert.alert("Supprimer", `Supprimer "${selected.reference}" ?`, [
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
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  filterText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDiv: { width: 1, height: 28 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, marginBottom: 8 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  reference: { fontSize: 14, fontFamily: "Inter_700Bold" },
  supplier: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  cardMid: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  amount: { fontSize: 18, fontFamily: "Inter_700Bold" },
  deliveryBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  deliveryText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  advanceBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 30, borderRadius: 8, borderWidth: 1 },
  advanceBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  swipeDelete: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#ef4444" },
  swipeDeleteText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
