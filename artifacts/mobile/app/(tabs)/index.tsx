import { Feather } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface DashboardData {
  totalCalls: number;
  missedCalls: number;
  totalContacts: number;
  pendingTasks: number;
  unreadMessages: number;
  avgCallDuration: number;
  answeredRate: number;
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/summary`);
      if (res.ok) {
        const json = await res.json();
        setData({
          totalCalls: json.totalCalls ?? 0,
          missedCalls: json.missedCalls ?? 0,
          totalContacts: json.totalContacts ?? 0,
          pendingTasks: json.pendingTasks ?? 0,
          unreadMessages: json.unreadMessages ?? 0,
          avgCallDuration: json.avgCallDuration ?? 0,
          answeredRate: json.answeredRate ?? 0,
        });
      }
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  function onRefresh() {
    setRefreshing(true);
    fetchDashboard();
  }

  const greeting = user
    ? `Bonjour, ${user.prenom}`
    : "Tableau de bord";

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
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.headerSubtitle}>Vue d'ensemble de votre activite</Text>
        </View>
        <View style={[styles.avatarCircle, { backgroundColor: colors.primary }]}>
          <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
            {user ? (user.prenom[0] + user.nom[0]).toUpperCase() : "AB"}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 100 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : !data ? (
          <EmptyState
            icon="bar-chart-2"
            title="Donnees indisponibles"
            subtitle="Impossible de charger les statistiques"
          />
        ) : (
          <>
            <View style={styles.statsRow}>
              <StatCard
                title="Appels"
                value={data.totalCalls}
                icon="phone"
                color={colors.info ?? "#3b82f6"}
              />
              <StatCard
                title="Manques"
                value={data.missedCalls}
                icon="phone-missed"
                color={colors.destructive}
              />
            </View>
            <View style={styles.statsRow}>
              <StatCard
                title="Contacts"
                value={data.totalContacts}
                icon="users"
                color={colors.success ?? "#22c55e"}
              />
              <StatCard
                title="Taches"
                value={data.pendingTasks}
                icon="check-square"
                color={colors.warning ?? "#f59e0b"}
                subtitle="En attente"
              />
            </View>

            <View style={[styles.performanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Performance</Text>
              <View style={styles.perfRow}>
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>
                    {data.answeredRate}%
                  </Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>
                    Taux de reponse
                  </Text>
                </View>
                <View style={[styles.perfDivider, { backgroundColor: colors.border }]} />
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>
                    {Math.floor(data.avgCallDuration / 60)}m {data.avgCallDuration % 60}s
                  </Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>
                    Duree moyenne
                  </Text>
                </View>
                <View style={[styles.perfDivider, { backgroundColor: colors.border }]} />
                <View style={styles.perfItem}>
                  <Text style={[styles.perfValue, { color: colors.primary }]}>
                    {data.unreadMessages}
                  </Text>
                  <Text style={[styles.perfLabel, { color: colors.mutedForeground }]}>
                    Non lus
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.infoCard, { backgroundColor: colors.secondary }]}>
              <Feather name="zap" size={20} color={colors.primary} />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Agent IA actif</Text>
                <Text style={styles.infoSubtitle}>
                  Analyse continue de votre activite
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  headerSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
    marginTop: 2,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: "center",
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  performanceCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 14,
  },
  perfRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  perfItem: {
    flex: 1,
    alignItems: "center",
  },
  perfValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  perfLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    textAlign: "center",
  },
  perfDivider: {
    width: 1,
    height: 36,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
  },
  infoSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
    marginTop: 2,
  },
});
