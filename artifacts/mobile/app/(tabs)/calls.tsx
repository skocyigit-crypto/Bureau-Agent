import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ListItem } from "@/components/ListItem";
import { useColors } from "@/hooks/useColors";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface Call {
  id: number;
  contactName: string;
  phoneNumber: string;
  status: string;
  direction: string;
  duration: number;
  createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  answered: { label: "Repondu", color: "#22c55e" },
  missed: { label: "Manque", color: "#ef4444" },
  voicemail: { label: "Messagerie", color: "#f59e0b" },
  outgoing: { label: "Sortant", color: "#3b82f6" },
};

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const fetchCalls = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (filter !== "all") params.set("status", filter);
      if (search) params.set("search", search);
      const res = await fetch(`${API_BASE}/api/calls?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCalls(data.calls ?? []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    setLoading(true);
    fetchCalls();
  }, [fetchCalls]);

  function formatDuration(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  const filters = [
    { key: "all", label: "Tous" },
    { key: "answered", label: "Repondus" },
    { key: "missed", label: "Manques" },
    { key: "outgoing", label: "Sortants" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.secondary,
            paddingTop: (isWeb ? 67 : insets.top) + 12,
          },
        ]}
      >
        <Text style={styles.headerTitle}>Appels</Text>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <View style={styles.filterRow}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === f.key ? colors.primary : "rgba(255,255,255,0.1)",
                },
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" },
                ]}
              >
                {f.label}
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
          data={calls}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          scrollEnabled={calls.length > 0}
          ListEmptyComponent={
            <EmptyState
              icon="phone-off"
              title="Aucun appel"
              subtitle="Les appels apparaitront ici"
            />
          }
          renderItem={({ item }) => {
            const status = STATUS_MAP[item.status] ?? { label: item.status, color: colors.mutedForeground };
            return (
              <ListItem
                title={item.contactName || item.phoneNumber}
                subtitle={item.direction === "entrant" ? "Entrant" : "Sortant"}
                icon={
                  item.status === "missed"
                    ? "phone-missed"
                    : item.direction === "sortant"
                    ? "phone-outgoing"
                    : "phone-incoming"
                }
                iconColor={status.color}
                rightText={formatTime(item.createdAt)}
                rightSubtext={item.duration > 0 ? formatDuration(item.duration) : status.label}
                statusColor={status.color}
              />
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
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    marginBottom: 14,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  filterText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    padding: 16,
  },
});
