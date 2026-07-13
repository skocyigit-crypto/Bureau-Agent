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
  status: "connecte" | "deconnecte" | "en_attente";
  version: string | null;
  lastSync: string | null;
  features: string[];
}

interface ApiCategory {
  id: string;
  label: string;
}

const CATEGORY_COLORS: Record<string, { color: string; icon: keyof typeof Feather.glyphMap }> = {
  crm: { color: "#3b82f6", icon: "briefcase" },
  communication: { color: "#8b5cf6", icon: "message-circle" },
  gestion_projet: { color: "#f59e0b", icon: "trello" },
  comptabilite: { color: "#14b8a6", icon: "dollar-sign" },
  documents: { color: "#ec4899", icon: "file-text" },
  messagerie: { color: "#6366f1", icon: "mail" },
  marketing: { color: "#f97316", icon: "target" },
  automatisation: { color: "#22c55e", icon: "zap" },
  support: { color: "#ef4444", icon: "headphones" },
};

export default function IntegrationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/integrations/catalog`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations ?? []);
        setCategories(data.categories ?? []);
      }
    } catch (err) { console.warn("[Integrations] fetch failed:", err); } finally {
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

  const connected = integrations.filter(i => i.status === "connecte").length;

  const ICON_MAP: Record<string, keyof typeof Feather.glyphMap> = {
    salesforce: "cloud",
    hubspot: "target",
    pipedrive: "trending-up",
    slack: "message-square",
    teams: "video",
    zoom: "video",
    trello: "trello",
    asana: "check-square",
    notion: "book",
    jira: "clipboard",
    sage: "database",
    quickbooks: "credit-card",
    docusign: "edit-3",
    dropbox: "droplet",
    outlook: "mail",
    mailchimp: "send",
    sendinblue: "send",
    brevo: "send",
    zapier: "zap",
    make: "repeat",
    intercom: "message-circle",
    zendesk: "headphones",
    github: "github",
  };

  function getIntegrationIcon(integration: Integration): keyof typeof Feather.glyphMap {
    const lower = integration.id.toLowerCase();
    if (ICON_MAP[lower]) return ICON_MAP[lower];
    const nameLower = integration.name.toLowerCase();
    for (const [key, icon] of Object.entries(ICON_MAP)) {
      if (nameLower.includes(key)) return icon;
    }
    return CATEGORY_COLORS[integration.category]?.icon || "grid";
  }

  function getCategoryLabel(catId: string): string {
    const cat = categories.find(c => c.id === catId);
    return cat?.label || catId;
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
                  <Text style={[styles.statVal, { color: colors.foreground }]}>{categories.filter(c => c.id !== "all").length}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Categories</Text>
                </View>
              </View>
              <View style={catStyles.container}>
                {categories.map(cat => {
                  const catColor = cat.id === "all" ? colors.primary : (CATEGORY_COLORS[cat.id]?.color || "#64748b");
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => setCategoryFilter(cat.id)}
                      style={[catStyles.chip, { backgroundColor: categoryFilter === cat.id ? catColor + "20" : colors.muted }]}
                    >
                      <Text style={[catStyles.chipText, { color: categoryFilter === cat.id ? catColor : colors.mutedForeground }]}>{cat.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          }
          ListEmptyComponent={<EmptyState icon="grid" title="Aucune integration" subtitle="Aucune integration trouvee" />}
          renderItem={({ item }) => {
            const catColor = CATEGORY_COLORS[item.category]?.color || "#64748b";
            const iconName = getIntegrationIcon(item);
            const isConnected = item.status === "connecte";
            const isPending = item.status === "en_attente";
            return (
              <View style={[styles.intCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.intIcon, { backgroundColor: catColor + "18" }]}>
                  <Feather name={iconName} size={20} color={catColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.intName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={[styles.intDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{item.description}</Text>
                  <View style={styles.intMeta}>
                    <View style={[styles.catBadge, { backgroundColor: catColor + "15" }]}>
                      <Text style={[styles.catBadgeText, { color: catColor }]}>{getCategoryLabel(item.category)}</Text>
                    </View>
                    {item.lastSync && (
                      <Text style={[styles.syncText, { color: colors.mutedForeground }]}>
                        Sync: {new Date(item.lastSync).toLocaleDateString("fr-FR")}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={[styles.statusBadge, {
                  backgroundColor: isConnected ? "#22c55e18" : isPending ? "#f59e0b18" : colors.muted,
                }]}>
                  <View style={[styles.statusDot, {
                    backgroundColor: isConnected ? "#22c55e" : isPending ? "#f59e0b" : "#94a3b8",
                  }]} />
                  <Text style={[styles.statusText, {
                    color: isConnected ? "#22c55e" : isPending ? "#f59e0b" : colors.mutedForeground,
                  }]}>
                    {isConnected ? "Connecte" : isPending ? "En attente" : "Disponible"}
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
