import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getDocument, type DocumentDetail } from "@workspace/api-client-react";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTranslation, type TFunction } from "@/lib/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────
type ReaderTab = "contenu" | "infos" | "analyse" | "actions";
type AIModel = "gemini" | "openai" | "claude";

interface ModelAnalysis {
  model: string;
  provider: AIModel;
  summary: string;
  keyPoints: string[];
  insights: string;
  recommendations: string[];
  risks: string[];
  sentiment: "positif" | "neutre" | "negatif";
  urgency: "haute" | "moyenne" | "basse";
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

interface MultiModelResult {
  gemini?: ModelAnalysis;
  openai?: ModelAnalysis;
  claude?: ModelAnalysis;
  consensus: { summary: string; topKeyPoints: string[]; agreementScore: number };
  analyzedAt: string;
}

interface QAAnswer { model: string; provider: string; answer: string; tokensUsed?: number; durationMs?: number; error?: string; }
interface ChatMessage { role: "user" | "assistant"; content: string; answers?: QAAnswer[]; timestamp: string; }

type DocPreview = DocumentDetail;

// ── Constants ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 3000;

const MODEL_CFG = {
  gemini: { name: "Gemini 2.5 Flash", color: "#1a73e8", bg: "#1a73e815", icon: "zap"     as const, short: "Gemini" },
  openai: { name: "GPT-4o",           color: "#10a37f", bg: "#10a37f15", icon: "cpu"      as const, short: "GPT-4o" },
  claude: { name: "Claude Sonnet",    color: "#d97706", bg: "#d9770615", icon: "feather"  as const, short: "Claude" },
} as const;

const SENTIMENT_CFG = {
  positif: { labelKey: "sentimentPositif", color: "#22c55e", icon: "thumbs-up"   as const },
  neutre:  { labelKey: "sentimentNeutre",  color: "#6366f1", icon: "minus"       as const },
  negatif: { labelKey: "sentimentNegatif", color: "#ef4444", icon: "thumbs-down" as const },
};

const URGENCY_CFG = {
  haute:   { labelKey: "urgencyHaute",   color: "#ef4444" },
  moyenne: { labelKey: "urgencyMoyenne", color: "#f59e0b" },
  basse:   { labelKey: "urgencyBasse",   color: "#22c55e" },
};

const MIME_LABELS: Record<string, { labelKey: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  "application/pdf": { labelKey: "pdf", color: "#ef4444", icon: "file-text" },
  "image/png": { labelKey: "imagePng", color: "#ec4899", icon: "image" },
  "image/jpeg": { labelKey: "imageJpeg", color: "#ec4899", icon: "image" },
  "image/webp": { labelKey: "imageWebp", color: "#ec4899", icon: "image" },
  "image/gif": { labelKey: "imageGif", color: "#ec4899", icon: "image" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { labelKey: "wordDocx", color: "#3b82f6", icon: "file-text" },
  "application/msword": { labelKey: "wordDoc", color: "#3b82f6", icon: "file-text" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { labelKey: "excelXlsx", color: "#22c55e", icon: "grid" },
  "application/vnd.ms-excel": { labelKey: "excelXls", color: "#22c55e", icon: "grid" },
  "text/csv": { labelKey: "csv", color: "#22c55e", icon: "grid" },
  "text/plain": { labelKey: "texte", color: "#6366f1", icon: "file-text" },
  "application/json": { labelKey: "json", color: "#f59e0b", icon: "code" },
  "application/zip": { labelKey: "zip", color: "#94a3b8", icon: "archive" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { labelKey: "powerpoint", color: "#f97316", icon: "monitor" },
};

const ENTITY_LABELS: Record<string, { labelKey: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  contact: { labelKey: "contact", color: "#3b82f6", icon: "user" },
  prospect: { labelKey: "prospect", color: "#8b5cf6", icon: "user-plus" },
  project: { labelKey: "project", color: "#f59e0b", icon: "folder" },
  task: { labelKey: "task", color: "#22c55e", icon: "check-square" },
  invoice: { labelKey: "invoice", color: "#22c55e", icon: "file-text" },
  devis: { labelKey: "devis", color: "#0891b2", icon: "clipboard" },
  message: { labelKey: "message", color: "#6366f1", icon: "message-square" },
  stock: { labelKey: "stock", color: "#f97316", icon: "package" },
  event: { labelKey: "event", color: "#ec4899", icon: "calendar" },
  general: { labelKey: "general", color: "#64748b", icon: "folder" },
};

const CATEGORY_COLORS: Record<string, string> = {
  general: "#6366f1", contrat: "#0891b2", facture: "#22c55e",
  rapport: "#f59e0b", cv: "#ec4899", correspondance: "#8b5cf6",
  technique: "#14b8a6", juridique: "#ef4444", comptabilite: "#f97316",
};

const QUICK_QUESTION_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

type MimeInfo = { labelKey?: string; rawLabel?: string; color: string; icon: keyof typeof Feather.glyphMap };

function getMimeInfo(mime: string): MimeInfo {
  const found = MIME_LABELS[mime];
  if (found) return found;
  const ext = mime.split("/")[1]?.toUpperCase();
  return { labelKey: ext ? undefined : "fichier", rawLabel: ext, color: "#64748b", icon: "file" };
}
function mimeLabel(info: MimeInfo, t: TFunction): string {
  return info.labelKey ? t(`documentReaderScreen.mimeLabels.${info.labelKey}`) : (info.rawLabel ?? "");
}
function entityLabel(info: { labelKey: string }, t: TFunction): string {
  return t(`documentReaderScreen.entityLabels.${info.labelKey}`);
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
    let end = i + size;
    if (end < text.length) {
      const nlIdx = text.lastIndexOf("\n", end);
      if (nlIdx > i + size * 0.7) end = nlIdx + 1;
    }
    pages.push(text.slice(i, end));
    i = end;
  }
  return pages;
}

// ── Content Tab ───────────────────────────────────────────────────────────────
function ContentTab({ doc }: { doc: DocPreview }) {
  const colors = useColors();
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const mimeInfo = getMimeInfo(doc.mimeType);
  const isImage = doc.mimeType.startsWith("image/");
  const textContent = doc.rawText ?? doc.extractedText ?? null;
  const pages = textContent ? splitIntoPages(textContent, PAGE_SIZE) : [];

  function goPrev() { setPage(p => Math.max(0, p - 1)); scrollRef.current?.scrollTo({ y: 0, animated: true }); }
  function goNext() { setPage(p => Math.min(pages.length - 1, p + 1)); scrollRef.current?.scrollTo({ y: 0, animated: true }); }

  if (isImage && doc.imageBase64) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        <View style={[rd.imageCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Image source={{ uri: doc.imageBase64 }} style={rd.imagePreview} resizeMode="contain" />
        </View>
        {doc.extractedText && (
          <View style={[rd.textCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[rd.sectionTitle, { color: colors.foreground }]}>{t("documentReaderScreen.extractedText")}</Text>
            <Text style={[rd.textContent, { color: colors.foreground }]}>{doc.extractedText}</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  if (textContent && pages.length > 0) {
    const currentText = pages[page] ?? "";
    return (
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[rd.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={14} color={colors.mutedForeground} />
          <TextInput accessibilityLabel={t("documentReaderScreen.searchPlaceholder")} style={[rd.searchInput, { color: colors.foreground }]} placeholder={t("documentReaderScreen.searchPlaceholder")} placeholderTextColor={colors.mutedForeground} value={search} onChangeText={setSearch} />
          {search ? <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} onPress={() => setSearch("")}><Feather name="x" size={13} color={colors.mutedForeground} /></Pressable> : null}
        </View>
        {pages.length > 1 && (
          <View style={[rd.pageNav, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable accessibilityRole="button" onPress={goPrev} disabled={page === 0} style={[rd.pageBtn, { opacity: page === 0 ? 0.4 : 1 }]}>
              <Feather name="chevron-left" size={16} color={colors.foreground} />
              <Text style={[rd.pageBtnText, { color: colors.foreground }]}>{t("documentReaderScreen.prev")}</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[rd.pageNum, { color: colors.foreground }]}>{t("documentReaderScreen.pageOf", { current: page + 1, total: pages.length })}</Text>
              <Text style={[rd.pageChars, { color: colors.mutedForeground }]}>{t("documentReaderScreen.charsApprox", { count: currentText.length })}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={goNext} disabled={page === pages.length - 1} style={[rd.pageBtn, { opacity: page === pages.length - 1 ? 0.4 : 1 }]}>
              <Text style={[rd.pageBtnText, { color: colors.foreground }]}>{t("documentReaderScreen.next")}</Text>
              <Feather name="chevron-right" size={16} color={colors.foreground} />
            </Pressable>
          </View>
        )}
        <ScrollView ref={scrollRef} style={[rd.textScroll, { backgroundColor: colors.card, borderColor: colors.border }]} contentContainerStyle={{ padding: 14 }}>
          <Text style={[rd.textContent, { color: colors.foreground }]} selectable>
            {search.trim()
              ? currentText.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `【${m}】`)
              : currentText}
          </Text>
        </ScrollView>
        <Text style={[rd.totalChars, { color: colors.mutedForeground }]}>{t(pages.length > 1 ? "documentReaderScreen.totalCharsMany" : "documentReaderScreen.totalCharsOne", { chars: textContent.length.toLocaleString("fr-FR"), count: pages.length })}</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      <View style={[rd.noPreviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[rd.bigIcon, { backgroundColor: mimeInfo.color + "15" }]}>
          <Feather name={mimeInfo.icon} size={40} color={mimeInfo.color} />
        </View>
        <Text style={[rd.sectionTitle, { color: colors.foreground, textAlign: "center" }]}>{doc.fileName}</Text>
        <Text style={[rd.mutedText, { textAlign: "center", color: colors.mutedForeground }]}>
          {doc.mimeType === "application/pdf" ? t("documentReaderScreen.pdfExternalViewer") : t("documentReaderScreen.previewUnavailable")}
        </Text>
        <Text style={[{ fontSize: 12, fontFamily: "Inter_700Bold", color: mimeInfo.color }]}>{mimeLabel(mimeInfo, t)} · {formatSize(doc.fileSize)}</Text>
      </View>
    </ScrollView>
  );
}

// ── Infos Tab ─────────────────────────────────────────────────────────────────
function InfosTab({ doc, docId, onReloadDoc }: { doc: DocPreview; docId: number; onReloadDoc: () => void }) {
  const colors = useColors();
  const { t } = useTranslation();
  const { fetchAuth } = useAuth();
  const mimeInfo = getMimeInfo(doc.mimeType);
  const entityInfo = doc.entityType ? (ENTITY_LABELS[doc.entityType] ?? ENTITY_LABELS.general) : null;
  const catColor = CATEGORY_COLORS[doc.category ?? "general"] ?? "#6366f1";

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  async function handleRescan() {
    if (scanning) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${docId}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) onReloadDoc();
      else setScanError(t("documentReaderScreen.scanFailed"));
    } catch {
      setScanError(t("documentReaderScreen.connectionError"));
    } finally {
      setScanning(false);
    }
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { icon: "file" as const,      label: t("documentReaderScreen.fieldName"),      value: doc.fileName,                                    color: "#6366f1" },
          { icon: mimeInfo.icon,        label: t("documentReaderScreen.fieldType"),      value: mimeLabel(mimeInfo, t),                          color: mimeInfo.color },
          { icon: "database" as const,  label: t("documentReaderScreen.fieldSize"),      value: formatSize(doc.fileSize),                        color: "#3b82f6" },
          { icon: "tag" as const,       label: t("documentReaderScreen.fieldCategory"),  value: doc.category ?? t("documentReaderScreen.categoryGeneral"), color: catColor },
          { icon: "calendar" as const,  label: t("documentReaderScreen.fieldDate"),      value: new Date(doc.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }), color: "#64748b" },
          { icon: "activity" as const,  label: t("documentReaderScreen.fieldStatus"),    value: doc.status ?? t("documentReaderScreen.statusActif"), color: doc.status === "actif" ? "#22c55e" : "#f59e0b" },
        ].map((row, i) => (
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

      {entityInfo && (
        <View style={[rd.infoCard, { backgroundColor: entityInfo.color + "08", borderColor: entityInfo.color + "30" }]}>
          <View style={[rd.infoRow, { borderTopColor: "transparent" }]}>
            <View style={[rd.infoIcon, { backgroundColor: entityInfo.color + "20" }]}>
              <Feather name={entityInfo.icon} size={13} color={entityInfo.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[rd.infoLabel, { color: colors.mutedForeground }]}>{t("documentReaderScreen.linkedTo")}</Text>
              <Text style={[rd.infoValue, { color: entityInfo.color }]}>{entityLabel(entityInfo, t)} #{doc.entityId}</Text>
            </View>
          </View>
        </View>
      )}

      {(() => {
        const hasVerdict = !!doc.scanVerdict;
        const safe = doc.scanVerdict === "safe";
        const accent = !hasVerdict ? "#64748b" : safe ? "#10b981" : "#ef4444";
        return (
          <View style={[rd.infoCard, { backgroundColor: accent + "08", borderColor: accent + "30" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Feather name={!hasVerdict ? "shield-off" : safe ? "shield" : "alert-triangle"} size={14} color={accent} />
              <Text style={[rd.sectionTitle, { color: accent }]}>{t("documentReaderScreen.antivirusAnalysis")}</Text>
            </View>
            <View style={[rd.infoRow, { borderTopColor: accent + "15" }]}>
              <Text style={[rd.infoLabel, { color: colors.mutedForeground, flex: 1 }]}>{t("documentReaderScreen.verdict")}</Text>
              <Text style={[rd.infoValue, { color: accent }]}>{!hasVerdict ? t("documentReaderScreen.notScanned") : safe ? t("documentReaderScreen.clean") : t("documentReaderScreen.threatDetected")}</Text>
            </View>
            {hasVerdict && doc.scanEngine && (
              <View style={[rd.infoRow, { borderTopColor: accent + "15" }]}>
                <Text style={[rd.infoLabel, { color: colors.mutedForeground, flex: 1 }]}>{t("documentReaderScreen.engine")}</Text>
                <Text style={[rd.infoValue, { color: colors.foreground }]}>{doc.scanEngine}</Text>
              </View>
            )}
            {hasVerdict && doc.scannedAt && (
              <View style={[rd.infoRow, { borderTopColor: accent + "15" }]}>
                <Text style={[rd.infoLabel, { color: colors.mutedForeground, flex: 1 }]}>{t("documentReaderScreen.scannedOn")}</Text>
                <Text style={[rd.infoValue, { color: colors.foreground }]}>{new Date(doc.scannedAt).toLocaleString("fr-FR")}</Text>
              </View>
            )}
            {hasVerdict && doc.scanDetail && (
              <Text style={[rd.infoLabel, { color: colors.mutedForeground, marginTop: 8 }]}>{doc.scanDetail}</Text>
            )}
            {!hasVerdict && (
              <Text style={[rd.infoLabel, { color: colors.mutedForeground, marginTop: 8, lineHeight: 16 }]}>
                {t("documentReaderScreen.notScannedHint")}
              </Text>
            )}
            <Pressable accessibilityRole="button" onPress={handleRescan} disabled={scanning}
              style={[rd.outlineBtn, { borderColor: accent + "40", marginTop: 12 }]}>
              {scanning ? <ActivityIndicator size="small" color={accent} /> : <Feather name="refresh-cw" size={13} color={accent} />}
              <Text style={[rd.outlineBtnText, { color: accent }]}>
                {scanning ? t("documentReaderScreen.scanningInProgress") : hasVerdict ? t("documentReaderScreen.rescan") : t("documentReaderScreen.scanNow")}
              </Text>
            </Pressable>
            {scanError && (
              <Text style={[rd.infoLabel, { color: "#ef4444", marginTop: 8, textAlign: "center" }]}>{scanError}</Text>
            )}
          </View>
        );
      })()}

      {doc.description && (
        <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[rd.infoLabel, { color: colors.mutedForeground }]}>{t("documentReaderScreen.description")}</Text>
          <Text style={[rd.infoValue, { color: colors.foreground, marginTop: 4 }]}>{doc.description}</Text>
        </View>
      )}

      {doc.tags && doc.tags.length > 0 && (
        <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[rd.infoLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>{t("documentReaderScreen.tags")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {doc.tags.map((tag, i) => (
              <View key={i} style={[rd.tagPill, { backgroundColor: "#6366f115" }]}>
                <Text style={[{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6366f1" }]}>#{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {doc.extractedData && Object.keys(doc.extractedData).length > 0 && (
        <View style={[rd.infoCard, { backgroundColor: "#f59e0b08", borderColor: "#f59e0b30" }]}>
          <Text style={[rd.sectionTitle, { color: "#f59e0b", marginBottom: 8 }]}>{t("documentReaderScreen.extractedData")}</Text>
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

// ── Model Card ────────────────────────────────────────────────────────────────
function ModelCard({ analysis, provider }: { analysis?: ModelAnalysis; provider: AIModel }) {
  const colors = useColors();
  const { t } = useTranslation();
  const cfg = MODEL_CFG[provider];
  const [expanded, setExpanded] = useState(true);

  if (!analysis) return null;

  const sentCfg = SENTIMENT_CFG[analysis.sentiment] ?? SENTIMENT_CFG.neutre;
  const urgCfg = URGENCY_CFG[analysis.urgency] ?? URGENCY_CFG.basse;

  if (analysis.error) {
    return (
      <View style={[rd.modelCard, { backgroundColor: "#ef444408", borderColor: "#ef444430" }]}>
        <View style={rd.modelCardHeader}>
          <View style={[rd.modelIcon, { backgroundColor: cfg.color + "20" }]}>
            <Feather name={cfg.icon} size={14} color={cfg.color} />
          </View>
          <Text style={[rd.modelName, { color: colors.foreground }]}>{cfg.name}</Text>
          <View style={[rd.tagPill, { backgroundColor: "#ef444415" }]}>
            <Text style={[{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#ef4444" }]}>{t("documentReaderScreen.error")}</Text>
          </View>
        </View>
        <Text style={[rd.mutedText, { color: "#ef4444", marginTop: 4 }]}>{analysis.error}</Text>
      </View>
    );
  }

  return (
    <View style={[rd.modelCard, { backgroundColor: cfg.bg, borderColor: cfg.color + "30" }]}>
      <Pressable accessibilityRole="button" onPress={() => setExpanded(e => !e)} style={rd.modelCardHeader}>
        <View style={[rd.modelIcon, { backgroundColor: cfg.color + "20" }]}>
          <Feather name={cfg.icon} size={14} color={cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[rd.modelName, { color: colors.foreground }]}>{cfg.name}</Text>
          {analysis.durationMs && (
            <Text style={[rd.mutedText, { color: colors.mutedForeground }]}>{(analysis.durationMs / 1000).toFixed(1)}s · {analysis.tokensUsed?.toLocaleString()} tokens</Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={[rd.tagPill, { backgroundColor: sentCfg.color + "15" }]}>
            <Feather name={sentCfg.icon} size={9} color={sentCfg.color} />
            <Text style={[{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: sentCfg.color }]}>{t(`documentReaderScreen.${sentCfg.labelKey}`)}</Text>
          </View>
          <View style={[rd.tagPill, { backgroundColor: urgCfg.color + "15" }]}>
            <Text style={[{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: urgCfg.color }]}>{t(`documentReaderScreen.${urgCfg.labelKey}`)}</Text>
          </View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
        </View>
      </Pressable>

      {expanded && (
        <View style={{ gap: 10, marginTop: 8 }}>
          {analysis.summary && (
            <Text style={[rd.bodyText, { color: colors.foreground }]}>{analysis.summary}</Text>
          )}

          {analysis.keyPoints.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={[rd.subLabel, { color: cfg.color }]}>{t("documentReaderScreen.keyPoints")}</Text>
              {analysis.keyPoints.map((pt, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <View style={[rd.numBadge, { backgroundColor: cfg.color + "20" }]}>
                    <Text style={[{ fontSize: 8, fontFamily: "Inter_700Bold", color: cfg.color }]}>{i + 1}</Text>
                  </View>
                  <Text style={[rd.bodyText, { color: colors.foreground, flex: 1 }]}>{pt}</Text>
                </View>
              ))}
            </View>
          )}

          {analysis.insights && (
            <View style={{ gap: 4 }}>
              <Text style={[rd.subLabel, { color: cfg.color }]}>{t("documentReaderScreen.deepAnalysis")}</Text>
              <Text style={[rd.bodyText, { color: colors.foreground }]}>{analysis.insights}</Text>
            </View>
          )}

          {analysis.recommendations.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={[rd.subLabel, { color: "#22c55e" }]}>{t("documentReaderScreen.recommendations")}</Text>
              {analysis.recommendations.map((r, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <Feather name="check-circle" size={12} color="#22c55e" style={{ marginTop: 2 }} />
                  <Text style={[rd.bodyText, { color: colors.foreground, flex: 1 }]}>{r}</Text>
                </View>
              ))}
            </View>
          )}

          {analysis.risks.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={[rd.subLabel, { color: "#ef4444" }]}>{t("documentReaderScreen.risksAlerts")}</Text>
              {analysis.risks.map((r, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <Feather name="alert-triangle" size={12} color="#f59e0b" style={{ marginTop: 2 }} />
                  <Text style={[rd.bodyText, { color: colors.foreground, flex: 1 }]}>{r}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── AI Tab ─────────────────────────────────────────────────────────────────────
function AnalyseTab({ doc, docId, onReloadDoc }: { doc: DocPreview; docId: number; onReloadDoc: () => void }) {
  const colors = useColors();
  const { t } = useTranslation();
  const { fetchAuth } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [selectedModels, setSelectedModels] = useState<AIModel[]>(["gemini", "openai", "claude"]);

  const multiModel = (doc.aiAnalysis?.multiModel as MultiModelResult | undefined) ?? null;
  const legacyAi = (doc.aiAnalysis && !doc.aiAnalysis.multiModel ? doc.aiAnalysis : null) as { summary?: string } | null;

  async function handleMultiAnalyze() {
    setAnalyzing(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${docId}/analyze-multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) onReloadDoc();
    } catch {}
    finally { setAnalyzing(false); }
  }

  async function handleAsk(q?: string) {
    const finalQ = (q ?? question).trim();
    if (!finalQ || asking) return;
    setQuestion("");
    const userMsg: ChatMessage = { role: "user", content: finalQ, timestamp: new Date().toISOString() };
    setChatHistory(h => [...h, userMsg]);
    setAsking(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${docId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: finalQ, models: selectedModels }),
      });
      const data = res.ok ? await res.json() : null;
      const aiMsg: ChatMessage = {
        role: "assistant",
        content: res.ok ? "" : t("documentReaderScreen.questionError"),
        answers: data?.answers ?? [],
        timestamp: new Date().toISOString(),
      };
      setChatHistory(h => [...h, aiMsg]);
    } catch {
      setChatHistory(h => [...h, { role: "assistant", content: t("documentReaderScreen.connectionError"), answers: [], timestamp: new Date().toISOString() }]);
    } finally {
      setAsking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    }
  }

  function toggleModel(m: AIModel) {
    setSelectedModels(prev =>
      prev.includes(m) ? (prev.length > 1 ? prev.filter(x => x !== m) : prev) : [...prev, m]
    );
  }

  // ── No analysis yet ───────────────────────────────────────────────────────
  if (!doc.aiProcessed && !multiModel) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        <View style={[rd.infoCard, { backgroundColor: "#1a73e808", borderColor: "#1a73e830", alignItems: "center", padding: 24, gap: 14 }]}>
          {/* 3 model icons */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(["gemini", "openai", "claude"] as AIModel[]).map(m => {
              const c = MODEL_CFG[m];
              return (
                <View key={m} style={[rd.modelIconLarge, { backgroundColor: c.color + "18" }]}>
                  <Feather name={c.icon} size={22} color={c.color} />
                </View>
              );
            })}
          </View>
          <Text style={[rd.sectionTitle, { color: colors.foreground, textAlign: "center" }]}>{t("documentReaderScreen.multiModelTitle")}</Text>
          <Text style={[rd.bodyText, { color: colors.mutedForeground, textAlign: "center" }]}>
            {t("documentReaderScreen.multiModelDesc")}
          </Text>
          <Pressable accessibilityRole="button" onPress={handleMultiAnalyze} disabled={analyzing}
            style={[rd.primaryBtn, { backgroundColor: analyzing ? "#6366f180" : "#6366f1" }]}>
            {analyzing ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="zap" size={14} color="#fff" />}
            <Text style={rd.primaryBtnText}>{analyzing ? t("documentReaderScreen.analyzing3Models") : t("documentReaderScreen.analyzeWith3AI")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={140}>
      {/* Tab: Analyse / Chat */}
      <View style={[rd.subTabBar, { borderColor: colors.border }]}>
        <Pressable accessibilityRole="button" onPress={() => setChatMode(false)}
          style={[rd.subTab, { backgroundColor: !chatMode ? "#6366f1" : "transparent" }]}>
          <Feather name="bar-chart-2" size={12} color={!chatMode ? "#fff" : colors.mutedForeground} />
          <Text style={[rd.subTabText, { color: !chatMode ? "#fff" : colors.mutedForeground }]}>{t("documentReaderScreen.subTabAnalysis")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setChatMode(true)}
          style={[rd.subTab, { backgroundColor: chatMode ? "#6366f1" : "transparent" }]}>
          <Feather name="message-circle" size={12} color={chatMode ? "#fff" : colors.mutedForeground} />
          <Text style={[rd.subTabText, { color: chatMode ? "#fff" : colors.mutedForeground }]}>{t("documentReaderScreen.subTabChat")}</Text>
        </Pressable>
      </View>

      {/* ── ANALYSIS VIEW ── */}
      {!chatMode && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {/* Consensus banner */}
          {multiModel?.consensus && (
            <View style={[rd.consensusBanner, { backgroundColor: "#6366f108", borderColor: "#6366f130" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Feather name="layers" size={14} color="#6366f1" />
                <Text style={[rd.sectionTitle, { color: "#6366f1" }]}>{t("documentReaderScreen.consensus3Models")}</Text>
                <View style={[rd.tagPill, { backgroundColor: "#6366f115", marginLeft: "auto" }]}>
                  <Text style={[{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#6366f1" }]}>{t("documentReaderScreen.agreementScore", { score: multiModel.consensus.agreementScore })}</Text>
                </View>
              </View>
              {multiModel.consensus.summary && (
                <Text style={[rd.bodyText, { color: "#1e293b" }]}>{multiModel.consensus.summary}</Text>
              )}
              {multiModel.consensus.topKeyPoints?.length > 0 && (
                <View style={{ marginTop: 8, gap: 4 }}>
                  {multiModel.consensus.topKeyPoints.slice(0, 5).map((pt, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                      <View style={[rd.numBadge, { backgroundColor: "#6366f120" }]}>
                        <Text style={[{ fontSize: 8, fontFamily: "Inter_700Bold", color: "#6366f1" }]}>{i + 1}</Text>
                      </View>
                      <Text style={[rd.bodyText, { color: "#1e293b", flex: 1 }]}>{pt}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Model cards */}
          {multiModel ? (
            <>
              <ModelCard analysis={multiModel.gemini} provider="gemini" />
              <ModelCard analysis={multiModel.openai} provider="openai" />
              <ModelCard analysis={multiModel.claude} provider="claude" />
            </>
          ) : legacyAi ? (
            // Legacy single-model analysis fallback
            <View style={[rd.infoCard, { backgroundColor: colors.card, borderColor: colors.border, gap: 8 }]}>
              <Text style={[rd.sectionTitle, { color: colors.foreground }]}>{t("documentReaderScreen.previousAnalysis")}</Text>
              {legacyAi.summary && <Text style={[rd.bodyText, { color: colors.foreground }]}>{legacyAi.summary}</Text>}
            </View>
          ) : null}

          {/* Re-analyze button */}
          <Pressable accessibilityRole="button" onPress={handleMultiAnalyze} disabled={analyzing}
            style={[rd.outlineBtn, { borderColor: "#6366f140" }]}>
            {analyzing ? <ActivityIndicator size="small" color="#6366f1" /> : <Feather name="refresh-cw" size={13} color="#6366f1" />}
            <Text style={[rd.outlineBtnText, { color: "#6366f1" }]}>{analyzing ? t("documentReaderScreen.reanalyzing") : t("documentReaderScreen.reanalyzeWith3AI")}</Text>
          </Pressable>

          {multiModel?.analyzedAt && (
            <Text style={[rd.mutedText, { color: colors.mutedForeground, textAlign: "center" }]}>
              {t("documentReaderScreen.analyzedOn", { date: new Date(multiModel.analyzedAt).toLocaleString("fr-FR") })}
            </Text>
          )}
        </ScrollView>
      )}

      {/* ── CHAT VIEW ── */}
      {chatMode && (
        <View style={{ flex: 1, gap: 8 }}>
          {/* Model selector */}
          <View style={[rd.modelSelector, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[rd.subLabel, { color: colors.mutedForeground }]}>{t("documentReaderScreen.activeModels")}</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {(["gemini", "openai", "claude"] as AIModel[]).map(m => {
                const c = MODEL_CFG[m];
                const active = selectedModels.includes(m);
                return (
                  <Pressable accessibilityRole="button" key={m} onPress={() => toggleModel(m)}
                    style={[rd.modelChip, { backgroundColor: active ? c.color + "20" : colors.border, borderColor: active ? c.color + "60" : "transparent" }]}>
                    <Feather name={c.icon} size={10} color={active ? c.color : colors.mutedForeground} />
                    <Text style={[{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: active ? c.color : colors.mutedForeground }]}>{c.short}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Chat messages */}
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {chatHistory.length === 0 && (
              <View style={{ gap: 8 }}>
                <Text style={[rd.subLabel, { color: colors.mutedForeground, textAlign: "center" }]}>{t("documentReaderScreen.quickQuestions")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_QUESTION_KEYS.map((qk, i) => {
                    const q = t(`documentReaderScreen.quickQuestionsList.${qk}`);
                    return (
                    <Pressable accessibilityRole="button" key={i} onPress={() => handleAsk(q)}
                      style={[rd.quickQ, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.foreground }]}>{q}</Text>
                    </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {chatHistory.map((msg, idx) => {
              if (msg.role === "user") {
                return (
                  <View key={idx} style={rd.userBubbleWrap}>
                    <View style={[rd.userBubble, { backgroundColor: "#6366f1" }]}>
                      <Text style={[rd.bodyText, { color: "#fff" }]}>{msg.content}</Text>
                    </View>
                  </View>
                );
              }
              // assistant
              return (
                <View key={idx} style={{ gap: 6 }}>
                  {msg.answers && msg.answers.length > 0 ? msg.answers.map((ans, ai) => {
                    const provider = ans.provider as AIModel;
                    const c = MODEL_CFG[provider] ?? MODEL_CFG.gemini;
                    return (
                      <View key={ai} style={[rd.aiBubble, { backgroundColor: c.bg, borderColor: c.color + "30" }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <View style={[rd.modelIcon, { backgroundColor: c.color + "20" }]}>
                            <Feather name={c.icon} size={11} color={c.color} />
                          </View>
                          <Text style={[{ fontSize: 11, fontFamily: "Inter_700Bold", color: c.color }]}>{c.name}</Text>
                          {ans.durationMs && (
                            <Text style={[rd.mutedText, { color: colors.mutedForeground, marginLeft: "auto" }]}>{(ans.durationMs / 1000).toFixed(1)}s</Text>
                          )}
                        </View>
                        {ans.error ? (
                          <Text style={[rd.bodyText, { color: "#ef4444" }]}>{t("documentReaderScreen.errorColon", { error: ans.error })}</Text>
                        ) : (
                          <Text style={[rd.bodyText, { color: colors.foreground }]} selectable>{ans.answer}</Text>
                        )}
                      </View>
                    );
                  }) : (
                    <View style={[rd.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[rd.bodyText, { color: colors.foreground }]}>{msg.content}</Text>
                    </View>
                  )}
                </View>
              );
            })}

            {asking && (
              <View style={{ gap: 6 }}>
                {selectedModels.map(m => {
                  const c = MODEL_CFG[m];
                  return (
                    <View key={m} style={[rd.aiBubble, { backgroundColor: c.bg, borderColor: c.color + "30" }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={[rd.modelIcon, { backgroundColor: c.color + "20" }]}>
                          <Feather name={c.icon} size={11} color={c.color} />
                        </View>
                        <Text style={[{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.color }]}>{c.name}</Text>
                        <ActivityIndicator size="small" color={c.color} style={{ marginLeft: 4 }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Input */}
          <View style={[rd.chatInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput accessibilityLabel={t("documentReaderScreen.chatPlaceholder")}
              style={[rd.chatTextInput, { color: colors.foreground }]}
              placeholder={t("documentReaderScreen.chatPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              value={question}
              onChangeText={setQuestion}
              multiline
              maxLength={1000}
              onSubmitEditing={() => handleAsk()}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.send")} onPress={() => handleAsk()} disabled={!question.trim() || asking}
              style={[rd.sendBtn, { backgroundColor: question.trim() && !asking ? "#6366f1" : "#6366f140" }]}>
              <Feather name="send" size={16} color="#fff" />
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ── Actions Tab ───────────────────────────────────────────────────────────────
function ActionsTab({ doc, onDownload, onDelete }: { doc: DocPreview; onDownload: () => void; onDelete: () => void }) {
  const colors = useColors();
  const { t } = useTranslation();
  const mimeInfo = getMimeInfo(doc.mimeType);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
      <View style={[rd.infoCard, { backgroundColor: mimeInfo.color + "08", borderColor: mimeInfo.color + "30" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[rd.bigIcon, { backgroundColor: mimeInfo.color + "18", width: 56, height: 56, borderRadius: 14 }]}>
            <Feather name={mimeInfo.icon} size={24} color={mimeInfo.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[rd.sectionTitle, { color: colors.foreground }]} numberOfLines={2}>{doc.fileName}</Text>
            <Text style={[rd.mutedText, { color: mimeInfo.color }]}>{mimeLabel(mimeInfo, t)} · {formatSize(doc.fileSize)}</Text>
          </View>
        </View>
      </View>

      {[
        { icon: "download" as const,       label: t("documentReaderScreen.download"),              sub: t("documentReaderScreen.saveWithSize", { size: formatSize(doc.fileSize) }), color: "#3b82f6", onPress: onDownload },
        { icon: "external-link" as const,  label: t("documentReaderScreen.openInBrowser"), sub: t("documentReaderScreen.externalViewer"),           color: "#6366f1", onPress: () => Linking.openURL(`${API_BASE}/api/documents/${doc.id}/download`).catch(() => {}) },
        { icon: "trash-2" as const,        label: t("documentReaderScreen.deleteAction"),                sub: t("documentReaderScreen.irreversibleAction"),            color: "#ef4444", onPress: onDelete },
      ].map((a, i) => (
        <Pressable accessibilityRole="button" key={i} onPress={a.onPress}
          style={[rd.actionCard, { backgroundColor: a.color === "#ef4444" ? "#ef444408" : colors.card, borderColor: a.color === "#ef4444" ? "#ef444430" : colors.border }]}>
          <View style={[rd.infoIcon, { backgroundColor: a.color + "15" }]}>
            <Feather name={a.icon} size={16} color={a.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[rd.sectionTitle, { fontSize: 14, color: a.color === "#ef4444" ? "#ef4444" : colors.foreground }]}>{a.label}</Text>
            <Text style={[rd.mutedText, { color: colors.mutedForeground }]}>{a.sub}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────
const TABS: { key: ReaderTab; labelKey: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "contenu", labelKey: "tabContenu",  icon: "file-text", color: "#0f766e" },
  { key: "infos",   labelKey: "tabInfos",   icon: "info",       color: "#0f4c81" },
  { key: "analyse", labelKey: "tabAnalyse",    icon: "zap",        color: "#6366f1" },
  { key: "actions", labelKey: "tabActions", icon: "settings",   color: "#64748b" },
];

export default function DocumentReaderScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const { id } = useLocalSearchParams<{ id: string }>();

  const [doc, setDoc] = useState<DocPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ReaderTab>("contenu");

  const activeIdRef = useRef(id);
  activeIdRef.current = id;

  const loadDoc = useCallback(async () => {
    if (!id) return;
    const reqId = id;
    setLoading(true);
    try {
      const data = await getDocument(Number(id));
      if (activeIdRef.current !== reqId) return;
      setDoc(data);
    } catch {}
    finally { if (activeIdRef.current === reqId) setLoading(false); }
  }, [id]);

  useEffect(() => { loadDoc(); }, [loadDoc]);

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
  const multiModel = (doc?.aiAnalysis?.multiModel as MultiModelResult | undefined) ?? null;

  return (
    <View style={[rd.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[rd.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={rd.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} hitSlop={12} style={rd.headerBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, overflow: "hidden" }}>
            <Text style={rd.headerTitle} numberOfLines={1}>{doc?.fileName ?? t("documentReaderScreen.loading")}</Text>
            {mimeInfo && doc && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                <View style={[rd.tagPill, { backgroundColor: mimeInfo.color + "30" }]}>
                  <Feather name={mimeInfo.icon} size={9} color="#fff" />
                  <Text style={[{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#fff" }]}>{mimeLabel(mimeInfo, t)}</Text>
                </View>
                {multiModel && (
                  <View style={[rd.tagPill, { backgroundColor: "#6366f130" }]}>
                    <Feather name="layers" size={9} color="#c4b5fd" />
                    <Text style={[{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#c4b5fd" }]}>{t("documentReaderScreen.badge3AI")}</Text>
                  </View>
                )}
                <Text style={[{ fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)" }]}>{formatSize(doc.fileSize)}</Text>
              </View>
            )}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.download")} onPress={handleDownload} hitSlop={10} style={rd.headerBtn}>
            <Feather name="download" size={18} color="#fff" />
          </Pressable>
        </View>

        {/* Tab bar */}
        <View style={rd.tabBar}>
          {TABS.map(tabItem => (
            <Pressable accessibilityRole="button" key={tabItem.key} onPress={() => setTab(tabItem.key)}
              style={[rd.tabItem, { backgroundColor: tab === tabItem.key ? "#fff" : "rgba(255,255,255,0.12)" }]}>
              <Feather name={tabItem.icon} size={11} color={tab === tabItem.key ? tabItem.color : "rgba(255,255,255,0.8)"} />
              <Text style={[rd.tabText, { color: tab === tabItem.key ? tabItem.color : "rgba(255,255,255,0.8)" }]}>{t(`documentReaderScreen.${tabItem.labelKey}`)}</Text>
              {tabItem.key === "analyse" && doc?.aiProcessed && (
                <View style={rd.tabDot} />
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={rd.center}>
          <ActivityIndicator size="large" color="#0f766e" />
          <Text style={[rd.mutedText, { color: colors.mutedForeground, marginTop: 10 }]}>{t("documentReaderScreen.loading")}</Text>
        </View>
      ) : !doc ? (
        <View style={rd.center}>
          <Feather name="file" size={40} color={colors.mutedForeground} />
          <Text style={[rd.sectionTitle, { color: colors.foreground, marginTop: 10 }]}>{t("documentReaderScreen.notFound")}</Text>
        </View>
      ) : (
        <View style={[rd.body, { paddingBottom: isWeb ? 120 : 48 }]}>
          {tab === "contenu"  && <ContentTab doc={doc} />}
          {tab === "infos"    && <InfosTab doc={doc} docId={doc.id} onReloadDoc={loadDoc} />}
          {tab === "analyse"  && <AnalyseTab doc={doc} docId={doc.id} onReloadDoc={loadDoc} />}
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
  headerBtn: { padding: 4, marginTop: 2 },
  headerTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 21 },
  tabBar: { flexDirection: "row", gap: 6, marginTop: 12 },
  tabItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, borderRadius: 20 },
  tabText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tabDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#8b5cf6" },
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
  textScroll: { flex: 1, borderRadius: 10, borderWidth: 1, maxHeight: 500 },
  textContent: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 21 },
  totalChars: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  imageCard: { borderRadius: 14, borderWidth: 1, padding: 8, alignItems: "center" },
  imagePreview: { width: "100%", height: 400, borderRadius: 8 },
  textCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  noPreviewCard: { borderRadius: 14, borderWidth: 1, padding: 28, alignItems: "center", gap: 10 },
  bigIcon: { width: 80, height: 80, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  // Infos tab
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 2 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  infoIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  infoLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1, lineHeight: 18 },
  tagPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  // AI tab
  subTabBar: { flexDirection: "row", borderRadius: 10, borderWidth: 1, padding: 3, marginBottom: 10 },
  subTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 7, borderRadius: 8 },
  subTabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  consensusBanner: { borderRadius: 12, borderWidth: 1, padding: 14 },
  modelCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  modelCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  modelIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  modelIconLarge: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modelName: { fontSize: 13, fontFamily: "Inter_700Bold", flex: 1 },
  numBadge: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  subLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  bodyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  mutedText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  // Chat
  modelSelector: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, flexWrap: "wrap" },
  modelChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  quickQ: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  userBubbleWrap: { alignItems: "flex-end" },
  userBubble: { maxWidth: "80%", paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16 },
  aiBubble: { borderRadius: 12, borderWidth: 1, padding: 12 },
  chatInput: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderRadius: 14, borderWidth: 1 },
  chatTextInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", maxHeight: 80 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  // Buttons
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 20, borderRadius: 10 },
  primaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 10, borderWidth: 1 },
  outlineBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  // Actions tab
  actionCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
});
