import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface DashboardData {
  totalCalls: number;
  missedCalls: number;
  totalContacts: number;
  pendingTasks: number;
  unreadMessages: number;
  avgCallDuration: number;
  answeredRate: number;
  todayCalls: number;
  todayTasks: number;
}

interface RecentCall {
  id: number;
  contactName: string;
  phoneNumber: string;
  status: string;
  direction: string;
  createdAt: string;
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const [summaryRes, callsRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/dashboard/summary`),
        fetchAuth(`${API_BASE}/api/calls?limit=5&sortOrder=desc`),
      ]);
      if (summaryRes.ok) {
        const json = await summaryRes.json();
        setData({
          totalCalls: json.totalCalls ?? 0,
          missedCalls: json.missedCalls ?? 0,
          totalContacts: json.totalContacts ?? 0,
          pendingTasks: json.pendingTasks ?? 0,
          unreadMessages: json.unreadMessages ?? 0,
          avgCallDuration: json.avgCallDuration ?? 0,
          answeredRate: json.answeredRate ?? 0,
          todayCalls: json.todayCalls ?? json.totalCalls ?? 0,
          todayTasks: json.todayTasks ?? json.pendingTasks ?? 0,
        });
      }
      if (callsRes.ok) {
        const callData = await callsRes.json();
        setRecentCalls(callData.calls?.slice(0, 5) ?? []);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  function onRefresh() { setRefreshing(true); fetchDashboard(); }

  function quickNav(route: string) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as any);
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  const STATUS_COLORS: Record<string, string> = {
    answered: "#22c55e",
    missed: "#ef4444",
    voicemail: "#f59e0b",
    outgoing: "#3b82f6",
  };

  const greeting = user ? `Bonjour, ${user.prenom}` : "Tableau de bord";

  const quickActions = [
    { icon: "phone" as const, label: "Appels", route: "/(tabs)/calls", color: "#3b82f6" },
    { icon: "users" as const, label: "Contacts", route: "/(tabs)/contacts", color: "#22c55e" },
    { icon: "check-square" as const, label: "Taches", route: "/(tabs)/tasks", color: "#f59e0b" },
    { icon: "message-square" as const, label: "Messages", route: "/messages", color: "#8b5cf6" },
    { icon: "calendar" as const, label: "Calendrier", route: "/calendar", color: "#ec4899" },
    { icon: "package" as const, label: "Stock", route: "/stock", color: "#6366f1" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.headerSubtitle}>Vue d'ensemble de votre activite</Text>
          </View>
          <Pressable onPress={() => router.push("/settings" as any)} style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
              {user ? (user.prenom[0] + user.nom[0]).toUpperCase() : "AB"}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : !data ? (
          <EmptyState icon="bar-chart-2" title="Donnees indisponibles" subtitle="Impossible de charger les statistiques" />
        ) : (
          <>
            <View style={styles.statsRow}>
              <StatCard title="Appels" value={data.totalCalls} icon="phone" color={colors.info ?? "#3b82f6"} />
              <StatCard title="Manques" value={data.missedCalls} icon="phone-missed" color={colors.destructive} />
            </View>
            <View style={styles.statsRow}>
              <StatCard title="Contacts" value={data.totalContacts} icon="users" color={colors.success ?? "#22c55e"} />
              <StatCard title="Taches" value={data.pendingTasks} icon="check-square" color={colors.warning ?? "#f59e0b"} subtitle="En attente" />
            </View>

            <View style={[styles.performanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Performance</Text>
              <View style={styles.perfRow}>
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>{data.answeredRate}%</Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>Taux de reponse</Text>
                </View>
                <View style={[styles.perfDivider, { backgroundColor: colors.border }]} />
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>
                    {Math.floor(data.avgCallDuration / 60)}m {data.avgCallDuration % 60}s
                  </Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>Duree moyenne</Text>
                </View>
                <View style={[styles.perfDivider, { backgroundColor: colors.border }]} />
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>{data.unreadMessages}</Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>Non lus</Text>
                </View>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: colors.foreground, paddingHorizontal: 0 }]}>Acces rapide</Text>
            <View style={styles.quickGrid}>
              {quickActions.map((qa) => (
                <Pressable
                  key={qa.label}
                  onPress={() => quickNav(qa.route)}
                  style={({ pressed }) => [
                    styles.quickCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    pressed && { opacity: 0.7, transform: [{ scale: 0.96 }] },
                  ]}
                >
                  <View style={[styles.quickIcon, { backgroundColor: qa.color + "18" }]}>
                    <Feather name={qa.icon} size={20} color={qa.color} />
                  </View>
                  <Text style={[styles.quickLabel, { color: colors.foreground }]}>{qa.label}</Text>
                </Pressable>
              ))}
            </View>

            {recentCalls.length > 0 ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground, paddingHorizontal: 0 }]}>Appels recents</Text>
                  <Pressable onPress={() => quickNav("/(tabs)/calls")}>
                    <Text style={[styles.seeAll, { color: colors.primary }]}>Voir tout</Text>
                  </Pressable>
                </View>
                {recentCalls.map((call) => (
                  <Pressable
                    key={call.id}
                    onPress={() => quickNav("/(tabs)/calls")}
                    style={[styles.recentItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.recentIcon, { backgroundColor: (STATUS_COLORS[call.status] || "#64748b") + "18" }]}>
                      <Feather
                        name={call.status === "missed" ? "phone-missed" : call.direction === "sortant" ? "phone-outgoing" : "phone-incoming"}
                        size={16}
                        color={STATUS_COLORS[call.status] || "#64748b"}
                      />
                    </View>
                    <View style={styles.recentContent}>
                      <Text style={[styles.recentName, { color: colors.foreground }]} numberOfLines={1}>
                        {call.contactName || call.phoneNumber}
                      </Text>
                      <Text style={[styles.recentSub, { color: colors.mutedForeground }]}>
                        {call.direction === "entrant" ? "Entrant" : "Sortant"}
                      </Text>
                    </View>
                    <Text style={[styles.recentTime, { color: colors.mutedForeground }]}>{formatTime(call.createdAt)}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            <View style={[styles.infoCard, { backgroundColor: colors.secondary }]}>
              <Feather name="zap" size={20} color={colors.primary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Agent IA actif</Text>
                <Text style={styles.infoSubtitle}>Analyse continue de votre activite</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 20 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  greeting: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  performanceCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  perfRow: { flexDirection: "row", alignItems: "center" },
  perfItem: { flex: 1, alignItems: "center" },
  perfValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  perfLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4, textAlign: "center" },
  perfDivider: { width: 1, height: 36 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  quickCard: {
    width: "31%",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  quickLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  recentItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  recentIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 10 },
  recentContent: { flex: 1 },
  recentName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  recentSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  recentTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  infoCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 12, gap: 12, marginTop: 12 },
  infoContent: { flex: 1 },
  infoTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#ffffff" },
  infoSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
});
