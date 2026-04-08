import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface User {
  id: number;
  prenom: string;
  nom: string;
  email: string;
  role: string;
  departement?: string;
  isActive: boolean;
  lastLogin?: string;
  mfaEnabled?: boolean;
}

const ROLE_MAP: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "#ef4444" },
  administrateur: { label: "Administrateur", color: "#8b5cf6" },
  agent: { label: "Agent", color: "#3b82f6" },
  lecture_seule: { label: "Lecture seule", color: "#64748b" },
};

const FORM_FIELDS = [
  { key: "prenom", label: "Prenom", required: true },
  { key: "nom", label: "Nom", required: true },
  { key: "email", label: "Email", required: true },
  { key: "role", label: "Role", type: "select" as const, options: [
    { value: "administrateur", label: "Administrateur" },
    { value: "agent", label: "Agent" },
    { value: "lecture_seule", label: "Lecture seule" },
  ]},
  { key: "departement", label: "Departement" },
  { key: "password", label: "Mot de passe (vide = genere auto)" },
];

export default function UsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user: currentUser } = useAuth();
  const isWeb = Platform.OS === "web";
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ role: "agent" });
  const [formLoading, setFormLoading] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [sendingCreds, setSendingCreds] = useState<number | null>(null);

  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "administrateur";

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/auth/users`);
      if (res.ok) {
        const data = await res.json();
        const rawUsers = data.users ?? data ?? [];
        setUsers(rawUsers.map((u: any) => ({ ...u, isActive: u.actif ?? u.isActive ?? true })));
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function onRefresh() { setRefreshing(true); fetchUsers(); }

  const filtered = users.filter(u =>
    `${u.prenom} ${u.nom} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSubmit() {
    if (!formValues.prenom?.trim() || !formValues.nom?.trim() || !formValues.email?.trim()) return;
    setFormLoading(true);
    try {
      if (editId) {
        const body: any = {
          prenom: formValues.prenom,
          nom: formValues.nom,
          email: formValues.email,
          role: formValues.role,
          departement: formValues.departement || null,
        };
        if (formValues.password?.trim()) body.password = formValues.password;
        const res = await fetchAuth(`${API_BASE}/api/auth/users/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setShowForm(false);
          setEditId(null);
          setFormValues({ role: "agent" });
          fetchUsers();
        }
      } else {
        const endpoint = formValues.password?.trim()
          ? `${API_BASE}/api/auth/users`
          : `${API_BASE}/api/auth/users/create-and-send`;
        const body: any = {
          prenom: formValues.prenom,
          nom: formValues.nom,
          email: formValues.email,
          role: formValues.role,
          departement: formValues.departement || undefined,
        };
        if (formValues.password?.trim()) body.password = formValues.password;
        const res = await fetchAuth(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setShowForm(false);
          setFormValues({ role: "agent" });
          fetchUsers();
        }
      }
    } catch {} finally { setFormLoading(false); }
  }

  function openEdit(user: User) {
    setEditId(user.id);
    setFormValues({
      prenom: user.prenom,
      nom: user.nom,
      email: user.email,
      role: user.role,
      departement: user.departement || "",
      password: "",
    });
    setShowForm(true);
  }

  function openNew() {
    setEditId(null);
    setFormValues({ role: "agent" });
    setShowForm(true);
  }

  async function deleteUser(id: number) {
    function doDelete() {
      fetchAuth(`${API_BASE}/api/auth/users/${id}`, { method: "DELETE" })
        .then(() => fetchUsers())
        .catch(() => {});
    }
    if (Platform.OS === "web") { doDelete(); return; }
    Alert.alert("Supprimer", "Supprimer cet utilisateur ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: doDelete },
    ]);
  }

  async function sendCredentials(userId: number) {
    setSendingCreds(userId);
    try {
      await fetchAuth(`${API_BASE}/api/auth/users/${userId}/send-credentials`, {
        method: "POST",
      });
    } catch {} finally { setSendingCreds(null); }
  }

  async function toggleActive(user: User) {
    try {
      await fetchAuth(`${API_BASE}/api/auth/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actif: !user.isActive }),
      });
      fetchUsers();
    } catch {}
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Utilisateurs</Text>
          <Pressable onPress={openNew} hitSlop={12}>
            <Feather name="user-plus" size={22} color="#ffffff" />
          </Pressable>
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un utilisateur..."
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
          data={filtered}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="users" title="Aucun utilisateur" subtitle="Ajoutez des membres a votre equipe" />}
          renderItem={({ item }) => {
            const role = ROLE_MAP[item.role] || { label: item.role, color: "#64748b" };
            return (
              <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.userHeader}>
                  <View style={[styles.avatar, { backgroundColor: role.color + "20" }]}>
                    <Text style={[styles.avatarText, { color: role.color }]}>
                      {(item.prenom[0] + item.nom[0]).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.userName, { color: colors.foreground }]}>{item.prenom} {item.nom}</Text>
                      <View style={[styles.statusIndicator, { backgroundColor: item.isActive ? "#22c55e" : "#ef4444" }]} />
                    </View>
                    <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{item.email}</Text>
                    <View style={styles.badgeRow}>
                      <View style={[styles.roleBadge, { backgroundColor: role.color + "18" }]}>
                        <Text style={[styles.roleBadgeText, { color: role.color }]}>{role.label}</Text>
                      </View>
                      {item.departement && (
                        <View style={[styles.deptBadge, { backgroundColor: colors.muted }]}>
                          <Text style={[styles.deptBadgeText, { color: colors.mutedForeground }]}>{item.departement}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
                <View style={[styles.userActions, { borderTopColor: colors.border }]}>
                  <Pressable onPress={() => openEdit(item)} style={styles.userActionBtn}>
                    <Feather name="edit-2" size={14} color={colors.primary} />
                    <Text style={[styles.userActionText, { color: colors.primary }]}>Modifier</Text>
                  </Pressable>
                  <Pressable onPress={() => sendCredentials(item.id)} disabled={sendingCreds === item.id} style={styles.userActionBtn}>
                    {sendingCreds === item.id ? (
                      <ActivityIndicator size="small" color="#f59e0b" />
                    ) : (
                      <>
                        <Feather name="send" size={14} color="#f59e0b" />
                        <Text style={[styles.userActionText, { color: "#f59e0b" }]}>Mot de passe</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable onPress={() => toggleActive(item)} style={styles.userActionBtn}>
                    <Feather name={item.isActive ? "user-x" : "user-check"} size={14} color={item.isActive ? "#ef4444" : "#22c55e"} />
                    <Text style={[styles.userActionText, { color: item.isActive ? "#ef4444" : "#22c55e" }]}>
                      {item.isActive ? "Desactiver" : "Activer"}
                    </Text>
                  </Pressable>
                  {currentUser?.role === "super_admin" && item.id !== currentUser.id && (
                    <Pressable onPress={() => deleteUser(item.id)} style={styles.userActionBtn}>
                      <Feather name="trash-2" size={14} color="#ef4444" />
                    </Pressable>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      <FormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditId(null); }}
        onSubmit={handleSubmit}
        title={editId ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="user-plus"
        submitLabel={editId ? "Enregistrer" : "Creer"}
      />
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
  userCard: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  userHeader: { flexDirection: "row", padding: 14, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  userName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusIndicator: { width: 8, height: 8, borderRadius: 4 },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  roleBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  deptBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  deptBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  userActions: { flexDirection: "row", borderTopWidth: 1, paddingVertical: 8, paddingHorizontal: 8 },
  userActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  userActionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
