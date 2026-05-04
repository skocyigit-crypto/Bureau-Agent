import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface CallDetail {
  id: number;
  phoneNumber: string;
  direction: string;
  status: string;
  duration?: number;
  notes?: string | null;
  contactName?: string | null;
  contactId?: number | null;
  transcript?: string | null;
  aiSummary?: string | null;
  aiCoachingTips?: string | null;
  recordingUrl?: string | null;
  provider?: string | null;
  createdAt: string;
  updatedAt?: string;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  repondu:    { label: "Répondu",    color: "#22c55e", icon: "phone" },
  manque:     { label: "Manqué",     color: "#ef4444", icon: "phone-missed" },
  messagerie: { label: "Messagerie", color: "#f59e0b", icon: "voicemail" },
  en_cours:   { label: "En cours",   color: "#3b82f6", icon: "phone-call" },
};

function fmtDuration(sec?: number | null): string {
  if (!sec) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtDatetime(d: string): string {
  return new Date(d).toLocaleString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function CallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [aiLoading, setAiLoading] = useState<"briefing" | "coaching" | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchAuth(`${API_BASE}/api/calls/${id}`);
      if (res.ok) {
        const d = await res.json();
        setCall(d);
        setNotes(d.notes ?? "");
      }
    } catch {} finally { setLoading(false); }
  }, [id, fetchAuth]);

  useEffect(() => { load(); }, [load]);

  async function saveNotes() {
    if (!call) return;
    setSavingNotes(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/calls/${call.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) { setEditingNotes(false); load(); }
    } finally { setSavingNotes(false); }
  }

  async function runAiBriefing() {
    if (!call) return;
    setAiLoading("briefing");
    setAiResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/calls/ai-briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callIds: [call.id] }),
      });
      if (res.ok) {
        const d = await res.json();
        setAiResult(d.briefing ?? d.summary ?? d.result ?? "Analyse IA générée.");
      }
    } finally { setAiLoading(null); }
  }

  async function runAiCoaching() {
    if (!call) return;
    setAiLoading("coaching");
    setAiResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/calls/ai-coaching`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: call.id }),
      });
      if (res.ok) {
        const d = await res.json();
        setAiResult(d.coaching ?? d.tips ?? d.result ?? "Coaching IA généré.");
      }
    } finally { setAiLoading(null); }
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Détail appel</Text>
        </View>
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#166534" /></View>
      </View>
    );
  }

  if (!call) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Appel introuvable</Text>
        </View>
        <View style={styles.loadingBox}>
          <Feather name="phone-off" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Appel introuvable</Text>
        </View>
      </View>
    );
  }

  const st = STATUS_CFG[call.status] ?? STATUS_CFG.repondu;
  const isOutbound = call.direction === "sortant" || call.direction === "outbound";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {call.contactName ?? call.phoneNumber}
            </Text>
            <Text style={styles.headerSub}>{call.phoneNumber}</Text>
          </View>
          <Pressable
            onPress={() => Linking.openURL(`tel:${call.phoneNumber}`)}
            style={[styles.callBtn, { backgroundColor: "#22c55e" }]}
          >
            <Feather name="phone" size={18} color="#fff" />
          </Pressable>
        </View>

        {/* Status bar */}
        <View style={styles.statusBar}>
          <View style={[styles.statusPill, { backgroundColor: st.color + "30" }]}>
            <Feather name={st.icon} size={12} color={st.color} />
            <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
            <Feather name={isOutbound ? "phone-outgoing" : "phone-incoming"} size={12} color="#fff" />
            <Text style={[styles.statusText, { color: "#fff" }]}>{isOutbound ? "Sortant" : "Entrant"}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
            <Feather name="clock" size={12} color="#fff" />
            <Text style={[styles.statusText, { color: "#fff" }]}>{fmtDuration(call.duration)}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 40 : 24 }]}>

        {/* Date & provider */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoRow}>
            <Feather name="calendar" size={14} color={colors.mutedForeground} />
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Date</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{fmtDatetime(call.createdAt)}</Text>
          </View>
          {call.contactName && (
            <View style={styles.infoRow}>
              <Feather name="user" size={14} color={colors.mutedForeground} />
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Contact</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>{call.contactName}</Text>
            </View>
          )}
          {call.provider && (
            <View style={styles.infoRow}>
              <Feather name="globe" size={14} color={colors.mutedForeground} />
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Fournisseur</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>{call.provider}</Text>
            </View>
          )}
        </View>

        {/* Notes */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="edit-3" size={14} color="#0369a1" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Notes</Text>
            <View style={{ flex: 1 }} />
            {!editingNotes ? (
              <Pressable onPress={() => setEditingNotes(true)} style={styles.editBtn}>
                <Feather name="edit-2" size={14} color="#0369a1" />
                <Text style={styles.editBtnText}>Modifier</Text>
              </Pressable>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => { setEditingNotes(false); setNotes(call.notes ?? ""); }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>Annuler</Text>
                </Pressable>
                <Pressable onPress={saveNotes} disabled={savingNotes} style={[styles.editBtn, { backgroundColor: "#0369a1" }]}>
                  {savingNotes ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Enregistrer</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
          {editingNotes ? (
            <TextInput
              style={[styles.notesInput, { color: colors.foreground, borderColor: "#0369a1", backgroundColor: colors.background }]}
              multiline
              value={notes}
              onChangeText={setNotes}
              placeholder="Saisir des notes sur cet appel..."
              placeholderTextColor={colors.mutedForeground}
              autoFocus
            />
          ) : (
            <Text style={[styles.notesText, { color: notes ? colors.foreground : colors.mutedForeground }]}>
              {notes || "Aucune note. Appuyez sur Modifier pour en ajouter."}
            </Text>
          )}
        </View>

        {/* AI Tools */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="cpu" size={14} color="#7c3aed" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Outils IA</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={runAiBriefing}
              disabled={!!aiLoading}
              style={[styles.aiBtn, { backgroundColor: "#7c3aed" }]}
            >
              {aiLoading === "briefing" ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="file-text" size={13} color="#fff" />
                  <Text style={styles.aiBtnText}>Synthèse IA</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={runAiCoaching}
              disabled={!!aiLoading}
              style={[styles.aiBtn, { backgroundColor: "#ec4899" }]}
            >
              {aiLoading === "coaching" ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="star" size={13} color="#fff" />
                  <Text style={styles.aiBtnText}>Coaching IA</Text>
                </>
              )}
            </Pressable>
          </View>
          {aiResult && (
            <View style={[styles.aiResult, { backgroundColor: "#7c3aed12", borderColor: "#7c3aed30" }]}>
              <Text style={[styles.aiResultText, { color: colors.foreground }]}>{aiResult}</Text>
            </View>
          )}
        </View>

        {/* AI Summary (from record) */}
        {call.aiSummary && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="cpu" size={14} color="#7c3aed" />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Synthèse IA enregistrée</Text>
            </View>
            <Text style={[styles.notesText, { color: colors.foreground }]}>{call.aiSummary}</Text>
          </View>
        )}

        {/* Transcript */}
        {call.transcript && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="message-square" size={14} color="#0891b2" />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Transcription</Text>
            </View>
            <Text style={[styles.notesText, { color: colors.foreground }]}>{call.transcript}</Text>
          </View>
        )}

        {/* Quick actions */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => Linking.openURL(`tel:${call.phoneNumber}`)}
            style={[styles.quickAction, { backgroundColor: "#22c55e", flex: 1 }]}
          >
            <Feather name="phone" size={16} color="#fff" />
            <Text style={styles.quickActionText}>Rappeler</Text>
          </Pressable>
          {call.contactId && (
            <Pressable
              onPress={() => router.push(`/contact-detail?id=${call.contactId}` as any)}
              style={[styles.quickAction, { backgroundColor: "#0369a1", flex: 1 }]}
            >
              <Feather name="user" size={16} color="#fff" />
              <Text style={styles.quickActionText}>Voir contact</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#166534", paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  callBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  statusBar: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  scrollContent: { padding: 12, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular", width: 80 },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  editBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#0369a1" },
  notesInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 80, textAlignVertical: "top" },
  notesText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  aiBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  aiBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  aiResult: { borderRadius: 8, borderWidth: 1, padding: 10, marginTop: 4 },
  aiResultText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  quickAction: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10 },
  quickActionText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
