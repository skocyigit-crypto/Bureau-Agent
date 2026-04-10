import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { DetailModal } from "@/components/DetailModal";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { ListItem } from "@/components/ListItem";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface StockArticle {
  id: number;
  name: string;
  reference: string;
  category: string;
  quantity: number;
  minQuantity: number;
  unitPrice: string;
  location?: string;
  description?: string;
  status: string;
  createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  en_stock: { label: "En stock", color: "#22c55e" },
  stock_faible: { label: "Stock faible", color: "#f59e0b" },
  rupture: { label: "Rupture", color: "#ef4444" },
  commande: { label: "En commande", color: "#3b82f6" },
};

const FORM_FIELDS = [
  { key: "name", label: "Nom de l'article", required: true },
  { key: "reference", label: "Reference", required: true },
  { key: "category", label: "Categorie", type: "select" as const, options: [
    { value: "fourniture", label: "Fourniture" },
    { value: "informatique", label: "Informatique" },
    { value: "mobilier", label: "Mobilier" },
    { value: "consommable", label: "Consommable" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "quantity", label: "Quantite" },
  { key: "minQuantity", label: "Quantite minimale" },
  { key: "unitPrice", label: "Prix unitaire (EUR)" },
  { key: "location", label: "Emplacement" },
  { key: "description", label: "Description", type: "multiline" as const },
];

export default function StockScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [articles, setArticles] = useState<StockArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ category: "fourniture", quantity: "0", minQuantity: "5" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<StockArticle | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const fetchStock = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortBy: "name", sortOrder: "asc" });
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/stock?${params}`);
      if (res.ok) {
        const data = await res.json();
        setArticles(data.articles ?? []);
      }
    } catch (err) { console.warn("[Stock] fetch failed:", err); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, fetchAuth]);

  useEffect(() => { setLoading(true); fetchStock(); }, [fetchStock]);

  function onRefresh() { setRefreshing(true); fetchStock(); }

  async function handleSubmit() {
    if (!formValues.name?.trim()) return;
    setFormLoading(true);
    try {
      const body = {
        ...formValues,
        quantity: parseInt(formValues.quantity || "0"),
        minQuantity: parseInt(formValues.minQuantity || "5"),
        unitPrice: formValues.unitPrice || "0",
      };
      const url = editId ? `${API_BASE}/api/stock/${editId}` : `${API_BASE}/api/stock`;
      const method = editId ? "PUT" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ category: "fourniture", quantity: "0", minQuantity: "5" });
        fetchStock();
      }
    } catch (err) { console.warn("[Stock] submit failed:", err); } finally { setFormLoading(false); }
  }

  function openEdit(article: StockArticle) {
    setEditId(article.id);
    setFormValues({
      name: article.name || "",
      reference: article.reference || "",
      category: article.category || "fourniture",
      quantity: String(article.quantity || 0),
      minQuantity: String(article.minQuantity || 5),
      unitPrice: article.unitPrice || "0",
      location: article.location || "",
      description: article.description || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  function openNew() {
    setEditId(null);
    setFormValues({ category: "fourniture", quantity: "0", minQuantity: "5" });
    setShowForm(true);
  }

  async function handleDelete(id: number) {
    try {
      await fetchAuth(`${API_BASE}/api/stock/${id}`, { method: "DELETE" });
      setSelected(null);
      fetchStock();
    } catch (err) { console.warn("[Stock] delete failed:", err); }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Stock</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
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
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="package" title="Aucun article" subtitle="Votre inventaire est vide" />}
          renderItem={({ item }) => {
            const status = STATUS_MAP[item.status] ?? { label: item.status, color: "#64748b" };
            return (
              <ListItem
                title={item.name}
                subtitle={`Ref: ${item.reference}`}
                icon="package"
                iconColor={status.color}
                rightText={`${item.quantity} unite(s)`}
                rightSubtext={status.label}
                statusColor={status.color}
                onPress={() => setSelected(item)}
              />
            );
          }}
        />
      )}

      <FAB onPress={openNew} />

      <FormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditId(null); }}
        onSubmit={handleSubmit}
        title={editId ? "Modifier l'article" : "Nouvel article"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="package"
        submitLabel="Creer"
      />

      {selected ? (
        <DetailModal
          visible
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => handleDelete(selected.id)}
          title={selected.name}
          subtitle={`Ref: ${selected.reference}`}
          icon="package"
          iconColor={STATUS_MAP[selected.status]?.color || "#64748b"}
          badge={{ label: STATUS_MAP[selected.status]?.label ?? selected.status, color: STATUS_MAP[selected.status]?.color ?? "#64748b" }}
          fields={[
            { label: "Quantite", value: `${selected.quantity}`, icon: "hash" },
            { label: "Quantite min.", value: `${selected.minQuantity}`, icon: "alert-triangle" },
            { label: "Prix unitaire", value: `${selected.unitPrice} EUR`, icon: "tag" },
            { label: "Categorie", value: selected.category, icon: "folder" },
            ...(selected.location ? [{ label: "Emplacement", value: selected.location, icon: "map-pin" as const }] : []),
            ...(selected.description ? [{ label: "Description", value: selected.description, icon: "file-text" as const }] : []),
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
});
