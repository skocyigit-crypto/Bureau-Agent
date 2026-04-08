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
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface AuditEntry {
  id: number;
  userId: number;
  userEmail: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: string;
  ipAddress?: string;
  createdAt: string;
}

const ACTION_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  create: { label: "Creation", color: "#22c55e", icon: "plus-circle" },
  update: { label: "Modification", color: "#3b82f6", icon: "edit" },
  delete: { label: "Suppression", color: "#ef4444", icon: "trash-2" },
  login: { label: "Connexion", color: "#8b5cf6", icon: "log-in" },
  logout: { label: "Deconnexion", color: "#64748b", icon: "log-out" },
  export: { label: "Export", color: "#f59e0b", icon: "download" },
  import: { label: "Import", color: "#ec4899", icon: "upload" },
};

const RESOURCE_MAP: Record<string, string> = {
  contact: "Contact",
  call: "Appel",
  task: "Tache",
  message: "Message",
  stock: "Stock",
  user: "Utilisateur",
  organisation: "Organisation",
  calendar: "Calendrier",
  checkin: "Pointage",
};

export default function AuditLogScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (search) params.set("search", search);
      if (actionFilter !== "all") params.set("action", actionFilter);
      const res = await fetchAuth(`${API_BASE}/api/audit/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.logs ?? []);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, search, actionFilter]);

  useEffect(() => { setLoading(true); fetchLogs(); }, [fetchLogs]);

  function onRefresh() { setRefreshing(true); fetchLogs(); }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "A l'instant";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  const todayActions = entries.filter(e => new Date(e.createdAt).toDateString() === new Date().toDateString()).length;
  const criticalActions = entries.filter(e => e.action === "delete").length;

  const filters = [
    { key: "all", label: "Tous" },
    { key: "create", label: "Creation" },
    { key: "update", label: "Modif." },
    { key: "delete", label: "Suppr." },
    { key: "login", label: "Connexion" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Journal d'audit</Text>
          <View style={{ width: 22 }} />
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
        <View style={styles.filterRow}>
          {filters.map(f => (
            <Pressable key={f.key} onPress={() => setActionFilter(f.key)} style={[styles.filterChip, { backgroundColor: actionFilter === f.key ? colors.primary : "rgba(255,255,255,0.1)" }]}>
              <Text style={[styles.filterText, { color: actionFilter === f.key ? colors.primaryForeground : "rgba(255,255,255,0.7)" }]}>{f.label}</Text>
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
          data={entries}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={styles.statsRow}>
              <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="activity" size={16} color="#3b82f6" />
                <Text style={[styles.statVal, { color: colors.foreground }]}>{todayActions}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Aujourd'hui</Text>
              </View>
              <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="alert-triangle" size={16} color="#ef4444" />
                <Text style={[styles.statVal, { color: colors.foreground }]}>{criticalActions}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Suppressions</Text>
              </View>
              <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="list" size={16} color="#8b5cf6" />
                <Text style={[styles.statVal, { color: colors.foreground }]}>{entries.length}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
              </View>
            </View>
          }
          ListEmptyComponent={<EmptyState icon="shield" title="Aucun evenement" subtitle="Le journal d'audit est vide" />}
          renderItem={({ item }) => {
            const action = ACTION_MAP[item.action] || { label: item.action, color: "#64748b", icon: "activity" as const };
            const resource = RESOURCE_MAP[item.resource] || item.resource;
            return (
              <View style={[styles.logCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.logIcon, { backgroundColor: action.color + "18" }]}>
                  <Feather name={action.icon} size={16} color={action.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.logTitleRow}>
                    <View style={[styles.actionBadge, { backgroundColor: action.color + "18" }]}>
                      <Text style={[styles.actionBadgeText, { color: action.color }]}>{action.label}</Text>
                    </View>
                    <Text style={[styles.resourceBadge, { color: colors.mutedForeground }]}>{resource}</Text>
                  </View>
                  <Text style={[styles.logEmail, { color: colors.foreground }]}>{item.userEmail}</Text>
                  {item.details && (
                    <Text style={[styles.logDetails, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {item.details.length > 100 ? item.details.substring(0, 100) + "..." : item.details}
                    </Text>
                  )}
                </View>
                <Text style={[styles.logTime, { color: colors.mutedForeground }]}>{formatTime(item.createdAt)}</Text>
              </View>
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
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 6 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  stat: { flex: 1, alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  statVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  logCard: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10, alignItems: "flex-start" },
  logIcon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 2 },
  logTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  actionBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  actionBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  resourceBadge: { fontSize: 11, fontFamily: "Inter_500Medium" },
  logEmail: { fontSize: 13, fontFamily: "Inter_500Medium" },
  logDetails: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },
  logTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
