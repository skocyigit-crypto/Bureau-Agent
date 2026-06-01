import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const LEARNING_API = `${API_BASE}/api/ai-learning`;

interface Preference {
  kind: string;
  key: string;
  upCount: number;
  downCount: number;
  score: number;
  updatedAt: string;
}
interface Pattern {
  patternType: string;
  label: string;
  value: string;
  occurrences: number;
  lastSeenAt: string | null;
}

const SUGGESTION_LABELS: Record<string, string> = {
  overdue_task: "Tâches en retard",
  missed_call_followup: "Rappels d'appels manqués",
  calendar_conflict: "Conflits d'agenda",
};
const CATEGORY_LABELS: Record<string, string> = {
  calls: "Appels", tasks: "Tâches", finance: "Finance", contacts: "Contacts",
  projets: "Projets", prospects: "Prospects", general: "Général",
};

function prefLabel(p: Preference): string {
  if (p.kind === "suggestion_type") return SUGGESTION_LABELS[p.key] ?? p.key;
  return CATEGORY_LABELS[p.key] ?? p.key;
}

export default function IaApprentissageScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { fetchAuth } = useAuth();

  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAuth(`${LEARNING_API}/profile`);
      if (res.ok) {
        const data = await res.json();
        setPreferences(data.preferences ?? []);
        setPatterns(data.patterns ?? []);
      }
    } catch {
      /* fail-soft */
    } finally {
      setLoading(false);
    }
  }, [fetchAuth]);

  useEffect(() => { void load(); }, [load]);

  const recompute = useCallback(async () => {
    setRecomputing(true);
    try {
      const res = await fetchAuth(`${LEARNING_API}/recompute`, { method: "POST" });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setPreferences(data.profile?.preferences ?? []);
        setPatterns(data.profile?.patterns ?? []);
      }
    } catch {
      /* fail-soft */
    } finally {
      setRecomputing(false);
    }
  }, [fetchAuth]);

  const liked = preferences.filter((p) => p.score >= 0.34 && p.upCount + p.downCount >= 1);
  const disliked = preferences.filter((p) => p.score <= -0.34 && p.upCount + p.downCount >= 1);
  const callers = patterns.filter((p) => p.patternType === "frequent_caller");
  const hours = patterns.filter((p) => p.patternType === "busy_hour");
  const themes = patterns.filter((p) => p.patternType === "task_theme");

  const isEmpty = !loading && preferences.length === 0 && patterns.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Ce que l'IA a appris</Text>
        <Pressable onPress={recompute} disabled={recomputing} hitSlop={12}>
          {recomputing ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={20} color={colors.primary} />}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          À partir de vos retours (👍/👎) et de vos habitudes, l'assistant adapte ses réponses.
        </Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.primary} />
        ) : isEmpty ? (
          <View style={styles.empty}>
            <Feather name="inbox" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>L'IA n'a encore rien appris</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Notez les suggestions (👍/👎) et votez sur les analyses : l'IA mémorisera vos préférences.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHead}>
                <Feather name="thumbs-up" size={16} color="#22c55e" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Préférences apprises</Text>
              </View>
              {liked.length === 0 && disliked.length === 0 ? (
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                  Pas encore assez de retours pour dégager une préférence.
                </Text>
              ) : null}
              {liked.map((p) => (
                <View key={`up-${p.kind}-${p.key}`} style={styles.row}>
                  <Feather name="trending-up" size={16} color="#22c55e" />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{prefLabel(p)}</Text>
                  <View style={[styles.badge, { backgroundColor: "#22c55e22" }]}>
                    <Text style={{ color: "#16a34a", fontSize: 12, fontWeight: "700" }}>{p.upCount} 👍</Text>
                  </View>
                </View>
              ))}
              {disliked.map((p) => (
                <View key={`down-${p.kind}-${p.key}`} style={styles.row}>
                  <Feather name="trending-down" size={16} color="#ef4444" />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{prefLabel(p)}</Text>
                  <View style={[styles.badge, { backgroundColor: "#ef444422" }]}>
                    <Text style={{ color: "#dc2626", fontSize: 12, fontWeight: "700" }}>{p.downCount} 👎</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHead}>
                <Feather name="zap" size={16} color="#f59e0b" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Habitudes détectées</Text>
              </View>
              {callers.length > 0 ? (
                <View style={styles.group}>
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Interlocuteurs fréquents</Text>
                  <View style={styles.tagRow}>
                    {callers.slice(0, 6).map((c) => (
                      <View key={c.value} style={[styles.tag, { borderColor: colors.border }]}>
                        <Text style={{ color: colors.foreground, fontSize: 12 }}>{c.label} · {c.occurrences}×</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {hours.length > 0 ? (
                <View style={styles.group}>
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Heures d'appels chargées</Text>
                  <View style={styles.tagRow}>
                    {hours.map((h) => (
                      <View key={h.value} style={[styles.tag, { borderColor: colors.border }]}>
                        <Text style={{ color: colors.foreground, fontSize: 12 }}>{h.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {themes.length > 0 ? (
                <View style={styles.group}>
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Thèmes de tâches récurrents</Text>
                  <View style={styles.tagRow}>
                    {themes.map((t) => (
                      <View key={t.value} style={[styles.tag, { borderColor: colors.border }]}>
                        <Text style={{ color: colors.foreground, fontSize: 12 }}>{t.label} · {t.occurrences}×</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {callers.length === 0 && hours.length === 0 && themes.length === 0 ? (
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                  Aucune habitude récurrente détectée pour l'instant.
                </Text>
              ) : null}
            </View>
          </>
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
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 64, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center", paddingHorizontal: 24, lineHeight: 20 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  rowLabel: { flex: 1, fontSize: 14 },
  rowSub: { fontSize: 13, lineHeight: 18 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  group: { marginBottom: 14 },
  groupLabel: { fontSize: 12, fontWeight: "600", marginBottom: 8 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
});
