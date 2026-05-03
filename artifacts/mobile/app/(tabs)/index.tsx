import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
import { useOfflineCache } from "@/hooks/useOfflineCache";
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

interface UpcomingEvent {
  id: number;
  title: string;
  startTime: string;
  createdAt?: string;
  type: string;
}

interface OverdueTask {
  id: number;
  title: string;
  priority: string;
  dueDate: string;
}

const REFRESH_INTERVAL = 60_000;

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<OverdueTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { cached: cachedDashboard, isFromCache, updateCache } = useOfflineCache<DashboardData | null>("dashboard_summary", null);

  const fetchDashboard = useCallback(async (silent = false) => {
    try {
      const [summaryRes, callsRes, eventsRes, tasksRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/dashboard/summary`),
        fetchAuth(`${API_BASE}/api/calls?limit=5&sortOrder=desc`),
        fetchAuth(`${API_BASE}/api/calendar/events?limit=3`).catch(() => null),
        fetchAuth(`${API_BASE}/api/tasks?status=en_attente&sortOrder=asc&limit=5`).catch(() => null),
      ]);
      if (summaryRes.ok) {
        const json = await summaryRes.json();
        const d: DashboardData = {
          totalCalls: json.totalCalls ?? 0,
          missedCalls: json.missedCalls ?? 0,
          totalContacts: json.totalContacts ?? 0,
          pendingTasks: json.pendingTasks ?? 0,
          unreadMessages: json.unreadMessages ?? 0,
          avgCallDuration: json.avgCallDuration ?? 0,
          answeredRate: json.answeredRate ?? 0,
          todayCalls: json.todayCalls ?? json.totalCalls ?? 0,
          todayTasks: json.todayTasks ?? json.pendingTasks ?? 0,
        };
        setData(d);
        updateCache(d);
      }
      if (callsRes.ok) {
        const callData = await callsRes.json();
        setRecentCalls(callData.calls?.slice(0, 5) ?? []);
      }
      if (eventsRes?.ok) {
        const eventData = await eventsRes.json();
        setEvents((eventData.events || eventData.data || []).slice(0, 3));
      }
      if (tasksRes?.ok) {
        const taskData = await tasksRes.json();
        const now = new Date();
        setOverdueTasks(
          (taskData.tasks || [])
            .filter((t: any) => t.dueDate && new Date(t.dueDate) < now && t.status !== "termine")
            .slice(0, 3)
        );
      }
      setLastRefresh(new Date());
    } catch {
      if (!silent && cachedDashboard && !data) setData(cachedDashboard);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, cachedDashboard, data, updateCache]);

  useEffect(() => {
    if (isFromCache && cachedDashboard && !data) setData(cachedDashboard);
  }, [isFromCache, cachedDashboard, data]);

  useEffect(() => {
    fetchDashboard();
    intervalRef.current = setInterval(() => fetchDashboard(true), REFRESH_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchDashboard]);

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

  function formatEventTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatLastRefresh() {
    if (!lastRefresh) return "";
    const diff = Date.now() - lastRefresh.getTime();
    if (diff < 60000) return "maintenant";
    return `${Math.floor(diff / 60000)} min`;
  }

  const STATUS_COLORS: Record<string, string> = {
    answered: "#22c55e", missed: "#ef4444", voicemail: "#f59e0b", outgoing: "#3b82f6",
  };

  const now = new Date();
  const dayName = now.toLocaleDateString("fr-FR", { weekday: "long" });
  const dateStr = now.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const greeting = user ? `Bonjour, ${user.prenom}` : "Tableau de bord";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greeting}</Text>
            <View style={styles.subtitleRow}>
              <Text style={styles.headerSubtitle}>
                {dayName.charAt(0).toUpperCase() + dayName.slice(1)}, {dateStr}
              </Text>
              {lastRefresh && !isFromCache && (
                <View style={styles.refreshBadge}>
                  <View style={styles.refreshDot} />
                  <Text style={styles.refreshText}>{formatLastRefresh()}</Text>
                </View>
              )}
              {isFromCache && (
                <View style={[styles.refreshBadge, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
                  <Feather name="wifi-off" size={8} color="rgba(255,255,255,0.4)" />
                  <Text style={[styles.refreshText, { color: "rgba(255,255,255,0.4)" }]}>Cache</Text>
                </View>
              )}
            </View>
          </View>
          <Pressable onPress={() => quickNav("/notifications")} style={[styles.notifBtn, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <Feather name="bell" size={18} color="#fff" />
            {(data?.unreadMessages || 0) > 0 && (
              <View style={[styles.notifDot, { backgroundColor: colors.destructive }]}>
                <Text style={styles.notifDotText}>{data!.unreadMessages > 9 ? "9+" : data!.unreadMessages}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={() => router.push("/settings" as any)} style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
            <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
              {user ? (user.prenom[0] + user.nom[0]).toUpperCase() : "AB"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.quickCreateRow}>
          {[
            { icon: "phone-call" as const, label: "Appel", route: "/(tabs)/calls", color: "#3b82f6" },
            { icon: "user-plus" as const, label: "Contact", route: "/(tabs)/contacts", color: "#22c55e" },
            { icon: "plus-square" as const, label: "Tache", route: "/(tabs)/tasks", color: "#f59e0b" },
            { icon: "video" as const, label: "Reunion IA", route: "/meetings", color: "#8b5cf6" },
          ].map((a) => (
            <Pressable
              key={a.label}
              onPress={() => quickNav(a.route)}
              style={({ pressed }) => [styles.quickCreateBtn, { backgroundColor: a.color + "25", opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name={a.icon} size={16} color={a.color} />
              <Text style={[styles.quickCreateLabel, { color: "#fff" }]}>{a.label}</Text>
            </Pressable>
          ))}
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
            {overdueTasks.length > 0 && (
              <Pressable onPress={() => quickNav("/(tabs)/tasks")} style={[styles.urgentBanner, { backgroundColor: "#ef444415", borderColor: "#ef4444" }]}>
                <Feather name="alert-triangle" size={18} color="#ef4444" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.urgentTitle, { color: "#ef4444" }]}>
                    {overdueTasks.length} tache{overdueTasks.length > 1 ? "s" : ""} en retard
                  </Text>
                  <Text style={[styles.urgentSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {overdueTasks.map((t) => t.title).join(", ")}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color="#ef4444" />
              </Pressable>
            )}

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
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>Taux reponse</Text>
                </View>
                <View style={[styles.perfDivider, { backgroundColor: colors.border }]} />
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>
                    {Math.floor(data.avgCallDuration / 60)}m {data.avgCallDuration % 60}s
                  </Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>Duree moy.</Text>
                </View>
                <View style={[styles.perfDivider, { backgroundColor: colors.border }]} />
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>{data.todayCalls}</Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>Appels/jour</Text>
                </View>
              </View>
            </View>

            {events.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Agenda du jour</Text>
                  <Pressable onPress={() => quickNav("/calendar")}>
                    <Text style={[styles.seeAll, { color: colors.primary }]}>Voir tout</Text>
                  </Pressable>
                </View>
                {events.map((evt) => (
                  <Pressable
                    key={evt.id}
                    onPress={() => quickNav("/calendar")}
                    style={[styles.eventItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.eventTime, { backgroundColor: colors.primary + "15" }]}>
                      <Text style={[styles.eventTimeText, { color: colors.primary }]}>
                        {formatEventTime(evt.startTime || evt.createdAt || new Date().toISOString())}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.eventTitle, { color: colors.foreground }]} numberOfLines={1}>{evt.title}</Text>
                      <Text style={[styles.eventType, { color: colors.mutedForeground }]}>{evt.type || "Evenement"}</Text>
                    </View>
                    <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </>
            )}

            {recentCalls.length > 0 && (
              <>
                <View style={[styles.sectionHeader, { marginTop: events.length > 0 ? 8 : 0 }]}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Appels recents</Text>
                  <Pressable onPress={() => quickNav("/(tabs)/calls")}>
                    <Text style={[styles.seeAll, { color: colors.primary }]}>Voir tout</Text>
                  </Pressable>
                </View>
                {recentCalls.map((call) => (
                  <View key={call.id} style={[styles.recentItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.recentIcon, { backgroundColor: (STATUS_COLORS[call.status] || "#64748b") + "18" }]}>
                      <Feather
                        name={call.status === "missed" ? "phone-missed" : call.direction === "sortant" ? "phone-outgoing" : "phone-incoming"}
                        size={16}
                        color={STATUS_COLORS[call.status] || "#64748b"}
                      />
                    </View>
                    <Pressable onPress={() => quickNav("/(tabs)/calls")} style={styles.recentContent}>
                      <Text style={[styles.recentName, { color: colors.foreground }]} numberOfLines={1}>
                        {call.contactName || call.phoneNumber}
                      </Text>
                      <Text style={[styles.recentSub, { color: colors.mutedForeground }]}>
                        {call.direction === "entrant" ? "Entrant" : "Sortant"}
                      </Text>
                    </Pressable>
                    {call.status === "missed" && call.phoneNumber && (
                      <Pressable
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          Linking.openURL(`tel:${call.phoneNumber}`);
                        }}
                        style={[styles.callbackBtn, { backgroundColor: "#22c55e20" }]}
                      >
                        <Feather name="phone-call" size={14} color="#22c55e" />
                      </Pressable>
                    )}
                    <Text style={[styles.recentTime, { color: colors.mutedForeground }]}>{formatTime(call.createdAt)}</Text>
                  </View>
                ))}
              </>
            )}

            <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 8 }]}>Acces rapide</Text>
            <View style={styles.quickGrid}>
              {[
                { icon: "message-square" as const, label: "Messages", route: "/messages", color: "#8b5cf6" },
                { icon: "calendar" as const, label: "Calendrier", route: "/calendar", color: "#ec4899" },
                { icon: "bar-chart-2" as const, label: "Analytique", route: "/analytics", color: "#f59e0b" },
                { icon: "clock" as const, label: "Pointage", route: "/checkins", color: "#14b8a6" },
                { icon: "users" as const, label: "Reunion IA", route: "/meetings", color: "#8b5cf6" },
                { icon: "cpu" as const, label: "Agents IA", route: "/ai-agents", color: "#6366f1" },
              ].map((qa) => (
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

            <Pressable onPress={() => quickNav("/ai-chat")} style={[styles.infoCard, { backgroundColor: colors.secondary }]}>
              <Feather name="message-circle" size={20} color={colors.primary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Assistant IA</Text>
                <Text style={styles.infoSubtitle}>Chat intelligent pour votre activite</Text>
              </View>
              <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.5)" />
            </Pressable>

            <Pressable onPress={() => quickNav("/meetings")} style={[styles.infoCard, { backgroundColor: "#8b5cf615", borderWidth: 1, borderColor: "#8b5cf630", marginTop: 8 }]}>
              <Feather name="video" size={20} color="#8b5cf6" />
              <View style={styles.infoContent}>
                <Text style={[styles.infoTitle, { color: "#8b5cf6" }]}>Reunion IA</Text>
                <Text style={[styles.infoSubtitle, { color: "rgba(139,92,246,0.7)" }]}>Compiler · GPS chantier · Taches auto</Text>
              </View>
              <Feather name="chevron-right" size={16} color="#8b5cf6" />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  greeting: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  subtitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  headerSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)" },
  refreshBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(34,197,94,0.15)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  refreshDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#22c55e" },
  refreshText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "#22c55e" },
  notifBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", position: "relative" },
  notifDot: { position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  notifDotText: { color: "#fff", fontSize: 9, fontFamily: "Inter_700Bold" },
  avatarCircle: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  quickCreateRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  quickCreateBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  quickCreateLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  urgentBanner: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
  urgentTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  urgentSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  performanceCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  perfRow: { flexDirection: "row", alignItems: "center" },
  perfItem: { flex: 1, alignItems: "center" },
  perfValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  perfLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 4, textAlign: "center" },
  perfDivider: { width: 1, height: 36 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  eventItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6, gap: 10 },
  eventTime: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  eventTimeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  eventTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  eventType: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  recentItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  recentIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 10 },
  recentContent: { flex: 1 },
  recentName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  recentSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  recentTime: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 8 },
  callbackBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  quickCard: { width: "30.5%", paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  quickLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  infoCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 12, gap: 12, marginTop: 4 },
  infoContent: { flex: 1 },
  infoTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#ffffff" },
  infoSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
});
