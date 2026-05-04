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
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  actif: boolean;
  createdAt: string;
  maxUsers: number;
  subscription?: {
    plan: string;
    status: string;
    licenseKey: string | null;
    maxUsers: number;
    maxContacts: number;
    maxCallsPerMonth: number;
    price: string | number;
    trialEndsAt?: string | null;
    isTrialExpired?: boolean;
    planDetails?: { name: string } | null;
  } | null;
  userCount: number;
  contactCount: number;
  callCount: number;
}

const PLAN_MAP: Record<string, { label: string; color: string }> = {
  essai:          { label: "Essai",      color: "#64748b" },
  starter:        { label: "Starter",    color: "#3b82f6" },
  professionnel:  { label: "Pro",        color: "#8b5cf6" },
  entreprise:     { label: "Entreprise", color: "#f59e0b" },
};

const FORM_FIELDS = [
  { key: "name",        label: "Nom de l'organisation", required: true },
  { key: "email",       label: "Email de contact" },
  { key: "phone",       label: "Telephone" },
  { key: "address",     label: "Adresse" },
  { key: "plan",        label: "Plan", type: "select" as const, options: [
    { value: "essai",         label: "Essai Gratuit" },
    { value: "starter",       label: "Starter (29 EUR/mois)" },
    { value: "professionnel", label: "Professionnel (79 EUR/mois)" },
    { value: "entreprise",    label: "Entreprise (199 EUR/mois)" },
  ]},
  { key: "adminPrenom", label: "Prenom admin", required: true },
  { key: "adminNom",    label: "Nom admin",    required: true },
  { key: "adminEmail",  label: "Email admin",  required: true },
];

function usagePct(current: number, max: number) {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((current / max) * 100));
}

function usageColor(pct: number): string {
  if (pct >= 100) return "#ef4444";
  if (pct >= 80)  return "#f59e0b";
  return "#22c55e";
}

interface UsageBarProps {
  label: string;
  current: number;
  max: number;
  icon: keyof typeof Feather.glyphMap;
  colors: ReturnType<typeof useColors>;
}

function UsageBar({ label, current, max, icon, colors }: UsageBarProps) {
  const pct = usagePct(current, max);
  const color = usageColor(pct);
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Feather name={icon} size={11} color={colors.mutedForeground} />
          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>{label}</Text>
        </View>
        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: pct >= 100 ? "#ef4444" : colors.foreground }}>
          {current} / {max === 999999 ? "∞" : max}
        </Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: color, width: `${pct}%` }} />
      </View>
    </View>
  );
}

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
  const [filterAlert, setFilterAlert] = useState(false);

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/organisations`);
      if (res.ok) {
        const data = await res.json();
        setOrgs((data.organisations ?? data ?? []).map((o: any) => ({ ...o, actif: o.actif ?? true })));
      }
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth]);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);
  function onRefresh() { setRefreshing(true); fetchOrgs(); }

  async function handleCreate() {
    if (!formValues.name?.trim() || !formValues.adminPrenom?.trim() || !formValues.adminNom?.trim() || !formValues.adminEmail?.trim()) return;
    setFormLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/organisations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      if (res.ok) { setShowForm(false); setFormValues({ plan: "essai" }); fetchOrgs(); }
    } finally { setFormLoading(false); }
  }

  async function resendLicense(orgId: number, resetPassword = false) {
    setSendingEmail(orgId);
    try {
      await fetchAuth(`${API_BASE}/api/organisations/${orgId}/resend-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPassword }),
      });
    } finally { setSendingEmail(null); }
  }

  async function toggleActive(org: Organisation) {
    try {
      await fetchAuth(`${API_BASE}/api/organisations/${org.id}/toggle-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actif: !org.actif }),
      });
      fetchOrgs();
    } catch {}
  }

  // Stats
  const totalUsers = orgs.reduce((s, o) => s + (o.userCount || 0), 0);
  const alertOrgs = orgs.filter(o => {
    const max = o.subscription?.maxUsers ?? o.maxUsers ?? 3;
    const pct = usagePct(o.userCount, max);
    return pct >= 80;
  });
  const payingOrgs = orgs.filter(o => o.subscription?.plan && o.subscription.plan !== "essai").length;

  const filtered = orgs
    .filter(o => `${o.name} ${o.email ?? ""}`.toLowerCase().includes(search.toLowerCase()))
    .filter(o => {
      if (!filterAlert) return true;
      const max = o.subscription?.maxUsers ?? o.maxUsers ?? 3;
      return usagePct(o.userCount, max) >= 80;
    });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Organisations</Text>
            <Text style={styles.headerSub}>{orgs.length} client{orgs.length !== 1 ? "s" : ""} · {totalUsers} utilisateur{totalUsers !== 1 ? "s" : ""} total</Text>
          </View>
          <Pressable onPress={() => setShowForm(true)} hitSlop={12} style={[styles.addBtn]}>
            <Feather name="plus" size={20} color="#fff" />
          </Pressable>
        </View>

        {/* Search */}
        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une organisation..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={14} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>

        {/* Alert filter */}
        {alertOrgs.length > 0 && (
          <Pressable
            onPress={() => setFilterAlert(f => !f)}
            style={[styles.alertFilter, { backgroundColor: filterAlert ? "#ef444430" : "rgba(255,255,255,0.12)", borderColor: filterAlert ? "#ef4444" : "transparent" }]}
          >
            <Feather name="alert-triangle" size={12} color={filterAlert ? "#ef4444" : "#fbbf24"} />
            <Text style={[styles.alertFilterText, { color: filterAlert ? "#ef4444" : "#fbbf24" }]}>
              {alertOrgs.length} org proche/au-delà de la limite
            </Text>
            {filterAlert && <Feather name="x" size={11} color="#ef4444" />}
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#7c3aed" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
          ListHeaderComponent={
            <View style={styles.statsRow}>
              {[
                { icon: "home" as const,        val: orgs.length,   label: "Clients",   color: "#7c3aed" },
                { icon: "check-circle" as const, val: orgs.filter(o => o.actif).length, label: "Actifs", color: "#22c55e" },
                { icon: "users" as const,        val: totalUsers,    label: "Utilisateurs", color: "#3b82f6" },
                { icon: "credit-card" as const,  val: payingOrgs,    label: "Payants",   color: "#f59e0b" },
              ].map(s => (
                <View key={s.label} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name={s.icon} size={14} color={s.color} />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{s.val}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
                </View>
              ))}
            </View>
          }
          ListEmptyComponent={<EmptyState icon="home" title="Aucune organisation" subtitle="Créez votre première organisation" />}
          renderItem={({ item }) => {
            const plan = PLAN_MAP[item.subscription?.plan ?? "essai"] ?? PLAN_MAP.essai;
            const maxUsers = item.subscription?.maxUsers ?? item.maxUsers ?? 3;
            const maxContacts = item.subscription?.maxContacts ?? 500;
            const maxCalls = item.subscription?.maxCallsPerMonth ?? 200;
            const userPct = usagePct(item.userCount, maxUsers);
            const isExpanded = expandedId === item.id;
            const isAlert = userPct >= 80;
            const isOver = userPct >= 100;

            return (
              <Pressable onPress={() => setExpandedId(isExpanded ? null : item.id)}>
                <View style={[
                  styles.orgCard,
                  { backgroundColor: colors.card, borderColor: isOver ? "#ef4444" : isAlert ? "#f59e0b" : colors.border },
                  isOver && { borderWidth: 1.5 },
                ]}>
                  {/* Alert bar */}
                  {isAlert && (
                    <View style={[styles.alertBar, { backgroundColor: isOver ? "#ef444415" : "#f59e0b15" }]}>
                      <Feather name="alert-triangle" size={11} color={isOver ? "#ef4444" : "#f59e0b"} />
                      <Text style={[styles.alertBarText, { color: isOver ? "#ef4444" : "#f59e0b" }]}>
                        {isOver ? "Limite dépassée" : "Proche de la limite"} · {userPct}% utilisateurs
                      </Text>
                    </View>
                  )}

                  <View style={styles.cardHeader}>
                    <View style={[styles.orgIcon, { backgroundColor: plan.color + "18" }]}>
                      <Feather name="home" size={18} color={plan.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.orgName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                        <View style={[styles.activeDot, { backgroundColor: item.actif ? "#22c55e" : "#ef4444" }]} />
                      </View>
                      {item.email && (
                        <Text style={[styles.orgEmail, { color: colors.mutedForeground }]} numberOfLines={1}>{item.email}</Text>
                      )}
                      <View style={styles.badgeRow}>
                        <View style={[styles.planBadge, { backgroundColor: plan.color + "18" }]}>
                          <Text style={[styles.planBadgeText, { color: plan.color }]}>{plan.label}</Text>
                        </View>
                        {item.subscription?.isTrialExpired && (
                          <View style={[styles.planBadge, { backgroundColor: "#ef444415" }]}>
                            <Text style={[styles.planBadgeText, { color: "#ef4444" }]}>Expiré</Text>
                          </View>
                        )}
                        <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
                          {new Date(item.createdAt).toLocaleDateString("fr-FR")}
                        </Text>
                      </View>
                    </View>

                    {/* User count pill — always visible */}
                    <View style={[styles.userPill, { backgroundColor: usageColor(userPct) + "18", borderColor: usageColor(userPct) + "40" }]}>
                      <Feather name="users" size={12} color={usageColor(userPct)} />
                      <Text style={[styles.userPillText, { color: usageColor(userPct) }]}>
                        {item.userCount}/{maxUsers}
                      </Text>
                    </View>

                    <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
                  </View>

                  {/* Usage bars — always visible below header */}
                  <View style={[styles.usageBars, { borderTopColor: colors.border }]}>
                    <UsageBar label="Utilisateurs" current={item.userCount} max={maxUsers} icon="users" colors={colors} />
                    <UsageBar label="Contacts"     current={item.contactCount} max={maxContacts} icon="user" colors={colors} />
                    <UsageBar label="Appels/mois"  current={item.callCount} max={maxCalls} icon="phone" colors={colors} />
                  </View>

                  {/* Expanded details */}
                  {isExpanded && (
                    <View style={[styles.expandedSection, { borderTopColor: colors.border }]}>
                      {/* Price */}
                      {item.subscription?.price !== undefined && (
                        <View style={styles.detailRow}>
                          <Feather name="credit-card" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Montant</Text>
                          <Text style={[styles.detailValue, { color: colors.foreground }]}>
                            {Number(item.subscription.price).toFixed(2)} EUR/mois
                          </Text>
                        </View>
                      )}

                      {/* License key */}
                      {item.subscription?.licenseKey && (
                        <View style={styles.detailRow}>
                          <Feather name="key" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Clé</Text>
                          <Text style={[styles.detailValue, { color: colors.foreground, fontSize: 11 }]} numberOfLines={1}>
                            {item.subscription.licenseKey}
                          </Text>
                        </View>
                      )}

                      {/* Trial ends */}
                      {item.subscription?.trialEndsAt && (
                        <View style={styles.detailRow}>
                          <Feather name="clock" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Essai</Text>
                          <Text style={[styles.detailValue, { color: item.subscription.isTrialExpired ? "#ef4444" : colors.foreground }]}>
                            {new Date(item.subscription.trialEndsAt).toLocaleDateString("fr-FR")}
                            {item.subscription.isTrialExpired ? " · Expiré" : ""}
                          </Text>
                        </View>
                      )}

                      {item.phone && (
                        <View style={styles.detailRow}>
                          <Feather name="phone" size={13} color={colors.mutedForeground} />
                          <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Tél.</Text>
                          <Text style={[styles.detailValue, { color: colors.foreground }]}>{item.phone}</Text>
                        </View>
                      )}

                      {/* Actions */}
                      <View style={styles.actionsRow}>
                        <Pressable
                          onPress={() => resendLicense(item.id)}
                          disabled={sendingEmail === item.id}
                          style={[styles.actionBtn, { backgroundColor: "#f59e0b18" }]}
                        >
                          {sendingEmail === item.id
                            ? <ActivityIndicator size="small" color="#f59e0b" />
                            : <><Feather name="send" size={13} color="#f59e0b" /><Text style={[styles.actionBtnText, { color: "#f59e0b" }]}>Renvoyer licence</Text></>
                          }
                        </Pressable>
                        <Pressable
                          onPress={() => resendLicense(item.id, true)}
                          disabled={sendingEmail === item.id}
                          style={[styles.actionBtn, { backgroundColor: "#3b82f618" }]}
                        >
                          <Feather name="key" size={13} color="#3b82f6" />
                          <Text style={[styles.actionBtnText, { color: "#3b82f6" }]}>Reset MDP</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => toggleActive(item)}
                          style={[styles.actionBtn, { backgroundColor: (item.actif ? "#ef4444" : "#22c55e") + "18" }]}
                        >
                          <Feather name={item.actif ? "x-circle" : "check-circle"} size={13} color={item.actif ? "#ef4444" : "#22c55e"} />
                          <Text style={[styles.actionBtnText, { color: item.actif ? "#ef4444" : "#22c55e" }]}>
                            {item.actif ? "Désactiver" : "Activer"}
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
        onChange={(k, v) => setFormValues(p => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="home"
        submitLabel="Créer et envoyer"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#7c3aed", paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 1 },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  alertFilter: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, alignSelf: "flex-start" },
  alertFilterText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12 },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: 3 },
  statVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },

  orgCard: { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  alertBar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 6 },
  alertBarText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 0 },
  orgIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  orgName: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  activeDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  orgEmail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" },
  planBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  planBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  dateText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  userPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  userPillText: { fontSize: 12, fontFamily: "Inter_700Bold" },

  usageBars: { padding: 14, paddingTop: 10, gap: 8, borderTopWidth: 1, marginTop: 10 },

  expandedSection: { borderTopWidth: 1, padding: 14, gap: 8 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailLabel: { fontSize: 12, fontFamily: "Inter_400Regular", width: 48 },
  detailValue: { fontSize: 12, fontFamily: "Inter_600SemiBold", flex: 1 },
  actionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  actionBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
