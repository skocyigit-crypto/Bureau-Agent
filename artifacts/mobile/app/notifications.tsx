import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface NotifItem {
  id: string;
  type: "missed_call" | "overdue_task" | "message" | "event" | "system";
  title: string;
  body: string;
  time: string;
  read: boolean;
  route?: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}

const TYPE_CONFIG: Record<string, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  missed_call: { icon: "phone-missed", color: "#ef4444" },
  overdue_task: { icon: "alert-circle", color: "#f59e0b" },
  message: { icon: "message-square", color: "#8b5cf6" },
  event: { icon: "calendar", color: "#3b82f6" },
  system: { icon: "bell", color: "#64748b" },
};

const POLL_INTERVAL = 30_000;

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const buildNotifications = useCallback(async (silent = false) => {
    const items: NotifItem[] = [];
    try {
      const [callsRes, tasksRes, messagesRes, notifsRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/calls?status=missed&limit=10&sortOrder=desc`).catch(() => null),
        fetchAuth(`${API_BASE}/api/tasks?status=en_attente&limit=10&sortOrder=asc`).catch(() => null),
        fetchAuth(`${API_BASE}/api/messages?limit=5&sortOrder=desc`).catch(() => null),
        fetchAuth(`${API_BASE}/api/notifications?limit=20`).catch(() => null),
      ]);

      if (notifsRes?.ok) {
        const data = await notifsRes.json();
        (data.notifications || data || []).forEach((n: any) => {
          const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
          items.push({
            id: `notif_${n.id}`,
            type: n.type ?? "system",
            title: n.title ?? "Notification",
            body: n.body ?? n.message ?? "",
            time: n.createdAt ?? new Date().toISOString(),
            read: n.read ?? false,
            route: n.route,
            ...cfg,
          });
        });
      }

      if (callsRes?.ok) {
        const data = await callsRes.json();
        (data.calls || []).forEach((c: any) => {
          if (items.some((i) => i.id === `call_${c.id}`)) return;
          items.push({
            id: `call_${c.id}`,
            type: "missed_call",
            title: "Appel manque",
            body: c.contactName || c.phoneNumber || "Numero inconnu",
            time: c.createdAt,
            read: false,
            route: "/(tabs)/calls",
            ...TYPE_CONFIG.missed_call,
          });
        });
      }

      if (tasksRes?.ok) {
        const data = await tasksRes.json();
        const now = new Date();
        (data.tasks || []).forEach((t: any) => {
          if (t.dueDate && new Date(t.dueDate) < now && t.status !== "termine") {
            if (items.some((i) => i.id === `task_${t.id}`)) return;
            items.push({
              id: `task_${t.id}`,
              type: "overdue_task",
              title: "Tache en retard",
              body: t.title,
              time: t.dueDate,
              read: false,
              route: "/(tabs)/tasks",
              ...TYPE_CONFIG.overdue_task,
            });
          }
        });
      }

      if (messagesRes?.ok) {
        const data = await messagesRes.json();
        (data.messages || []).filter((m: any) => !m.read).forEach((m: any) => {
          if (items.some((i) => i.id === `msg_${m.id}`)) return;
          items.push({
            id: `msg_${m.id}`,
            type: "message",
            title: "Nouveau message",
            body: m.subject || m.content?.slice(0, 60) || "Message",
            time: m.createdAt,
            read: false,
            route: "/messages",
            ...TYPE_CONFIG.message,
          });
        });
      }

      items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setNotifications((prev) => {
        if (silent) {
          const prevIds = new Set(prev.map((n) => n.id));
          const merged = [...items.filter((n) => !prevIds.has(n.id)), ...prev];
          merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
          return merged.map((n) => ({ ...n, read: prev.find((p) => p.id === n.id)?.read ?? n.read }));
        }
        return items;
      });
      setLastUpdated(new Date());
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [fetchAuth]);

  useEffect(() => {
    // Sondage suspendu hors premier plan: 30 s en arriere-plan represente
    // 120 requetes/heure qui reveillent une instance Cloud Run pour un ecran
    // que personne ne regarde.
    const start = () => {
      if (!pollRef.current) pollRef.current = setInterval(() => buildNotifications(true), POLL_INTERVAL);
    };
    const stop = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    buildNotifications();
    start();

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") { buildNotifications(true); start(); } else stop();
    });
    return () => { stop(); sub.remove(); };
  }, [buildNotifications]);

  function onRefresh() { setRefreshing(true); buildNotifications(); }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "A l'instant";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 172800000) return "Hier";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  function formatLastUpdated() {
    if (!lastUpdated) return "";
    const diff = Date.now() - lastUpdated.getTime();
    if (diff < 60000) return "a l'instant";
    return `${Math.floor(diff / 60000)} min`;
  }

  function handlePress(item: NotifItem) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotifications((prev) => prev.map((n) => n.id === item.id ? { ...n, read: true } : n));
    if (item.route) router.push(item.route as any);
  }

  function markAllRead() {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const filtered = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const groupedByDate = filtered.reduce<Record<string, NotifItem[]>>((acc, item) => {
    const d = new Date(item.time);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    const key = diffDays === 0 ? "Aujourd'hui" : diffDays === 1 ? "Hier" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const sections = Object.entries(groupedByDate);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.headerTitle}>Notifications</Text>
              <View style={styles.liveIndicator}>
                <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            </View>
            {lastUpdated && (
              <Text style={styles.headerSub}>Mis a jour {formatLastUpdated()}</Text>
            )}
          </View>
          {unreadCount > 0 && (
            <Pressable onPress={markAllRead} style={[styles.markAllBtn, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="check-circle" size={14} color="#fff" />
              <Text style={styles.markAllText}>Tout lire</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.tabRow}>
          {(["all", "unread"] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.tab, filter === f && { borderBottomColor: "#fff", borderBottomWidth: 2 }]}
            >
              <Text style={[styles.tabText, { color: filter === f ? "#fff" : "rgba(255,255,255,0.5)" }]}>
                {f === "all" ? "Toutes" : `Non lues`}
              </Text>
              {f === "unread" && unreadCount > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                </View>
              )}
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
          data={sections}
          keyExtractor={([key]) => key}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="bell-off"
              title="Aucune notification"
              subtitle={filter === "unread" ? "Toutes les notifications sont lues" : "Rien a signaler pour le moment"}
            />
          }
          renderItem={({ item: [dateLabel, items] }) => (
            <View>
              <Text style={[styles.dateLabel, { color: colors.mutedForeground }]}>{dateLabel}</Text>
              {items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handlePress(item)}
                  style={({ pressed }) => [
                    styles.notifRow,
                    {
                      backgroundColor: item.read ? colors.card : item.color + "08",
                      borderColor: item.read ? colors.border : item.color + "30",
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={[styles.notifIcon, { backgroundColor: item.color + "18" }]}>
                    <Feather name={item.icon} size={18} color={item.color} />
                  </View>
                  <View style={styles.notifContent}>
                    <View style={styles.notifHeader}>
                      <Text style={[styles.notifTitle, { color: colors.foreground }]}>{item.title}</Text>
                      {!item.read && <View style={[styles.unreadDot, { backgroundColor: item.color }]} />}
                    </View>
                    <Text style={[styles.notifBody, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {item.body}
                    </Text>
                  </View>
                  <View style={styles.notifRight}>
                    <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>{formatTime(item.time)}</Text>
                    {item.route && <Feather name="chevron-right" size={14} color={colors.mutedForeground} />}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 0 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  backBtn: { marginRight: 12, padding: 4, marginTop: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  liveIndicator: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },
  liveText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#22c55e" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", marginTop: 2 },
  markAllBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 2 },
  markAllText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#fff" },
  tabRow: { flexDirection: "row", gap: 4 },
  tab: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabBadge: { backgroundColor: "#ef4444", minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tabBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  dateLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
  notifRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  notifIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 12 },
  notifContent: { flex: 1, marginRight: 8 },
  notifHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  notifTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  notifBody: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  notifRight: { alignItems: "flex-end", gap: 4 },
  notifTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
