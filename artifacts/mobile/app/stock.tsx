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

interface Article {
  id: number;
  name: string;
  reference: string;
  barcode?: string | null;
  description?: string | null;
  category: string;
  quantity: number;
  minQuantity: number;
  unitPrice?: string | null;
  supplier?: string | null;
  location?: string | null;
  unit: string;
  status: string;
  notes?: string | null;
  createdAt: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  en_stock:    { label: "En stock",    color: "#22c55e", icon: "check-circle" },
  stock_faible:{ label: "Stock faible",color: "#f59e0b", icon: "alert-triangle" },
  rupture:     { label: "Rupture",     color: "#ef4444", icon: "x-circle" },
};

const FORM_FIELDS = [
  { key: "name", label: "Nom de l'article", required: true },
  { key: "reference", label: "Référence" },
  { key: "barcode", label: "Code-barres" },
  {
    key: "category", label: "Catégorie", type: "select" as const, options: [
      { value: "general", label: "Général" },
      { value: "electronique", label: "Électronique" },
      { value: "fournitures", label: "Fournitures" },
      { value: "mobilier", label: "Mobilier" },
      { value: "consommable", label: "Consommable" },
      { value: "outillage", label: "Outillage" },
      { value: "informatique", label: "Informatique" },
      { value: "autre", label: "Autre" },
    ],
  },
  { key: "quantity", label: "Quantité" },
  { key: "minQuantity", label: "Quantité minimale" },
  {
    key: "unit", label: "Unité", type: "select" as const, options: [
      { value: "piece", label: "Pièce" },
      { value: "kg", label: "Kilogramme" },
      { value: "litre", label: "Litre" },
      { value: "boite", label: "Boîte" },
      { value: "lot", label: "Lot" },
      { value: "metre", label: "Mètre" },
      { value: "carton", label: "Carton" },
    ],
  },
  { key: "unitPrice", label: "Prix unitaire (€)" },
  { key: "supplier", label: "Fournisseur" },
  { key: "location", label: "Emplacement" },
  { key: "description", label: "Description", type: "multiline" as const },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function fmtEur(v: string | null | undefined) {
  if (!v || v === "0") return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(v));
}

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeAction, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Supprimer</Text>
    </Animated.View>
  );
}

interface StockCardProps {
  item: Article;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (a: Article) => void;
  onAdjust: (a: Article) => void;
}

function StockCard({ item, colors, onDelete, onOpen, onAdjust }: StockCardProps) {
  const swipeRef = useRef<Swipeable>(null);
  const sc = STATUS_CFG[item.status] ?? STATUS_CFG.en_stock;
  const isLow = item.status === "stock_faible";
  const isOut = item.status === "rupture";

  function handleSwipeOpen(direction: "left" | "right") {
    swipeRef.current?.close();
    if (direction === "right") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (Platform.OS === "web") {
        onDelete(item.id);
      } else {
        Alert.alert("Supprimer", `Supprimer "${item.name}" ?`, [
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
            borderColor: sc.color + "30",
            borderLeftWidth: 3,
            borderLeftColor: sc.color,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={styles.rowHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.articleName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
            {item.reference ? (
              <Text style={[styles.referenceText, { color: colors.mutedForeground }]}>{item.reference}</Text>
            ) : null}
          </View>
          <View style={[styles.statusPill, { backgroundColor: sc.color + "18" }]}>
            <Feather name={sc.icon} size={10} color={sc.color} />
            <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
          </View>
        </View>

        <View style={styles.rowMeta}>
          <View style={[styles.qtyBadge, { backgroundColor: isOut ? "#ef444420" : isLow ? "#f59e0b20" : "#22c55e20" }]}>
            <Feather name="package" size={12} color={sc.color} />
            <Text style={[styles.qtyText, { color: sc.color }]}>
              {item.quantity} {item.unit}{item.quantity !== 1 ? "s" : ""}
            </Text>
            {item.minQuantity > 0 && (
              <Text style={[styles.minQtyText, { color: colors.mutedForeground }]}>
                / min {item.minQuantity}
              </Text>
            )}
          </View>
          {item.unitPrice && item.unitPrice !== "0" && (
            <View style={styles.metaChip}>
              <Feather name="tag" size={10} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{fmtEur(item.unitPrice)}</Text>
            </View>
          )}
          {item.category && (
            <View style={[styles.categoryBadge, { backgroundColor: colors.border }]}>
              <Text style={[styles.categoryText, { color: colors.mutedForeground }]}>{item.category}</Text>
            </View>
          )}
        </View>

        {(item.supplier || item.location) && (
          <View style={styles.rowFooter}>
            {item.supplier && (
              <View style={styles.metaChip}>
                <Feather name="truck" size={10} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.supplier}</Text>
              </View>
            )}
            {item.location && (
              <View style={styles.metaChip}>
                <Feather name="map-pin" size={10} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.location}</Text>
              </View>
            )}
          </View>
        )}

        <Pressable
          onPress={() => onAdjust(item)}
          style={[styles.adjustBtn, { backgroundColor: "#6366f118", borderColor: "#6366f130" }]}
        >
          <Feather name="sliders" size={12} color="#6366f1" />
          <Text style={[styles.adjustBtnText, { color: "#6366f1" }]}>Ajuster stock</Text>
        </Pressable>
      </Pressable>
    </Swipeable>
  );
}

function AdjustModal({ article, onClose, onDone, fetchAuth }: { article: Article | null; onClose: () => void; onDone: () => void; fetchAuth: any }) {
  const colors = useColors();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAdjust(isAdd: boolean) {
    if (!article || !delta.trim()) return;
    const d = parseFloat(delta);
    if (isNaN(d) || d <= 0) return;
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/stock/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: article.quantity + (isAdd ? d : -d), notes: reason || undefined }),
      });
      if (res.ok) { onDone(); onClose(); }
    } finally { setLoading(false); }
  }

  if (!article) return null;

  return (
    <View style={[styles.adjustOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
      <View style={[styles.adjustCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.adjustHeader}>
          <Text style={[styles.adjustTitle, { color: colors.foreground }]}>Ajuster le stock</Text>
          <Pressable onPress={onClose}>
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <Text style={[styles.adjustSubtitle, { color: colors.mutedForeground }]}>
          {article.name} — Stock actuel: {article.quantity} {article.unit}
        </Text>
        <TextInput
          style={[styles.adjustInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          placeholder="Quantité"
          placeholderTextColor={colors.mutedForeground}
          value={delta}
          onChangeText={setDelta}
          keyboardType="numeric"
        />
        <TextInput
          style={[styles.adjustInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          placeholder="Motif (optionnel)"
          placeholderTextColor={colors.mutedForeground}
          value={reason}
          onChangeText={setReason}
        />
        <View style={styles.adjustBtns}>
          <Pressable style={[styles.adjustActionBtn, { backgroundColor: "#22c55e", flex: 1 }]} onPress={() => handleAdjust(true)} disabled={loading}>
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="plus" size={16} color="#fff" />}
            <Text style={styles.adjustActionBtnText}>Ajouter</Text>
          </Pressable>
          <Pressable style={[styles.adjustActionBtn, { backgroundColor: "#ef4444", flex: 1 }]} onPress={() => handleAdjust(false)} disabled={loading}>
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="minus" size={16} color="#fff" />}
            <Text style={styles.adjustActionBtnText}>Retirer</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function StockScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [articles, setArticles] = useState<Article[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Article | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Article | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({ category: "general", unit: "piece", quantity: "0", minQuantity: "5" });
  const [formLoading, setFormLoading] = useState(false);

  const { cached, isFromCache, updateCache } = useOfflineCache<Article[]>("stock_list", []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "80", sortBy: "name", sortOrder: "asc" });
      if (filter === "low") params.set("lowStock", "true");
      else if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const [r1, r2] = await Promise.all([
        fetchAuth(`${API_BASE}/api/stock?${params}`),
        fetchAuth(`${API_BASE}/api/stock/stats`),
      ]);
      if (r1.ok) {
        const d = await r1.json();
        const list: Article[] = d.articles ?? [];
        setArticles(list);
        if (filter === "all" && !search) updateCache(list);
      }
      if (r2.ok) setStats(await r2.json());
    } catch {
      if (cached.length > 0 && articles.length === 0) setArticles(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth, cached, articles.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && articles.length === 0) setArticles(cached);
  }, [isFromCache, cached, articles.length]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setArticles(prev => prev.filter(a => a.id !== id));
    setSelected(null);
    try {
      await fetchAuth(`${API_BASE}/api/stock/${id}`, { method: "DELETE" });
      load();
    } catch { load(); }
  }

  async function handleSubmit() {
    if (!formValues.name?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/stock/${editId}` : `${API_BASE}/api/stock`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formValues,
          quantity: parseFloat(formValues.quantity || "0"),
          minQuantity: parseFloat(formValues.minQuantity || "5"),
          unitPrice: formValues.unitPrice || null,
        }),
      });
      if (res.ok) {
        setShowForm(false); setEditId(null);
        setFormValues({ category: "general", unit: "piece", quantity: "0", minQuantity: "5" });
        load();
      }
    } finally { setFormLoading(false); }
  }

  function openEdit(a: Article) {
    setEditId(a.id);
    setFormValues({
      name: a.name || "",
      reference: a.reference || "",
      barcode: a.barcode || "",
      category: a.category || "general",
      quantity: String(a.quantity),
      minQuantity: String(a.minQuantity),
      unit: a.unit || "piece",
      unitPrice: a.unitPrice || "",
      supplier: a.supplier || "",
      location: a.location || "",
      description: a.description || "",
      notes: a.notes || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "en_stock", label: "En stock" },
    { key: "low", label: "Stock faible" },
    { key: "rupture", label: "Rupture" },
  ];

  const rupture = articles.filter(a => a.status === "rupture").length;
  const faible = articles.filter(a => a.status === "stock_faible").length;
  const totalValue = articles.reduce((s, a) => s + (a.quantity * parseFloat(a.unitPrice || "0")), 0);

  const detailFields = selected ? [
    { label: "Référence", value: selected.reference || "—" },
    { label: "Catégorie", value: selected.category },
    { label: "Quantité", value: `${selected.quantity} ${selected.unit}` },
    { label: "Stock minimum", value: `${selected.minQuantity} ${selected.unit}` },
    { label: "Prix unitaire", value: fmtEur(selected.unitPrice) },
    { label: "Fournisseur", value: selected.supplier ?? "—" },
    { label: "Emplacement", value: selected.location ?? "—" },
    { label: "Code-barres", value: selected.barcode ?? "—" },
    { label: "Description", value: selected.description ?? "—" },
    { label: "Notes", value: selected.notes ?? "—" },
  ] : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#7c3aed", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Stock</Text>
          {isFromCache && (
            <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
              <Text style={styles.cacheText}>Cache</Text>
            </View>
          )}
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un article..."
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
          <ActivityIndicator size="large" color="#7c3aed" />
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
          ListHeaderComponent={
            articles.length > 0 ? (
              <View style={[styles.statsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: colors.foreground }]}>{articles.length}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Articles</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#f59e0b" }]}>{faible}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Stock faible</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#ef4444" }]}>{rupture}</Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Rupture</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: "#22c55e", fontSize: 12 }]}>
                    {totalValue > 0
                      ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(totalValue)
                      : "—"}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Valeur</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="package"
              title="Aucun article"
              subtitle={search ? "Aucun article ne correspond à votre recherche." : "Ajoutez votre premier article en stock."}
            />
          }
          renderItem={({ item }) => (
            <StockCard
              item={item}
              colors={colors}
              onDelete={handleDelete}
              onOpen={setSelected}
              onAdjust={(a) => { setAdjustTarget(a); setSelected(null); }}
            />
          )}
        />
      )}

      <FAB onPress={() => { setEditId(null); setFormValues({ category: "general", unit: "piece", quantity: "0", minQuantity: "5" }); setShowForm(true); }} icon="plus" />

      <FormModal
        visible={showForm}
        title={editId ? "Modifier l'article" : "Nouvel article"}
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
        icon="package"
        iconColor={selected ? (STATUS_CFG[selected.status]?.color ?? "#7c3aed") : "#7c3aed"}
        title={selected?.name ?? ""}
        subtitle={selected ? `${selected.reference || selected.category} · ${selected.quantity} ${selected.unit}` : ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={selected ? [
          {
            label: "Ajuster stock",
            icon: "sliders" as const,
            color: "#6366f1",
            onPress: () => { const snap = selected; setSelected(null); setAdjustTarget(snap); },
          },
        ] : undefined}
        onEdit={selected ? () => openEdit(selected) : undefined}
        onDelete={selected ? () => {
          if (Platform.OS === "web") {
            handleDelete(selected.id);
          } else {
            Alert.alert("Supprimer", `Supprimer "${selected.name}" ?`, [
              { text: "Annuler", style: "cancel" },
              { text: "Supprimer", style: "destructive", onPress: () => handleDelete(selected.id) },
            ]);
          }
        } : undefined}
      />

      {adjustTarget && (
        <AdjustModal
          article={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onDone={load}
          fetchAuth={fetchAuth}
        />
      )}
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
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsBar: { flexDirection: "row", borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDivider: { width: 1, height: 28 },
  row: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  rowHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 },
  articleName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  referenceText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6, alignItems: "center" },
  qtyBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  qtyText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  minQtyText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  categoryBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  categoryText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  rowFooter: { flexDirection: "row", gap: 12, marginBottom: 8 },
  adjustBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 30, borderRadius: 8, borderWidth: 1, marginTop: 4 },
  adjustBtnText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  swipeAction: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#ef4444" },
  swipeActionText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  adjustOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "flex-end" },
  adjustCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 20, paddingBottom: 32 },
  adjustHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  adjustTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  adjustSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 14 },
  adjustInput: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 10 },
  adjustBtns: { flexDirection: "row", gap: 10, marginTop: 6 },
  adjustActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, borderRadius: 10 },
  adjustActionBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
