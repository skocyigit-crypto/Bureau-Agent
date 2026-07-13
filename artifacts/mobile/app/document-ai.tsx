import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type DocType =
  | "bon_commande" | "bon_livraison" | "contrat" | "cv" | "carte_visite"
  | "courrier" | "releve_bancaire" | "rapport" | "formulaire" | "piece_identite"
  | "attestation" | "note_frais" | "planning" | "inconnu";

interface SuggestedAction {
  action: string;
  module: string;
  label: string;
  description: string;
  data: Record<string, any>;
  priority: "haute" | "moyenne" | "basse";
}

interface AnalysisResult {
  documentType: DocType;
  confidence: number;
  title: string;
  summary: string;
  destination: string;
  destinationReason: string;
  extractedFields: Record<string, any>;
  suggestedActions: SuggestedAction[];
  warnings: string[];
}

interface ActionResult {
  success: boolean;
  module: string;
  action: string;
  message: string;
  createdId?: number;
}

const DOC_TYPE_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  bon_commande:    { label: "Bon de commande",    color: "#8b5cf6", icon: "shopping-cart" },
  bon_livraison:   { label: "Bon de livraison",   color: "#7c3aed", icon: "package" },
  contrat:         { label: "Contrat",             color: "#b45309", icon: "file-text" },
  cv:              { label: "CV / Résumé",          color: "#16a34a", icon: "user" },
  carte_visite:    { label: "Carte de visite",     color: "#0d9488", icon: "credit-card" },
  courrier:        { label: "Courrier",             color: "#64748b", icon: "mail" },
  releve_bancaire: { label: "Relevé bancaire",     color: "#15803d", icon: "dollar-sign" },
  rapport:         { label: "Rapport",              color: "#0891b2", icon: "bar-chart-2" },
  formulaire:      { label: "Formulaire",           color: "#db2777", icon: "list" },
  piece_identite:  { label: "Pièce d'identité",   color: "#ef4444", icon: "shield" },
  attestation:     { label: "Attestation",          color: "#ca8a04", icon: "award" },
  note_frais:      { label: "Note de frais",       color: "#65a30d", icon: "dollar-sign" },
  planning:        { label: "Planning",             color: "#0284c7", icon: "calendar" },
  inconnu:         { label: "Type inconnu",         color: "#94a3b8", icon: "file" },
};

const PRIORITY_MAP: Record<string, { color: string; label: string }> = {
  haute:   { color: "#ef4444", label: "Haute" },
  moyenne: { color: "#f59e0b", label: "Moyenne" },
  basse:   { color: "#22c55e", label: "Basse" },
};

const MODULE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  contacts: "users", taches: "check-square", messages: "message-square",
  projets: "folder", aucun: "x-circle",
};

const SUPPORTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".csv", ".docx", ".xlsx", ".pptx"];

export default function DocumentAIScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [file, setFile] = useState<{ name: string; uri: string; mimeType: string; size: number } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<ActionResult[]>([]);

  async function pickDocument() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf", "image/*", "text/plain", "text/csv",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!picked.canceled && picked.assets.length > 0) {
        const asset = picked.assets[0];
        const ext = asset.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
        if (!SUPPORTED_EXTENSIONS.includes(ext)) {
          Alert.alert("Format non supporté", `Types acceptés : ${SUPPORTED_EXTENSIONS.join(", ")}`);
          return;
        }
        setFile({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType ?? "application/octet-stream", size: asset.size ?? 0 });
        setResult(null);
        setActionResults([]);
      }
    } catch { /* user cancelled */ }
  }

  async function analyseDocument() {
    if (!file) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAnalysing(true);
    try {
      let fileContent: string;
      if (Platform.OS === "web") {
        // On web, we can't read the file the same way
        Alert.alert("Fonctionnalité mobile", "L'analyse de document est optimisée pour mobile.");
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: "base64" as any });
      fileContent = base64;

      const res = await fetchAuth(`${API_BASE}/api/document-ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileContent,
          mimeType: file.mimeType,
          fileName: file.name,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Erreur d'analyse", err.error ?? "Impossible d'analyser ce document.");
        return;
      }
      const d = await res.json();
      setResult(d);
    } catch (e: any) {
      Alert.alert("Erreur réseau", "Impossible de contacter le serveur.");
    } finally { setAnalysing(false); }
  }

  async function executeAction(action: SuggestedAction) {
    setActionLoading(action.action);
    try {
      const res = await fetchAuth(`${API_BASE}/api/document-ai/execute-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action.action, module: action.module, data: action.data }),
      });
      const d = await res.json();
      setActionResults(prev => [...prev, { ...d, action: action.action }]);
      if (d.success && Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally { setActionLoading(null); }
  }

  const docCfg = result ? (DOC_TYPE_MAP[result.documentType] ?? DOC_TYPE_MAP.inconnu) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Document IA</Text>
          <Text style={styles.headerSub}>Analyse intelligente de documents</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: isWeb ? 118 : 100 }]}>
        {/* Drop zone */}
        <Pressable
          onPress={pickDocument}
          style={[styles.dropZone, { backgroundColor: colors.card, borderColor: file ? "#8b5cf6" : colors.border }]}
        >
          {file ? (
            <View style={styles.filePreview}>
              <View style={[styles.fileIcon, { backgroundColor: "#8b5cf618" }]}>
                <Feather name="file" size={24} color="#8b5cf6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={2}>{file.name}</Text>
                <Text style={[styles.fileSize, { color: colors.mutedForeground }]}>
                  {file.size < 1024 * 1024
                    ? `${(file.size / 1024).toFixed(1)} KB`
                    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                </Text>
              </View>
              <Pressable onPress={() => { setFile(null); setResult(null); setActionResults([]); }}>
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.dropZoneContent}>
              <View style={[styles.dropIcon, { backgroundColor: "#8b5cf618" }]}>
                <Feather name="upload" size={28} color="#8b5cf6" />
              </View>
              <Text style={[styles.dropTitle, { color: colors.foreground }]}>Choisir un document</Text>
              <Text style={[styles.dropSub, { color: colors.mutedForeground }]}>
                PDF, image, Word, Excel, CSV, PowerPoint — jusqu'à 25 Mo
              </Text>
            </View>
          )}
        </Pressable>

        {file && !result && (
          <Pressable
            onPress={analyseDocument}
            disabled={analysing}
            style={[styles.analyseBtn, { opacity: analysing ? 0.7 : 1 }]}
          >
            {analysing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="cpu" size={18} color="#fff" />
            )}
            <Text style={styles.analyseBtnText}>
              {analysing ? "Analyse en cours…" : "Analyser avec l'IA"}
            </Text>
          </Pressable>
        )}

        {analysing && (
          <View style={[styles.analysingCard, { backgroundColor: "#f5f3ff", borderColor: "#8b5cf6" }]}>
            <ActivityIndicator size="small" color="#8b5cf6" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.analysingTitle, { color: "#7c3aed" }]}>Intelligence IA en cours…</Text>
              <Text style={[styles.analysingSub, { color: "#6d28d9" }]}>
                Extraction du contenu, classification et détection d'entités
              </Text>
            </View>
          </View>
        )}

        {/* Results */}
        {result && docCfg && (
          <>
            {/* Document type card */}
            <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.resultCardHeader}>
                <View style={[styles.resultTypeIcon, { backgroundColor: docCfg.color + "18" }]}>
                  <Feather name={docCfg.icon} size={20} color={docCfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.resultTypeName, { color: colors.foreground }]}>{result.title || docCfg.label}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
                    <View style={[styles.typeBadge, { backgroundColor: docCfg.color + "18" }]}>
                      <Text style={[styles.typeBadgeText, { color: docCfg.color }]}>{docCfg.label}</Text>
                    </View>
                    <View style={[styles.confBadge, { backgroundColor: result.confidence >= 0.8 ? "#22c55e18" : "#f59e0b18" }]}>
                      <Text style={[styles.confBadgeText, { color: result.confidence >= 0.8 ? "#22c55e" : "#f59e0b" }]}>
                        {Math.round(result.confidence * 100)}% confiance
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
              <Text style={[styles.resultSummary, { color: colors.mutedForeground }]}>{result.summary}</Text>
              {result.destination !== "aucun" && (
                <View style={[styles.destinationRow, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
                  <Feather name={MODULE_ICONS[result.destination] ?? "arrow-right"} size={13} color="#3b82f6" />
                  <Text style={[styles.destinationText, { color: "#3b82f6" }]}>
                    Recommandé : module <Text style={{ fontFamily: "Inter_700Bold" }}>{result.destination}</Text> — {result.destinationReason}
                  </Text>
                </View>
              )}
            </View>

            {/* Extracted fields */}
            {Object.keys(result.extractedFields).length > 0 && (
              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Champs extraits</Text>
                {Object.entries(result.extractedFields).slice(0, 12).map(([k, v]) => (
                  <View key={k} style={[styles.fieldRow, { borderColor: colors.border }]}>
                    <Text style={[styles.fieldKey, { color: colors.mutedForeground }]}>{k.replace(/_/g, " ")}</Text>
                    <Text style={[styles.fieldVal, { color: colors.foreground }]} numberOfLines={2}>
                      {Array.isArray(v) ? v.join(", ") : String(v ?? "—")}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Suggested actions */}
            {result.suggestedActions.length > 0 && (
              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Actions suggérées</Text>
                {result.suggestedActions.map((act, i) => {
                  const prio = PRIORITY_MAP[act.priority];
                  const done = actionResults.find(r => r.action === act.action);
                  return (
                    <View key={i} style={[styles.actionItem, { borderColor: colors.border }]}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                        <Feather name={MODULE_ICONS[act.module] ?? "arrow-right"} size={14} color="#8b5cf6" style={{ marginTop: 2 }} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <Text style={[styles.actionLabel, { color: colors.foreground }]}>{act.label}</Text>
                            <View style={[styles.prioBadge, { backgroundColor: prio.color + "18" }]}>
                              <Text style={[styles.prioBadgeText, { color: prio.color }]}>{prio.label}</Text>
                            </View>
                          </View>
                          <Text style={[styles.actionDesc, { color: colors.mutedForeground }]}>{act.description}</Text>
                        </View>
                      </View>
                      {done ? (
                        <View style={[styles.doneAction, { backgroundColor: done.success ? "#22c55e18" : "#ef444418" }]}>
                          <Feather name={done.success ? "check" : "x"} size={13} color={done.success ? "#22c55e" : "#ef4444"} />
                          <Text style={[styles.doneActionText, { color: done.success ? "#22c55e" : "#ef4444" }]}>{done.message}</Text>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => executeAction(act)}
                          disabled={!!actionLoading}
                          style={[styles.execBtn, { opacity: actionLoading ? 0.5 : 1 }]}
                        >
                          {actionLoading === act.action
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Feather name="zap" size={13} color="#fff" />
                          }
                          <Text style={styles.execBtnText}>Exécuter</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <View style={[styles.warnCard, { borderColor: "#fcd34d" }]}>
                <Feather name="alert-triangle" size={14} color="#b45309" />
                <View style={{ flex: 1, gap: 3 }}>
                  {result.warnings.map((w, i) => (
                    <Text key={i} style={[styles.warnText, { color: "#b45309" }]}>• {w}</Text>
                  ))}
                </View>
              </View>
            )}

            {/* Re-analyse */}
            <Pressable onPress={() => { setResult(null); setActionResults([]); }} style={[styles.reanalyseBtn, { borderColor: colors.border }]}>
              <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
              <Text style={[styles.reanalyseBtnText, { color: colors.mutedForeground }]}>Analyser un autre document</Text>
            </Pressable>
          </>
        )}

        {/* Supported formats info */}
        {!file && !result && (
          <View style={[styles.formatsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.formatsTitle, { color: colors.foreground }]}>Types de documents analysés</Text>
            {Object.values(DOC_TYPE_MAP).filter(d => d.label !== "Type inconnu").map((d, i) => (
              <View key={i} style={styles.formatRow}>
                <Feather name={d.icon} size={13} color={d.color} />
                <Text style={[styles.formatText, { color: colors.foreground }]}>{d.label}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#7c3aed", paddingHorizontal: 20, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 1 },
  content: { padding: 16, gap: 12 },
  dropZone: { borderRadius: 16, borderWidth: 2, borderStyle: "dashed", padding: 20, alignItems: "center" },
  dropZoneContent: { alignItems: "center", gap: 10 },
  dropIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  dropTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  dropSub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  filePreview: { flexDirection: "row", alignItems: "center", gap: 10, width: "100%" },
  fileIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fileSize: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  analyseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: "#7c3aed" },
  analyseBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  analysingCard: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "flex-start" },
  analysingTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  analysingSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  resultCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  resultCardHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 10 },
  resultTypeIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  resultTypeName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  confBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  confBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  resultSummary: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 8 },
  destinationRow: { flexDirection: "row", gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, alignItems: "flex-start" },
  destinationText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 10 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, gap: 10 },
  fieldKey: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 0.9, textTransform: "capitalize" },
  fieldVal: { fontSize: 12, fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "right" },
  actionItem: { paddingVertical: 10, borderBottomWidth: 1, gap: 8 },
  actionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actionDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1, lineHeight: 17 },
  prioBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  prioBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  execBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#7c3aed", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, alignSelf: "flex-end" },
  execBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  doneAction: { flexDirection: "row", gap: 6, padding: 8, borderRadius: 8, alignItems: "center" },
  doneActionText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  warnCard: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, backgroundColor: "#fefce8" },
  warnText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  reanalyseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, borderWidth: 1 },
  reanalyseBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  formatsCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  formatsTitle: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 10 },
  formatRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  formatText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
