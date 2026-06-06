import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
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

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  tags?: string[] | null;
  createdAt: string;
}

const TAG_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#22c55e", "#0891b2"];
function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash + tag.charCodeAt(i)) % TAG_COLORS.length;
  return TAG_COLORS[hash];
}

function initials(first: string, last: string): string {
  return `${(first[0] || "").toUpperCase()}${(last[0] || "").toUpperCase()}`;
}

const FORM_FIELDS = [
  { key: "firstName", label: "Prénom", required: true },
  { key: "lastName",  label: "Nom",    required: true },
  { key: "company",   label: "Entreprise" },
  { key: "phone",     label: "Téléphone" },
  { key: "email",     label: "Email" },
];

function RightAction({ progress }: { progress: Animated.AnimatedInterpolation<number> }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1], extrapolate: "clamp" });
  return (
    <Animated.View style={[styles.swipeDelete, { transform: [{ scale }] }]}>
      <Feather name="trash-2" size={20} color="#fff" />
      <Text style={styles.swipeText}>Supprimer</Text>
    </Animated.View>
  );
}

function ContactRow({ contact, colors, onDelete, onOpen }: {
  contact: Contact;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onOpen: (c: Contact) => void;
}) {
  const ref = useRef<Swipeable>(null);
  const avatarColor = tagColor(contact.firstName + contact.lastName);

  function handleSwipeOpen(direction: "left" | "right") {
    ref.current?.close();
    if (direction === "right") {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (Platform.OS === "web") { onDelete(contact.id); return; }
      Alert.alert("Supprimer", `Supprimer ${contact.firstName} ${contact.lastName} ?`, [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: () => onDelete(contact.id) },
      ]);
    }
  }

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootRight={false}
      renderRightActions={p => <RightAction progress={p} />}
      onSwipeableOpen={handleSwipeOpen}
    >
      <Pressable
        onPress={() => onOpen(contact)}
        style={({ pressed }) => [
          styles.contactRow,
          { backgroundColor: colors.card, borderColor: colors.border },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: avatarColor + "20" }]}>
          <Text style={[styles.avatarText, { color: avatarColor }]}>
            {initials(contact.firstName, contact.lastName)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.contactName, { color: colors.foreground }]} numberOfLines={1}>
            {contact.firstName} {contact.lastName}
          </Text>
          <View style={styles.contactMeta}>
            {contact.company && (
              <View style={styles.metaChip}>
                <Feather name="briefcase" size={10} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>{contact.company}</Text>
              </View>
            )}
            {contact.phone && (
              <View style={styles.metaChip}>
                <Feather name="phone" size={10} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{contact.phone}</Text>
              </View>
            )}
          </View>
          {contact.tags && contact.tags.length > 0 && (
            <View style={styles.tagsRow}>
              {contact.tags.slice(0, 3).map((tag, i) => (
                <View key={i} style={[styles.tagChip, { backgroundColor: tagColor(tag) + "18" }]}>
                  <Text style={[styles.tagText, { color: tagColor(tag) }]}>#{tag}</Text>
                </View>
              ))}
              {contact.tags.length > 3 && (
                <Text style={[styles.tagMore, { color: colors.mutedForeground }]}>+{contact.tags.length - 3}</Text>
              )}
            </View>
          )}
        </View>
        <View style={styles.contactActions}>
          {contact.phone && (
            <Pressable
              onPress={() => Linking.openURL(`tel:${contact.phone}`)}
              style={[styles.actionBtn, { backgroundColor: "#22c55e18" }]}
              hitSlop={8}
            >
              <Feather name="phone" size={14} color="#22c55e" />
            </Pressable>
          )}
          {contact.email && (
            <Pressable
              onPress={() => Linking.openURL(`mailto:${contact.email}`)}
              style={[styles.actionBtn, { backgroundColor: "#3b82f618" }]}
              hitSlop={8}
            >
              <Feather name="mail" size={14} color="#3b82f6" />
            </Pressable>
          )}
        </View>
      </Pressable>
    </Swipeable>
  );
}

export default function ContactsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formLoading, setFormLoading] = useState(false);

  const { cached, isFromCache, updateCache } = useOfflineCache<Contact[]>("contacts_list", []);

  // cf. tasks.tsx : refs pour le fallback hors-ligne afin de garder `load` stable
  // (sinon refetch en boucle via useEffect([load])) + reqGen anti-reponse-obsolete.
  const cachedRef = useRef(cached);
  cachedRef.current = cached;
  const contactsLenRef = useRef(contacts.length);
  contactsLenRef.current = contacts.length;
  const reqGenRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++reqGenRef.current;
    try {
      const params = new URLSearchParams({ limit: "100", sortBy: "lastName", sortOrder: "asc" });
      if (search) params.set("search", search);
      const res = await fetchAuth(`${API_BASE}/api/contacts?${params}`);
      if (gen !== reqGenRef.current) return;
      if (res.ok) {
        const d = await res.json();
        if (gen !== reqGenRef.current) return;
        const list: Contact[] = d.contacts ?? d ?? [];
        setContacts(list);
        setTotal(d.total ?? list.length);
        if (!search) updateCache(list);
      }
    } catch {
      if (gen === reqGenRef.current && cachedRef.current.length > 0 && contactsLenRef.current === 0) setContacts(cachedRef.current);
    } finally { if (gen === reqGenRef.current) { setLoading(false); setRefreshing(false); } }
  }, [search, fetchAuth, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && contacts.length === 0) setContacts(cached);
  }, [isFromCache, cached, contacts.length]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setContacts(prev => prev.filter(c => c.id !== id));
    setSelected(null);
    try { await fetchAuth(`${API_BASE}/api/contacts/${id}`, { method: "DELETE" }); load(); }
    catch { load(); }
  }

  async function handleSubmit() {
    if (!formValues.firstName?.trim() || !formValues.lastName?.trim()) return;
    setFormLoading(true);
    try {
      const url = editId ? `${API_BASE}/api/contacts/${editId}` : `${API_BASE}/api/contacts`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formValues }),
      });
      if (res.ok) {
        setShowForm(false); setEditId(null);
        setFormValues({});
        load();
      }
    } finally { setFormLoading(false); }
  }

  function openEdit(c: Contact) {
    setEditId(c.id);
    setFormValues({
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      company: c.company || "",
      phone: c.phone || "",
      email: c.email || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  const avatarColor = selected ? tagColor(selected.firstName + selected.lastName) : "#6366f1";

  const detailFields = selected ? [
    { label: "Entreprise", value: selected.company ?? "—"  },
    { label: "Téléphone",  value: selected.phone    ?? "—" },
    { label: "Email",      value: selected.email    ?? "—" },
    { label: "Tags",       value: selected.tags?.join(", ") || "—" },
    { label: "Créé le",   value: new Date(selected.createdAt).toLocaleDateString("fr-FR") },
  ] : [];

  const detailExtraActions = selected ? [
    {
      label: "Voir fiche",
      icon: "external-link" as const,
      color: "#0369a1",
      onPress: () => { setSelected(null); router.push(`/contact-detail?id=${selected.id}` as any); },
    },
    ...(selected.phone ? [{
      label: "Appeler",
      icon: "phone" as const,
      color: "#22c55e",
      onPress: () => { setSelected(null); Linking.openURL(`tel:${selected.phone}`); },
    }] : []),
    ...(selected.email ? [{
      label: "Email",
      icon: "mail" as const,
      color: "#3b82f6",
      onPress: () => { setSelected(null); Linking.openURL(`mailto:${selected.email}`); },
    }] : []),
  ] : undefined;

  // Group contacts by first letter
  const letters = Array.from(new Set(contacts.map(c => (c.lastName[0] || "#").toUpperCase()))).sort();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#0369a1", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Contacts</Text>
            {!loading && <Text style={styles.headerSub}>{total} contact{total !== 1 ? "s" : ""}</Text>}
          </View>
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
            placeholder="Rechercher un contact…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={14} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0369a1" />
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0369a1" />}
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title="Aucun contact"
              subtitle={search ? "Aucun contact ne correspond à votre recherche." : "Ajoutez votre premier contact."}
            />
          }
          renderItem={({ item }) => (
            <ContactRow contact={item} colors={colors} onDelete={handleDelete} onOpen={setSelected} />
          )}
        />
      )}

      <FAB onPress={() => { setEditId(null); setFormValues({}); setShowForm(true); }} icon="user-plus" />

      <FormModal
        visible={showForm}
        title={editId ? "Modifier le contact" : "Nouveau contact"}
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
        icon="user"
        iconColor={avatarColor}
        title={selected ? `${selected.firstName} ${selected.lastName}` : ""}
        subtitle={selected?.company ?? selected?.email ?? ""}
        fields={detailFields}
        onClose={() => setSelected(null)}
        extraActions={detailExtraActions}
        onEdit={selected ? () => openEdit(selected) : undefined}
        onDelete={selected ? () => {
          if (Platform.OS === "web") { handleDelete(selected.id); return; }
          Alert.alert("Supprimer", `Supprimer ${selected.firstName} ${selected.lastName} ?`, [
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
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 1 },
  cachePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  contactRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8, gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  contactName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  contactMeta: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  tagsRow: { flexDirection: "row", gap: 4, marginTop: 5, flexWrap: "wrap" },
  tagChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  tagMore: { fontSize: 10, fontFamily: "Inter_400Regular", alignSelf: "center" },
  contactActions: { flexDirection: "row", gap: 6 },
  actionBtn: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  swipeDelete: { justifyContent: "center", alignItems: "center", width: 90, borderRadius: 12, marginBottom: 8, gap: 4, backgroundColor: "#ef4444" },
  swipeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
