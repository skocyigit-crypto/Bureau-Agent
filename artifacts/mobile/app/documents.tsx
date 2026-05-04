import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Doc {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileSizeFormatted: string;
  entityType?: string | null;
  entityId?: number | null;
  category: string;
  description?: string | null;
  tags?: string[] | null;
  aiProcessed: boolean;
  status: string;
  uploadedBy?: number | null;
  createdAt: string;
}

interface Stats {
  totalDocuments: number;
  totalSizeFormatted: string;
  aiProcessed: number;
  byCategory: { category: string; count: number }[];
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  general:        { label: "Général",         color: "#6366f1" },
  contrat:        { label: "Contrat",          color: "#0891b2" },
  facture:        { label: "Facture",          color: "#22c55e" },
  rapport:        { label: "Rapport",          color: "#f59e0b" },
  cv:             { label: "CV",               color: "#ec4899" },
  correspondance: { label: "Correspondance",   color: "#8b5cf6" },
  technique:      { label: "Technique",        color: "#14b8a6" },
  juridique:      { label: "Juridique",        color: "#ef4444" },
  comptabilite:   { label: "Comptabilité",     color: "#f97316" },
};

const ENTITY_LABELS: Record<string, string> = {
  contact: "Contact", task: "Tâche", message: "Message",
  invoice: "Facture", devis: "Devis", prospect: "Prospect",
  project: "Projet", stock: "Stock", event: "Événement", general: "Général",
};

function getMimeIcon(mimeType: string): { icon: keyof typeof Feather.glyphMap; color: string } {
  if (mimeType.startsWith("image/"))                      return { icon: "image",      color: "#ec4899" };
  if (mimeType.includes("pdf"))                           return { icon: "file-text",  color: "#ef4444" };
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv")
                                                          return { icon: "grid",        color: "#22c55e" };
  if (mimeType.includes("word") || mimeType.includes("document"))
                                                          return { icon: "file-text",  color: "#3b82f6" };
  if (mimeType.includes("zip") || mimeType.includes("rar"))
                                                          return { icon: "archive",    color: "#f59e0b" };
  if (mimeType.startsWith("text/"))                       return { icon: "file-text",  color: "#6366f1" };
  return { icon: "file", color: "#6b7280" };
}

function DocCard({ doc, colors, onDelete, onDownload }: {
  doc: Doc;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onDownload: (id: number, name: string) => void;
}) {
  const { icon, color } = getMimeIcon(doc.mimeType);
  const catCfg = CATEGORY_LABELS[doc.category] ?? { label: doc.category, color: "#6366f1" };
  const date = new Date(doc.createdAt).toLocaleDateString("fr-FR");

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: catCfg.color + "25", borderLeftWidth: 3, borderLeftColor: catCfg.color }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.fileIcon, { backgroundColor: color + "15" }]}>
          <Feather name={icon} size={20} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={2}>{doc.fileName}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.catBadge, { backgroundColor: catCfg.color + "15" }]}>
              <Text style={[styles.catText, { color: catCfg.color }]}>{catCfg.label}</Text>
            </View>
            <Text style={[styles.sizeText, { color: colors.mutedForeground }]}>{doc.fileSizeFormatted}</Text>
            {doc.aiProcessed && (
              <View style={[styles.aiBadge, { backgroundColor: "#8b5cf618" }]}>
                <Feather name="zap" size={8} color="#8b5cf6" />
                <Text style={[styles.aiText, { color: "#8b5cf6" }]}>IA</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {doc.description && (
        <Text style={[styles.descText, { color: colors.mutedForeground }]} numberOfLines={2}>{doc.description}</Text>
      )}

      {(doc.entityType || doc.tags?.length) && (
        <View style={styles.tagsRow}>
          {doc.entityType && (
            <View style={[styles.entityTag, { backgroundColor: colors.border }]}>
              <Feather name="link" size={9} color={colors.mutedForeground} />
              <Text style={[styles.entityText, { color: colors.mutedForeground }]}>
                {ENTITY_LABELS[doc.entityType] ?? doc.entityType}
              </Text>
            </View>
          )}
          {doc.tags?.slice(0, 3).map((tag, i) => (
            <View key={i} style={[styles.tag, { backgroundColor: colors.border }]}>
              <Text style={[styles.tagText, { color: colors.mutedForeground }]}>#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.cardFooter}>
        <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
          <Feather name="clock" size={10} color={colors.mutedForeground} /> {date}
        </Text>
        <View style={styles.footerActions}>
          <Pressable
            onPress={() => onDownload(doc.id, doc.fileName)}
            style={[styles.actionBtn, { backgroundColor: "#3b82f618", borderColor: "#3b82f630" }]}
          >
            <Feather name="download" size={13} color="#3b82f6" />
            <Text style={[styles.actionBtnText, { color: "#3b82f6" }]}>Télécharger</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS === "web") { onDelete(doc.id); return; }
              Alert.alert("Supprimer", `Supprimer "${doc.fileName}" ?`, [
                { text: "Annuler", style: "cancel" },
                { text: "Supprimer", style: "destructive", onPress: () => onDelete(doc.id) },
              ]);
            }}
            style={[styles.actionBtn, { backgroundColor: "#ef444418", borderColor: "#ef444430" }]}
          >
            <Feather name="trash-2" size={13} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function DocumentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [docs, setDocs] = useState<Doc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "80" });
      if (catFilter !== "all") params.set("category", catFilter);
      const [r1, r2] = await Promise.all([
        fetchAuth(`${API_BASE}/api/documents/list?${params}`),
        fetchAuth(`${API_BASE}/api/documents/stats/overview`),
      ]);
      if (r1.ok) { const d = await r1.json(); setDocs(d.documents ?? []); }
      if (r2.ok) setStats(await r2.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, catFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function handleDelete(id: number) {
    setDocs(prev => prev.filter(d => d.id !== id));
    try { await fetchAuth(`${API_BASE}/api/documents/${id}`, { method: "DELETE" }); load(); }
    catch { load(); }
  }

  async function handleDownload(id: number, name: string) {
    const url = `${API_BASE}/api/documents/${id}/download`;
    try {
      if (Platform.OS === "web") {
        window.open(url, "_blank");
      } else {
        await Linking.openURL(url);
      }
    } catch {
      Alert.alert("Erreur", "Impossible d'ouvrir le fichier.");
    }
  }

  const cats = ["all", ...Object.keys(CATEGORY_LABELS)];

  const filteredDocs = docs.filter(d => {
    if (search) {
      const q = search.toLowerCase();
      if (!d.fileName.toLowerCase().includes(q) && !(d.description ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#0f766e", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Documents</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        {stats && (
          <View style={[styles.statsStrip, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{stats.totalDocuments}</Text>
              <Text style={styles.statLbl}>Documents</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: "#a5f3fc" }]}>{stats.totalSizeFormatted}</Text>
              <Text style={styles.statLbl}>Taille totale</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: "#c4b5fd" }]}>{stats.aiProcessed}</Text>
              <Text style={styles.statLbl}>Analysés IA</Text>
            </View>
          </View>
        )}

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
          <Feather name="search" size={15} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un document..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={15} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
          {cats.map(cat => {
            const cfg = CATEGORY_LABELS[cat];
            const isActive = catFilter === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => setCatFilter(cat)}
                style={[
                  styles.filterChip,
                  { backgroundColor: isActive ? (cfg?.color ?? "#fff") : "rgba(255,255,255,0.1)" },
                ]}
              >
                <Text style={[styles.filterText, { color: isActive ? "#fff" : "rgba(255,255,255,0.7)" }]}>
                  {cat === "all" ? "Tous" : (cfg?.label ?? cat)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0f766e" />
        </View>
      ) : (
        <FlatList
          data={filteredDocs}
          keyExtractor={d => d.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 80 : 60 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0f766e" />}
          ListEmptyComponent={
            <EmptyState
              icon="folder"
              title="Aucun document"
              subtitle={search ? "Aucun document ne correspond à votre recherche." : "Aucun document uploadé pour le moment."}
            />
          }
          renderItem={({ item }) => (
            <DocCard doc={item} colors={colors} onDelete={handleDelete} onDownload={handleDownload} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  statsStrip: { flexDirection: "row", borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", marginTop: 2 },
  statDiv: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.2)" },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", gap: 10, marginBottom: 8, alignItems: "flex-start" },
  fileIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  catBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  catText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  sizeText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  aiBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  aiText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  descText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginBottom: 8 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  entityTag: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  entityText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  footerActions: { flexDirection: "row", gap: 6 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  actionBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
