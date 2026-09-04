import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTranslation, type TFunction } from "@/lib/i18n";

interface SearchResults {
  contacts: any[];
  calls: any[];
  tasks: any[];
  messages: any[];
  prospects: any[];
  devis: any[];
  factures: any[];
  stock: any[];
  projets: any[];
  totalResults: number;
}

type ResultCategory = {
  key: keyof Omit<SearchResults, "totalResults">;
  labelKey: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  route: string;
  getTitle: (item: any, t: TFunction) => string;
  getSub: (item: any) => string;
};

const CATEGORIES: ResultCategory[] = [
  {
    key: "contacts",
    labelKey: "rechercheScreen.catContacts",
    icon: "user",
    color: "#0369a1",
    route: "/contacts",
    getTitle: (c) => `${c.firstName || ""} ${c.lastName || ""}`.trim(),
    getSub: (c) => c.company || c.email || c.phone || "",
  },
  {
    key: "prospects",
    labelKey: "rechercheScreen.catProspects",
    icon: "trending-up",
    color: "#f59e0b",
    route: "/prospects",
    getTitle: (p) => p.title || p.company || "",
    getSub: (p) => p.contactName || p.company || p.stage || "",
  },
  {
    key: "devis",
    labelKey: "rechercheScreen.catDevis",
    icon: "file-text",
    color: "#3b82f6",
    route: "/devis",
    getTitle: (d, t) => d.reference || d.title || t("rechercheScreen.devisFallback", { id: d.id }),
    getSub: (d) => d.clientName || "",
  },
  {
    key: "factures",
    labelKey: "rechercheScreen.catFactures",
    icon: "dollar-sign",
    color: "#22c55e",
    route: "/factures",
    getTitle: (f, t) => f.reference || f.title || t("rechercheScreen.factureFallback", { id: f.id }),
    getSub: (f) => f.clientName || "",
  },
  {
    key: "tasks",
    labelKey: "rechercheScreen.catTasks",
    icon: "check-square",
    color: "#1e3a5f",
    route: "/tasks",
    getTitle: (item) => item.title || "",
    getSub: (item) => item.status || item.priority || "",
  },
  {
    key: "projets",
    labelKey: "rechercheScreen.catProjets",
    icon: "folder",
    color: "#6366f1",
    route: "/projets",
    getTitle: (p) => p.title || "",
    getSub: (p) => p.clientName || p.status || "",
  },
  {
    key: "calls",
    labelKey: "rechercheScreen.catCalls",
    icon: "phone",
    color: "#166534",
    route: "/calls",
    getTitle: (c, t) => c.contactName || c.phoneNumber || t("rechercheScreen.callFallback"),
    getSub: (c) => c.direction || c.status || "",
  },
  {
    key: "messages",
    labelKey: "rechercheScreen.catMessages",
    icon: "message-square",
    color: "#8b5cf6",
    route: "/messages",
    getTitle: (m, t) => (m.content || "").slice(0, 60) || t("rechercheScreen.messageFallback"),
    getSub: (m) => m.contactName || m.fromName || "",
  },
  {
    key: "stock",
    labelKey: "rechercheScreen.catStock",
    icon: "package",
    color: "#7c3aed",
    route: "/stock",
    getTitle: (s) => s.name || s.reference || "",
    getSub: (s) => s.category || s.reference || "",
  },
];

type FlatResultItem =
  | { kind: "header"; catKey: string; label: string; count: number; icon: keyof typeof Feather.glyphMap; color: string }
  | { kind: "result"; catKey: string; item: any; cat: ResultCategory };

function ResultRow({ item, colors }: { item: FlatResultItem & { kind: "result" }; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  const { t } = useTranslation();
  const { cat } = item;
  return (
    <Pressable accessibilityRole="button"
      onPress={() => router.push(cat.route as any)}
      style={({ pressed }) => [
        styles.resultRow,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.resultIcon, { backgroundColor: cat.color + "18" }]}>
        <Feather name={cat.icon} size={14} color={cat.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.resultTitle, { color: colors.foreground }]} numberOfLines={1}>
          {cat.getTitle(item.item, t)}
        </Text>
        {cat.getSub(item.item) !== "" && (
          <Text style={[styles.resultSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {cat.getSub(item.item)}
          </Text>
        )}
      </View>
      <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function RechercheScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { reqIdRef.current++; setResults(null); setLoading(false); return; }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=5`);
      const data = res.ok ? await res.json() : null;
      if (reqId === reqIdRef.current) setResults(data);
    } catch {
      if (reqId === reqIdRef.current) setResults(null);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [fetchAuth]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Flatten results for FlatList
  const flatData: FlatResultItem[] = [];
  if (results) {
    for (const cat of CATEGORIES) {
      const items = results[cat.key] ?? [];
      if (items.length === 0) continue;
      flatData.push({ kind: "header", catKey: cat.key, label: t(cat.labelKey), count: items.length, icon: cat.icon, color: cat.color });
      items.forEach(item => flatData.push({ kind: "result", catKey: cat.key, item, cat }));
    }
  }

  const totalResults = results?.totalResults ?? flatData.filter(i => i.kind === "result").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#1e293b", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>{t("rechercheScreen.title")}</Text>
        </View>
        <View style={[styles.searchBox, { backgroundColor: "#fff" }]}>
          <Feather name="search" size={16} color="#6b7280" />
          <TextInput accessibilityLabel={t("rechercheScreen.searchPlaceholder")}
            ref={inputRef}
            style={styles.searchInput}
            placeholder={t("rechercheScreen.searchPlaceholder")}
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            autoFocus={!isWeb}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={() => { setQuery(""); setResults(null); }}>
              <Feather name="x" size={16} color="#6b7280" />
            </Pressable>
          )}
        </View>
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#1e293b" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>{t("rechercheScreen.searching")}</Text>
        </View>
      )}

      {!query || query.trim().length < 2 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: "#f1f5f9" }]}>
            <Feather name="search" size={36} color="#94a3b8" />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t("rechercheScreen.emptyTitle")}</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {t("rechercheScreen.emptySub")}
          </Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map(cat => (
              <Pressable accessibilityRole="button"
                key={cat.key}
                onPress={() => router.push(cat.route as any)}
                style={[styles.catCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.catIcon, { backgroundColor: cat.color + "18" }]}>
                  <Feather name={cat.icon} size={16} color={cat.color} />
                </View>
                <Text style={[styles.catLabel, { color: colors.foreground }]}>{t(cat.labelKey)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results && totalResults === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="search" size={36} color="#94a3b8" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t("rechercheScreen.noResults")}</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {t("rechercheScreen.noResultsFor", { query })}
          </Text>
        </View>
      ) : results ? (
        <FlatList
          data={flatData}
          keyExtractor={(item, i) => item.kind === "header" ? `h-${item.catKey}` : `r-${item.catKey}-${i}`}
          contentContainerStyle={[styles.listContent, { paddingBottom: 40 }]}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <Text style={[styles.resultsCount, { color: colors.mutedForeground }]}>
                {t(totalResults !== 1 ? "rechercheScreen.resultsCountMany" : "rechercheScreen.resultsCountOne", { count: totalResults, query })}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <View style={styles.catHeader}>
                  <View style={[styles.catHeaderIcon, { backgroundColor: item.color + "18" }]}>
                    <Feather name={item.icon} size={12} color={item.color} />
                  </View>
                  <Text style={[styles.catHeaderLabel, { color: item.color }]}>{item.label}</Text>
                  <View style={[styles.catCount, { backgroundColor: item.color + "18" }]}>
                    <Text style={[styles.catCountText, { color: item.color }]}>{item.count}</Text>
                  </View>
                </View>
              );
            }
            return <ResultRow item={item} colors={colors} />;
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingHorizontal: 14, height: 44, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  searchInput: { flex: 1, color: "#111827", fontSize: 15, fontFamily: "Inter_400Regular" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, paddingHorizontal: 20 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  emptyState: { flex: 1, alignItems: "center", padding: 32, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, maxWidth: 280 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, justifyContent: "center" },
  catCard: { width: 90, alignItems: "center", padding: 10, borderRadius: 12, borderWidth: 1, gap: 6 },
  catIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  catLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
  listContent: { padding: 16 },
  resultsHeader: { paddingBottom: 8 },
  resultsCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  catHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingTop: 14 },
  catHeaderIcon: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  catHeaderLabel: { fontSize: 12, fontFamily: "Inter_700Bold", flex: 1 },
  catCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  catCountText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  resultRow: { flexDirection: "row", alignItems: "center", padding: 11, borderRadius: 10, borderWidth: 1, marginBottom: 6, gap: 10 },
  resultIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  resultSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
});
