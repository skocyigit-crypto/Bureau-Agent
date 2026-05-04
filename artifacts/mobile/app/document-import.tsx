import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface PickedFile {
  name: string;
  mimeType: string;
  size: number;
  uri: string;
}

interface UploadedDoc {
  id: number;
  filename: string;
  fileSize: number;
  mimeType: string;
  category: string;
  entityType?: string;
}

const CATEGORY_OPTIONS = [
  { value: "general",       label: "Général" },
  { value: "contrat",       label: "Contrat" },
  { value: "facture",       label: "Facture" },
  { value: "rapport",       label: "Rapport" },
  { value: "cv",            label: "CV" },
  { value: "correspondance",label: "Correspondance" },
  { value: "technique",     label: "Technique" },
  { value: "juridique",     label: "Juridique" },
  { value: "comptabilite",  label: "Comptabilité" },
];

const META_FIELDS = [
  { key: "category",    label: "Catégorie",   type: "select" as const, options: CATEGORY_OPTIONS },
  { key: "entityType",  label: "Entité liée", type: "select" as const, options: [
    { value: "contact",   label: "Contact" },
    { value: "prospect",  label: "Prospect" },
    { value: "devis",     label: "Devis" },
    { value: "facture",   label: "Facture" },
    { value: "projet",    label: "Projet" },
    { value: "",          label: "Aucune" },
  ]},
  { key: "tags",        label: "Tags (virgule séparés)" },
  { key: "description", label: "Description", type: "multiline" as const },
];

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
];

const MAX_SIZE = 25 * 1024 * 1024;

function fmtSize(b: number): string {
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

function mimeIcon(mime: string): keyof typeof Feather.glyphMap {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "file-text";
  if (mime.includes("word")) return "file";
  if (mime.includes("excel") || mime.includes("spreadsheet") || mime === "text/csv") return "grid";
  return "file";
}

type Step = "pick" | "meta" | "done";

export default function DocumentImportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [step, setStep] = useState<Step>("pick");
  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);
  const [metaValues, setMetaValues] = useState<Record<string, string>>({ category: "general" });
  const [uploading, setUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [showMeta, setShowMeta] = useState(false);

  async function pickFiles() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_TYPES,
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const valid: PickedFile[] = [];
      const errs: string[] = [];
      for (const asset of result.assets) {
        if (asset.size && asset.size > MAX_SIZE) {
          errs.push(`${asset.name} dépasse 25 Mo (${fmtSize(asset.size ?? 0)})`);
          continue;
        }
        valid.push({ name: asset.name, mimeType: asset.mimeType ?? "application/octet-stream", size: asset.size ?? 0, uri: asset.uri });
      }
      if (errs.length > 0) Alert.alert("Fichiers trop volumineux", errs.join("\n"));
      if (valid.length > 0) {
        setPickedFiles(prev => [...prev, ...valid]);
      }
    } catch (e) {
      Alert.alert("Erreur", "Impossible de sélectionner le fichier.");
    }
  }

  function removeFile(idx: number) {
    setPickedFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function uploadAll() {
    if (pickedFiles.length === 0) return;
    setUploading(true);
    setErrors([]);
    const uploaded: UploadedDoc[] = [];
    const errs: string[] = [];

    for (const file of pickedFiles) {
      try {
        let base64: string;
        if (Platform.OS === "web") {
          const response = await fetch(file.uri);
          const blob = await response.blob();
          base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } else {
          base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: "base64" as any });
        }

        const payload = {
          filename: file.name,
          mimeType: file.mimeType,
          fileSize: file.size,
          content: base64,
          category: metaValues.category || "general",
          entityType: metaValues.entityType || undefined,
          tags: metaValues.tags ? metaValues.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
          description: metaValues.description || undefined,
        };

        const res = await fetchAuth(`${API_BASE}/api/documents/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const d = await res.json();
          uploaded.push(d.document ?? d);
        } else {
          const err = await res.json().catch(() => ({}));
          errs.push(`${file.name} : ${err.error ?? "Erreur"}`);
        }
      } catch {
        errs.push(`${file.name} : Erreur de lecture`);
      }
    }

    setUploadedDocs(uploaded);
    setErrors(errs);
    setUploading(false);
    setStep("done");
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Importer des documents</Text>
        </View>
        <View style={styles.stepRow}>
          {(["pick", "meta", "done"] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <View style={[styles.stepDot, { backgroundColor: step === s ? "#fff" : "rgba(255,255,255,0.35)" }]}>
                <Text style={[styles.stepNum, { color: step === s ? "#0f766e" : "#fff" }]}>{i + 1}</Text>
              </View>
              {i < 2 && <View style={[styles.stepLine, { backgroundColor: step !== "pick" && i === 0 ? "#fff" : "rgba(255,255,255,0.3)" }]} />}
            </React.Fragment>
          ))}
        </View>
        <Text style={styles.stepLabel}>
          {step === "pick" ? "Sélection des fichiers" : step === "meta" ? "Métadonnées" : "Résultats"}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 40 : 24 }]}>
        {/* STEP 1 — Pick */}
        {step === "pick" && (
          <>
            <Pressable
              onPress={pickFiles}
              style={[styles.dropZone, { backgroundColor: colors.card, borderColor: "#0f766e" }]}
            >
              <Feather name="upload-cloud" size={40} color="#0f766e" />
              <Text style={[styles.dropTitle, { color: colors.foreground }]}>Appuyez pour sélectionner</Text>
              <Text style={[styles.dropSub, { color: colors.mutedForeground }]}>PDF · Images · Word · Excel · CSV</Text>
              <Text style={[styles.dropSub, { color: colors.mutedForeground }]}>Max 25 Mo par fichier</Text>
            </Pressable>

            {pickedFiles.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                  {pickedFiles.length} fichier{pickedFiles.length > 1 ? "s" : ""} sélectionné{pickedFiles.length > 1 ? "s" : ""}
                </Text>
                {pickedFiles.map((f, i) => (
                  <View key={i} style={[styles.fileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.fileIcon, { backgroundColor: "#0f766e15" }]}>
                      <Feather name={mimeIcon(f.mimeType)} size={18} color="#0f766e" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{f.name}</Text>
                      <Text style={[styles.fileMeta, { color: colors.mutedForeground }]}>{fmtSize(f.size)} · {f.mimeType.split("/")[1]?.toUpperCase() ?? "—"}</Text>
                    </View>
                    <Pressable onPress={() => removeFile(i)} style={styles.removeBtn}>
                      <Feather name="x" size={16} color="#ef4444" />
                    </Pressable>
                  </View>
                ))}

                <View style={{ gap: 8, marginTop: 4 }}>
                  <Pressable
                    onPress={() => setStep("meta")}
                    style={[styles.primaryBtn, { backgroundColor: "#0f766e" }]}
                  >
                    <Feather name="settings" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Configurer & Importer</Text>
                  </Pressable>
                  <Pressable
                    onPress={uploadAll}
                    style={[styles.secondaryBtn, { borderColor: "#0f766e" }]}
                  >
                    <Feather name="upload" size={16} color="#0f766e" />
                    <Text style={[styles.secondaryBtnText, { color: "#0f766e" }]}>Import rapide (catég. par défaut)</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Format info */}
            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.infoTitle, { color: colors.foreground }]}>Formats acceptés</Text>
              {[
                { icon: "file-text" as const,  label: "PDF", desc: "Contrats, factures, rapports" },
                { icon: "image" as const,       label: "Images", desc: "JPG, PNG, WebP" },
                { icon: "file" as const,        label: "Word", desc: "DOC, DOCX" },
                { icon: "grid" as const,        label: "Excel / CSV", desc: "XLS, XLSX, CSV" },
              ].map(f => (
                <View key={f.label} style={styles.formatRow}>
                  <Feather name={f.icon} size={14} color="#0f766e" />
                  <Text style={[styles.formatLabel, { color: colors.foreground }]}>{f.label}</Text>
                  <Text style={[styles.formatDesc, { color: colors.mutedForeground }]}>{f.desc}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* STEP 2 — Meta */}
        {step === "meta" && (
          <>
            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.infoTitle, { color: colors.foreground }]}>
                {pickedFiles.length} fichier{pickedFiles.length > 1 ? "s" : ""} à importer
              </Text>
              {pickedFiles.map((f, i) => (
                <Text key={i} style={[styles.fileMeta, { color: colors.mutedForeground }]}>· {f.name}</Text>
              ))}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.foreground, marginBottom: 12 }]}>Catégorie</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {CATEGORY_OPTIONS.map(c => (
                  <Pressable
                    key={c.value}
                    onPress={() => setMetaValues(prev => ({ ...prev, category: c.value }))}
                    style={[
                      styles.catChip,
                      { backgroundColor: metaValues.category === c.value ? "#0f766e" : colors.background, borderColor: metaValues.category === c.value ? "#0f766e" : colors.border },
                    ]}
                  >
                    <Text style={[styles.catChipText, { color: metaValues.category === c.value ? "#fff" : colors.mutedForeground }]}>
                      {c.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.foreground, marginBottom: 8 }]}>Tags (optionnel)</Text>
              <TextInput
                style={[styles.tagInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="contrat, 2024, client-dupont..."
                placeholderTextColor={colors.mutedForeground}
                value={metaValues.tags ?? ""}
                onChangeText={v => setMetaValues(prev => ({ ...prev, tags: v }))}
              />
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 12, marginBottom: 8 }]}>Description (optionnel)</Text>
              <TextInput
                style={[styles.tagInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 60, textAlignVertical: "top" }]}
                placeholder="Description du document..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                value={metaValues.description ?? ""}
                onChangeText={v => setMetaValues(prev => ({ ...prev, description: v }))}
              />
            </View>

            <View style={{ gap: 8 }}>
              <Pressable
                onPress={uploadAll}
                disabled={uploading}
                style={[styles.primaryBtn, { backgroundColor: "#0f766e" }]}
              >
                {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="upload" size={16} color="#fff" />}
                <Text style={styles.primaryBtnText}>{uploading ? "Import en cours..." : `Importer ${pickedFiles.length} fichier${pickedFiles.length > 1 ? "s" : ""}`}</Text>
              </Pressable>
              <Pressable onPress={() => setStep("pick")} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Retour</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* STEP 3 — Done */}
        {step === "done" && (
          <>
            <View style={[styles.doneCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.doneIcon, { backgroundColor: uploadedDocs.length > 0 ? "#0f766e15" : "#ef444415" }]}>
                <Feather
                  name={uploadedDocs.length > 0 ? "check-circle" : "alert-circle"}
                  size={36}
                  color={uploadedDocs.length > 0 ? "#0f766e" : "#ef4444"}
                />
              </View>
              <Text style={[styles.doneTitle, { color: colors.foreground }]}>
                {uploadedDocs.length > 0 ? `${uploadedDocs.length} document${uploadedDocs.length > 1 ? "s" : ""} importé${uploadedDocs.length > 1 ? "s" : ""}` : "Aucun document importé"}
              </Text>
              {errors.length > 0 && (
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#ef4444", textAlign: "center" }}>
                  {errors.length} erreur{errors.length > 1 ? "s" : ""}
                </Text>
              )}
            </View>

            {uploadedDocs.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Documents importés</Text>
                {uploadedDocs.map((d, i) => (
                  <View key={i} style={[styles.fileCard, { backgroundColor: colors.card, borderColor: "#0f766e40" }]}>
                    <View style={[styles.fileIcon, { backgroundColor: "#0f766e15" }]}>
                      <Feather name={mimeIcon(d.mimeType)} size={16} color="#0f766e" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{d.filename}</Text>
                      <Text style={[styles.fileMeta, { color: "#0f766e" }]}>{d.category} · {fmtSize(d.fileSize)}</Text>
                    </View>
                    <Feather name="check-circle" size={16} color="#22c55e" />
                  </View>
                ))}
              </View>
            )}

            {errors.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.sectionLabel, { color: "#ef4444" }]}>Erreurs</Text>
                {errors.map((e, i) => (
                  <View key={i} style={[styles.fileCard, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                    <Feather name="alert-circle" size={16} color="#ef4444" />
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#ef4444", flex: 1 }}>{e}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={{ gap: 8 }}>
              <Pressable
                onPress={() => router.push("/documents" as any)}
                style={[styles.primaryBtn, { backgroundColor: "#0f766e" }]}
              >
                <Feather name="folder" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Voir les documents</Text>
              </Pressable>
              <Pressable
                onPress={() => { setStep("pick"); setPickedFiles([]); setUploadedDocs([]); setErrors([]); setMetaValues({ category: "general" }); }}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Feather name="plus" size={16} color={colors.mutedForeground} />
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Importer d'autres documents</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#0f766e", paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  stepRow: { flexDirection: "row", alignItems: "center" },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stepNum: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stepLine: { flex: 1, height: 2, marginHorizontal: 4 },
  stepLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },
  scrollContent: { padding: 12, gap: 12 },
  dropZone: { borderRadius: 16, borderWidth: 2, borderStyle: "dashed", padding: 32, alignItems: "center", gap: 8 },
  dropTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  dropSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
  fileCard: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 10, gap: 10 },
  fileIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  fileMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  removeBtn: { padding: 4 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12 },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  infoTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 4 },
  formatRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  formatLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", width: 60 },
  formatDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  catChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tagInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: "Inter_400Regular" },
  doneCard: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center", gap: 10 },
  doneIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  doneTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
});
