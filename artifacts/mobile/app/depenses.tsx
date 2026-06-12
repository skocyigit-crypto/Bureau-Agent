import { Feather } from "@expo/vector-icons";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const ACCENT = "#0d9488";

// Libellés français des catégories — alignés sur EXPENSE_CATEGORIES (schéma) et
// sur la page web (buro-ajani/src/pages/depenses.tsx).
const CATEGORY_LABELS: Record<string, string> = {
  carburant: "Carburant",
  fournitures: "Fournitures",
  materiel: "Matériel / outillage",
  sous_traitance: "Sous-traitance",
  loyer: "Loyer",
  assurance: "Assurance",
  telephone_internet: "Téléphone / Internet",
  repas: "Repas",
  deplacement: "Déplacement",
  entretien_vehicule: "Entretien véhicule",
  honoraires: "Honoraires",
  taxes: "Taxes / cotisations",
  autre: "Autre",
};

const SOURCE_LABELS: Record<string, string> = {
  upload: "Téléversement",
  gmail: "E-mail",
  manuel: "Saisie manuelle",
};

interface Depense {
  id: number;
  documentId: number | null;
  vendor: string;
  title: string | null;
  reference: string | null;
  category: string;
  expenseDate: string | null;
  dueDate: string | null;
  amountHt: string;
  amountTva: string;
  amountTtc: string;
  currency: string;
  status: string;
  paymentStatus: string;
  source: string;
  notes: string | null;
  duplicateOfId: number | null;
  createdAt: string;
}

interface Summary {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  approvedTotal: number;
  payableCount: number;
  payableTotal: number;
}

const EMPTY_SUMMARY: Summary = {
  pendingCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  approvedTotal: 0,
  payableCount: 0,
  payableTotal: 0,
};

type Tab = "queue" | "ledger";

function eur(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("fr-FR");
}

export default function DepensesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, authHeaders } = useAuth();
  const isWeb = Platform.OS === "web";

  const [tab, setTab] = useState<Tab>("queue");
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("status", tab === "queue" ? "en_attente" : "approuve");
        const res = await fetchAuth(`${API_BASE}/api/depenses?${params.toString()}`);
        if (!res.ok) throw new Error("load");
        const data = await res.json();
        setDepenses(Array.isArray(data.depenses) ? data.depenses : []);
        setSummary({ ...EMPTY_SUMMARY, ...(data.summary || {}) });
      } catch {
        Alert.alert("Erreur", "Impossible de charger les dépenses.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab, fetchAuth],
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load({ silent: true });
  }, [load]);

  const act = useCallback(
    async (id: number, action: "approve" | "reject") => {
      setBusyId(id);
      try {
        const res = await fetchAuth(`${API_BASE}/api/depenses/${id}/${action}`, { method: "POST" });
        if (!res.ok) throw new Error("act");
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Retire la ligne traitée localement pour un retour immédiat, puis
        // rafraîchit les compteurs en arrière-plan.
        setDepenses((prev) => prev.filter((d) => d.id !== id));
        load({ silent: true });
      } catch {
        Alert.alert("Erreur", "L'action a échoué.");
      } finally {
        setBusyId(null);
      }
    },
    [fetchAuth, load],
  );

  // Capture d'un justificatif : on téléverse la photo via /api/documents/upload.
  // Le serveur déclenche alors la capture automatique (Document IA) en
  // arrière-plan ; si le document est reconnu comme facture / note de frais avec
  // un montant, une dépense « en attente » apparaît dans la file d'inspection.
  const uploadReceipt = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      const ext = (asset.mimeType?.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const mimeType = asset.mimeType || "image/jpeg";
      const fileName = asset.fileName || `recu-${Date.now()}.${ext}`;
      if (asset.fileSize && asset.fileSize > 25 * 1024 * 1024) {
        Alert.alert("Image trop lourde", "Cette photo dépasse 25 Mo. Reprenez-la d'un peu plus loin.");
        return;
      }
      setUploading(true);
      setCaptureNotice(null);
      const url = `${API_BASE}/api/documents/upload`;
      try {
        let status: number;
        if (isWeb) {
          const blob = await (await fetch(asset.uri)).blob();
          const form = new FormData();
          form.append("fileName", fileName);
          form.append("mimeType", mimeType);
          form.append("category", "facture");
          form.append("file", blob, fileName);
          const res = await fetchAuth(url, { method: "POST", body: form });
          status = res.status;
        } else {
          const res = await uploadAsync(url, asset.uri, {
            httpMethod: "POST",
            uploadType: FileSystemUploadType.MULTIPART,
            fieldName: "file",
            mimeType,
            parameters: { fileName, mimeType, category: "facture" },
            headers: authHeaders(),
          });
          status = res.status;
        }
        if (status < 200 || status >= 300) {
          Alert.alert("Envoi impossible", "Le justificatif n'a pas pu être envoyé.");
          return;
        }
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTab("queue");
        setCaptureNotice("Justificatif envoyé. L'IA l'analyse — la dépense apparaîtra ici dans quelques instants.");
        // La capture est asynchrone côté serveur : on rafraîchit après un court
        // délai pour laisser le temps à Document IA d'extraire les champs.
        setTimeout(() => load({ silent: true }), 4500);
      } catch {
        Alert.alert("Erreur réseau", "Impossible de contacter le serveur.");
      } finally {
        setUploading(false);
      }
    },
    [isWeb, fetchAuth, authHeaders, load],
  );

  const takePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Autorisation requise", "Activez l'accès à la caméra pour photographier un justificatif.");
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, allowsEditing: false });
      if (!shot.canceled && shot.assets[0]?.uri) await uploadReceipt(shot.assets[0]);
    } catch {
      Alert.alert("Erreur caméra", "Impossible d'ouvrir la caméra.");
    }
  }, [uploadReceipt]);

  const pickFromGallery = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Autorisation requise", "Activez l'accès à la galerie pour choisir un justificatif.");
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
      if (!picked.canceled && picked.assets[0]?.uri) await uploadReceipt(picked.assets[0]);
    } catch {
      Alert.alert("Erreur galerie", "Impossible d'ouvrir la galerie.");
    }
  }, [uploadReceipt]);

  const renderItem = useCallback(
    ({ item: d }: { item: Depense }) => (
      <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.rowTop}>
            <Text style={[styles.vendor, { color: colors.foreground }]} numberOfLines={1}>
              {d.vendor || "Fournisseur inconnu"}
            </Text>
            <View style={[styles.catBadge, { backgroundColor: ACCENT + "18" }]}>
              <Text style={[styles.catBadgeText, { color: ACCENT }]} numberOfLines={1}>
                {CATEGORY_LABELS[d.category] || d.category}
              </Text>
            </View>
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {fmtDate(d.expenseDate)}
            {d.reference ? ` · réf. ${d.reference}` : ""}
            {` · ${SOURCE_LABELS[d.source] || d.source}`}
          </Text>
          <View style={styles.tagRow}>
            {d.duplicateOfId ? (
              <View style={[styles.tag, { backgroundColor: "#f59e0b18" }]}>
                <Feather name="alert-triangle" size={10} color="#b45309" />
                <Text style={[styles.tagText, { color: "#b45309" }]}>Doublon ?</Text>
              </View>
            ) : null}
            {d.paymentStatus === "paye" ? (
              <View style={[styles.tag, { backgroundColor: "#22c55e18" }]}>
                <Text style={[styles.tagText, { color: "#15803d" }]}>Payé</Text>
              </View>
            ) : (
              <View style={[styles.tag, { backgroundColor: colors.background }]}>
                <Text style={[styles.tagText, { color: colors.mutedForeground }]}>À payer</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.rowRight}>
          <Text style={[styles.amount, { color: colors.foreground }]}>{eur(Number(d.amountTtc))}</Text>
          <Text style={[styles.amountSub, { color: colors.mutedForeground }]}>
            HT {eur(Number(d.amountHt))}
          </Text>
          {tab === "queue" ? (
            <View style={styles.actions}>
              <Pressable
                onPress={() => act(d.id, "reject")}
                disabled={busyId === d.id}
                style={[styles.actBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Feather name="x" size={16} color={colors.destructive} />
              </Pressable>
              <Pressable
                onPress={() => act(d.id, "approve")}
                disabled={busyId === d.id}
                style={[styles.actBtn, { backgroundColor: ACCENT, borderColor: ACCENT }]}
              >
                {busyId === d.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="check" size={16} color="#fff" />
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    ),
    [colors, tab, busyId, act],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Dépenses</Text>
          <Text style={styles.headerSub}>Justificatifs à valider et registre</Text>
        </View>
      </View>

      <FlatList
        data={depenses}
        keyExtractor={(d) => String(d.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 40 : 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {/* Synthèse */}
            <View style={styles.summaryGrid}>
              <View style={[styles.sumCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>En attente</Text>
                <Text style={[styles.sumValue, { color: colors.foreground }]}>{summary.pendingCount}</Text>
              </View>
              <View style={[styles.sumCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>Approuvées</Text>
                <Text style={[styles.sumValue, { color: colors.foreground }]}>{summary.approvedCount}</Text>
              </View>
              <View style={[styles.sumCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>Total registre</Text>
                <Text style={[styles.sumValue, { color: colors.foreground }]} numberOfLines={1}>
                  {eur(summary.approvedTotal)}
                </Text>
              </View>
              <View style={[styles.sumCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>Reste à payer</Text>
                <Text style={[styles.sumValue, { color: colors.foreground }]} numberOfLines={1}>
                  {eur(summary.payableTotal)}
                </Text>
              </View>
            </View>

            {/* Capture d'un justificatif */}
            <View style={[styles.captureCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.captureHead}>
                <View style={[styles.captureIcon, { backgroundColor: ACCENT + "18" }]}>
                  <Feather name="camera" size={18} color={ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.captureTitle, { color: colors.foreground }]}>Photographier un reçu</Text>
                  <Text style={[styles.captureSub, { color: colors.mutedForeground }]}>
                    L'IA lit le montant et le fournisseur, puis crée la dépense à valider.
                  </Text>
                </View>
              </View>
              <View style={styles.captureBtns}>
                <Pressable onPress={takePhoto} disabled={uploading} style={[styles.primaryBtn, { opacity: uploading ? 0.7 : 1 }]}>
                  {uploading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Feather name="camera" size={16} color="#fff" />
                  )}
                  <Text style={styles.primaryBtnText}>{uploading ? "Envoi…" : "Photo"}</Text>
                </Pressable>
                <Pressable
                  onPress={pickFromGallery}
                  disabled={uploading}
                  style={[styles.secondaryBtn, { borderColor: colors.border, opacity: uploading ? 0.7 : 1 }]}
                >
                  <Feather name="image" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Galerie</Text>
                </Pressable>
              </View>
              {captureNotice ? (
                <View style={[styles.notice, { backgroundColor: ACCENT + "10", borderColor: ACCENT + "40" }]}>
                  <Feather name="info" size={13} color={ACCENT} />
                  <Text style={[styles.noticeText, { color: ACCENT }]}>{captureNotice}</Text>
                </View>
              ) : null}
            </View>

            {/* Onglets */}
            <View style={[styles.tabs, { backgroundColor: colors.muted }]}>
              {(["queue", "ledger"] as Tab[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={[styles.tabBtn, tab === t && { backgroundColor: colors.card }]}
                >
                  <Feather
                    name={t === "queue" ? "inbox" : "book-open"}
                    size={14}
                    color={tab === t ? ACCENT : colors.mutedForeground}
                  />
                  <Text style={[styles.tabText, { color: tab === t ? ACCENT : colors.mutedForeground }]}>
                    {t === "queue" ? `File (${summary.pendingCount})` : "Registre"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={ACCENT} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name={tab === "queue" ? "inbox" : "book-open"} size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {tab === "queue"
                  ? "Aucun justificatif en attente. Photographiez un reçu pour démarrer."
                  : "Aucune dépense enregistrée."}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    backgroundColor: ACCENT,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 1 },
  listContent: { padding: 12, gap: 10 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sumCard: { flexGrow: 1, flexBasis: "47%", borderRadius: 12, borderWidth: 1, padding: 12 },
  sumLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  sumValue: { fontSize: 19, fontFamily: "Inter_700Bold", marginTop: 4 },
  captureCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  captureHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  captureIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  captureTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  captureSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  captureBtns: { flexDirection: "row", gap: 8 },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  primaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  noticeText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  tabs: { flexDirection: "row", borderRadius: 10, padding: 4, gap: 4 },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  vendor: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  catBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, maxWidth: 130 },
  catBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  tag: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowRight: { alignItems: "flex-end", gap: 2 },
  amount: { fontSize: 15, fontFamily: "Inter_700Bold" },
  amountSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 6, marginTop: 6 },
  actBtn: { width: 38, height: 34, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 32 },
});
