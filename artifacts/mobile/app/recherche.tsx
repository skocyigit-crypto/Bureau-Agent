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

interface SearchResults {
  contacts: any[];
  calls: any[];
  tasks: any[];
  messages: any[];
  prospects: any[];
  devis: any[];
  factures: any[];
  stock: any[];
  commandes: any[];
  projets: any[];
  totalResults: number;
}

type ResultCategory = {
  key: keyof Omit<SearchResults, "totalResults">;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  route: string;
  getTitle: (item: any) => string;
  getSub: (item: any) => string;
};

const CATEGORIES: ResultCategory[] = [
  {
    key: "contacts",
    label: "Contacts",
    icon: "user",
    color: "#0369a1",
    route: "/contacts",
    getTitle: (c) => `${c.firstName || ""} ${c.lastName || ""}`.trim(),
    getSub: (c) => c.company || c.email || c.phone || "",
  },
  {
    key: "prospects",
    label: "Prospects",
    icon: "trending-up",
    color: "#f59e0b",
    route: "/prospects",
    getTitle: (p) => p.title || p.company || "",
    getSub: (p) => p.contactName || p.company || p.stage || "",
  },
  {
    key: "devis",
    label: "Devis",
    icon: "file-text",
    color: "#3b82f6",
    route: "/devis",
    getTitle: (d) => d.reference || d.title || `Devis #${d.id}`,
    getSub: (d) => d.clientName || "",
  },
  {
    key: "factures",
    label: "Factures",
    icon: "dollar-sign",
    color: "#22c55e",
    route: "/factures",
    getTitle: (f) => f.reference || f.title || `Facture #${f.id}`,
    getSub: (f) => f.clientName || "",
  },
  {
    key: "tasks",
    label: "Tâches",
    icon: "check-square",
    color: "#1e3a5f",
    route: "/tasks",
    getTitle: (t) => t.title || "",
    getSub: (t) => t.status || t.priority || "",
  },
  {
    key: "projets",
    label: "Projets",
    icon: "folder",
    color: "#6366f1",
    route: "/projets",
    getTitle: (p) => p.title || "",
    getSub: (p) => p.clientName || p.status || "",
  },
  {
    key: "calls",
    label: "Appels",
    icon: "phone",
    color: "#166534",
    route: "/calls",
    getTitle: (c) => c.contactName || c.phoneNumber || "Appel",
    getSub: (c) => c.direction || c.status || "",
  },
  {
    key: "messages",
    label: "Messages",
    icon: "message-square",
    color: "#8b5cf6",
    route: "/messages",
    getTitle: (m) => (m.content || "").slice(0, 60) || "Message",
    getSub: (m) => m.contactName || m.fromName || "",
  },
  {
    key: "stock",
    label: "Stock",
    icon: "package",
    color: "#7c3aed",
    route: "/stock",
    getTitle: (s) => s.name || s.reference || "",
    getSub: (s) => s.category || s.reference || "",
  },
  {
    key: "commandes",
    label: "Commandes",
    icon: "shopping-cart",
    color: "#b45309",
    route: "/commandes-fournisseur",
    getTitle: (c) => c.reference || c.fournisseurName || `BC #${c.id}`,
    getSub: (c) => c.fournisseurName || c.status || "",
  },
];

type FlatResultItem =
  | { kind: "header"; catKey: string; label: string; count: number; icon: keyof typeof Feather.glyphMap; color: string }
  | { kind: "result"; catKey: string; item: any; cat: ResultCategory };

function ResultRow({ item, colors }: { item: FlatResultItem & { kind: "result" }; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  const { cat } = item;
  return (
    <Pressable
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
          {cat.getTitle(item.item)}
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
      flatData.push({ kind: "header", catKey: cat.key, label: cat.label, count: items.length, icon: cat.icon, color: cat.color });
      items.forEach(item => flatData.push({ kind: "result", catKey: cat.key, item, cat }));
    }
  }

  const totalResults = results?.totalResults ?? flatData.filter(i => i.kind === "result").length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#1e293b", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Recherche Globale</Text>
        </View>
        <View style={[styles.searchBox, { backgroundColor: "#fff" }]}>
          <Feather name="search" size={16} color="#6b7280" />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Contacts, devis, tâches, prospects…"
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            autoFocus={!isWeb}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(""); setResults(null); }}>
              <Feather name="x" size={16} color="#6b7280" />
            </Pressable>
          )}
        </View>
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#1e293b" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Recherche en cours…</Text>
        </View>
      )}

      {!query || query.trim().length < 2 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: "#f1f5f9" }]}>
            <Feather name="search" size={36} color="#94a3b8" />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Recherchez dans toute l'app</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Contacts, prospects, devis, factures, tâches, projets, messages, stock et commandes.
          </Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map(cat => (
              <Pressable
                key={cat.key}
                onPress={() => router.push(cat.route as any)}
                style={[styles.catCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.catIcon, { backgroundColor: cat.color + "18" }]}>
                  <Feather name={cat.icon} size={16} color={cat.color} />
                </View>
                <Text style={[styles.catLabel, { color: colors.foreground }]}>{cat.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : results && totalResults === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="search" size={36} color="#94a3b8" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Aucun résultat</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Aucun résultat pour « {query} »
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
                {totalResults} résultat{totalResults !== 1 ? "s" : ""} pour « {query} »
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
