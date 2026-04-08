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

interface Integration {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  isConnected: boolean;
  isAvailable: boolean;
  status?: string;
  lastSync?: string;
}

const CATEGORY_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  crm: { label: "CRM", color: "#3b82f6", icon: "briefcase" },
  communication: { label: "Communication", color: "#8b5cf6", icon: "message-circle" },
  productivity: { label: "Productivite", color: "#22c55e", icon: "zap" },
  project: { label: "Gestion de projet", color: "#f59e0b", icon: "trello" },
  storage: { label: "Stockage", color: "#ec4899", icon: "hard-drive" },
  analytics: { label: "Analytique", color: "#6366f1", icon: "bar-chart" },
  finance: { label: "Finance", color: "#14b8a6", icon: "dollar-sign" },
  other: { label: "Autre", color: "#64748b", icon: "grid" },
};

export default function IntegrationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/integrations/catalog`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations ?? data.catalog ?? []);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  const filtered = integrations.filter(i => {
    const matchSearch = `${i.name} ${i.description}`.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === "all" || i.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const connected = integrations.filter(i => i.isConnected).length;
  const categories = [...new Set(integrations.map(i => i.category))];

  const ICON_MAP: Record<string, keyof typeof Feather.glyphMap> = {
    salesforce: "cloud",
    hubspot: "target",
    slack: "message-square",
    teams: "video",
    google: "mail",
    microsoft: "monitor",
    trello: "trello",
    asana: "check-square",
    jira: "clipboard",
    notion: "book",
    dropbox: "droplet",
    drive: "hard-drive",
    stripe: "credit-card",
    zoom: "video",
    discord: "message-circle",
    github: "github",
    gitlab: "gitlab",
    zapier: "zap",
  };

  function getIntegrationIcon(integration: Integration): keyof typeof Feather.glyphMap {
    const lower = integration.name.toLowerCase();
    for (const [key, icon] of Object.entries(ICON_MAP)) {
      if (lower.includes(key)) return icon;
    }
    return CATEGORY_MAP[integration.category]?.icon || "grid";
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Integrations</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une integration..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
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
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <>
              <View style={styles.statsRow}>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="link" size={16} color="#22c55e" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{connected}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Connectees</Text>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="grid" size={16} color="#3b82f6" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{integrations.length}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Disponibles</Text>
                </View>
                <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="layers" size={16} color="#8b5cf6" />
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{categories.length}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Categories</Text>
                </View>
              </View>
              <ScrollableCategories
                categories={categories}
                selected={categoryFilter}
                onSelect={setCategoryFilter}
                colors={colors}
              />
            </>
          }
          ListEmptyComponent={<EmptyState icon="grid" title="Aucune integration" subtitle="Aucune integration disponible" />}
          renderItem={({ item }) => {
            const catInfo = CATEGORY_MAP[item.category] || CATEGORY_MAP.other;
            const iconName = getIntegrationIcon(item);
            return (
              <View style={[styles.intCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.intIcon, { backgroundColor: catInfo.color + "18" }]}>
                  <Feather name={iconName} size={20} color={catInfo.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.intName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={[styles.intDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{item.description}</Text>
                  <View style={styles.intMeta}>
                    <View style={[styles.catBadge, { backgroundColor: catInfo.color + "15" }]}>
                      <Text style={[styles.catBadgeText, { color: catInfo.color }]}>{catInfo.label}</Text>
                    </View>
                    {item.lastSync && (
                      <Text style={[styles.syncText, { color: colors.mutedForeground }]}>
                        Sync: {new Date(item.lastSync).toLocaleDateString("fr-FR")}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: item.isConnected ? "#22c55e18" : colors.muted }]}>
                  <View style={[styles.statusDot, { backgroundColor: item.isConnected ? "#22c55e" : "#94a3b8" }]} />
                  <Text style={[styles.statusText, { color: item.isConnected ? "#22c55e" : colors.mutedForeground }]}>
                    {item.isConnected ? "Connecte" : "Disponible"}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function ScrollableCategories({ categories, selected, onSelect, colors }: {
  categories: string[];
  selected: string;
  onSelect: (cat: string) => void;
  colors: any;
}) {
  const allCats = ["all", ...categories];
  return (
    <View style={catStyles.container}>
      {allCats.map(cat => {
        const info = cat === "all" ? { label: "Toutes", color: colors.primary } : (CATEGORY_MAP[cat] || CATEGORY_MAP.other);
        return (
          <Pressable
            key={cat}
            onPress={() => onSelect(cat)}
            style={[catStyles.chip, { backgroundColor: selected === cat ? info.color + "20" : colors.muted }]}
          >
            <Text style={[catStyles.chipText, { color: selected === cat ? info.color : colors.mutedForeground }]}>{info.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const catStyles = StyleSheet.create({
  container: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  stat: { flex: 1, alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  statVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  intCard: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12, alignItems: "flex-start" },
  intIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  intName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  intDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  intMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  catBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  catBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  syncText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
});
