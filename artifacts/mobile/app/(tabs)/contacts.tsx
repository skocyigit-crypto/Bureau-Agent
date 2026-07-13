import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  type Contact,
  type CreateContactBody,
  type UpdateContactBody,
  type ListContactsParams,
} from "@workspace/api-client-react";

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";

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
  {
    key: "category", label: "Categorie", type: "select" as const, options: [
      { value: "client", label: "Client" },
      { value: "prospect", label: "Prospect" },
      { value: "fournisseur", label: "Fournisseur" },
      { value: "partenaire", label: "Partenaire" },
      { value: "autre", label: "Autre" },
    ],
  },
  { key: "address", label: "Adresse" },
  { key: "notes", label: "Notes", type: "multiline" as const },
];

function ContactRow({
  item,
  colors,
  onPress,
  onCall,
  onSms,
  onEmail,
}: {
  item: Contact;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onPress: () => void;
  onCall: () => void;
  onSms: () => void;
  onEmail: () => void;
}) {
  const catColor = CATEGORY_COLORS[item.category] ?? colors.mutedForeground;

  function formatLastContact(dateStr?: string | null): string {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Aujourd'hui";
    if (days === 1) return "Hier";
    if (days < 7) return `${days}j`;
    if (days < 30) return `${Math.floor(days / 7)}sem`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  const lastContact = formatLastContact(item.lastCallAt);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.contactRow,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.avatarBox, { backgroundColor: catColor + "18" }]}>
        <Text style={[styles.avatarInitials, { color: catColor }]}>
          {(item.firstName?.[0] || "").toUpperCase()}{(item.lastName?.[0] || "").toUpperCase()}
        </Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={[styles.contactName, { color: colors.foreground }]} numberOfLines={1}>
          {item.firstName} {item.lastName}
        </Text>
        <View style={styles.contactMeta}>
          <View style={[styles.catDot, { backgroundColor: catColor }]} />
          <Text style={[styles.contactSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.company || CATEGORY_LABELS[item.category] || item.category}
          </Text>
          {lastContact ? (
            <Text style={[styles.lastContactText, { color: colors.mutedForeground }]}> · {lastContact}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actionBtns}>
        {item.phone ? (
          <Pressable onPress={onCall} style={[styles.actionBtn, { backgroundColor: "#22c55e18" }]}>
            <Feather name="phone" size={15} color="#22c55e" />
          </Pressable>
        ) : null}
        {item.phone ? (
          <Pressable onPress={onSms} style={[styles.actionBtn, { backgroundColor: "#3b82f618" }]}>
            <Feather name="message-circle" size={15} color="#3b82f6" />
          </Pressable>
        ) : null}
        {item.email ? (
          <Pressable onPress={onEmail} style={[styles.actionBtn, { backgroundColor: "#8b5cf618" }]}>
            <Feather name="mail" size={15} color="#8b5cf6" />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function ContactsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [filterCat, setFilterCat] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ category: "client" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const sectionListRef = useRef<SectionList<Contact>>(null);
  const flatListRef = useRef<FlatList>(null);

  const { cached, isFromCache, updateCache } = useOfflineCache<Contact[]>("contacts_list", []);
  // Read via refs (not as fetchContacts deps) so the callback's identity
  // doesn't change every time updateCache() runs — cached/contacts.length
  // used to be direct deps, and since updateCache() (called on every
  // successful default-filter fetch) creates a new `cached` reference,
  // that recreated fetchContacts, which retriggered the effect below it,
  // producing an unbounded refetch loop on the default (no search/filter) view.
  const cachedRef = useRef(cached);
  cachedRef.current = cached;
  const contactsLenRef = useRef(contacts.length);
  contactsLenRef.current = contacts.length;

  const fetchContacts = useCallback(async () => {
    try {
      const params: ListContactsParams = { limit: 200, sortBy: "lastName", sortOrder: "asc" };
      if (search) params.search = search;
      if (filterCat !== "all") params.category = filterCat as ListContactsParams["category"];
      const data = await listContacts(params);
      const list = data.contacts ?? [];
      setContacts(list);
      if (!search && filterCat === "all") updateCache(list);
    } catch {
      if (cachedRef.current.length > 0 && contactsLenRef.current === 0) setContacts(cachedRef.current);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, filterCat, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && contacts.length === 0) setContacts(cached);
  }, [isFromCache, cached, contacts.length]);

  useEffect(() => { setLoading(true); fetchContacts(); }, [fetchContacts]);

  function onRefresh() { setRefreshing(true); fetchContacts(); }

  function haptic() {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleSubmit() {
    if (!formValues.firstName?.trim() || !formValues.lastName?.trim()) return;
    setFormLoading(true);
    try {
      const body: CreateContactBody = {
        firstName: formValues.firstName.trim(),
        lastName: formValues.lastName.trim(),
        company: formValues.company || undefined,
        email: formValues.email || undefined,
        phone: formValues.phone?.trim() || "",
        category: formValues.category as CreateContactBody["category"],
        address: formValues.address || undefined,
        notes: formValues.notes || undefined,
      };
      if (editId) {
        await updateContact(editId, body as UpdateContactBody);
      } else {
        await createContact(body);
      }
      setShowForm(false);
      setEditId(null);
      setFormValues({ category: "client" });
      fetchContacts();
    } catch {} finally { setFormLoading(false); }
  }

  async function handleDelete(id: number) {
    try {
      await deleteContact(id);
      setSelected(null);
      fetchContacts();
    } catch {}
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

  const sections = useMemo(() => {
    const sorted = [...contacts].sort((a, b) =>
      (a.lastName || "").localeCompare(b.lastName || "", "fr", { sensitivity: "base" })
    );
    const groups: Record<string, Contact[]> = {};
    sorted.forEach((c) => {
      const letter = (c.lastName?.[0] || "#").toUpperCase();
      const key = /[A-Z]/.test(letter) ? letter : "#";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => {
        if (a === "#") return 1;
        if (b === "#") return -1;
        return a.localeCompare(b);
      })
      .map(([title, data]) => ({ title, data }));
  }, [contacts]);

  const letters = useMemo(() => sections.map((s) => s.title), [sections]);

  function scrollToLetter(letter: string) {
    haptic();
    const idx = sections.findIndex((s) => s.title === letter);
    if (idx >= 0 && sectionListRef.current) {
      try {
        sectionListRef.current.scrollToLocation({ sectionIndex: idx, itemIndex: 0, animated: true, viewPosition: 0 });
      } catch {}
    }
  }

  const isSearchMode = !!search || filterCat !== "all";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Contacts</Text>
          <View style={[styles.countBadge, { backgroundColor: colors.primary + "30" }]}>
            <Text style={[styles.countText, { color: colors.primary }]}>{contacts.length}</Text>
          </View>
          {isFromCache && (
            <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
            </View>
          )}
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un contact..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={searchInput}
            onChangeText={setSearchInput}
          />
          {searchInput ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => { setSearchInput(""); setSearch(""); }} /> : null}
        </View>
        <View style={styles.filterRow}>
          {catFilters.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilterCat(f.key)}
              style={[styles.filterChip, { backgroundColor: filterCat === f.key ? colors.primary : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.filterText, { color: filterCat === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>
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
      ) : contacts.length === 0 ? (
        <EmptyState icon="users" title="Aucun contact" subtitle="Vos contacts apparaitront ici" />
      ) : isSearchMode ? (
        <FlatList
          ref={flatListRef}
          data={contacts}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="users" title="Aucun contact" subtitle="Affinez votre recherche" />}
          renderItem={({ item }) => (
            <ContactRow
              item={item}
              colors={colors}
              onPress={() => setSelected(item)}
              onCall={() => { haptic(); Linking.openURL(`tel:${item.phone}`); }}
              onSms={() => { haptic(); Linking.openURL(`sms:${item.phone}`); }}
              onEmail={() => { haptic(); Linking.openURL(`mailto:${item.email}`); }}
            />
          )}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <SectionList
            ref={sectionListRef}
            sections={sections}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100, paddingRight: isWeb ? 16 : 36 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            stickySectionHeadersEnabled
            onScrollToIndexFailed={() => {}}
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <Text style={[styles.sectionLetter, { color: colors.primary }]}>{section.title}</Text>
                <View style={[styles.sectionLine, { backgroundColor: colors.border }]} />
              </View>
            )}
            renderItem={({ item }) => (
              <ContactRow
                item={item}
                colors={colors}
                onPress={() => setSelected(item)}
                onCall={() => { haptic(); Linking.openURL(`tel:${item.phone}`); }}
                onSms={() => { haptic(); Linking.openURL(`sms:${item.phone}`); }}
                onEmail={() => { haptic(); Linking.openURL(`mailto:${item.email}`); }}
              />
            )}
          />
          {!isWeb && letters.length > 0 && (
            <View style={styles.alphabetSidebar} pointerEvents="box-none">
              {letters.map((letter) => (
                <TouchableOpacity key={letter} onPress={() => scrollToLetter(letter)} style={styles.alphabetBtn}>
                  <Text style={[styles.alphabetLetter, { color: colors.primary }]}>{letter}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
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
          subtitle={selected.company ?? undefined}
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
          extraActions={[{
            label: "Créer un projet",
            icon: "folder",
            color: "#6366f1",
            onPress: async () => {
              try {
                const name = `${selected.firstName} ${selected.lastName}`.trim() || selected.company || "Contact";
                const res = await fetchAuth(`${API_BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Projet - ${name}`, clientName: name, contactId: selected.id, status: "planifie", priority: "moyenne", progress: 0, notes: `Créé depuis le contact mobile` }) });
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
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  countText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  cacheBadge: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8 },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 16,
    gap: 10,
  },
  sectionLetter: { fontSize: 13, fontFamily: "Inter_700Bold", width: 18 },
  sectionLine: { flex: 1, height: 1 },
  contactRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 6, marginHorizontal: 16 },
  avatarBox: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 12 },
  avatarInitials: { fontSize: 15, fontFamily: "Inter_700Bold" },
  contactInfo: { flex: 1, marginRight: 8 },
  contactName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  contactMeta: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  catDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  contactSub: { fontSize: 12, fontFamily: "Inter_400Regular", flexShrink: 1 },
  lastContactText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  actionBtns: { flexDirection: "row", gap: 6 },
  actionBtn: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  alphabetSidebar: {
    position: "absolute",
    right: 4,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
  },
  alphabetBtn: { paddingVertical: 1.5, paddingHorizontal: 6 },
  alphabetLetter: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
