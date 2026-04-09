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

interface AdminReport {
  id: number;
  subject: string;
  message: string;
  category: string;
  priority: string;
  status: string;
  adminResponse?: string;
  respondedAt?: string;
  orgName?: string;
  userName?: string;
  createdAt: string;
}

interface Stats {
  total: number;
  nouveau: number;
  en_cours: number;
  resolu: number;
  repondu: number;
}

const CATEGORY_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  general: { label: "General", color: "#64748b", icon: "file-text" },
  technique: { label: "Technique", color: "#3b82f6", icon: "tool" },
  facturation: { label: "Facturation", color: "#f59e0b", icon: "credit-card" },
  fonctionnalite: { label: "Fonctionnalite", color: "#8b5cf6", icon: "star" },
  bug: { label: "Bug", color: "#ef4444", icon: "alert-circle" },
  question: { label: "Question", color: "#22c55e", icon: "help-circle" },
};

const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  basse: { label: "Basse", color: "#64748b" },
  normal: { label: "Normal", color: "#3b82f6" },
  haute: { label: "Haute", color: "#f59e0b" },
  urgente: { label: "Urgente", color: "#ef4444" },
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  nouveau: { label: "Nouveau", color: "#3b82f6" },
  en_cours: { label: "En cours", color: "#f59e0b" },
  resolu: { label: "Resolu", color: "#22c55e" },
  ferme: { label: "Ferme", color: "#64748b" },
};

const FORM_FIELDS = [
  { key: "subject", label: "Sujet", required: true },
  { key: "category", label: "Categorie", type: "select" as const, options: [
    { value: "general", label: "General" },
    { value: "technique", label: "Technique" },
    { value: "facturation", label: "Facturation" },
    { value: "fonctionnalite", label: "Fonctionnalite" },
    { value: "bug", label: "Bug" },
    { value: "question", label: "Question" },
  ]},
  { key: "priority", label: "Priorite", type: "select" as const, options: [
    { value: "basse", label: "Basse" },
    { value: "normal", label: "Normal" },
    { value: "haute", label: "Haute" },
    { value: "urgente", label: "Urgente" },
  ]},
  { key: "message", label: "Message", required: true, type: "multiline" as const },
];

export default function AdminReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";
  const isSuperAdmin = user?.role === "super_admin";

  const [tab, setTab] = useState<"rapports" | "equipe">("rapports");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, nouveau: 0, en_cours: 0, resolu: 0, repondu: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ category: "general", priority: "normal" });
  const [formLoading, setFormLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userFormValues, setUserFormValues] = useState<Record<string, string>>({ role: "agent" });
  const [userFormLoading, setUserFormLoading] = useState(false);

  const USER_FORM_FIELDS = [
    { key: "prenom", label: "Prenom", required: true },
    { key: "nom", label: "Nom", required: true },
    { key: "email", label: "Email", required: true },
    { key: "role", label: "Role", type: "select" as const, options: [
      { value: "agent", label: "Agent" },
      { value: "lecture_seule", label: "Lecture seule" },
    ]},
    { key: "departement", label: "Departement" },
  ];

  const fetchReports = useCallback(async () => {
    try {
      const [reportsRes, statsRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/admin-reports?limit=30`),
        fetchAuth(`${API_BASE}/api/admin-reports/stats`),
      ]);
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        setReports(data.reports ?? []);
      }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  const fetchTeam = useCallback(async () => {
    setTeamLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/auth/users`);
      if (res.ok) {
        const data = await res.json();
        setTeamUsers(data.users ?? data ?? []);
      }
    } catch {} finally { setTeamLoading(false); }
  }, [fetchAuth]);

  useEffect(() => { fetchReports(); }, [fetchReports]);
  useEffect(() => { if (tab === "equipe") fetchTeam(); }, [tab, fetchTeam]);

  function onRefresh() {
    setRefreshing(true);
    if (tab === "rapports") fetchReports();
    else { fetchTeam(); setRefreshing(false); }
  }

  async function handleSubmitReport() {
    if (!formValues.subject?.trim() || !formValues.message?.trim()) return;
    setFormLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/admin-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: formValues.subject,
          message: formValues.message,
          category: formValues.category || "general",
          priority: formValues.priority || "normal",
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormValues({ category: "general", priority: "normal" });
        fetchReports();
      }
    } catch {} finally { setFormLoading(false); }
  }

  async function handleAddUser() {
    if (!userFormValues.prenom?.trim() || !userFormValues.nom?.trim() || !userFormValues.email?.trim()) return;
    setUserFormLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/auth/users/create-and-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prenom: userFormValues.prenom,
          nom: userFormValues.nom,
          email: userFormValues.email,
          role: userFormValues.role || "agent",
          departement: userFormValues.departement || undefined,
        }),
      });
      if (res.ok) {
        setShowUserForm(false);
        setUserFormValues({ role: "agent" });
        fetchTeam();
      }
    } catch {} finally { setUserFormLoading(false); }
  }

  async function updateReportStatus(reportId: number, status: string) {
    try {
      const res = await fetchAuth(`${API_BASE}/api/admin-reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) fetchReports();
    } catch {}
  }

  const ROLE_MAP: Record<string, { label: string; color: string }> = {
    super_admin: { label: "Super Admin", color: "#ef4444" },
    administrateur: { label: "Admin", color: "#8b5cf6" },
    agent: { label: "Agent", color: "#3b82f6" },
    lecture_seule: { label: "Lecture", color: "#64748b" },
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Mon Espace</Text>
          <Pressable onPress={() => tab === "rapports" ? setShowForm(true) : setShowUserForm(true)} hitSlop={12}>
            <Feather name="plus" size={22} color="#ffffff" />
          </Pressable>
        </View>
        <View style={styles.tabRow}>
          <Pressable onPress={() => setTab("equipe")} style={[styles.tabBtn, tab === "equipe" && { backgroundColor: colors.primary }]}>
            <Feather name="users" size={14} color={tab === "equipe" ? colors.primaryForeground : "rgba(255,255,255,0.7)"} />
            <Text style={[styles.tabText, { color: tab === "equipe" ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>Mon Equipe</Text>
          </Pressable>
          <Pressable onPress={() => setTab("rapports")} style={[styles.tabBtn, tab === "rapports" && { backgroundColor: colors.primary }]}>
            <Feather name="send" size={14} color={tab === "rapports" ? colors.primaryForeground : "rgba(255,255,255,0.7)"} />
            <Text style={[styles.tabText, { color: tab === "rapports" ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>Rapports Admin</Text>
          </Pressable>
        </View>
      </View>

      {tab === "equipe" ? (
        teamLoading && teamUsers.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={teamUsers}
            keyExtractor={(item) => item.id?.toString()}
            contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 40 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            ListHeaderComponent={
              <View style={styles.statsRow}>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="users" size={16} color="#3b82f6" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{teamUsers.length}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="user-check" size={16} color="#22c55e" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{teamUsers.filter((u: any) => u.actif !== false).length}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Actifs</Text>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="shield" size={16} color="#8b5cf6" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{teamUsers.filter((u: any) => u.role === "administrateur" || u.role === "super_admin").length}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Admins</Text>
                </View>
              </View>
            }
            ListEmptyComponent={<EmptyState icon="users" title="Aucun membre" subtitle="Ajoutez des utilisateurs a votre equipe" />}
            renderItem={({ item }) => {
              const role = ROLE_MAP[item.role] || { label: item.role, color: "#64748b" };
              return (
                <View style={[styles.teamCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.avatar, { backgroundColor: role.color + "20" }]}>
                    <Text style={[styles.avatarText, { color: role.color }]}>
                      {((item.prenom?.[0] || "") + (item.nom?.[0] || "")).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.userName, { color: colors.foreground }]}>{item.prenom} {item.nom}</Text>
                      <View style={[styles.activeDot, { backgroundColor: item.actif !== false ? "#22c55e" : "#ef4444" }]} />
                    </View>
                    <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{item.email}</Text>
                    <View style={styles.badgeRow}>
                      <View style={[styles.roleBadge, { backgroundColor: role.color + "18" }]}>
                        <Text style={[styles.roleBadgeText, { color: role.color }]}>{role.label}</Text>
                      </View>
                      {item.departement && (
                        <View style={[styles.roleBadge, { backgroundColor: colors.muted }]}>
                          <Text style={[styles.roleBadgeText, { color: colors.mutedForeground }]}>{item.departement}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              );
            }}
          />
        )
      ) : (
        loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={reports}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 40 }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            ListHeaderComponent={
              <View style={styles.statsRow}>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="file-text" size={16} color="#3b82f6" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{stats.total}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="clock" size={16} color="#f59e0b" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{stats.nouveau + stats.en_cours}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>En attente</Text>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="check-circle" size={16} color="#22c55e" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{stats.resolu}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Resolus</Text>
                </View>
              </View>
            }
            ListEmptyComponent={<EmptyState icon="send" title="Aucun rapport" subtitle="Envoyez un rapport a l'administration" />}
            renderItem={({ item }) => {
              const cat = CATEGORY_MAP[item.category] || CATEGORY_MAP.general;
              const priority = PRIORITY_MAP[item.priority] || PRIORITY_MAP.normal;
              const status = STATUS_MAP[item.status] || STATUS_MAP.nouveau;
              const isExpanded = expandedId === item.id;

              return (
                <Pressable onPress={() => setExpandedId(isExpanded ? null : item.id)}>
                  <View style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.reportHeader}>
                      <View style={[styles.catIcon, { backgroundColor: cat.color + "18" }]}>
                        <Feather name={cat.icon} size={16} color={cat.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.reportSubject, { color: colors.foreground }]} numberOfLines={isExpanded ? undefined : 1}>{item.subject}</Text>
                        {isSuperAdmin && item.orgName && (
                          <Text style={[styles.orgLabel, { color: colors.mutedForeground }]}>{item.orgName} — {item.userName}</Text>
                        )}
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: status.color + "18" }]}>
                        <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
                      </View>
                    </View>

                    <View style={styles.reportMeta}>
                      <View style={[styles.priBadge, { backgroundColor: priority.color + "15" }]}>
                        <Text style={[styles.priBadgeText, { color: priority.color }]}>{priority.label}</Text>
                      </View>
                      <Text style={[styles.catLabel, { color: colors.mutedForeground }]}>{cat.label}</Text>
                      <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>
                        {new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>

                    {isExpanded && (
                      <View style={[styles.expandedSection, { borderTopColor: colors.border }]}>
                        <Text style={[styles.messageText, { color: colors.foreground }]}>{item.message}</Text>
                        {item.adminResponse && (
                          <View style={[styles.responseBubble, { backgroundColor: "#22c55e10", borderColor: "#22c55e30" }]}>
                            <View style={styles.responseHeader}>
                              <Feather name="message-circle" size={14} color="#22c55e" />
                              <Text style={[styles.responseLabel, { color: "#22c55e" }]}>Reponse de l'admin</Text>
                            </View>
                            <Text style={[styles.responseText, { color: colors.foreground }]}>{item.adminResponse}</Text>
                            {item.respondedAt && (
                              <Text style={[styles.responseTime, { color: colors.mutedForeground }]}>
                                {new Date(item.respondedAt).toLocaleString("fr-FR")}
                              </Text>
                            )}
                          </View>
                        )}
                        {isSuperAdmin && item.status !== "resolu" && (
                          <View style={styles.adminActions}>
                            {item.status === "nouveau" && (
                              <Pressable onPress={() => updateReportStatus(item.id, "en_cours")} style={[styles.actionBtn, { backgroundColor: "#f59e0b18" }]}>
                                <Feather name="clock" size={14} color="#f59e0b" />
                                <Text style={[styles.actionBtnText, { color: "#f59e0b" }]}>En cours</Text>
                              </Pressable>
                            )}
                            <Pressable onPress={() => updateReportStatus(item.id, "resolu")} style={[styles.actionBtn, { backgroundColor: "#22c55e18" }]}>
                              <Feather name="check" size={14} color="#22c55e" />
                              <Text style={[styles.actionBtnText, { color: "#22c55e" }]}>Resoudre</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />
        )
      )}

      <FormModal
        visible={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmitReport}
        title="Nouveau rapport"
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues(p => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="send"
        submitLabel="Envoyer"
      />

      <FormModal
        visible={showUserForm}
        onClose={() => setShowUserForm(false)}
        onSubmit={handleAddUser}
        title="Ajouter un membre"
        fields={USER_FORM_FIELDS}
        values={userFormValues}
        onChange={(k, v) => setUserFormValues(p => ({ ...p, [k]: v }))}
        loading={userFormLoading}
        icon="user-plus"
        submitLabel="Ajouter"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  tabRow: { flexDirection: "row", gap: 8 },
  tabBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  stat: { flex: 1, alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  statVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  teamCard: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12, alignItems: "center" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  userName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  roleBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  reportCard: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  reportHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  catIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  reportSubject: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  orgLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  reportMeta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
  priBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  priBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  catLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  timeLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  expandedSection: { borderTopWidth: 1, padding: 14 },
  messageText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  responseBubble: { marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  responseHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  responseLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  responseText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  responseTime: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "right" },
  adminActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  actionBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
