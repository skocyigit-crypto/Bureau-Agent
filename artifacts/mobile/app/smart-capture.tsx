import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const ACCENT = "#0d9488";

interface SuggestedAction {
  action: string;
  module: string;
  label: string;
  description: string;
  data: Record<string, any>;
  priority: "haute" | "moyenne" | "basse";
}

interface RelatedEntity {
  type: string;
  id: number;
  name: string;
  matchReason: string;
}

interface AnalysisResult {
  documentType: string;
  confidence: number;
  title: string;
  summary: string;
  destination: string;
  destinationReason: string;
  extractedFields: Record<string, any>;
  suggestedActions: SuggestedAction[];
  relatedEntities: RelatedEntity[];
  warnings: string[];
}

interface ActionResult {
  success: boolean;
  module: string;
  action: string;
  message: string;
  createdId?: number;
}

interface Capture {
  uri: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

const DOC_TYPE_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  facture:         { label: "Facture",            color: "#ef4444", icon: "file-text" },
  devis:           { label: "Devis",              color: "#f59e0b", icon: "file" },
  bon_commande:    { label: "Bon de commande",    color: "#8b5cf6", icon: "shopping-cart" },
  bon_livraison:   { label: "Bon de livraison",   color: "#7c3aed", icon: "package" },
  contrat:         { label: "Contrat",            color: "#b45309", icon: "file-text" },
  courrier:        { label: "Courrier",           color: "#64748b", icon: "mail" },
  carte_visite:    { label: "Carte de visite",    color: "#0d9488", icon: "credit-card" },
  releve_bancaire: { label: "Relevé bancaire",    color: "#15803d", icon: "dollar-sign" },
  note_frais:      { label: "Note de frais",      color: "#65a30d", icon: "dollar-sign" },
  cv:              { label: "CV / Résumé",         color: "#16a34a", icon: "user" },
  rapport:         { label: "Rapport",            color: "#0891b2", icon: "bar-chart-2" },
  formulaire:      { label: "Formulaire",         color: "#db2777", icon: "list" },
  piece_identite:  { label: "Pièce d'identité",   color: "#ef4444", icon: "shield" },
  attestation:     { label: "Attestation",        color: "#ca8a04", icon: "award" },
  planning:        { label: "Planning",           color: "#0284c7", icon: "calendar" },
  inventaire:      { label: "Inventaire",         color: "#0d9488", icon: "list" },
  inconnu:         { label: "Type inconnu",       color: "#94a3b8", icon: "file" },
};

const PRIORITY_MAP: Record<string, { color: string; label: string }> = {
  haute:   { color: "#ef4444", label: "Haute" },
  moyenne: { color: "#f59e0b", label: "Moyenne" },
  basse:   { color: "#22c55e", label: "Basse" },
};

const MODULE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  contacts: "users", prospects: "user-plus", taches: "check-square",
  factures: "file-text", devis: "file", stock: "package",
  projets: "folder", messages: "message-square", aucun: "x-circle",
};

// Champs mis en avant en tete de la fiche de triage (montant a payer, echeance,
// fournisseur). On cherche plusieurs alias car l'IA ne nomme pas toujours pareil.
const KEY_FIELD_ALIASES: { label: string; icon: keyof typeof Feather.glyphMap; keys: string[] }[] = [
  { label: "Montant TTC", icon: "dollar-sign", keys: ["montantTTC", "montant_ttc", "montantTotal", "montant"] },
  { label: "Échéance",     icon: "calendar",    keys: ["echeance", "dateEcheance", "date_echeance", "dueDate", "validite"] },
  { label: "Émetteur",     icon: "briefcase",   keys: ["fournisseur", "expediteur", "societe", "client", "emetteur"] },
  { label: "Référence",    icon: "hash",        keys: ["numero", "reference", "ref"] },
];

function pickField(fields: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = fields[k];
    if (v != null && String(v).trim() !== "") return Array.isArray(v) ? v.join(", ") : String(v);
  }
  return null;
}

export default function SmartCaptureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [capture, setCapture] = useState<Capture | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [actionResults, setActionResults] = useState<ActionResult[]>([]);

  // Edition des champs cles avant validation (montant / echeance / contact lie).
  // On garde la valeur courante + la valeur initiale lue de l'IA: on ne pousse
  // un override que pour les champs reellement modifies par l'utilisateur, afin
  // de ne jamais forcer un contact que l'IA n'avait pas proposé.
  const [editing, setEditing] = useState(false);
  const [editMontant, setEditMontant] = useState("");
  const [editEcheance, setEditEcheance] = useState("");
  const [editContactId, setEditContactId] = useState<number | null>(null);
  const [initMontant, setInitMontant] = useState("");
  const [initEcheance, setInitEcheance] = useState("");
  const [initContactId, setInitContactId] = useState<number | null>(null);

  function assetToCapture(asset: ImagePicker.ImagePickerAsset): Capture {
    const ext = (asset.mimeType?.split("/")[1] || "jpg").replace("jpeg", "jpg");
    return {
      uri: asset.uri,
      base64: asset.base64 ?? "",
      mimeType: asset.mimeType || "image/jpeg",
      fileName: asset.fileName || `capture-${Date.now()}.${ext}`,
    };
  }

  async function takePhoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Autorisation requise", "Activez l'accès à la caméra pour photographier un document.");
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.6,
        base64: true,
        allowsEditing: false,
      });
      if (!shot.canceled && shot.assets[0]?.base64) {
        setCapture(assetToCapture(shot.assets[0]));
        setResult(null);
        setActionResults([]);
      }
    } catch {
      Alert.alert("Erreur caméra", "Impossible d'ouvrir la caméra.");
    }
  }

  async function pickFromGallery() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Autorisation requise", "Activez l'accès à la galerie pour choisir une image.");
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.6,
        base64: true,
      });
      if (!picked.canceled && picked.assets[0]?.base64) {
        setCapture(assetToCapture(picked.assets[0]));
        setResult(null);
        setActionResults([]);
      }
    } catch {
      Alert.alert("Erreur galerie", "Impossible d'ouvrir la galerie.");
    }
  }

  async function analyse() {
    if (!capture?.base64) return;
    // Garde de taille: le parser JSON du serveur plafonne bien avant les 25 Mo
    // metier. base64 ~= 4/3 des octets bruts -> on bloque au-dela de ~13 Mo bruts.
    const approxBytes = Math.floor(capture.base64.length * 0.75);
    if (approxBytes > 13 * 1024 * 1024) {
      Alert.alert("Image trop lourde", "Cette photo est trop volumineuse. Reprenez-la d'un peu plus loin ou réessayez.");
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAnalysing(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/document-ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileContent: capture.base64,
          mimeType: capture.mimeType,
          fileName: capture.fileName,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Analyse impossible", err.error ?? "Impossible d'analyser cette image.");
        return;
      }
      const d: AnalysisResult = await res.json();
      setResult(d);
      // Pre-remplir les champs editables avec ce que l'IA a lu.
      const f = d.extractedFields || {};
      const m = pickField(f, KEY_FIELD_ALIASES[0].keys) ?? "";
      const e = pickField(f, KEY_FIELD_ALIASES[1].keys) ?? "";
      // Ne pre-selectionner un contact QUE si l'IA en a explicitement fourni un.
      // Sinon on laisse vide: l'utilisateur le choisira lui-meme (sa selection
      // devient alors une vraie modification -> envoyee a la validation).
      const rawContact = f.relatedContactId ?? f.contactId ?? null;
      const cId = typeof rawContact === "number" ? rawContact : Number(rawContact);
      const initC = Number.isFinite(cId) && cId > 0 ? cId : null;
      setEditMontant(m); setInitMontant(m);
      setEditEcheance(e); setInitEcheance(e);
      setEditContactId(initC); setInitContactId(initC);
      setEditing(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Erreur réseau", "Impossible de contacter le serveur.");
    } finally {
      setAnalysing(false);
    }
  }

  // Construit les overrides a partir des SEULS champs modifies. On les pousse a
  // la fois dans extractedFields et dans action.data (cote serveur, action.data
  // ecrase extractedFields) pour garantir que la valeur editee soit bien prise.
  function buildOverrides(): Record<string, any> {
    const ov: Record<string, any> = {};
    const m = editMontant.trim();
    if (m !== initMontant.trim()) {
      ov.montantTTC = m; ov.montant = m; ov.montantTotal = m;
    }
    const e = editEcheance.trim();
    if (e !== initEcheance.trim()) {
      ov.echeance = e; ov.dueDate = e; ov.dateEcheance = e;
    }
    if (editContactId !== initContactId) {
      ov.relatedContactId = editContactId; ov.contactId = editContactId;
    }
    return ov;
  }

  function applyOverrides(act: SuggestedAction, ov: Record<string, any>): SuggestedAction {
    return Object.keys(ov).length ? { ...act, data: { ...act.data, ...ov } } : act;
  }

  async function runAction(act: SuggestedAction) {
    if (!result) return;
    setActionLoading(act.action + act.label);
    try {
      const ov = buildOverrides();
      const res = await fetchAuth(`${API_BASE}/api/document-ai/execute-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: applyOverrides(act, ov),
          extractedFields: { ...result.extractedFields, ...ov },
        }),
      });
      const d = await res.json().catch(() => ({ success: false, message: "Erreur" }));
      setActionResults(prev => [...prev, { ...d, action: act.action, module: act.module }]);
      if (d.success && Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setActionResults(prev => [...prev, { success: false, action: act.action, module: act.module, message: "Erreur réseau" }]);
    } finally {
      setActionLoading(null);
    }
  }

  async function runAll() {
    if (!result) return;
    const pending = result.suggestedActions.filter(
      a => !actionResults.find(r => r.action === a.action && r.module === a.module),
    );
    if (pending.length === 0) return;
    setBatchLoading(true);
    try {
      const ov = buildOverrides();
      const res = await fetchAuth(`${API_BASE}/api/document-ai/batch-execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actions: pending.map(a => applyOverrides(a, ov)),
          extractedFields: { ...result.extractedFields, ...ov },
        }),
      });
      const d = await res.json().catch(() => ({ results: [] }));
      const results: ActionResult[] = Array.isArray(d.results) ? d.results : [];
      setActionResults(prev => [...prev, ...results]);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Erreur réseau", "Impossible de valider les actions.");
    } finally {
      setBatchLoading(false);
    }
  }

  function reset() {
    setCapture(null);
    setResult(null);
    setActionResults([]);
    setEditing(false);
    setEditMontant(""); setInitMontant("");
    setEditEcheance(""); setInitEcheance("");
    setEditContactId(null); setInitContactId(null);
  }

  const docCfg = result ? (DOC_TYPE_MAP[result.documentType] ?? DOC_TYPE_MAP.inconnu) : null;
  // Champs effectifs = lecture IA + overrides edites, pour que la fiche reflete
  // immediatement ce qui sera reellement envoye a la validation.
  const effectiveFields = result ? { ...result.extractedFields, ...buildOverrides() } : {};
  const keyFields = result
    ? KEY_FIELD_ALIASES.map(f => ({ ...f, value: pickField(effectiveFields, f.keys) })).filter(f => f.value)
    : [];
  const detectedContacts = result
    ? result.relatedEntities.filter(e => e.type === "contacts" || e.type === "contact")
    : [];
  const selectedContact = detectedContacts.find(c => c.id === editContactId) ?? null;
  const edited =
    editMontant.trim() !== initMontant.trim() ||
    editEcheance.trim() !== initEcheance.trim() ||
    editContactId !== initContactId;
  const pendingCount = result
    ? result.suggestedActions.filter(a => !actionResults.find(r => r.action === a.action && r.module === a.module)).length
    : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Capture Intelligente</Text>
          <Text style={styles.headerSub}>Photographiez un courrier ou une facture</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: isWeb ? 118 : 100 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* Capture zone */}
        {!capture ? (
          <View style={[styles.captureCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.captureIcon, { backgroundColor: ACCENT + "18" }]}>
              <Feather name="camera" size={30} color={ACCENT} />
            </View>
            <Text style={[styles.captureTitle, { color: colors.foreground }]}>Capturez un document</Text>
            <Text style={[styles.captureSub, { color: colors.mutedForeground }]}>
              L'IA lit la facture ou le courrier, le relie au bon contact et vous propose les prochaines actions.
            </Text>
            <Pressable onPress={takePhoto} style={styles.primaryBtn}>
              <Feather name="camera" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Prendre une photo</Text>
            </Pressable>
            <Pressable onPress={pickFromGallery} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
              <Feather name="image" size={16} color={colors.mutedForeground} />
              <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Choisir dans la galerie</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Image source={{ uri: capture.uri }} style={styles.previewImg} resizeMode="cover" />
            <Pressable onPress={reset} style={styles.previewRemove}>
              <Feather name="x" size={16} color="#fff" />
            </Pressable>
          </View>
        )}

        {capture && !result && (
          <Pressable onPress={analyse} disabled={analysing} style={[styles.primaryBtn, { marginTop: 12, opacity: analysing ? 0.7 : 1 }]}>
            {analysing ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="cpu" size={18} color="#fff" />}
            <Text style={styles.primaryBtnText}>{analysing ? "Analyse en cours…" : "Analyser avec l'IA"}</Text>
          </Pressable>
        )}

        {analysing && (
          <View style={[styles.analysingCard, { backgroundColor: ACCENT + "10", borderColor: ACCENT }]}>
            <ActivityIndicator size="small" color={ACCENT} />
            <Text style={[styles.analysingText, { color: ACCENT }]}>Lecture du document, extraction et triage…</Text>
          </View>
        )}

        {/* Triage result */}
        {result && docCfg && (
          <>
            <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.resultHead}>
                <View style={[styles.resultIcon, { backgroundColor: docCfg.color + "18" }]}>
                  <Feather name={docCfg.icon} size={20} color={docCfg.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.resultTitle, { color: colors.foreground }]} numberOfLines={2}>{result.title || docCfg.label}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
                    <View style={[styles.badge, { backgroundColor: docCfg.color + "18" }]}>
                      <Text style={[styles.badgeText, { color: docCfg.color }]}>{docCfg.label}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: result.confidence >= 0.8 ? "#22c55e18" : "#f59e0b18" }]}>
                      <Text style={[styles.badgeText, { color: result.confidence >= 0.8 ? "#22c55e" : "#f59e0b" }]}>
                        {Math.round(result.confidence * 100)}% confiance
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
              {!!result.summary && <Text style={[styles.summary, { color: colors.mutedForeground }]}>{result.summary}</Text>}

              {!editing && (keyFields.length > 0 || selectedContact) && (
                <View style={styles.keyGrid}>
                  {keyFields.map((f, i) => (
                    <View key={i} style={[styles.keyChip, { backgroundColor: colors.background, borderColor: edited ? ACCENT + "55" : colors.border }]}>
                      <Feather name={f.icon} size={12} color={ACCENT} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.keyLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                        <Text style={[styles.keyValue, { color: colors.foreground }]} numberOfLines={1}>{f.value}</Text>
                      </View>
                    </View>
                  ))}
                  {selectedContact && (
                    <View style={[styles.keyChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Feather name="user-check" size={12} color={ACCENT} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.keyLabel, { color: colors.mutedForeground }]}>Contact lié</Text>
                        <Text style={[styles.keyValue, { color: colors.foreground }]} numberOfLines={1}>{selectedContact.name}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Panneau d'edition des champs cles avant validation */}
              {editing && (
                <View style={[styles.editPanel, { borderColor: ACCENT + "40", backgroundColor: ACCENT + "08" }]}>
                  <Text style={[styles.editFieldLabel, { color: colors.mutedForeground }]}>Montant TTC</Text>
                  <TextInput
                    value={editMontant}
                    onChangeText={setEditMontant}
                    keyboardType="decimal-pad"
                    placeholder="ex : 1250.00"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                  />
                  <Text style={[styles.editFieldLabel, { color: colors.mutedForeground }]}>Échéance</Text>
                  <TextInput
                    value={editEcheance}
                    onChangeText={setEditEcheance}
                    autoCapitalize="none"
                    placeholder="AAAA-MM-JJ"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                  />
                  <Text style={[styles.editFieldLabel, { color: colors.mutedForeground }]}>Contact lié</Text>
                  {detectedContacts.length > 0 ? (
                    <View style={styles.contactChipRow}>
                      <Pressable
                        onPress={() => setEditContactId(null)}
                        style={[styles.contactChip, { borderColor: editContactId === null ? ACCENT : colors.border, backgroundColor: editContactId === null ? ACCENT + "18" : colors.card }]}
                      >
                        <Text style={[styles.contactChipText, { color: editContactId === null ? ACCENT : colors.mutedForeground }]}>Aucun</Text>
                      </Pressable>
                      {detectedContacts.map((c, i) => {
                        const sel = editContactId === c.id;
                        return (
                          <Pressable
                            key={i}
                            onPress={() => setEditContactId(c.id)}
                            style={[styles.contactChip, { borderColor: sel ? ACCENT : colors.border, backgroundColor: sel ? ACCENT + "18" : colors.card }]}
                          >
                            <Feather name="user" size={11} color={sel ? ACCENT : colors.mutedForeground} />
                            <Text style={[styles.contactChipText, { color: sel ? ACCENT : colors.foreground }]} numberOfLines={1}>{c.name || "Contact"}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={[styles.editHint, { color: colors.mutedForeground }]}>Aucun contact détecté à lier.</Text>
                  )}
                </View>
              )}

              <Pressable
                onPress={() => setEditing(v => !v)}
                style={[styles.editToggle, { borderColor: editing ? ACCENT : colors.border, backgroundColor: editing ? ACCENT + "12" : "transparent" }]}
              >
                <Feather name={editing ? "check" : "edit-2"} size={13} color={editing ? ACCENT : colors.mutedForeground} />
                <Text style={[styles.editToggleText, { color: editing ? ACCENT : colors.mutedForeground }]}>
                  {editing ? "Terminer la modification" : edited ? "Informations modifiées · ajuster" : "Modifier les informations"}
                </Text>
              </Pressable>
            </View>

            {/* Related contacts */}
            {result.relatedEntities.length > 0 && (
              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Contacts liés détectés</Text>
                {result.relatedEntities.slice(0, 5).map((e, i) => (
                  <View key={i} style={[styles.relRow, { borderColor: colors.border }]}>
                    <View style={[styles.relIcon, { backgroundColor: ACCENT + "18" }]}>
                      <Feather name={MODULE_ICONS[e.type] ?? "user"} size={13} color={ACCENT} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.relName, { color: colors.foreground }]} numberOfLines={1}>{e.name || "Contact"}</Text>
                      <Text style={[styles.relReason, { color: colors.mutedForeground }]} numberOfLines={1}>{e.matchReason}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Suggested actions */}
            {result.suggestedActions.length > 0 && (
              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.actionsHead}>
                  <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Actions proposées</Text>
                  {pendingCount > 1 && (
                    <Pressable onPress={runAll} disabled={batchLoading} style={[styles.allBtn, { opacity: batchLoading ? 0.6 : 1 }]}>
                      {batchLoading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="check-circle" size={13} color="#fff" />}
                      <Text style={styles.allBtnText}>Tout valider</Text>
                    </Pressable>
                  )}
                </View>
                {result.suggestedActions.map((act, i) => {
                  const prio = PRIORITY_MAP[act.priority] ?? PRIORITY_MAP.moyenne;
                  const done = actionResults.find(r => r.action === act.action && r.module === act.module);
                  const loadingKey = act.action + act.label;
                  return (
                    <View key={i} style={[styles.actionItem, { borderColor: colors.border }]}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                        <Feather name={MODULE_ICONS[act.module] ?? "arrow-right"} size={14} color={ACCENT} style={{ marginTop: 2 }} />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <Text style={[styles.actionLabel, { color: colors.foreground }]}>{act.label}</Text>
                            <View style={[styles.prioBadge, { backgroundColor: prio.color + "18" }]}>
                              <Text style={[styles.prioBadgeText, { color: prio.color }]}>{prio.label}</Text>
                            </View>
                          </View>
                          {!!act.description && <Text style={[styles.actionDesc, { color: colors.mutedForeground }]}>{act.description}</Text>}
                        </View>
                      </View>
                      {done ? (
                        <View style={[styles.doneRow, { backgroundColor: done.success ? "#22c55e18" : "#ef444418" }]}>
                          <Feather name={done.success ? "check" : "x"} size={13} color={done.success ? "#22c55e" : "#ef4444"} />
                          <Text style={[styles.doneText, { color: done.success ? "#16a34a" : "#ef4444" }]} numberOfLines={2}>{done.message}</Text>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => runAction(act)}
                          disabled={!!actionLoading || batchLoading}
                          style={[styles.execBtn, { opacity: actionLoading || batchLoading ? 0.5 : 1 }]}
                        >
                          {actionLoading === loadingKey ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="zap" size={13} color="#fff" />}
                          <Text style={styles.execBtnText}>Valider</Text>
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

            <Pressable onPress={reset} style={[styles.reanalyseBtn, { borderColor: colors.border }]}>
              <Feather name="camera" size={14} color={colors.mutedForeground} />
              <Text style={[styles.reanalyseBtnText, { color: colors.mutedForeground }]}>Capturer un autre document</Text>
            </Pressable>
          </>
        )}

        {/* Hint */}
        {!capture && !result && (
          <View style={[styles.hintCard, { backgroundColor: ACCENT + "0d", borderColor: ACCENT + "30" }]}>
            <Feather name="info" size={14} color={ACCENT} />
            <Text style={[styles.hintText, { color: colors.foreground }]}>
              Astuce : cadrez bien le document, à plat et bien éclairé. Vous validez chaque action avant qu'elle ne soit créée.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: ACCENT, paddingHorizontal: 20, paddingBottom: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 1 },
  content: { padding: 16, gap: 12 },
  captureCard: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: "center", gap: 10 },
  captureIcon: { width: 66, height: 66, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  captureTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  captureSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: ACCENT, alignSelf: "stretch" },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 12, borderWidth: 1, alignSelf: "stretch" },
  secondaryBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  previewCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden", position: "relative" },
  previewImg: { width: "100%", height: 220, backgroundColor: "#000" },
  previewRemove: { position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  analysingCard: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  analysingText: { fontSize: 12.5, fontFamily: "Inter_600SemiBold", flex: 1, lineHeight: 17 },
  resultCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  resultHead: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 10 },
  resultIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  summary: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  keyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  keyChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, width: "48%" },
  keyLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  keyValue: { fontSize: 12.5, fontFamily: "Inter_700Bold", marginTop: 1 },
  editPanel: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, gap: 6 },
  editFieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  editInput: { height: 42, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 14, fontFamily: "Inter_500Medium" },
  editHint: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  contactChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  contactChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, borderWidth: 1, maxWidth: "100%" },
  contactChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  editToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 38, borderRadius: 10, borderWidth: 1, marginTop: 12 },
  editToggleText: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 10 },
  relRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1 },
  relIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  relName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  relReason: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  actionsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  allBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: ACCENT, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  allBtnText: { color: "#fff", fontSize: 11.5, fontFamily: "Inter_600SemiBold" },
  actionItem: { paddingVertical: 10, borderTopWidth: 1, gap: 8 },
  actionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actionDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1, lineHeight: 17 },
  prioBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  prioBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  execBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: ACCENT, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, alignSelf: "flex-end" },
  execBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  doneRow: { flexDirection: "row", gap: 6, padding: 8, borderRadius: 8, alignItems: "center" },
  doneText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  warnCard: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, backgroundColor: "#fefce8" },
  warnText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  reanalyseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, borderWidth: 1 },
  reanalyseBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hintCard: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: "flex-start" },
  hintText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, flex: 1 },
});
