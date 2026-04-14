import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const buildNotifications = useCallback(async () => {
    const items: NotifItem[] = [];
    try {
      const [callsRes, tasksRes, messagesRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/calls?status=missed&limit=10&sortOrder=desc`).catch(() => null),
        fetchAuth(`${API_BASE}/api/tasks?status=en_attente&limit=10&sortOrder=asc`).catch(() => null),
        fetchAuth(`${API_BASE}/api/messages?limit=5&sortOrder=desc`).catch(() => null),
      ]);

      if (callsRes?.ok) {
        const data = await callsRes.json();
        (data.calls || []).forEach((c: any) => {
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
    } catch (err) { console.warn("[Notifications] build failed:", err); }
    setNotifications(items);
    setLoading(false);
    setRefreshing(false);
  }, [fetchAuth]);

  useEffect(() => { buildNotifications(); }, [buildNotifications]);

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

  function handlePress(item: NotifItem) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
    if (item.route) router.push(item.route as any);
  }

  const filtered = filter === "unread" ? notifications.filter(n => !n.read) : notifications;
  const unreadCount = notifications.filter(n => !n.read).length;

  function markAllRead() {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Notifications</Text>
            {unreadCount > 0 && (
              <Text style={styles.headerSub}>{unreadCount} non lue{unreadCount > 1 ? "s" : ""}</Text>
            )}
          </View>
          {unreadCount > 0 && (
            <Pressable onPress={markAllRead} style={[styles.markAllBtn, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="check-circle" size={14} color="#fff" />
              <Text style={styles.markAllText}>Tout lire</Text>
            </Pressable>
          )}
        </View>
        <View style={[styles.filterRow, { marginTop: 12 }]}>
          {(["all", "unread"] as const).map(f => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, { backgroundColor: filter === f ? colors.primary : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.filterText, { color: filter === f ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>
                {f === "all" ? "Toutes" : "Non lues"}
              </Text>
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
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="bell-off"
              title="Aucune notification"
              subtitle={filter === "unread" ? "Toutes les notifications sont lues" : "Rien a signaler pour le moment"}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handlePress(item)}
              style={({ pressed }) => [
                styles.notifRow,
                {
                  backgroundColor: item.read ? colors.card : item.color + "08",
                  borderColor: item.read ? colors.border : item.color + "25",
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
                <Text style={[styles.notifBody, { color: colors.mutedForeground }]} numberOfLines={2}>{item.body}</Text>
              </View>
              <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>{formatTime(item.time)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { marginRight: 12, padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 1 },
  markAllBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  markAllText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#fff" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  notifRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  notifIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 12 },
  notifContent: { flex: 1, marginRight: 8 },
  notifHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  notifTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  notifBody: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  notifTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
