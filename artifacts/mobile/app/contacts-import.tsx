import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface ContactRow {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  company: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

const EMPTY_ROW = (): ContactRow => ({ firstName: "", lastName: "", phone: "", email: "", company: "" });
const PASTE_PLACEHOLDER = `Prénom, Nom, Téléphone, Email, Société
Jean, Dupont, 0612345678, jean@example.com, ACME
Marie, Martin, 0698765432, marie@corp.fr, Corp SA`;

function parseTextRows(text: string): ContactRow[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const result: ContactRow[] = [];
  for (const line of lines) {
    if (line.toLowerCase().startsWith("prénom") || line.toLowerCase().startsWith("prenom") || line.toLowerCase().startsWith("firstname")) continue;
    const parts = line.split(",").map(p => p.trim());
    if (parts.length >= 1) {
      result.push({
        firstName: parts[0] || "",
        lastName: parts[1] || "",
        phone: parts[2] || "",
        email: parts[3] || "",
        company: parts[4] || "",
      });
    }
  }
  return result;
}

type Mode = "manual" | "paste";

export default function ContactsImportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [mode, setMode] = useState<Mode>("manual");
  const [rows, setRows] = useState<ContactRow[]>([EMPTY_ROW()]);
  const [pasteText, setPasteText] = useState("");
  const [parsedRows, setParsedRows] = useState<ContactRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"edit" | "preview" | "done">("edit");

  function updateRow(i: number, field: keyof ContactRow, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  function addRow() { setRows(prev => [...prev, EMPTY_ROW()]); }
  function removeRow(i: number) { setRows(prev => prev.filter((_, idx) => idx !== i)); }

  function handleParsePaste() {
    const parsed = parseTextRows(pasteText);
    if (parsed.length === 0) {
      Alert.alert("Aucun contact", "Impossible de lire les données. Vérifiez le format (Prénom, Nom, Téléphone, Email, Société — une ligne par contact).");
      return;
    }
    setParsedRows(parsed);
    setStep("preview");
  }

  function handlePreviewManual() {
    const valid = rows.filter(r => r.firstName.trim() || r.lastName.trim());
    if (valid.length === 0) {
      Alert.alert("Aucun contact", "Ajoutez au moins un contact avec un prénom ou un nom.");
      return;
    }
    setParsedRows(valid);
    setStep("preview");
  }

  async function handleImport() {
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      if (res.ok) {
        const d: ImportResult = await res.json();
        setResult(d);
        setStep("done");
      } else {
        Alert.alert("Erreur", "L'import a échoué. Réessayez.");
      }
    } catch {
      Alert.alert("Erreur réseau", "Impossible de contacter le serveur.");
    } finally { setLoading(false); }
  }

  function resetForm() {
    setRows([EMPTY_ROW()]);
    setPasteText("");
    setParsedRows([]);
    setResult(null);
    setStep("edit");
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#0369a1", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Importer des contacts</Text>
        </View>
        {step === "edit" && (
          <View style={styles.modeRow}>
            {(["manual", "paste"] as Mode[]).map(m => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.modeChip, { backgroundColor: mode === m ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)" }]}
              >
                <Feather name={m === "manual" ? "edit-3" : "clipboard"} size={13} color="#fff" />
                <Text style={styles.modeChipText}>{m === "manual" ? "Saisie manuelle" : "Coller / CSV"}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* DONE */}
        {step === "done" && result && (
          <View style={styles.doneContainer}>
            <View style={[styles.doneIcon, { backgroundColor: result.imported > 0 ? "#22c55e18" : "#ef444418" }]}>
              <Feather name={result.imported > 0 ? "check-circle" : "alert-circle"} size={48} color={result.imported > 0 ? "#22c55e" : "#ef4444"} />
            </View>
            <Text style={[styles.doneTitle, { color: colors.foreground }]}>
              Import terminé
            </Text>
            <View style={styles.doneStats}>
              <View style={[styles.doneStat, { backgroundColor: "#22c55e18" }]}>
                <Text style={[styles.doneStatNum, { color: "#22c55e" }]}>{result.imported}</Text>
                <Text style={[styles.doneStatLbl, { color: "#22c55e" }]}>Importés</Text>
              </View>
              <View style={[styles.doneStat, { backgroundColor: "#ef444418" }]}>
                <Text style={[styles.doneStatNum, { color: "#ef4444" }]}>{result.skipped}</Text>
                <Text style={[styles.doneStatLbl, { color: "#ef4444" }]}>Ignorés</Text>
              </View>
            </View>
            {result.errors.length > 0 && (
              <View style={[styles.errorsBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                <Text style={[styles.errorsTitle, { color: "#ef4444" }]}>Erreurs :</Text>
                {result.errors.slice(0, 5).map((e, i) => (
                  <Text key={i} style={[styles.errorLine, { color: "#ef4444" }]}>• {e}</Text>
                ))}
              </View>
            )}
            <View style={styles.doneActions}>
              <Pressable onPress={() => router.push("/(tabs)/contacts" as any)} style={[styles.primaryBtn, { backgroundColor: "#0369a1" }]}>
                <Feather name="users" size={15} color="#fff" />
                <Text style={styles.primaryBtnText}>Voir les contacts</Text>
              </Pressable>
              <Pressable onPress={resetForm} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Feather name="plus" size={15} color={colors.foreground} />
                <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Nouvel import</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* PREVIEW */}
        {step === "preview" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <View style={[styles.previewHeader, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
              <Feather name="eye" size={16} color="#0369a1" />
              <Text style={[styles.previewHeaderText, { color: "#0369a1" }]}>
                Aperçu — {parsedRows.length} contact{parsedRows.length !== 1 ? "s" : ""} à importer
              </Text>
            </View>
            {parsedRows.map((row, i) => (
              <View key={i} style={[styles.previewRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.previewAvatar, { backgroundColor: "#0369a1" }]}>
                  <Text style={styles.previewAvatarText}>
                    {((row.firstName[0] || "") + (row.lastName[0] || "")).toUpperCase() || "?"}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.previewName, { color: colors.foreground }]}>
                    {[row.firstName, row.lastName].filter(Boolean).join(" ") || "(Sans nom)"}
                  </Text>
                  {row.company ? <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>{row.company}</Text> : null}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                    {row.phone ? (
                      <View style={styles.chip}><Feather name="phone" size={10} color="#64748b" /><Text style={styles.chipText}>{row.phone}</Text></View>
                    ) : null}
                    {row.email ? (
                      <View style={styles.chip}><Feather name="mail" size={10} color="#64748b" /><Text style={styles.chipText}>{row.email}</Text></View>
                    ) : null}
                  </View>
                </View>
              </View>
            ))}
            <View style={styles.previewActions}>
              <Pressable onPress={() => setStep("edit")} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Feather name="arrow-left" size={15} color={colors.foreground} />
                <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Modifier</Text>
              </Pressable>
              <Pressable onPress={handleImport} disabled={loading} style={[styles.primaryBtn, { backgroundColor: "#0369a1", flex: 2, opacity: loading ? 0.7 : 1 }]}>
                {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="upload" size={15} color="#fff" />}
                <Text style={styles.primaryBtnText}>{loading ? "Import en cours…" : "Lancer l'import"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {/* EDIT — PASTE MODE */}
        {step === "edit" && mode === "paste" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View style={[styles.infoBox, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
              <Feather name="info" size={14} color="#0369a1" />
              <Text style={[styles.infoText, { color: "#0369a1" }]}>
                Collez vos contacts en format CSV ou texte brut : une ligne par contact, champs séparés par des virgules.
              </Text>
            </View>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Données à importer</Text>
            <TextInput
              style={[styles.pasteArea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              value={pasteText}
              onChangeText={setPasteText}
              placeholder={PASTE_PLACEHOLDER}
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={10}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              Format : Prénom, Nom, Téléphone, Email, Société (l'entête est optionnel)
            </Text>
            <Pressable
              onPress={handleParsePaste}
              disabled={!pasteText.trim()}
              style={[styles.primaryBtn, { backgroundColor: "#0369a1", opacity: !pasteText.trim() ? 0.6 : 1, marginTop: 16 }]}
            >
              <Feather name="eye" size={15} color="#fff" />
              <Text style={styles.primaryBtnText}>Prévisualiser</Text>
            </Pressable>
          </ScrollView>
        )}

        {/* EDIT — MANUAL MODE */}
        {step === "edit" && mode === "manual" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            {rows.map((row, i) => (
              <View key={i} style={[styles.manualCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.manualCardHeader}>
                  <View style={[styles.manualNum, { backgroundColor: "#0369a1" }]}>
                    <Text style={styles.manualNumText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.manualCardTitle, { color: colors.foreground }]}>Contact {i + 1}</Text>
                  {rows.length > 1 && (
                    <Pressable onPress={() => removeRow(i)} style={styles.removeBtn}>
                      <Feather name="x" size={16} color="#ef4444" />
                    </Pressable>
                  )}
                </View>
                <View style={styles.manualFields}>
                  {[
                    { key: "firstName" as const, label: "Prénom", placeholder: "Jean" },
                    { key: "lastName" as const, label: "Nom", placeholder: "Dupont" },
                    { key: "phone" as const, label: "Téléphone", placeholder: "0612345678" },
                    { key: "email" as const, label: "Email", placeholder: "jean@example.com" },
                    { key: "company" as const, label: "Société", placeholder: "ACME Corp" },
                  ].map(f => (
                    <View key={f.key} style={[styles.manualField, { borderColor: colors.border }]}>
                      <Text style={[styles.manualFieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                      <TextInput
                        style={[styles.manualFieldInput, { color: colors.foreground }]}
                        value={row[f.key]}
                        onChangeText={v => updateRow(i, f.key, v)}
                        placeholder={f.placeholder}
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType={f.key === "phone" ? "phone-pad" : f.key === "email" ? "email-address" : "default"}
                        autoCapitalize={f.key === "email" ? "none" : "words"}
                        autoCorrect={false}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))}

            <Pressable onPress={addRow} style={[styles.addRowBtn, { borderColor: "#0369a1" }]}>
              <Feather name="plus" size={16} color="#0369a1" />
              <Text style={[styles.addRowText, { color: "#0369a1" }]}>Ajouter un contact</Text>
            </Pressable>

            <Pressable
              onPress={handlePreviewManual}
              style={[styles.primaryBtn, { backgroundColor: "#0369a1", marginTop: 16 }]}
            >
              <Feather name="eye" size={15} color="#fff" />
              <Text style={styles.primaryBtnText}>Prévisualiser ({rows.filter(r => r.firstName.trim() || r.lastName.trim()).length} contact{rows.filter(r => r.firstName.trim() || r.lastName.trim()).length !== 1 ? "s" : ""})</Text>
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#0369a1", paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  modeRow: { flexDirection: "row", gap: 8 },
  modeChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  modeChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  doneContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16 },
  doneIcon: { width: 90, height: 90, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  doneTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  doneStats: { flexDirection: "row", gap: 12, width: "100%" },
  doneStat: { flex: 1, alignItems: "center", padding: 14, borderRadius: 14 },
  doneStatNum: { fontSize: 28, fontFamily: "Inter_700Bold" },
  doneStatLbl: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  errorsBox: { width: "100%", borderRadius: 10, borderWidth: 1, padding: 12, gap: 4 },
  errorsTitle: { fontSize: 12, fontFamily: "Inter_700Bold", marginBottom: 4 },
  errorLine: { fontSize: 11, fontFamily: "Inter_400Regular" },
  doneActions: { width: "100%", gap: 8 },
  previewHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  previewHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  previewRow: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8, alignItems: "flex-start" },
  previewAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  previewAvatarText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  previewName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  previewSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#f1f5f9", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  chipText: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#64748b" },
  previewActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12 },
  primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12, borderWidth: 1, flex: 1 },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  infoBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 14 },
  infoText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  pasteArea: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 12, fontFamily: "Inter_400Regular", minHeight: 180, lineHeight: 18 },
  fieldHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 6, lineHeight: 16 },
  manualCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  manualCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  manualNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  manualNumText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  manualCardTitle: { fontSize: 14, fontFamily: "Inter_700Bold", flex: 1 },
  removeBtn: { padding: 4 },
  manualFields: { gap: 2 },
  manualField: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, paddingVertical: 10, gap: 10 },
  manualFieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 70 },
  manualFieldInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  addRowBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed" },
  addRowText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
