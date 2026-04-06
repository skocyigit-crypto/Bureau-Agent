import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { ListItem } from "@/components/ListItem";
import { useColors } from "@/hooks/useColors";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  en_attente: { label: "En attente", color: "#f59e0b", icon: "clock" },
  en_cours: { label: "En cours", color: "#3b82f6", icon: "play-circle" },
  termine: { label: "Termine", color: "#22c55e", icon: "check-circle" },
  annule: { label: "Annule", color: "#64748b", icon: "x-circle" },
};

const PRIORITY_COLORS: Record<string, string> = {
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#22c55e",
};

export default function TasksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50", sortOrder: "desc" });
      if (filter !== "all") params.set("status", filter);
      const res = await fetch(`${API_BASE}/api/tasks?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks ?? []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  const filters = [
    { key: "all", label: "Toutes" },
    { key: "en_attente", label: "En attente" },
    { key: "en_cours", label: "En cours" },
    { key: "termine", label: "Terminees" },
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
        <Text style={styles.headerTitle}>Taches</Text>
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
          data={tasks}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          scrollEnabled={tasks.length > 0}
          ListEmptyComponent={
            <EmptyState
              icon="check-square"
              title="Aucune tache"
              subtitle="Vos taches apparaitront ici"
            />
          }
          renderItem={({ item }) => {
            const status = STATUS_MAP[item.status] ?? { label: item.status, color: "#64748b", icon: "circle" as const };
            const prioColor = PRIORITY_COLORS[item.priority] ?? colors.mutedForeground;
            return (
              <ListItem
                title={item.title}
                subtitle={item.description ? item.description.substring(0, 60) : undefined}
                icon={status.icon}
                iconColor={status.color}
                rightText={formatDate(item.dueDate)}
                rightSubtext={item.priority === "haute" ? "Haute" : item.priority === "moyenne" ? "Moyenne" : "Basse"}
                statusColor={prioColor}
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
