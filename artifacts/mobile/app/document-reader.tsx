import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

// ── Types ─────────────────────────────────────────────────────────────────────
type ReaderTab = "contenu" | "infos" | "analyse" | "actions";

interface DocPreview {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  entityType?: string | null;
  entityId?: number | null;
  category?: string;
  description?: string | null;
  tags?: string[] | null;
  aiProcessed: boolean;
  aiAnalysis?: Record<string, any> | null;
  extractedText?: string | null;
  extractedData?: Record<string, any> | null;
  imageBase64?: string | null;
  rawText?: string | null;
  status?: string;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 3000;

const MIME_LABELS: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  "application/pdf": { label: "PDF", color: "#ef4444", icon: "file-text" },
  "image/png": { label: "Image PNG", color: "#ec4899", icon: "image" },
  "image/jpeg": { label: "Image JPEG", color: "#ec4899", icon: "image" },
  "image/webp": { label: "Image WebP", color: "#ec4899", icon: "image" },
  "image/gif": { label: "Image GIF", color: "#ec4899", icon: "image" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word (.docx)", color: "#3b82f6", icon: "file-text" },
  "application/msword": { label: "Word (.doc)", color: "#3b82f6", icon: "file-text" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { label: "Excel (.xlsx)", color: "#22c55e", icon: "grid" },
  "application/vnd.ms-excel": { label: "Excel (.xls)", color: "#22c55e", icon: "grid" },
  "text/csv": { label: "CSV", color: "#22c55e", icon: "grid" },
  "text/plain": { label: "Texte", color: "#6366f1", icon: "file-text" },
  "application/json": { label: "JSON", color: "#f59e0b", icon: "code" },
  "application/zip": { label: "Archive ZIP", color: "#94a3b8", icon: "archive" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { label: "PowerPoint", color: "#f97316", icon: "monitor" },
};

const ENTITY_LABELS: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  contact: { label: "Contact", color: "#3b82f6", icon: "user" },
  prospect: { label: "Prospect", color: "#8b5cf6", icon: "user-plus" },
  project: { label: "Projet", color: "#f59e0b", icon: "folder" },
  task: { label: "Tâche", color: "#22c55e", icon: "check-square" },
  invoice: { label: "Facture", color: "#22c55e", icon: "file-text" },
  devis: { label: "Devis", color: "#0891b2", icon: "clipboard" },
  message: { label: "Message", color: "#6366f1", icon: "message-square" },
  stock: { label: "Stock", color: "#f97316", icon: "package" },
  event: { label: "Événement", color: "#ec4899", icon: "calendar" },
  general: { label: "Général", color: "#64748b", icon: "folder" },
};

const CATEGORY_COLORS: Record<string, string> = {
  general: "#6366f1", contrat: "#0891b2", facture: "#22c55e",
  rapport: "#f59e0b", cv: "#ec4899", correspondance: "#8b5cf6",
  technique: "#14b8a6", juridique: "#ef4444", comptabilite: "#f97316",
};

function getMimeInfo(mime: string) {
  return MIME_LABELS[mime] ?? { label: mime.split("/")[1]?.toUpperCase() ?? "Fichier", color: "#64748b", icon: "file" as const };
}

function formatSize(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} Mo`;
  return `${Math.ceil(bytes / 1024)} Ko`;
}

function splitIntoPages(text: string, size: number): string[] {
  if (!text) return [];
  const pages: string[] = [];
  let i = 0;
  while (i < text.length) {
    // Try to break at paragraph end
    let end = i + size;
    if (end < text.length) {
      const nlIdx = text.lastIndexOf("\n", end);
      if (nlIdx > i + size * 0.7) end = nlIdx + 1;
      const sentIdx = text.lastIndexOf(". ", end);
      if (sentIdx > i + size * 0.8) end = sentIdx + 2;
    }
    pages.push(text.slice(i, end));
    i = end;
  }
  return pages;
}

// ── Content Tab ───────────────────────────────────────────────────────────────
function ContentTab({ doc }: { doc: DocPreview }) {
  const colors = useColors();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const mimeInfo = getMimeInfo(doc.mimeType);
  const isImage = doc.mimeType.startsWith("image/");
  const isPdf = doc.mimeType === "application/pdf";
  const textContent = doc.rawText ?? doc.extractedText ?? null;
  const pages = textContent ? splitIntoPages(textContent, PAGE_SIZE) : [];
  const totalPages = pages.length;

  function goPrev() { setPage(p => Math.max(0, p - 1)); scrollRef.current?.scrollTo({ y: 0, animated: true }); }
  function goNext() { setPage(p => Math.min(totalPages - 1, p + 1)); scrollRef.current?.scrollTo({ y: 0, animated: true }); }

  const currentText = pages[page] ?? "";
  const highlightedText = search.trim()
    ? currentText.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `【${m}】`)
    : currentText;

  // ── Image ────────────────────────────────────────────────────────────────
  if (isImage && doc.imageBase64) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        <View style={[rd.imageCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Image source={{ uri: doc.imageBase64 }} style={rd.imagePreview} resizeMode="contain" />
        </View>
        {doc.extractedText && (
          <View style={[rd.textCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[rd.textCardTitle, { color: colors.foreground }]}>Texte extrait de l'image</Text>
            <Text style={[rd.textContent, { color: colors.foreground }]}>{doc.extractedText}</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── Text content ─────────────────────────────────────────────────────────
  if (textContent && pages.length > 0) {
    return (
      <View style={{ flex: 1, gap: 8 }}>
        {/* Search bar */}
        <View style={[rd.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={14} color={colors.mutedForeground} />
          <TextInput
            style={[rd.searchInput, { color: colors.foreground }]}
            placeholder="Rechercher dans le document..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Pressable onPress={() => setSearch("")}><Feather name="x" size={13} color={colors.mutedForeground} /></Pressable> : null}
        </View>

        {/* Page navigation */}
        {totalPages > 1 && (
          <View style={[rd.pageNav, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable onPress={goPrev} disabled={page === 0} style={[rd.pageBtn, { opacity: page === 0 ? 0.4 : 1 }]}>
              <Feather name="chevron-left" size={16} color={colors.foreground} />
              <Text style={[rd.pageBtnText, { color: colors.foreground }]}>Préc.</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[rd.pageNum, { color: colors.foreground }]}>Page {page + 1} / {totalPages}</Text>
              <Text style={[rd.pageChars, { color: colors.mutedForeground }]}>~{currentText.length} caractères</Text>
            </View>
            <Pressable onPress={goNext} disabled={page === totalPages - 1} style={[rd.pageBtn, { opacity: page === totalPages - 1 ? 0.4 : 1 }]}>
              <Text style={[rd.pageBtnText, { color: colors.foreground }]}>Suiv.</Text>
              <Feather name="chevron-right" size={16} color={colors.foreground} />
            </Pressable>
          </View>
        )}

        {/* Text */}
        <ScrollView ref={scrollRef} style={[rd.textScroll, { backgroundColor: colors.card, borderColor: colors.border }]}
          showsVerticalScrollIndicator={true} contentContainerStyle={{ padding: 14 }}>
          {search.trim() ? (
            // Highlight search results
            highlightedText.split("【").map((part, i) => {
              if (i === 0) return <Text key={i} style={[rd.textContent, { color: colors.foreground }]}>{part.replace(/】/g, "")}</Text>;
              const [match, rest] = part.split("】");
              return (
                <Text key={i} style={[rd.textContent, { color: colors.foreground }]}>
                  <Text style={[rd.highlight, { backgroundColor: "#fef08a", color: "#1e293b" }]}>{match}</Text>
                  {rest}
                </Text>
              );
            })
          ) : (
            <Text style={[rd.textContent, { color: colors.foreground }]} selectable>{currentText}</Text>
          )}
        </ScrollView>

        {/* Total chars info */}
        <Text style={[rd.totalChars, { color: colors.mutedForeground }]}>
          {textContent.length.toLocaleString("fr-FR")} caractères au total · {totalPages} page{totalPages > 1 ? "s" : ""}
        </Text>
      </View>
    );
  }

  // ── PDF / unsupported ─────────────────────────────────────────────────────
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      <View style={[rd.noPreviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[rd.bigIcon, { backgroundColor: mimeInfo.color + "15" }]}>
          <Feather name={mimeInfo.icon} size={40} color={mimeInfo.color} />
        </View>
        <Text style={[rd.noPreviewTitle, { color: colors.foreground }]}>{doc.fileName}</Text>
        <Text style={[rd.noPreviewSub, { color: colors.mutedForeground }]}>
          {isPdf
            ? "Les fichiers PDF s'ouvrent dans votre visionneuse externe."
            : "L'aperçu en ligne n'est pas disponible pour ce type de fichier."}
        </Text>
        <Text style={[rd.noPreviewType, { color: mimeInfo.color }]}>{mimeInfo.label} · {formatSize(doc.fileSize)}</Text>
      </View>
    </ScrollView>
  );
}

// ── Infos Tab ─────────────────────────────────────────────────────────────────
function InfosTab({ doc }: { doc: DocPreview }) {
  const colors = useColors();
  const mimeInfo = getMimeInfo(doc.mimeType);
  const entityInfo = doc.entityType ? (ENTITY_LABELS[doc.entityType] ?? ENTITY_LABELS.general) : null;
  const catColor = CATEGORY_COLORS[doc.category ?? "general"] ?? "#6366f1";

  const ROWS: { icon: keyof typeof Feather.glyphMap; label: string; value: string; color: string }[] = [
    { icon: "file", label: "Nom du fichier", value: doc.fileName, color: "#6366f1" },
    { icon: mimeInfo.icon, label: "Type de fichier", value: mimeInfo.label, color: mimeInfo.color },
    { icon: "database", label: "Taille", value: formatSize(doc.fileSize), color: "#3b82f6" },
    { icon: "tag", label: "Catégorie", value: doc.category ?? "Général", color: catColor },
    { icon: "calendar", label: "Uploadé le", value: new Date(doc.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }), color: "#64748b" },
    { icon: "activity", label: "Statut", value: doc.status ?? "actif", color: doc.status === "actif" ? "#22c55e" : "#f59e0b" },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {ROWS.map((row, i) => (
          <View key={i} style={[rd.infoRow, { borderTopColor: colors.border }]}>
            <View style={[rd.infoIcon, { backgroundColor: row.color + "15" }]}>
              <Feather name={row.icon} size={13} color={row.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[rd.infoLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
              <Text style={[rd.infoValue, { color: colors.foreground }]}>{row.value}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Entity link */}
      {entityInfo && (
        <View style={[rd.infoCard, { backgroundColor: entityInfo.color + "08", borderColor: entityInfo.color + "30" }]}>
          <View style={[rd.infoRow, { borderTopColor: "transparent" }]}>
            <View style={[rd.infoIcon, { backgroundColor: entityInfo.color + "20" }]}>
              <Feather name={entityInfo.icon} size={13} color={entityInfo.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[rd.infoLabel, { color: colors.mutedForeground }]}>Lié à</Text>
              <Text style={[rd.infoValue, { color: entityInfo.color }]}>{entityInfo.label} #{doc.entityId}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Description */}
      {doc.description && (
        <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[rd.infoLabel, { color: colors.mutedForeground }]}>Description</Text>
          <Text style={[rd.infoValue, { color: colors.foreground, marginTop: 4 }]}>{doc.description}</Text>
        </View>
      )}

      {/* Tags */}
      {doc.tags && doc.tags.length > 0 && (
        <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[rd.infoLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>Étiquettes</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {doc.tags.map((tag, i) => (
              <View key={i} style={[rd.tagPill, { backgroundColor: "#6366f115" }]}>
                <Text style={[rd.tagText, { color: "#6366f1" }]}>#{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Extracted structured data */}
      {doc.extractedData && Object.keys(doc.extractedData).length > 0 && (
        <View style={[rd.infoCard, { backgroundColor: "#f59e0b08", borderColor: "#f59e0b30" }]}>
          <Text style={[rd.infoLabel, { color: "#f59e0b", marginBottom: 8 }]}>Données structurées extraites</Text>
          {Object.entries(doc.extractedData).slice(0, 20).map(([k, v]) => (
            <View key={k} style={[rd.infoRow, { borderTopColor: "#f59e0b15" }]}>
              <Text style={[rd.infoLabel, { color: colors.mutedForeground, flex: 1 }]}>{k}</Text>
              <Text style={[rd.infoValue, { color: colors.foreground }]} numberOfLines={2}>{String(v)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ── Analyse IA Tab ────────────────────────────────────────────────────────────
function AnalyseTab({ doc, onAnalyze, analyzing }: { doc: DocPreview; onAnalyze: () => void; analyzing: boolean }) {
  const colors = useColors();
  const ai = doc.aiAnalysis;

  if (!doc.aiProcessed && !ai) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        <View style={[rd.infoCard, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
          <View style={{ alignItems: "center", gap: 12, padding: 20 }}>
            <View style={[rd.bigIcon, { backgroundColor: "#8b5cf615" }]}>
              <Feather name="zap" size={32} color="#8b5cf6" />
            </View>
            <Text style={[rd.noPreviewTitle, { color: colors.foreground }]}>Analyse IA non effectuée</Text>
            <Text style={[rd.noPreviewSub, { color: colors.mutedForeground }]}>
              L'IA peut analyser ce document pour en extraire les points clés, les données importantes et générer un résumé automatique.
            </Text>
            <Pressable onPress={onAnalyze} disabled={analyzing} style={[rd.analyzeBtn, { backgroundColor: "#8b5cf6", opacity: analyzing ? 0.6 : 1 }]}>
              {analyzing ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="zap" size={14} color="#fff" />}
              <Text style={rd.analyzeBtnText}>{analyzing ? "Analyse en cours..." : "Analyser avec l'IA"}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      {/* Summary */}
      {ai?.summary && (
        <View style={[rd.infoCard, { backgroundColor: "#8b5cf608", borderColor: "#8b5cf630" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <View style={[rd.smallIcon, { backgroundColor: "#8b5cf618" }]}>
              <Feather name="zap" size={12} color="#8b5cf6" />
            </View>
            <Text style={[rd.cardTitle, { color: colors.foreground }]}>Résumé IA</Text>
          </View>
          <Text style={[rd.aiText, { color: colors.foreground }]}>{ai.summary}</Text>
        </View>
      )}

      {/* Document type */}
      {ai?.documentType && (
        <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Feather name="tag" size={14} color="#6366f1" />
            <Text style={[rd.infoLabel, { color: colors.mutedForeground }]}>Type détecté</Text>
            <View style={[rd.tagPill, { backgroundColor: "#6366f115", marginLeft: "auto" }]}>
              <Text style={[rd.tagText, { color: "#6366f1" }]}>{String(ai.documentType).replace(/_/g, " ")}</Text>
            </View>
          </View>
          {ai.confidence !== undefined && (
            <Text style={[rd.infoLabel, { color: colors.mutedForeground, marginTop: 6 }]}>
              Confiance: {Math.round(Number(ai.confidence) * 100)}%
            </Text>
          )}
        </View>
      )}

      {/* Key points */}
      {ai?.keyPoints && Array.isArray(ai.keyPoints) && ai.keyPoints.length > 0 && (
        <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[rd.cardTitle, { color: colors.foreground, marginBottom: 8 }]}>Points clés</Text>
          {ai.keyPoints.map((pt: string, i: number) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <View style={[rd.numBadge, { backgroundColor: "#6366f115" }]}>
                <Text style={[{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#6366f1" }]}>{i + 1}</Text>
              </View>
              <Text style={[rd.aiText, { color: colors.foreground, flex: 1 }]}>{pt}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Warnings / alerts */}
      {ai?.warnings && Array.isArray(ai.warnings) && ai.warnings.length > 0 && (
        <View style={[rd.infoCard, { backgroundColor: "#f59e0b08", borderColor: "#f59e0b30" }]}>
          <Text style={[rd.cardTitle, { color: "#f59e0b", marginBottom: 8 }]}>Alertes</Text>
          {ai.warnings.map((w: string, i: number) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <Feather name="alert-triangle" size={12} color="#f59e0b" style={{ marginTop: 2 }} />
              <Text style={[rd.aiText, { color: colors.foreground, flex: 1 }]}>{w}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Suggested actions */}
      {ai?.suggestedActions && Array.isArray(ai.suggestedActions) && ai.suggestedActions.length > 0 && (
        <View style={[rd.infoCard, { backgroundColor: "#22c55e08", borderColor: "#22c55e30" }]}>
          <Text style={[rd.cardTitle, { color: colors.foreground, marginBottom: 8 }]}>Actions suggérées</Text>
          {ai.suggestedActions.map((a: any, i: number) => {
            const prioColors: Record<string, string> = { haute: "#ef4444", moyenne: "#f59e0b", basse: "#22c55e" };
            const col = prioColors[a.priority] ?? "#64748b";
            return (
              <View key={i} style={[rd.actionRow, { backgroundColor: col + "08", borderColor: col + "20" }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[rd.actionLabel, { color: colors.foreground }]}>{a.label ?? a.action}</Text>
                  {a.description && <Text style={[rd.actionDesc, { color: colors.mutedForeground }]}>{a.description}</Text>}
                </View>
                <View style={[rd.tagPill, { backgroundColor: col + "18" }]}>
                  <Text style={[rd.tagText, { color: col }]}>{a.priority}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Raw AI JSON fallback */}
      {ai && !ai.summary && !ai.keyPoints && !ai.documentType && (
        <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[rd.cardTitle, { color: colors.foreground, marginBottom: 8 }]}>Résultats de l'analyse</Text>
          <Text style={[rd.aiText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
            {JSON.stringify(ai, null, 2).slice(0, 3000)}
          </Text>
        </View>
      )}

      {/* Re-analyze button */}
      <Pressable onPress={onAnalyze} disabled={analyzing} style={[rd.analyzeBtn, { backgroundColor: analyzing ? "#8b5cf660" : "#8b5cf6" }]}>
        {analyzing ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="refresh-cw" size={13} color="#fff" />}
        <Text style={rd.analyzeBtnText}>{analyzing ? "Analyse en cours..." : "Réanalyser"}</Text>
      </Pressable>
    </ScrollView>
  );
}

// ── Actions Tab ───────────────────────────────────────────────────────────────
function ActionsTab({ doc, onDownload, onDelete }: { doc: DocPreview; onDownload: () => void; onDelete: () => void }) {
  const colors = useColors();
  const mimeInfo = getMimeInfo(doc.mimeType);

  const ACTIONS = [
    { icon: "download" as const, label: "Télécharger", sub: `Enregistrer le fichier (${formatSize(doc.fileSize)})`, color: "#3b82f6", onPress: onDownload },
    { icon: "external-link" as const, label: "Ouvrir dans le navigateur", sub: "Afficher dans votre visionneuse externe", color: "#6366f1", onPress: () => {
      const url = `${API_BASE}/api/documents/${doc.id}/download`;
      Linking.openURL(url).catch(() => {});
    }},
    { icon: "share-2" as const, label: "Partager l'URL", sub: "Copier le lien de téléchargement", color: "#22c55e", onPress: () => {
      const url = `${API_BASE}/api/documents/${doc.id}/download`;
      Linking.openURL(url).catch(() => {});
    }},
    { icon: "trash-2" as const, label: "Supprimer le document", sub: "Cette action est irréversible", color: "#ef4444", onPress: onDelete },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      {/* File preview card */}
      <View style={[rd.infoCard, { backgroundColor: mimeInfo.color + "08", borderColor: mimeInfo.color + "30" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[rd.bigIcon, { backgroundColor: mimeInfo.color + "18", width: 56, height: 56, borderRadius: 14 }]}>
            <Feather name={mimeInfo.icon} size={24} color={mimeInfo.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[rd.cardTitle, { color: colors.foreground }]} numberOfLines={2}>{doc.fileName}</Text>
            <Text style={[rd.infoLabel, { color: mimeInfo.color }]}>{mimeInfo.label} · {formatSize(doc.fileSize)}</Text>
          </View>
        </View>
      </View>

      {ACTIONS.map((a, i) => (
        <Pressable key={i} onPress={a.onPress} style={[rd.actionCard, { backgroundColor: a.color === "#ef4444" ? "#ef444408" : colors.card, borderColor: a.color === "#ef4444" ? "#ef444430" : colors.border }]}>
          <View style={[rd.infoIcon, { backgroundColor: a.color + "15" }]}>
            <Feather name={a.icon} size={16} color={a.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[rd.actionLabel, { color: a.color === "#ef4444" ? "#ef4444" : colors.foreground }]}>{a.label}</Text>
            <Text style={[rd.actionDesc, { color: colors.mutedForeground }]}>{a.sub}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────
const TABS: { key: ReaderTab; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "contenu",  label: "Contenu",  icon: "file-text",  color: "#0f766e" },
  { key: "infos",    label: "Infos",    icon: "info",        color: "#0f4c81" },
  { key: "analyse",  label: "IA",       icon: "zap",         color: "#8b5cf6" },
  { key: "actions",  label: "Actions",  icon: "settings",    color: "#64748b" },
];

export default function DocumentReaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const { id } = useLocalSearchParams<{ id: string }>();

  const [doc, setDoc] = useState<DocPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ReaderTab>("contenu");
  const [analyzing, setAnalyzing] = useState(false);

  const loadDoc = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${id}/preview`);
      if (res.ok) setDoc(await res.json());
    } catch {}
    finally { setLoading(false); }
  }, [fetchAuth, id]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

  async function handleAnalyze() {
    if (!doc) return;
    setAnalyzing(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${doc.id}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (res.ok) await loadDoc();
    } catch {}
    finally { setAnalyzing(false); }
  }

  async function handleDownload() {
    if (!doc) return;
    const url = `${API_BASE}/api/documents/${doc.id}/download`;
    try {
      if (Platform.OS === "web") window.open(url, "_blank");
      else await Linking.openURL(url);
    } catch {}
  }

  async function handleDelete() {
    if (!doc) return;
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${doc.id}`, { method: "DELETE" });
      if (res.ok) router.back();
    } catch {}
  }

  const mimeInfo = doc ? getMimeInfo(doc.mimeType) : null;
  const activeTab = TABS.find(t => t.key === tab)!;

  return (
    <View style={[rd.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[rd.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={rd.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={rd.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, overflow: "hidden" }}>
            <Text style={rd.headerTitle} numberOfLines={1}>{doc?.fileName ?? "Chargement..."}</Text>
            {mimeInfo && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                <View style={[rd.mimeChip, { backgroundColor: mimeInfo.color + "30" }]}>
                  <Feather name={mimeInfo.icon} size={10} color="#fff" />
                  <Text style={rd.mimeChipText}>{mimeInfo.label}</Text>
                </View>
                {doc?.aiProcessed && (
                  <View style={[rd.aiBadge]}>
                    <Feather name="zap" size={9} color="#c4b5fd" />
                    <Text style={rd.aiChipText}>Analysé IA</Text>
                  </View>
                )}
                {doc && (
                  <Text style={rd.headerSub}>{formatSize(doc.fileSize)}</Text>
                )}
              </View>
            )}
          </View>
          <Pressable onPress={handleDownload} hitSlop={10} style={[rd.dlBtn]}>
            <Feather name="download" size={18} color="#fff" />
          </Pressable>
        </View>

        {/* Tab bar */}
        <View style={rd.tabBar}>
          {TABS.map(t => (
            <Pressable key={t.key} onPress={() => setTab(t.key)}
              style={[rd.tabItem, { backgroundColor: tab === t.key ? "#fff" : "rgba(255,255,255,0.12)" }]}>
              <Feather name={t.icon} size={12} color={tab === t.key ? t.color : "rgba(255,255,255,0.8)"} />
              <Text style={[rd.tabText, { color: tab === t.key ? t.color : "rgba(255,255,255,0.8)" }]}>{t.label}</Text>
              {t.key === "analyse" && doc?.aiProcessed && (
                <View style={rd.tabDot} />
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={rd.center}>
          <ActivityIndicator size="large" color="#0f766e" />
          <Text style={[{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 10 }]}>Chargement du document...</Text>
        </View>
      ) : !doc ? (
        <View style={rd.center}>
          <Feather name="file" size={40} color={colors.mutedForeground} />
          <Text style={[{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginTop: 10 }]}>Document introuvable</Text>
        </View>
      ) : (
        <View style={[rd.body, { paddingBottom: isWeb ? 120 : 48 }]}>
          {tab === "contenu"  && <ContentTab doc={doc} />}
          {tab === "infos"    && <InfosTab doc={doc} />}
          {tab === "analyse"  && <AnalyseTab doc={doc} onAnalyze={handleAnalyze} analyzing={analyzing} />}
          {tab === "actions"  && <ActionsTab doc={doc} onDownload={handleDownload} onDelete={handleDelete} />}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const rd = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#0f766e", paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  backBtn: { padding: 4, marginTop: 2 },
  dlBtn: { padding: 4, marginTop: 2 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 22 },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  mimeChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  mimeChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff" },
  aiBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: "#7c3aed30" },
  aiChipText: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#c4b5fd" },
  tabBar: { flexDirection: "row", gap: 6, marginTop: 12 },
  tabItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, borderRadius: 20 },
  tabText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#8b5cf6" },
  body: { flex: 1, padding: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Content tab
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  pageNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10, borderRadius: 10, borderWidth: 1 },
  pageBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  pageBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pageNum: { fontSize: 14, fontFamily: "Inter_700Bold" },
  pageChars: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  textScroll: { flex: 1, borderRadius: 10, borderWidth: 1, maxHeight: 520 },
  textContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  highlight: { borderRadius: 2 },
  totalChars: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  imageCard: { borderRadius: 14, borderWidth: 1, padding: 8, alignItems: "center" },
  imagePreview: { width: "100%", height: 400, borderRadius: 8 },
  textCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  textCardTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  noPreviewCard: { borderRadius: 14, borderWidth: 1, padding: 28, alignItems: "center", gap: 10 },
  bigIcon: { width: 80, height: 80, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  noPreviewTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  noPreviewSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  noPreviewType: { fontSize: 12, fontFamily: "Inter_700Bold" },
  // Infos tab
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 2 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  infoIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  infoLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1, lineHeight: 18 },
  tagPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tagText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  // AI tab
  smallIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  aiText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  numBadge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 4 },
  actionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actionDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  analyzeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 13, borderRadius: 10, marginTop: 4 },
  analyzeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  // Actions tab
  actionCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
});
