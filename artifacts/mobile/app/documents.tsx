import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { streamSse } from "@/lib/sse-stream";

// ── Types ─────────────────────────────────────────────────────────────────────
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
  hasText?: boolean;
  status: string;
  uploadedBy?: number | null;
  scanVerdict?: string | null;
  scanEngine?: string | null;
  scannedAt?: string | null;
  createdAt: string;
}

interface SourceCount { entity_type: string; count: number; }

interface BySourceData {
  documents: Doc[];
  total: number;
  bySource: SourceCount[];
  byScan?: { safe: number; dangerous: number; unscanned: number };
}

// ── Constants ─────────────────────────────────────────────────────────────────
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

const ENTITY_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  contact:  { label: "Contacts",    color: "#3b82f6", icon: "user" },
  prospect: { label: "Prospects",   color: "#8b5cf6", icon: "user-plus" },
  project:  { label: "Projets",     color: "#f59e0b", icon: "folder" },
  task:     { label: "Tâches",      color: "#22c55e", icon: "check-square" },
  invoice:  { label: "Factures",    color: "#22c55e", icon: "file-text" },
  devis:    { label: "Devis",       color: "#0891b2", icon: "clipboard" },
  message:  { label: "Messages",    color: "#6366f1", icon: "message-square" },
  stock:    { label: "Stock",       color: "#f97316", icon: "package" },
  event:    { label: "Événements",  color: "#ec4899", icon: "calendar" },
  general:  { label: "Général",     color: "#64748b", icon: "folder" },
};

function getMimeIcon(mimeType: string): { icon: keyof typeof Feather.glyphMap; color: string } {
  if (mimeType.startsWith("image/"))                       return { icon: "image",      color: "#ec4899" };
  if (mimeType.includes("pdf"))                            return { icon: "file-text",  color: "#ef4444" };
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv")
                                                           return { icon: "grid",        color: "#22c55e" };
  if (mimeType.includes("word") || mimeType.includes("document"))
                                                           return { icon: "file-text",  color: "#3b82f6" };
  if (mimeType.includes("zip") || mimeType.includes("rar")) return { icon: "archive",  color: "#f59e0b" };
  if (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml"))
                                                           return { icon: "file-text",  color: "#6366f1" };
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
                                                           return { icon: "monitor",    color: "#f97316" };
  return { icon: "file", color: "#6b7280" };
}

// ── Doc Card ──────────────────────────────────────────────────────────────────
function DocCard({ doc, colors, onDelete, onDownload, onRead, onRescan, scanning }: {
  doc: Doc;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onDelete: (id: number) => void;
  onDownload: (id: number, name: string) => void;
  onRead: (id: number) => void;
  onRescan: (id: number) => void;
  scanning: boolean;
}) {
  const { icon, color } = getMimeIcon(doc.mimeType);
  const catCfg = CATEGORY_LABELS[doc.category] ?? { label: doc.category, color: "#6366f1" };
  const entityCfg = doc.entityType ? (ENTITY_CFG[doc.entityType] ?? ENTITY_CFG.general) : null;
  const date = new Date(doc.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  const isReadable = doc.hasText || doc.mimeType.startsWith("image/") || doc.mimeType === "text/plain" || doc.mimeType === "application/json";

  return (
    <Pressable onPress={() => onRead(doc.id)}
      style={[st.card, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: catCfg.color, borderLeftWidth: 3 }]}>
      <View style={st.cardHeader}>
        <View style={[st.fileIcon, { backgroundColor: color + "15" }]}>
          <Feather name={icon} size={20} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.fileName, { color: colors.foreground }]} numberOfLines={2}>{doc.fileName}</Text>
          <View style={st.metaRow}>
            <View style={[st.catBadge, { backgroundColor: catCfg.color + "15" }]}>
              <Text style={[st.catText, { color: catCfg.color }]}>{catCfg.label}</Text>
            </View>
            <Text style={[st.sizeText, { color: colors.mutedForeground }]}>{doc.fileSizeFormatted}</Text>
            {doc.aiProcessed && (
              <View style={[st.aiBadge, { backgroundColor: "#8b5cf618" }]}>
                <Feather name="zap" size={8} color="#8b5cf6" />
                <Text style={[st.aiText, { color: "#8b5cf6" }]}>IA</Text>
              </View>
            )}
            {isReadable && (
              <View style={[st.aiBadge, { backgroundColor: "#22c55e18" }]}>
                <Feather name="eye" size={8} color="#22c55e" />
                <Text style={[st.aiText, { color: "#22c55e" }]}>Lisible</Text>
              </View>
            )}
            {doc.scanVerdict === "safe" && (
              <View style={[st.aiBadge, { backgroundColor: "#10b98118" }]}>
                <Feather name="shield" size={8} color="#10b981" />
                <Text style={[st.aiText, { color: "#10b981" }]}>{doc.scanEngine ? `Vérifié (${doc.scanEngine})` : "Vérifié"}</Text>
              </View>
            )}
            {doc.scanVerdict === "dangerous" && (
              <View style={[st.aiBadge, { backgroundColor: "#ef444418" }]}>
                <Feather name="alert-triangle" size={8} color="#ef4444" />
                <Text style={[st.aiText, { color: "#ef4444" }]}>Menace</Text>
              </View>
            )}
            {!doc.scanVerdict && (
              <View style={[st.aiBadge, { backgroundColor: "#64748b18" }]}>
                <Feather name="shield-off" size={8} color="#64748b" />
                <Text style={[st.aiText, { color: "#64748b" }]}>Non analysé</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Entity source badge */}
      {entityCfg && (
        <View style={st.entityRow}>
          <View style={[st.entityBadge, { backgroundColor: entityCfg.color + "12" }]}>
            <Feather name={entityCfg.icon} size={10} color={entityCfg.color} />
            <Text style={[st.entityText, { color: entityCfg.color }]}>{entityCfg.label}</Text>
            {doc.entityId && <Text style={[st.entityText, { color: entityCfg.color }]}>#{doc.entityId}</Text>}
          </View>
        </View>
      )}

      {doc.description && (
        <Text style={[st.descText, { color: colors.mutedForeground }]} numberOfLines={2}>{doc.description}</Text>
      )}

      {doc.tags && doc.tags.length > 0 && (
        <View style={st.tagsRow}>
          {doc.tags.slice(0, 4).map((tag, i) => (
            <View key={i} style={[st.tag, { backgroundColor: colors.border }]}>
              <Text style={[st.tagText, { color: colors.mutedForeground }]}>#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={st.cardFooter}>
        <Text style={[st.dateText, { color: colors.mutedForeground }]}>{date}</Text>
        <View style={st.footerActions}>
          <Pressable onPress={() => onRead(doc.id)}
            style={[st.actionBtn, { backgroundColor: "#0f766e18", borderColor: "#0f766e30" }]}>
            <Feather name="book-open" size={12} color="#0f766e" />
            <Text style={[st.actionBtnText, { color: "#0f766e" }]}>Lire</Text>
          </Pressable>
          <Pressable onPress={() => onDownload(doc.id, doc.fileName)}
            style={[st.actionBtn, { backgroundColor: "#3b82f618", borderColor: "#3b82f630" }]}>
            <Feather name="download" size={12} color="#3b82f6" />
            <Text style={[st.actionBtnText, { color: "#3b82f6" }]}>Télécharger</Text>
          </Pressable>
          <Pressable onPress={() => onRescan(doc.id)} disabled={scanning}
            style={[st.actionBtn, { backgroundColor: "#10b98118", borderColor: "#10b98130" }]}>
            {scanning
              ? <ActivityIndicator size="small" color="#10b981" />
              : <Feather name="shield" size={12} color="#10b981" />}
            <Text style={[st.actionBtnText, { color: "#10b981" }]}>{scanning ? "..." : (doc.scanVerdict ? "Rescanner" : "Analyser")}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS === "web") { onDelete(doc.id); return; }
              Alert.alert("Supprimer", `Supprimer "${doc.fileName}" ?`, [
                { text: "Annuler", style: "cancel" },
                { text: "Supprimer", style: "destructive", onPress: () => onDelete(doc.id) },
              ]);
            }}
            style={[st.actionBtn, { backgroundColor: "#ef444418", borderColor: "#ef444430" }]}>
            <Feather name="trash-2" size={12} color="#ef4444" />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function DocumentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, authHeaders } = useAuth();
  const isWeb = Platform.OS === "web";
  const params = useLocalSearchParams<{ scan?: string }>();

  const [data, setData] = useState<BySourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [scanningIds, setScanningIds] = useState<number[]>([]);
  const [scanFilter, setScanFilter] = useState(() => {
    const s = params.scan;
    return s === "safe" || s === "dangerous" || s === "none" ? s : "all";
  });
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState<{ completed: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "120" });
      if (sourceFilter !== "all") params.set("entityType", sourceFilter);
      if (search.trim()) params.set("q", search.trim());
      if (scanFilter !== "all") params.set("scanVerdict", scanFilter);
      const res = await fetchAuth(`${API_BASE}/api/documents/by-source?${params}`);
      if (res.ok) setData(await res.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, sourceFilter, search, scanFilter]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  // Au montage : se rebrancher a un scan en arriere-plan deja en cours.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/documents/scan-unscanned/status`);
        if (!res.ok) return;
        const { job } = await res.json();
        if (job.status === "running") {
          setBulkScanning(true);
          setBulkScanProgress({ completed: job.scanned, total: Math.max(job.total, job.scanned) });
          cleanup = pollBulkScan(false);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => { cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(id: number) {
    setData(prev => prev ? { ...prev, documents: prev.documents.filter(d => d.id !== id) } : null);
    try { await fetchAuth(`${API_BASE}/api/documents/${id}`, { method: "DELETE" }); load(); }
    catch { load(); }
  }

  async function handleDownload(id: number, name: string) {
    const url = `${API_BASE}/api/documents/${id}/download`;
    try {
      if (Platform.OS === "web") window.open(url, "_blank");
      else await Linking.openURL(url);
    } catch { Alert.alert("Erreur", "Impossible d'ouvrir le fichier."); }
  }

  function handleRead(id: number) {
    router.push(`/document-reader?id=${id}` as any);
  }

  async function handleRescan(id: number) {
    if (scanningIds.includes(id)) return;
    setScanningIds(prev => [...prev, id]);
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${id}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const result = await res.json();
        setData(prev => prev ? {
          ...prev,
          documents: prev.documents.map(d => d.id === id ? {
            ...d,
            scanVerdict: result.scanVerdict ?? d.scanVerdict,
            scanEngine: result.scanEngine ?? null,
            scannedAt: result.scannedAt ?? d.scannedAt,
          } : d),
        } : null);
      } else {
        Alert.alert("Analyse antivirus", "L'analyse a échoué. Réessayez.");
      }
    } catch {
      Alert.alert("Analyse antivirus", "Erreur de connexion.");
    } finally {
      setScanningIds(prev => prev.filter(x => x !== id));
    }
  }

  async function handleBulkScan(ids: number[]) {
    if (bulkScanning || ids.length === 0) return;
    setBulkScanning(true);
    setBulkScanProgress({ completed: 0, total: ids.length });
    // Patche une ligne de document avec son verdict frais des qu'il arrive.
    const applyResult = (item: { documentId: number; scanVerdict?: string; scanEngine?: string | null; scannedAt?: string }) => {
      if (!item.scanVerdict) return;
      setData(prev => prev ? {
        ...prev,
        documents: prev.documents.map(d => d.id === item.documentId
          ? { ...d, scanVerdict: item.scanVerdict ?? d.scanVerdict, scanEngine: item.scanEngine ?? null, scannedAt: item.scannedAt ?? d.scannedAt }
          : d),
      } : null);
    };
    const controller = new AbortController();
    let finished = false;
    try {
      await streamSse(`${API_BASE}/api/documents/bulk/scan/stream`, { ids }, {
        signal: controller.signal,
        headers: authHeaders(),
        onEvent: (event, data) => {
          if (event === "start") {
            setBulkScanProgress({ completed: 0, total: data.total ?? ids.length });
          } else if (event === "progress") {
            setBulkScanProgress({ completed: data.completed ?? 0, total: data.total ?? ids.length });
            if (data.last) applyResult(data.last);
          } else if (event === "done") {
            finished = true;
            for (const item of data.results ?? []) applyResult(item);
            const parts: string[] = [];
            if (data.safe) parts.push(`${data.safe} sain(s)`);
            if (data.dangerous) parts.push(`${data.dangerous} menace(s)`);
            if (data.failed) parts.push(`${data.failed} échec(s)`);
            Alert.alert(`${data.scanned} document(s) analysé(s)`, parts.join(" · ") || "Analyse terminée.");
          } else if (event === "error") {
            finished = true;
            Alert.alert("Analyse antivirus", data?.error || "L'analyse groupée a échoué. Réessayez.");
          }
        },
      });
      if (!finished) {
        // Le flux s'est termine sans evenement terminal (reattachement a un job
        // deja fini): on reconcilie via l'instantane de statut.
        const res = await fetchAuth(`${API_BASE}/api/documents/bulk/scan/status`);
        if (res.ok) {
          const r = await res.json();
          for (const item of r.results ?? []) applyResult(item);
          if (r.status === "completed" || r.status === "cancelled") {
            const parts: string[] = [];
            if (r.safe) parts.push(`${r.safe} sain(s)`);
            if (r.dangerous) parts.push(`${r.dangerous} menace(s)`);
            if (r.failed) parts.push(`${r.failed} échec(s)`);
            Alert.alert(`${(r.safe ?? 0) + (r.dangerous ?? 0)} document(s) analysé(s)`, parts.join(" · ") || "Analyse terminée.");
          }
        }
      }
      load();
    } catch {
      Alert.alert("Analyse antivirus", "Erreur de connexion.");
    } finally {
      setBulkScanning(false);
      setBulkScanProgress(null);
    }
  }

  // Interroge le statut du scan en arriere-plan jusqu'a sa fin. Le travail lourd
  // tourne cote serveur : ici on ne fait qu'un sondage leger de la progression,
  // ce qui survit a une navigation/refresh (on se rebranche au montage).
  const pollBulkScan = useCallback((announceOnFinish: boolean) => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetchAuth(`${API_BASE}/api/documents/scan-unscanned/status`);
        if (!res.ok) { setBulkScanning(false); setBulkScanProgress(null); return; }
        const { job } = await res.json();
        if (job.status === "running") {
          setBulkScanning(true);
          setBulkScanProgress({ completed: job.scanned, total: Math.max(job.total, job.scanned) });
          if (!stopped) setTimeout(tick, 1500);
        } else {
          setBulkScanning(false);
          setBulkScanProgress(null);
          if (announceOnFinish && job.status === "completed") {
            Alert.alert(
              "Analyse terminée",
              job.dangerous > 0
                ? `${job.scanned} document(s) analysé(s). ${job.dangerous} menace(s) détectée(s).`
                : `${job.scanned} document(s) analysé(s). Aucune menace détectée.`,
            );
          } else if (announceOnFinish && job.status === "failed") {
            Alert.alert("Analyse antivirus", "L'analyse en lot a échoué. Réessayez.");
          }
          load();
        }
      } catch {
        setBulkScanning(false);
        setBulkScanProgress(null);
      }
    };
    tick();
    return () => { stopped = true; };
  }, [fetchAuth, load]);

  async function handleScanAll() {
    const total = data?.byScan?.unscanned ?? 0;
    if (total === 0 || bulkScanning) return;
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/scan-unscanned/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        Alert.alert("Analyse antivirus", "L'analyse en lot a échoué. Réessayez.");
        return;
      }
      const { job } = await res.json();
      setBulkScanning(true);
      setBulkScanProgress({ completed: job.scanned ?? 0, total: job.total || total });
      pollBulkScan(true);
    } catch {
      Alert.alert("Analyse antivirus", "Erreur de connexion.");
    }
  }

  // Security-status filter items
  const scanTotal = data?.byScan ? data.byScan.safe + data.byScan.dangerous + data.byScan.unscanned : undefined;
  const scanTabs: { key: string; label: string; icon: keyof typeof Feather.glyphMap; color: string; count?: number }[] = [
    { key: "all",       label: "Toute sécurité", icon: "shield",         color: "#0f766e", count: scanTotal },
    { key: "safe",      label: "Vérifié",        icon: "shield",         color: "#10b981", count: data?.byScan?.safe },
    { key: "dangerous", label: "Menace",         icon: "alert-triangle", color: "#ef4444", count: data?.byScan?.dangerous },
    { key: "none",      label: "Non analysé",    icon: "help-circle",    color: "#64748b", count: data?.byScan?.unscanned },
  ];

  // Source filter bar items
  const sourceTabs = [
    { key: "all", label: "Tous", icon: "folder" as const, color: "#0f766e", count: data?.documents.length ?? 0 },
    ...Object.entries(ENTITY_CFG).map(([key, cfg]) => ({
      key, label: cfg.label, icon: cfg.icon, color: cfg.color,
      count: data?.bySource.find(s => s.entity_type === key)?.count ?? 0,
    })).filter(s => s.count > 0),
  ];

  // Documents not yet security-scanned (currently loaded list)
  const unscannedIds = (data?.documents ?? []).filter(d => !d.scanVerdict).map(d => d.id);

  // Stats
  const totalDocs = data?.bySource.reduce((s, b) => s + b.count, 0) ?? 0;
  const aiDocs = data?.documents.filter(d => d.aiProcessed).length ?? 0;
  const readableDocs = data?.documents.filter(d => d.hasText || d.mimeType.startsWith("image/")).length ?? 0;

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[st.header, { backgroundColor: "#0f766e", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={st.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={st.headerTitle}>Documents</Text>
          <Pressable onPress={onRefresh} hitSlop={10}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        {/* Stats strip */}
        {!loading && data && (
          <View style={st.statsStrip}>
            {[
              { icon: "folder" as const,     label: "Total",     value: totalDocs,    color: "#fff"     },
              { icon: "book-open" as const,  label: "Lisibles",  value: readableDocs, color: "#86efac"  },
              { icon: "zap" as const,        label: "Analysés",  value: aiDocs,       color: "#c4b5fd"  },
              { icon: "layers" as const,     label: "Sources",   value: data.bySource.length, color: "#fde68a" },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <View style={st.statItem}>
                  <Text style={[st.statNum, { color: s.color }]}>{s.value}</Text>
                  <Text style={st.statLbl}>{s.label}</Text>
                </View>
                {i < arr.length - 1 && <View style={st.statDiv} />}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Search */}
        <View style={st.searchBox}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={st.searchInput}
            placeholder="Rechercher dans tous les documents..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Feather name="x" size={13} color="rgba(255,255,255,0.5)" /></Pressable> : null}
        </View>

        {/* Source filter — scrollable */}
        <FlatList
          data={sourceTabs}
          horizontal
          keyExtractor={s => s.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
          renderItem={({ item: s }) => (
            <Pressable onPress={() => setSourceFilter(s.key)}
              style={[st.sourceChip, { backgroundColor: sourceFilter === s.key ? s.color : "rgba(255,255,255,0.13)" }]}>
              <Feather name={s.icon} size={11} color={sourceFilter === s.key ? "#fff" : "rgba(255,255,255,0.75)"} />
              <Text style={[st.sourceChipText, { color: sourceFilter === s.key ? "#fff" : "rgba(255,255,255,0.75)" }]}>{s.label}</Text>
              {s.count > 0 && (
                <View style={[st.sourceBadge, { backgroundColor: sourceFilter === s.key ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.15)" }]}>
                  <Text style={st.sourceBadgeText}>{s.count}</Text>
                </View>
              )}
            </Pressable>
          )}
        />

        {/* Security-status filter — scrollable */}
        <FlatList
          data={scanTabs}
          horizontal
          keyExtractor={s => s.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
          renderItem={({ item: s }) => (
            <Pressable onPress={() => setScanFilter(s.key)}
              style={[st.sourceChip, { backgroundColor: scanFilter === s.key ? s.color : "rgba(255,255,255,0.13)" }]}>
              <Feather name={s.icon} size={11} color={scanFilter === s.key ? "#fff" : "rgba(255,255,255,0.75)"} />
              <Text style={[st.sourceChipText, { color: scanFilter === s.key ? "#fff" : "rgba(255,255,255,0.75)" }]}>{s.label}</Text>
              {typeof s.count === "number" && (
                <View style={[st.sourceBadge, { backgroundColor: scanFilter === s.key ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.15)" }]}>
                  <Text style={st.sourceBadgeText}>{s.count}</Text>
                </View>
              )}
            </Pressable>
          )}
        />

        {/* Bulk-scan all unscanned */}
        {!loading && (data?.byScan?.unscanned ?? 0) > 0 && (
          <Pressable
            onPress={handleScanAll}
            disabled={bulkScanning}
            style={[st.scanAllBtn, { opacity: bulkScanning ? 0.7 : 1 }]}
          >
            {bulkScanning ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="shield" size={13} color="#fff" />
            )}
            <Text style={st.scanAllText}>
              {bulkScanning
                ? (bulkScanProgress ? `Analyse ${bulkScanProgress.completed}/${bulkScanProgress.total}…` : "Analyse…")
                : `Tout analyser (${data?.byScan?.unscanned})`}
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Bulk scan banner (unanalysed documents) ── */}
      {!loading && unscannedIds.length > 0 && (
        <Pressable
          onPress={() => handleBulkScan(unscannedIds)}
          disabled={bulkScanning}
          style={[st.bulkBanner, { backgroundColor: colors.card, borderColor: "#10b98140" }]}>
          {bulkScanning
            ? <ActivityIndicator size="small" color="#10b981" />
            : <Feather name="shield" size={15} color="#10b981" />}
          <Text style={[st.bulkBannerText, { color: colors.text }]}>
            {bulkScanning
              ? (bulkScanProgress
                  ? `Analyse en cours… ${bulkScanProgress.completed}/${bulkScanProgress.total}`
                  : "Analyse en cours…")
              : `Analyser la sécurité de ${unscannedIds.length} document(s) non analysé(s)`}
          </Text>
        </Pressable>
      )}

      {/* ── Content ── */}
      {loading ? (
        <View style={st.center}>
          <ActivityIndicator size="large" color="#0f766e" />
        </View>
      ) : (
        <FlatList
          data={data?.documents ?? []}
          keyExtractor={d => d.id.toString()}
          contentContainerStyle={[st.listContent, { paddingBottom: isWeb ? 80 : 60 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0f766e" />}
          ListEmptyComponent={
            <EmptyState
              icon="folder"
              title="Aucun document"
              subtitle={search ? "Aucun document ne correspond à votre recherche." : "Aucun document uploadé pour le moment."}
            />
          }
          renderItem={({ item }) => (
            <DocCard doc={item} colors={colors} onDelete={handleDelete} onDownload={handleDownload} onRead={handleRead} onRescan={handleRescan} scanning={scanningIds.includes(item.id)} />
          )}
        />
      )}

      {/* ── Import FAB ── */}
      <Pressable onPress={() => router.push("/document-import" as any)}
        style={[st.fab, { backgroundColor: "#0f766e" }]}>
        <Feather name="upload" size={20} color="#fff" />
      </Pressable>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  statsStrip: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 17, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", marginTop: 1 },
  statDiv: { width: 1, height: 26, backgroundColor: "rgba(255,255,255,0.2)" },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 13, fontFamily: "Inter_400Regular" },
  sourceChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20 },
  sourceChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scanAllBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10, paddingVertical: 9, borderRadius: 10, backgroundColor: "#10b981" },
  scanAllText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sourceBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8 },
  sourceBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  bulkBanner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  bulkBannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 14, gap: 2 },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8 },
  cardHeader: { flexDirection: "row", gap: 10, marginBottom: 6, alignItems: "flex-start" },
  fileIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  catBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  catText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  sizeText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  aiBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  aiText: { fontSize: 9, fontFamily: "Inter_700Bold" },
  entityRow: { marginBottom: 4 },
  entityBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  entityText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  descText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginBottom: 6 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 8 },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  dateText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  footerActions: { flexDirection: "row", gap: 5 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  actionBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  fab: { position: "absolute", right: 16, bottom: 90, width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
});
