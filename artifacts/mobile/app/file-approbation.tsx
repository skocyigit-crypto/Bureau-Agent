/**
 * File d'approbation — pendant mobile de l'écran web du même nom.
 *
 * Jusqu'ici, approuver une action proposée par l'IA n'était possible que
 * depuis le bureau: rien dans l'app mobile ne touchait `agent-queue`. Or les
 * propositions les plus urgentes (relance client, annulation de rendez-vous
 * demandée par téléphone) arrivent souvent quand le dirigeant n'est pas devant
 * son ordinateur — l'action restait bloquée en file.
 *
 * Même règle que sur le web: on montre le contenu réel avant d'exécuter, et
 * l'exécution n'a lieu qu'après confirmation explicite.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const QUEUE_API = `${API_BASE}/api/agent-queue`;

interface Proposal {
  id: number;
  toolName: string;
  title: string;
  summary: string;
  reason: string;
  args: Record<string, unknown>;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
}

const PRIORITY_COLOR: Record<string, string> = {
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#3b82f6",
};

const CATEGORY_META: Record<string, { label: string; icon: keyof typeof Feather.glyphMap }> = {
  email: { label: "E-mail", icon: "mail" },
  sms: { label: "SMS", icon: "message-square" },
  tache: { label: "Tâche", icon: "check-square" },
  relance: { label: "Relance", icon: "repeat" },
  rappel: { label: "Rappel", icon: "bell" },
  contact: { label: "Contact", icon: "user-plus" },
};

/**
 * Champs affichés par outil. Le contenu réel doit être lisible AVANT
 * d'approuver — un résumé ne suffit pas quand le texte part chez un client.
 * Seuls les champs texte courts sont modifiables ici; le corps long l'est
 * aussi, mais les identifiants restent en lecture seule.
 */
const TOOL_FIELDS: Record<string, Array<{ key: string; label: string; editable: boolean; multiline?: boolean }>> = {
  send_email: [
    { key: "to", label: "À", editable: true },
    { key: "subject", label: "Sujet", editable: true },
    { key: "body", label: "Message", editable: true, multiline: true },
  ],
  send_sms: [
    { key: "to", label: "Numéro", editable: true },
    { key: "message", label: "Message", editable: true, multiline: true },
  ],
  create_task: [
    { key: "title", label: "Titre", editable: true },
    { key: "description", label: "Description", editable: true, multiline: true },
    { key: "dueDate", label: "Échéance", editable: false },
  ],
  create_calendar_event: [
    { key: "title", label: "Titre", editable: true },
    { key: "startDate", label: "Début", editable: false },
    { key: "endDate", label: "Fin", editable: false },
  ],
  cancel_calendar_event: [
    { key: "id", label: "Rendez-vous n°", editable: false },
    { key: "motif", label: "Motif", editable: true },
  ],
};

/** Actions destructives: on avertit explicitement avant de confirmer. */
const DANGEROUS_TOOLS = new Set(["cancel_calendar_event", "reschedule_calendar_event"]);

interface PreviewField { key: string; label: string; editable: boolean; multiline?: boolean }

function fieldsFor(p: Proposal): PreviewField[] {
  const known = TOOL_FIELDS[p.toolName];
  if (known) return known;
  // Outil non listé: tout afficher en lecture seule plutôt que de ne rien
  // montrer — une proposition illisible ne peut pas être jugée.
  return Object.keys(p.args ?? {}).map((key) => ({ key, label: key, editable: false }));
}

export default function FileApprobationScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { fetchAuth } = useAuth();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tab, setTab] = useState<"en_attente" | "all">("en_attente");
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const res = await fetchAuth(`${QUEUE_API}?status=${status}`);
      if (res.ok) {
        const data = await res.json();
        setProposals(data.proposals ?? []);
      }
    } catch {
      /* fail-soft: l'écran reste utilisable, le pull-to-refresh réessaie */
    } finally {
      setLoading(false);
    }
  }, [fetchAuth]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const valueOf = useCallback(
    (p: Proposal, key: string) => edits[p.id]?.[key] ?? String((p.args ?? {})[key] ?? ""),
    [edits],
  );

  const doApprove = useCallback(async (p: Proposal) => {
    setBusyId(p.id);
    try {
      const edited = edits[p.id];
      if (edited && Object.keys(edited).length > 0) {
        // Fusion avec les args d'origine: seuls certains champs sont exposés
        // ici, et en texte — les identifiants numériques doivent repartir
        // intacts sinon la validation serveur rejette la proposition.
        const patch = await fetchAuth(`${QUEUE_API}/${p.id}/args`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: { ...(p.args ?? {}), ...edited } }),
        });
        if (!patch.ok) {
          const err = await patch.json().catch(() => ({}));
          Alert.alert("Modification refusée", err.error || "Les valeurs saisies sont invalides.");
          return;
        }
      }
      const res = await fetchAuth(`${QUEUE_API}/${p.id}/approve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setProposals((prev) => prev.filter((x) => x.id !== p.id));
      } else {
        Alert.alert("Échec de l'exécution", data.error || "L'action n'a pas pu être exécutée.");
      }
    } catch {
      Alert.alert("Erreur", "Impossible de contacter le serveur.");
    } finally {
      setBusyId(null);
    }
  }, [edits, fetchAuth]);

  const confirmApprove = useCallback((p: Proposal) => {
    // La confirmation reprend les valeurs FINALES (modifications comprises):
    // le dernier écran avant exécution doit montrer ce qui partira vraiment.
    const recap = fieldsFor(p)
      .map((f) => { const v = valueOf(p, f.key); return v ? `${f.label} : ${v}` : null; })
      .filter(Boolean)
      .join("\n");
    const warning = DANGEROUS_TOOLS.has(p.toolName)
      ? "Cette action est irréversible et peut être visible par le client.\n\n"
      : "";
    Alert.alert(
      p.toolName === "send_email" ? "Envoyer cet e-mail ?" : "Approuver cette action ?",
      `${warning}${recap || p.summary}`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: p.toolName === "send_email" ? "Envoyer" : "Approuver",
          style: DANGEROUS_TOOLS.has(p.toolName) ? "destructive" : "default",
          onPress: () => { void doApprove(p); },
        },
      ],
    );
  }, [doApprove, valueOf]);

  const reject = useCallback(async (p: Proposal) => {
    setBusyId(p.id);
    try {
      const res = await fetchAuth(`${QUEUE_API}/${p.id}/reject`, { method: "POST" });
      if (res.ok) setProposals((prev) => prev.filter((x) => x.id !== p.id));
    } catch {
      Alert.alert("Erreur", "Impossible de rejeter la proposition.");
    } finally {
      setBusyId(null);
    }
  }, [fetchAuth]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>File d&apos;approbation</Text>
        <Pressable onPress={() => load(tab)} hitSlop={12}>
          <Feather name="refresh-cw" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(tab)} tintColor={colors.primary} />}
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Votre secrétaire numérique prépare les actions. Rien n&apos;est exécuté sans votre accord.
        </Text>

        <View style={styles.filterRow}>
          {([
            { key: "en_attente" as const, label: "En attente" },
            { key: "all" as const, label: "Historique" },
          ]).map((f) => {
            const active = tab === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setTab(f.key)}
                style={[styles.chip, { borderColor: colors.border, backgroundColor: active ? colors.primary : "transparent" }]}
              >
                <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 13, fontWeight: "600" }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.primary} />
        ) : proposals.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="check-circle" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {tab === "en_attente" ? "Tout est à jour" : "Aucun historique"}
            </Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              {tab === "en_attente"
                ? "Aucune action en attente de votre validation."
                : "Aucune proposition traitée pour le moment."}
            </Text>
          </View>
        ) : (
          proposals.map((p) => {
            const meta = CATEGORY_META[p.category] ?? { label: p.category, icon: "zap" as const };
            const color = PRIORITY_COLOR[p.priority] ?? PRIORITY_COLOR.moyenne;
            const pending = p.status === "en_attente";
            const busy = busyId === p.id;
            return (
              <View
                key={p.id}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: color }]}
              >
                <View style={styles.cardHead}>
                  <Feather name={meta.icon} size={18} color={colors.mutedForeground} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{p.title}</Text>
                    <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>{p.summary}</Text>
                    {p.reason ? (
                      <Text style={[styles.reason, { color: colors.mutedForeground }]}>Pourquoi : {p.reason}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.badge, { backgroundColor: color + "22" }]}>
                    <Text style={{ color, fontSize: 11, fontWeight: "700" }}>{meta.label}</Text>
                  </View>
                </View>

                {pending ? (
                  <View style={[styles.preview, { borderColor: colors.border }]}>
                    {DANGEROUS_TOOLS.has(p.toolName) ? (
                      <Text style={styles.danger}>
                        Action irréversible — vérifiez avant d&apos;approuver.
                      </Text>
                    ) : null}
                    {fieldsFor(p).map((f) => {
                      const v = valueOf(p, f.key);
                      if (!f.editable) {
                        if (!v) return null;
                        return (
                          <View key={f.key} style={{ marginBottom: 8 }}>
                            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                            <Text style={{ color: colors.foreground, fontSize: 14 }}>{v}</Text>
                          </View>
                        );
                      }
                      return (
                        <View key={f.key} style={{ marginBottom: 8 }}>
                          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                          <TextInput
                            value={v}
                            onChangeText={(text) =>
                              setEdits((prev) => {
                                const base: Record<string, string> = { ...(prev[p.id] ?? {}) };
                                base[f.key] = text;
                                return { ...prev, [p.id]: base };
                              })
                            }
                            multiline={f.multiline}
                            style={[
                              styles.input,
                              {
                                color: colors.foreground,
                                borderColor: colors.border,
                                backgroundColor: colors.background,
                                height: f.multiline ? 110 : 40,
                                textAlignVertical: f.multiline ? "top" : "center",
                              },
                            ]}
                          />
                        </View>
                      );
                    })}
                  </View>
                ) : null}

                {pending ? (
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => confirmApprove(p)}
                      disabled={busy}
                      style={[styles.approveBtn, { opacity: busy ? 0.5 : 1 }]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Feather name="check" size={16} color="#fff" />
                          <Text style={styles.approveText}>Approuver</Text>
                        </>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => reject(p)}
                      disabled={busy}
                      style={[styles.rejectBtn, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
                    >
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                      <Text style={{ color: colors.mutedForeground, fontSize: 14, fontWeight: "600" }}>Rejeter</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={[styles.statusLine, { color: colors.mutedForeground }]}>Statut : {p.status}</Text>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  intro: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 64, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
  card: { borderRadius: 14, borderWidth: 1, borderLeftWidth: 4, padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  cardSub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  reason: { fontSize: 12, marginTop: 6, fontStyle: "italic", lineHeight: 16 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  preview: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 12 },
  danger: { color: "#f59e0b", fontSize: 12, fontWeight: "600", marginBottom: 8 },
  fieldLabel: { fontSize: 11, fontWeight: "600", marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  approveBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#059669", paddingVertical: 10, borderRadius: 8,
  },
  approveText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  rejectBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1,
  },
  statusLine: { fontSize: 12, marginTop: 10, fontWeight: "600" },
});
