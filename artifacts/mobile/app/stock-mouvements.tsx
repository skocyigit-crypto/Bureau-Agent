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

interface Mouvement {
  id: number;
  articleId: number;
  articleName: string;
  articleReference?: string;
  type: string;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason?: string;
  userName?: string;
  createdAt: string;
}

const TYPE_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap; sign: "+" | "-" | "~" }> = {
  entree:      { label: "Entrée",      color: "#22c55e", icon: "arrow-down-circle", sign: "+" },
  sortie:      { label: "Sortie",      color: "#ef4444", icon: "arrow-up-circle",   sign: "-" },
  ajustement:  { label: "Ajustement", color: "#3b82f6", icon: "edit-2",            sign: "~" },
  inventaire:  { label: "Inventaire",  color: "#8b5cf6", icon: "clipboard",         sign: "~" },
};

function fmtDateTime(d: string): { date: string; time: string } {
  const dt = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  let date: string;
  if (dt.toDateString() === today.toDateString()) date = "Aujourd'hui";
  else if (dt.toDateString() === yesterday.toDateString()) date = "Hier";
  else date = dt.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const time = dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

function MouvementCard({ m, colors }: { m: Mouvement; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  const cfg = TYPE_CFG[m.type] ?? { label: m.type, color: "#6b7280", icon: "activity" as const, sign: "~" as const };
  const { date, time } = fmtDateTime(m.createdAt);
  const isPositive = m.delta > 0;
  const deltaSign = m.delta > 0 ? "+" : "";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: cfg.color + "30", borderLeftColor: cfg.color }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeIcon, { backgroundColor: cfg.color + "18" }]}>
          <Feather name={cfg.icon} size={16} color={cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.articleName, { color: colors.foreground }]} numberOfLines={1}>{m.articleName}</Text>
          {m.articleReference && (
            <Text style={[styles.articleRef, { color: colors.mutedForeground }]}>Réf: {m.articleReference}</Text>
          )}
        </View>
        <View style={styles.deltaContainer}>
          <Text style={[styles.deltaText, { color: isPositive ? "#22c55e" : m.delta < 0 ? "#ef4444" : "#3b82f6" }]}>
            {deltaSign}{m.delta}
          </Text>
          <Text style={[styles.deltaUnit, { color: colors.mutedForeground }]}>unités</Text>
        </View>
      </View>

      <View style={styles.cardMeta}>
        <View style={[styles.typePill, { backgroundColor: cfg.color + "18" }]}>
          <Text style={[styles.typeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={[styles.qtyFlow, { backgroundColor: colors.background }]}>
          <Text style={[styles.qtyNum, { color: colors.mutedForeground }]}>{m.quantityBefore}</Text>
          <Feather name="arrow-right" size={10} color={colors.mutedForeground} />
          <Text style={[styles.qtyNum, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>{m.quantityAfter}</Text>
        </View>
        {m.userName && (
          <View style={styles.userChip}>
            <Feather name="user" size={9} color={colors.mutedForeground} />
            <Text style={[styles.userText, { color: colors.mutedForeground }]} numberOfLines={1}>{m.userName}</Text>
          </View>
        )}
        <View style={styles.timeChip}>
          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>{date} {time}</Text>
        </View>
      </View>

      {m.reason && (
        <Text style={[styles.reason, { color: colors.mutedForeground }]} numberOfLines={1}>
          <Feather name="message-circle" size={10} color={colors.mutedForeground} /> {m.reason}
        </Text>
      )}
    </View>
  );
}

export default function StockMouvementsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await fetchAuth(`${API_BASE}/api/stock/mouvements?${params}`);
      if (res.ok) {
        const d = await res.json();
        const list: Mouvement[] = d.mouvements ?? [];
        setMouvements(list);
        setTotal(d.total ?? list.length);
      }
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, search, typeFilter, page]);

  useEffect(() => { setPage(0); }, [search, typeFilter]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const typeFilters = [
    { key: "all",        label: "Tout"       },
    { key: "entree",     label: "Entrées"    },
    { key: "sortie",     label: "Sorties"    },
    { key: "ajustement", label: "Ajust."     },
    { key: "inventaire", label: "Inventaire" },
  ];

  const totalEntrees = mouvements.filter(m => m.type === "entree").reduce((s, m) => s + Math.abs(m.delta), 0);
  const totalSorties = mouvements.filter(m => m.type === "sortie").reduce((s, m) => s + Math.abs(m.delta), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#7c3aed", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Mouvements de Stock</Text>
            {!loading && <Text style={styles.headerSub}>{total} mouvement{total !== 1 ? "s" : ""}</Text>}
          </View>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Article, référence, raison…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={t => { setSearch(t); setPage(0); }}
          />
          {search ? <Feather name="x" size={14} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>

        <View style={styles.filterRow}>
          {typeFilters.map(f => (
            <Pressable
              key={f.key}
              onPress={() => { setTypeFilter(f.key); setPage(0); }}
              style={[styles.filterChip, { backgroundColor: typeFilter === f.key ? "#fff" : "rgba(255,255,255,0.15)" }]}
            >
              <Text style={[styles.filterText, { color: typeFilter === f.key ? "#7c3aed" : "rgba(255,255,255,0.85)" }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {!loading && mouvements.length > 0 && (
          <View style={[styles.summaryRow, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <View style={styles.sumItem}>
              <Feather name="arrow-down-circle" size={12} color="#86efac" />
              <Text style={[styles.sumNum, { color: "#86efac" }]}>+{totalEntrees}</Text>
              <Text style={styles.sumLbl}>Entrées</Text>
            </View>
            <View style={styles.sumDiv} />
            <View style={styles.sumItem}>
              <Feather name="arrow-up-circle" size={12} color="#fca5a5" />
              <Text style={[styles.sumNum, { color: "#fca5a5" }]}>-{totalSorties}</Text>
              <Text style={styles.sumLbl}>Sorties</Text>
            </View>
            <View style={styles.sumDiv} />
            <View style={styles.sumItem}>
              <Feather name="layers" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.sumNum}>{mouvements.length}</Text>
              <Text style={styles.sumLbl}>Sur cette page</Text>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#7c3aed" /></View>
      ) : (
        <FlatList
          data={mouvements}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: 32 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
          ListEmptyComponent={
            <EmptyState
              icon="package"
              title="Aucun mouvement"
              subtitle={search ? "Aucun mouvement ne correspond à votre recherche." : "Aucun mouvement de stock enregistré."}
            />
          }
          ListFooterComponent={totalPages > 1 ? (
            <View style={styles.pagination}>
              <Pressable
                onPress={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={[styles.pageBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: page === 0 ? 0.4 : 1 }]}
              >
                <Feather name="chevron-left" size={16} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.pageText, { color: colors.foreground }]}>Page {page + 1} / {totalPages}</Text>
              <Pressable
                onPress={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={[styles.pageBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: page >= totalPages - 1 ? 0.4 : 1 }]}
              >
                <Feather name="chevron-right" size={16} color={colors.foreground} />
              </Pressable>
            </View>
          ) : null}
          renderItem={({ item }) => <MouvementCard m={item} colors={colors} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  filterText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  summaryRow: { flexDirection: "row", borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  sumItem: { flex: 1, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 5 },
  sumNum: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  sumLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)" },
  sumDiv: { width: 1, height: 20, backgroundColor: "rgba(255,255,255,0.2)" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16, gap: 8 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  typeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  articleName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  articleRef: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  deltaContainer: { alignItems: "flex-end" },
  deltaText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  deltaUnit: { fontSize: 9, fontFamily: "Inter_400Regular" },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  typePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  typeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  qtyFlow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  qtyNum: { fontSize: 11, fontFamily: "Inter_400Regular" },
  userChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  userText: { fontSize: 10, fontFamily: "Inter_400Regular", maxWidth: 80 },
  timeChip: { marginLeft: "auto" },
  timeText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  reason: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 6 },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 16 },
  pageBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pageText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
