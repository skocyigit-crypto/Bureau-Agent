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
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Organisation {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  isActive: boolean;
  createdAt: string;
  subscription?: {
    plan: string;
    status: string;
    licenseKey: string;
    maxUsers: number;
    maxContacts: number;
  };
  userCount?: number;
}

const PLAN_MAP: Record<string, { label: string; color: string }> = {
  essai: { label: "Essai", color: "#64748b" },
  starter: { label: "Starter", color: "#3b82f6" },
  professionnel: { label: "Pro", color: "#8b5cf6" },
  entreprise: { label: "Entreprise", color: "#f59e0b" },
};

const FORM_FIELDS = [
  { key: "name", label: "Nom de l'organisation", required: true },
  { key: "email", label: "Email de contact" },
  { key: "phone", label: "Telephone" },
  { key: "address", label: "Adresse" },
  { key: "plan", label: "Plan", type: "select" as const, options: [
    { value: "essai", label: "Essai Gratuit" },
    { value: "starter", label: "Starter (29 EUR/mois)" },
    { value: "professionnel", label: "Professionnel (79 EUR/mois)" },
    { value: "entreprise", label: "Entreprise (199 EUR/mois)" },
  ]},
  { key: "adminPrenom", label: "Prenom admin", required: true },
  { key: "adminNom", label: "Nom admin", required: true },
  { key: "adminEmail", label: "Email admin", required: true },
];

export default function OrganisationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ plan: "essai" });
  const [formLoading, setFormLoading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/organisations`);
      if (res.ok) {
        const data = await res.json();
        const rawOrgs = data.organisations ?? data ?? [];
        setOrgs(rawOrgs.map((o: any) => ({ ...o, isActive: o.actif ?? o.isActive ?? true })));
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  function onRefresh() { setRefreshing(true); fetchOrgs(); }

  const filtered = orgs.filter(o =>
    `${o.name} ${o.email || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate() {
    if (!formValues.name?.trim() || !formValues.adminPrenom?.trim() || !formValues.adminNom?.trim() || !formValues.adminEmail?.trim()) return;
    setFormLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/organisations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (res.ok) {
        setShowForm(false);
        setFormValues({ plan: "essai" });
        fetchOrgs();
      }
    } catch {} finally { setFormLoading(false); }
  }

  async function resendLicense(orgId: number, resetPassword = false) {
    setSendingEmail(orgId);
    try {
      await fetchAuth(`${API_BASE}/api/organisations/${orgId}/resend-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPassword }),
      });
    } catch {} finally { setSendingEmail(null); }
  }

  async function toggleActive(org: Organisation) {
    try {
      await fetchAuth(`${API_BASE}/api/organisations/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: org.name, actif: !org.isActive }),
      });
      fetchOrgs();
    } catch {}
  }

  const totalOrgs = orgs.length;
  const activeOrgs = orgs.filter(o => o.isActive).length;
  const trialOrgs = orgs.filter(o => o.subscription?.plan === "essai").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Organisations</Text>
          <Pressable onPress={() => setShowForm(true)} hitSlop={12}>
            <Feather name="plus" size={22} color="#ffffff" />
          </Pressable>
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
          ListHeaderComponent={
            <View style={styles.statsRow}>
              <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="home" size={16} color="#3b82f6" />
                <Text style={[styles.statVal, { color: colors.foreground }]}>{totalOrgs}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
              </View>
              <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="check-circle" size={16} color="#22c55e" />
                <Text style={[styles.statVal, { color: colors.foreground }]}>{activeOrgs}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Actives</Text>
              </View>
              <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="clock" size={16} color="#f59e0b" />
                <Text style={[styles.statVal, { color: colors.foreground }]}>{trialOrgs}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Essai</Text>
              </View>
            </View>
          }
          ListEmptyComponent={<EmptyState icon="home" title="Aucune organisation" subtitle="Creez votre premiere organisation" />}
          renderItem={({ item }) => {
            const plan = PLAN_MAP[item.subscription?.plan || "essai"] || PLAN_MAP.essai;
            const isExpanded = expandedId === item.id;
            return (
              <Pressable onPress={() => setExpandedId(isExpanded ? null : item.id)}>
                <View style={[styles.orgCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.orgHeader}>
                    <View style={[styles.orgIcon, { backgroundColor: plan.color + "18" }]}>
                      <Feather name="home" size={18} color={plan.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.orgNameRow}>
                        <Text style={[styles.orgName, { color: colors.foreground }]}>{item.name}</Text>
                        <View style={[styles.activeDot, { backgroundColor: item.isActive ? "#22c55e" : "#ef4444" }]} />
                      </View>
                      {item.email && <Text style={[styles.orgEmail, { color: colors.mutedForeground }]}>{item.email}</Text>}
                      <View style={styles.orgBadges}>
                        <View style={[styles.planBadge, { backgroundColor: plan.color + "18" }]}>
                          <Text style={[styles.planBadgeText, { color: plan.color }]}>{plan.label}</Text>
                        </View>
                        <Text style={[styles.orgDate, { color: colors.mutedForeground }]}>
                          {new Date(item.createdAt).toLocaleDateString("fr-FR")}
                        </Text>
                      </View>
                    </View>
                    <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
                  </View>

                  {isExpanded && (
                    <View style={[styles.orgExpanded, { borderTopColor: colors.border }]}>
                      {item.subscription?.licenseKey && (
                        <View style={styles.licenseRow}>
                          <Feather name="key" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.licenseText, { color: colors.foreground }]}>{item.subscription.licenseKey}</Text>
                        </View>
                      )}
                      {item.phone && (
                        <View style={styles.licenseRow}>
                          <Feather name="phone" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.licenseText, { color: colors.foreground }]}>{item.phone}</Text>
                        </View>
                      )}
                      {item.address && (
                        <View style={styles.licenseRow}>
                          <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.licenseText, { color: colors.foreground }]}>{item.address}</Text>
                        </View>
                      )}
                      <View style={styles.orgActions}>
                        <Pressable
                          onPress={() => resendLicense(item.id)}
                          disabled={sendingEmail === item.id}
                          style={[styles.orgActionBtn, { backgroundColor: "#f59e0b18" }]}
                        >
                          {sendingEmail === item.id ? (
                            <ActivityIndicator size="small" color="#f59e0b" />
                          ) : (
                            <>
                              <Feather name="send" size={14} color="#f59e0b" />
                              <Text style={[styles.orgActionText, { color: "#f59e0b" }]}>Licence</Text>
                            </>
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => resendLicense(item.id, true)}
                          disabled={sendingEmail === item.id}
                          style={[styles.orgActionBtn, { backgroundColor: "#3b82f618" }]}
                        >
                          <Feather name="key" size={14} color="#3b82f6" />
                          <Text style={[styles.orgActionText, { color: "#3b82f6" }]}>Reset MDP</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => toggleActive(item)}
                          style={[styles.orgActionBtn, { backgroundColor: (item.isActive ? "#ef4444" : "#22c55e") + "18" }]}
                        >
                          <Feather name={item.isActive ? "x-circle" : "check-circle"} size={14} color={item.isActive ? "#ef4444" : "#22c55e"} />
                          <Text style={[styles.orgActionText, { color: item.isActive ? "#ef4444" : "#22c55e" }]}>
                            {item.isActive ? "Desact." : "Activer"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <FormModal
        visible={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleCreate}
        title="Nouvelle organisation"
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="home"
        submitLabel="Creer et envoyer"
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
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  stat: { flex: 1, alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  statVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  orgCard: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  orgHeader: { flexDirection: "row", padding: 14, gap: 12, alignItems: "center" },
  orgIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  orgNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  orgName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  orgEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  orgBadges: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  planBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  planBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  orgDate: { fontSize: 10, fontFamily: "Inter_400Regular" },
  orgExpanded: { borderTopWidth: 1, padding: 14 },
  licenseRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  licenseText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  orgActions: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  orgActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  orgActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
