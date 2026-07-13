import { Feather } from "@expo/vector-icons";
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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useOfflineCache } from "@/hooks/useOfflineCache";

interface Conversation {
  id: number;
  customerPhone: string;
  customerName: string | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastDirection: string | null;
  draftReply: string | null;
  draftStatus: string;
  draftError: string | null;
}

type StatusFilter = "open" | "closed" | "all";

const DRAFT_PILL: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  ready: { label: "Brouillon IA prêt", color: "#22c55e", icon: "edit-3" },
  generating: { label: "IA rédige…", color: "#f59e0b", icon: "loader" },
  failed: { label: "Brouillon échoué", color: "#ef4444", icon: "alert-triangle" },
};

function initials(name: string | null | undefined, phone: string): string {
  const src = (name ?? "").trim() || phone;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function WhatsappInboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("open");

  const { cached, isFromCache, updateCache } = useOfflineCache<Conversation[]>("whatsapp_conversations", []);

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("status", filter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetchAuth(`${API_BASE}/api/whatsapp/conversations?${params}`);
      if (res.ok) {
        const data = await res.json();
        const list: Conversation[] = data.conversations ?? [];
        setConversations(list);
        updateCache(list);
      }
    } catch {
      if (cached && conversations.length === 0) setConversations(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, search, fetchAuth]);

  useEffect(() => {
    if (cached && conversations.length === 0) setConversations(cached);
    setLoading(true);
    fetchConversations();
  }, [fetchConversations]);

  // Rafraîchit la liste au retour sur l'écran (ex. après envoi depuis le fil).
  useFocusEffect(
    useCallback(() => {
      fetchConversations();
    }, [fetchConversations]),
  );

  function onRefresh() {
    setRefreshing(true);
    fetchConversations();
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  const filters: { key: StatusFilter; label: string }[] = [
    { key: "open", label: "Ouverts" },
    { key: "closed", label: "Fermés" },
    { key: "all", label: "Tous" },
  ];

  const unreadTotal = conversations.reduce((acc, c) => acc + (c.unreadCount > 0 ? 1 : 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Feather name="message-circle" size={18} color="#ffffff" />
            <Text style={styles.headerTitle}>WhatsApp clients</Text>
            {unreadTotal > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.unreadBadgeText}>{unreadTotal}</Text>
              </View>
            )}
          </View>
          <View style={{ width: 22 }} />
        </View>

        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un client…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color="rgba(255,255,255,0.5)" />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filterRow}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterChip, { backgroundColor: filter === f.key ? colors.primary : "rgba(255,255,255,0.1)" }]}
            >
              <Text style={[styles.filterText, { color: filter === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {isFromCache && (
          <View style={styles.cacheRow}>
            <Feather name="wifi-off" size={11} color="rgba(255,255,255,0.5)" />
            <Text style={styles.cacheText}>Cache hors ligne</Text>
          </View>
        )}
      </View>

      {loading && conversations.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState icon="message-circle" title="Aucune conversation" subtitle="Les messages WhatsApp de vos clients apparaîtront ici" />
          }
          renderItem={({ item }) => {
            const unread = item.unreadCount > 0;
            const pill = DRAFT_PILL[item.draftStatus];
            return (
              <Pressable
                onPress={() => router.push(`/whatsapp-thread?id=${item.id}` as any)}
                style={({ pressed }) => [
                  styles.convCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderLeftColor: unread ? colors.primary : colors.border,
                  },
                  pressed && { opacity: 0.75 },
                ]}
              >
                {unread && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
                <View style={[styles.avatar, { backgroundColor: "#25D36618" }]}>
                  <Text style={[styles.avatarText, { color: "#128C7E" }]}>{initials(item.customerName, item.customerPhone)}</Text>
                </View>
                <View style={styles.convBody}>
                  <View style={styles.convTop}>
                    <Text
                      style={[styles.convName, { color: colors.foreground, fontFamily: unread ? "Inter_700Bold" : "Inter_500Medium" }]}
                      numberOfLines={1}
                    >
                      {item.customerName || item.customerPhone}
                    </Text>
                    <Text style={[styles.convTime, { color: colors.mutedForeground }]}>{formatTime(item.lastMessageAt)}</Text>
                  </View>
                  <Text style={[styles.convPreview, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {item.lastDirection === "outbound" ? "Vous : " : ""}
                    {item.lastMessagePreview || "(média)"}
                  </Text>
                  <View style={styles.convBottom}>
                    {pill ? (
                      <View style={[styles.pill, { backgroundColor: pill.color + "18" }]}>
                        <Feather name={pill.icon} size={11} color={pill.color} />
                        <Text style={[styles.pillText, { color: pill.color }]}>{pill.label}</Text>
                      </View>
                    ) : null}
                    {item.status === "closed" ? (
                      <View style={[styles.pill, { backgroundColor: colors.mutedForeground + "18" }]}>
                        <Feather name="check-circle" size={11} color={colors.mutedForeground} />
                        <Text style={[styles.pillText, { color: colors.mutedForeground }]}>Fermé</Text>
                      </View>
                    ) : null}
                    {unread ? (
                      <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.countBadgeText}>{item.unreadCount}</Text>
                      </View>
                    ) : null}
                  </View>
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
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerCenter: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  cacheRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  cacheText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  convCard: { flexDirection: "row", alignItems: "flex-start", padding: 14, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, marginBottom: 10, position: "relative", gap: 12 },
  unreadDot: { position: "absolute", top: 14, right: 14, width: 8, height: 8, borderRadius: 4 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  convBody: { flex: 1 },
  convTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  convName: { fontSize: 15, flex: 1, marginRight: 8 },
  convTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  convPreview: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 8 },
  convBottom: { flexDirection: "row", gap: 6, alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  countBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  countBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
});
