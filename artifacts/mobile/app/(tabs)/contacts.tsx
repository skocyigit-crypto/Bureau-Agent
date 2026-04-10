import { Feather } from "@expo/vector-icons";
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

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { ListItem } from "@/components/ListItem";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  email: string;
  category: string;
  totalCalls: number;
  address?: string;
  notes?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  client: "#22c55e",
  prospect: "#3b82f6",
  fournisseur: "#8b5cf6",
  partenaire: "#f59e0b",
  autre: "#64748b",
};

const CATEGORY_LABELS: Record<string, string> = {
  client: "Client",
  prospect: "Prospect",
  fournisseur: "Fournisseur",
  partenaire: "Partenaire",
  autre: "Autre",
};

const FORM_FIELDS = [
  { key: "firstName", label: "Prenom", required: true },
  { key: "lastName", label: "Nom", required: true },
  { key: "company", label: "Entreprise" },
  { key: "phone", label: "Telephone", type: "phone" as const },
  { key: "email", label: "E-mail", type: "email" as const },
  { key: "category", label: "Categorie", type: "select" as const, options: [
    { value: "client", label: "Client" },
    { value: "prospect", label: "Prospect" },
    { value: "fournisseur", label: "Fournisseur" },
    { value: "partenaire", label: "Partenaire" },
    { value: "autre", label: "Autre" },
  ]},
  { key: "address", label: "Adresse" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

export default function ContactsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ category: "client" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortBy: "lastName", sortOrder: "asc" });
      if (search) params.set("search", search);
      if (filterCat !== "all") params.set("category", filterCat);
      const res = await fetchAuth(`${API_BASE}/api/contacts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts ?? []);
      }
    } catch (err) { console.warn("[Contacts] fetch failed:", err); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, filterCat, fetchAuth]);

  useEffect(() => { setLoading(true); fetchContacts(); }, [fetchContacts]);

  function onRefresh() { setRefreshing(true); fetchContacts(); }

  async function handleSubmit() {
    if (!formValues.firstName?.trim() || !formValues.lastName?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/contacts/${editId}` : `${API_BASE}/api/contacts`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ category: "client" });
        fetchContacts();
      }
    } catch (err) { console.warn("[Contacts] submit failed:", err); } finally { setFormLoading(false); }
  }

  async function handleDelete(id: number) {
    try {
      await fetchAuth(`${API_BASE}/api/contacts/${id}`, { method: "DELETE" });
      setSelected(null);
      fetchContacts();
    } catch (err) { console.warn("[Contacts] delete failed:", err); }
  }

  function openEdit(contact: Contact) {
    setEditId(contact.id);
    setFormValues({
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      company: contact.company || "",
      phone: contact.phone || "",
      email: contact.email || "",
      category: contact.category || "client",
      address: contact.address || "",
      notes: contact.notes || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  function openNew() {
    setEditId(null);
    setFormValues({ category: "client" });
    setShowForm(true);
  }

  const catFilters = [
    { key: "all", label: "Tous" },
    { key: "client", label: "Clients" },
    { key: "prospect", label: "Prospects" },
    { key: "fournisseur", label: "Fourn." },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <Text style={styles.headerTitle}>Contacts</Text>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un contact..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>
        <View style={styles.filterRow}>
          {catFilters.map((f) => (
            <Pressable key={f.key} onPress={() => setFilterCat(f.key)} style={[styles.filterChip, { backgroundColor: filterCat === f.key ? colors.primary : "rgba(255,255,255,0.1)" }]}>
              <Text style={[styles.filterText, { color: filterCat === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>{f.label}</Text>
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
          data={contacts}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="users" title="Aucun contact" subtitle="Vos contacts apparaitront ici" />}
          renderItem={({ item }) => {
            const catColor = CATEGORY_COLORS[item.category] ?? colors.mutedForeground;
            return (
              <ListItem
                title={`${item.firstName} ${item.lastName}`}
                subtitle={item.company || item.email}
                icon="user"
                iconColor={catColor}
                rightText={item.totalCalls > 0 ? `${item.totalCalls} appels` : undefined}
                rightSubtext={CATEGORY_LABELS[item.category] ?? item.category}
                statusColor={catColor}
                onPress={() => setSelected(item)}
              />
            );
          }}
        />
      )}

      <FAB icon="user-plus" onPress={openNew} />

      <FormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditId(null); }}
        onSubmit={handleSubmit}
        title={editId ? "Modifier le contact" : "Nouveau contact"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="user-plus"
        submitLabel={editId ? "Enregistrer" : "Creer"}
      />

      {selected ? (
        <DetailModal
          visible
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => handleDelete(selected.id)}
          title={`${selected.firstName} ${selected.lastName}`}
          subtitle={selected.company}
          icon="user"
          iconColor={CATEGORY_COLORS[selected.category]}
          badge={{ label: CATEGORY_LABELS[selected.category] ?? selected.category, color: CATEGORY_COLORS[selected.category] ?? "#64748b" }}
          fields={[
            ...(selected.phone ? [{ label: "Telephone", value: selected.phone, icon: "phone" as const, action: "call" as const }] : []),
            ...(selected.email ? [{ label: "E-mail", value: selected.email, icon: "mail" as const, action: "email" as const }] : []),
            ...(selected.company ? [{ label: "Entreprise", value: selected.company, icon: "briefcase" as const }] : []),
            ...(selected.address ? [{ label: "Adresse", value: selected.address, icon: "map-pin" as const }] : []),
            { label: "Appels", value: `${selected.totalCalls || 0}`, icon: "phone" },
            ...(selected.notes ? [{ label: "Notes", value: selected.notes, icon: "file-text" as const }] : []),
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", marginBottom: 14 },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
});
