import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
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
import { useUnreadBadges } from "@/contexts/UnreadBadgesContext";
import { useColors } from "@/hooks/useColors";

interface NotificationDTO {
  id: number;
  title?: string | null;
  message?: string | null;
  priority?: string | null;
  read?: boolean | null;
  sourceId?: string | null;
  actionUrl?: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications?: NotificationDTO[];
  unreadCount?: number;
}

interface RappelItem {
  id: number;
  title: string;
  message: string;
  priority: string;
  read: boolean;
  sourceId: string | null;
  actionUrl: string | null;
  createdAt: string;
}

export default function RappelsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const { clearKey } = useUnreadBadges();
  const isWeb = Platform.OS === "web";

  const [items, setItems] = useState<RappelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(
        `${API_BASE}/api/notifications?sourceType=calendar_reminder&type=rappel&sinceHours=24&limit=100`
      );
      if (res.ok) {
        const data = (await res.json()) as NotificationsResponse;
        const list: RappelItem[] = (data.notifications ?? []).map((n: NotificationDTO) => ({
          id: n.id,
          title: n.title ?? "Rappel",
          message: n.message ?? "",
          priority: n.priority ?? "normale",
          read: !!n.read,
          sourceId: n.sourceId ?? null,
          actionUrl: n.actionUrl ?? null,
          createdAt: n.createdAt,
        }));
        list.sort((a, b) => {
          if (a.read !== b.read) return a.read ? 1 : -1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        setItems(list);
      }
    } catch {
      // silencieux
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => {
    load();
  }, [load]);

  // Tâche #95: dès que la secrétaire ouvre l'écran Rappels, on remet le
  // compteur en temps réel à zéro. Le contexte écoute le SSE et le
  // rebumpera dès qu'un nouveau rappel calendrier arrivera.
  useFocusEffect(
    useCallback(() => {
      clearKey("rappel");
    }, [clearKey]),
  );

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  async function markAllRead() {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await fetchAuth(`${API_BASE}/api/notifications/read-all`, {
      method: "POST",
    }).catch(() => null);
  }

  async function handlePress(item: RappelItem) {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (!item.read) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
      fetchAuth(`${API_BASE}/api/notifications/${item.id}/read`, {
        method: "PATCH",
      }).catch(() => null);
    }
    if (item.sourceId) {
      router.push({ pathname: "/calendar", params: { eventId: item.sourceId } });
    } else {
      router.push("/calendar");
    }
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "A l'instant";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  const unreadCount = items.filter((i) => !i.read).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Rappels</Text>
          <Text style={styles.headerSub}>
            {items.length === 0
              ? "Dernieres 24 heures"
              : `${items.length} rappel${items.length > 1 ? "s" : ""} - ${unreadCount} non lu${unreadCount > 1 ? "s" : ""}`}
          </Text>
        </View>
        {unreadCount > 0 ? (
          <Pressable
            onPress={markAllRead}
            style={[styles.markAllBtn, { backgroundColor: "rgba(255,255,255,0.12)" }]}
          >
            <Feather name="check-circle" size={14} color="#fff" />
            <Text style={styles.markAllText}>Tout lire</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="bell-off"
              title="Aucun rappel"
              subtitle="Aucun rappel calendrier dans les dernieres 24 heures."
            />
          }
          renderItem={({ item }) => {
            const accent = item.priority === "haute" ? "#ef4444" : "#3b82f6";
            return (
              <Pressable
                onPress={() => handlePress(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: item.read ? colors.card : accent + "0F",
                    borderColor: item.read ? colors.border : accent + "40",
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: accent + "1A" }]}>
                  <Feather name="bell" size={18} color={accent} />
                </View>
                <View style={styles.content}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {!item.read ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null}
                  </View>
                  <Text
                    style={[styles.body, { color: colors.mutedForeground }]}
                    numberOfLines={2}
                  >
                    {item.message}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={[styles.time, { color: colors.mutedForeground }]}>
                    {formatTime(item.createdAt)}
                  </Text>
                  <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  backBtn: { padding: 4, marginTop: 2 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
    marginTop: 2,
  },
  markAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 2,
  },
  markAllText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#fff" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  content: { flex: 1, marginRight: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  body: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 18 },
  right: { alignItems: "flex-end", gap: 4 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
