import { Feather } from "@expo/vector-icons";
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

import { StatCard } from "@/components/StatCard";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface AnalyticsData {
  totalCalls: number;
  missedCalls: number;
  totalContacts: number;
  pendingTasks: number;
  completedTasks: number;
  unreadMessages: number;
  avgCallDuration: number;
  answeredRate: number;
}

export default function AnalyticsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/dashboard/summary`);
      if (res.ok) {
        const json = await res.json();
        setData({
          totalCalls: json.totalCalls ?? 0,
          missedCalls: json.missedCalls ?? 0,
          totalContacts: json.totalContacts ?? 0,
          pendingTasks: json.pendingTasks ?? 0,
          completedTasks: json.completedTasks ?? 0,
          unreadMessages: json.unreadMessages ?? 0,
          avgCallDuration: json.avgCallDuration ?? 0,
          answeredRate: json.answeredRate ?? 0,
        });
      }
    } catch (err) { console.warn("[Analytics] fetch failed:", err); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  function onRefresh() { setRefreshing(true); fetchAnalytics(); }

  function ProgressBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
      <View style={styles.progressItem}>
        <View style={styles.progressHeader}>
          <Text style={[styles.progressLabel, { color: colors.foreground }]}>{label}</Text>
          <Text style={[styles.progressValue, { color }]}>{value}</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Analytique</Text>
          <View style={{ width: 22 }} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : data ? (
          <>
            <View style={styles.statsRow}>
              <StatCard title="Total appels" value={data.totalCalls} icon="phone" color="#3b82f6" />
              <StatCard title="Manques" value={data.missedCalls} icon="phone-missed" color="#ef4444" />
            </View>
            <View style={styles.statsRow}>
              <StatCard title="Contacts" value={data.totalContacts} icon="users" color="#22c55e" />
              <StatCard title="Messages" value={data.unreadMessages} icon="message-square" color="#8b5cf6" subtitle="Non lus" />
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Taux de reponse</Text>
              <View style={styles.rateRow}>
                <View style={[styles.rateBig, { backgroundColor: colors.primary + "18" }]}>
                  <Text style={[styles.rateValue, { color: colors.primary }]}>{data.answeredRate}%</Text>
                </View>
                <View style={styles.rateInfo}>
                  <Text style={[styles.rateLabel, { color: colors.mutedForeground }]}>
                    {data.totalCalls - data.missedCalls} appels repondus sur {data.totalCalls}
                  </Text>
                  <Text style={[styles.rateLabel, { color: colors.mutedForeground, marginTop: 4 }]}>
                    Duree moy: {Math.floor(data.avgCallDuration / 60)}m {data.avgCallDuration % 60}s
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Vue d'ensemble</Text>
              <ProgressBar label="Appels repondus" value={data.totalCalls - data.missedCalls} max={data.totalCalls} color="#22c55e" />
              <ProgressBar label="Appels manques" value={data.missedCalls} max={data.totalCalls} color="#ef4444" />
              <ProgressBar label="Taches en attente" value={data.pendingTasks} max={data.pendingTasks + data.completedTasks} color="#f59e0b" />
              <ProgressBar label="Taches terminees" value={data.completedTasks} max={data.pendingTasks + data.completedTasks} color="#22c55e" />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 14 },
  rateRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  rateBig: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  rateValue: { fontSize: 24, fontFamily: "Inter_700Bold" },
  rateInfo: { flex: 1 },
  rateLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  progressItem: { marginBottom: 14 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  progressValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
});
