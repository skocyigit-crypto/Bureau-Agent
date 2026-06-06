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

interface UserFact {
  factType: string;
  label: string;
  value: string;
  occurrences: number;
  lastSeenAt: string | null;
}
interface UserProfile {
  userId: number;
  facts: UserFact[];
}
interface LearnableUser {
  id: number;
  nom: string;
  prenom: string;
  role: string;
  factCount: number;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Dirigeant", administrateur: "Administrateur",
  agent: "Agent", lecture_seule: "Lecture seule",
};
const MANAGER_ROLES = new Set(["super_admin", "administrateur"]);

// Regroupe les faits personnels par catégorie pour l'affichage.
function groupUserFacts(facts: UserFact[]) {
  const byType = (t: string) => facts.filter((f) => f.factType === t);
  return {
    hours: byType("busy_hour"),
    focus: byType("work_focus"),
    themes: byType("task_theme"),
    contacts: byType("frequent_contact"),
    writingStyle: facts.find((f) => f.factType === "writing_style") ?? null,
  };
}

export default function IaApprentissageScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { fetchAuth, user } = useAuth();

  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  // --- Profil PERSONNEL (par employé) ---
  const isManager = user ? MANAGER_ROLES.has(user.role) : false;
  const [selectedUserId, setSelectedUserId] = useState<number | null>(user?.id ?? null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [userRecomputing, setUserRecomputing] = useState(false);
  const [team, setTeam] = useState<LearnableUser[]>([]);

  const loadUserProfile = useCallback(async (uid: number) => {
    setUserLoading(true);
    try {
      const res = await fetchAuth(`${LEARNING_API}/user-profile?userId=${uid}`);
      if (res.ok) {
        const data = await res.json();
        setUserProfile({ userId: data.userId ?? uid, facts: data.facts ?? [] });
      } else {
        setUserProfile({ userId: uid, facts: [] });
      }
    } catch {
      setUserProfile({ userId: uid, facts: [] });
    } finally {
      setUserLoading(false);
    }
  }, [fetchAuth]);

  // L'utilisateur est restauré de façon asynchrone au démarrage : dès qu'il
  // est disponible, on sélectionne son propre profil par défaut (sinon le
  // spinner resterait bloqué car selectedUserId resterait null).
  useEffect(() => {
    if (selectedUserId == null && user?.id != null) setSelectedUserId(user.id);
  }, [user?.id, selectedUserId]);

  useEffect(() => {
    if (selectedUserId != null) void loadUserProfile(selectedUserId);
  }, [selectedUserId, loadUserProfile]);

  const recomputeUser = useCallback(async () => {
    if (selectedUserId == null) return;
    setUserRecomputing(true);
    try {
      const res = await fetchAuth(`${LEARNING_API}/recompute-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setUserProfile({ userId: data.profile?.userId ?? selectedUserId, facts: data.profile?.facts ?? [] });
      }
    } catch {
      /* fail-soft */
    } finally {
      setUserRecomputing(false);
    }
  }, [fetchAuth, selectedUserId]);

  useEffect(() => {
    if (!isManager) return;
    void (async () => {
      try {
        const res = await fetchAuth(`${LEARNING_API}/users`);
        if (!res.ok) return;
        const data = await res.json();
        setTeam(data.users ?? []);
      } catch {
        /* fail-soft: pas de sélecteur d'équipe */
      }
    })();
  }, [isManager, fetchAuth]);

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

  const ug = groupUserFacts(userProfile?.facts ?? []);
  const userEmpty = !userLoading && (userProfile?.facts.length ?? 0) === 0;
  const viewingSelf = selectedUserId === user?.id;

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

        {/* --- Profil PERSONNEL (par employé) --- */}
        {!loading ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Feather name="user" size={18} color="#8b5cf6" />
              <Text style={[styles.sectionTitle, { color: colors.foreground, flex: 1 }]}>
                {viewingSelf ? "Votre profil personnel" : "Profil de l'employé"}
              </Text>
              <Pressable onPress={recomputeUser} disabled={userRecomputing || userLoading} hitSlop={12}>
                {userRecomputing ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={18} color={colors.primary} />}
              </Pressable>
            </View>
            <Text style={[styles.intro, { color: colors.mutedForeground }]}>
              {isManager
                ? "Ce que l'IA a appris de chaque employé : horaires, domaines, thèmes, interlocuteurs et style d'écriture."
                : "Ce que l'IA a appris de votre activité pour personnaliser ses suggestions et le ton de ses réponses."}
            </Text>

            {isManager && team.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHead}>
                  <Feather name="users" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Choisir un employé</Text>
                </View>
                <View style={styles.tagRow}>
                  {team.map((m) => {
                    const active = m.id === selectedUserId;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => setSelectedUserId(m.id)}
                        style={[
                          styles.memberChip,
                          { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : "transparent" },
                        ]}
                      >
                        <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                          {m.prenom} {m.nom}
                        </Text>
                        <Text style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontSize: 11 }}>
                          {ROLE_LABELS[m.role] ?? m.role}{m.factCount > 0 ? ` · ${m.factCount}` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {userLoading ? (
              <ActivityIndicator style={{ marginTop: 32 }} size="large" color={colors.primary} />
            ) : userEmpty ? (
              <View style={styles.empty}>
                <Feather name="inbox" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {viewingSelf ? "Rien appris sur vous pour l'instant" : "Rien appris sur cet employé pour l'instant"}
                </Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  L'IA apprend automatiquement à partir de l'activité (appels, tâches, messages). Le profil se remplira au fil de l'usage.
                </Text>
              </View>
            ) : (
              <>
                {ug.writingStyle ? (
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.cardHead}>
                      <Feather name="edit-3" size={16} color="#8b5cf6" />
                      <Text style={[styles.cardTitle, { color: colors.foreground }]}>Style d'écriture</Text>
                    </View>
                    <Text style={[styles.rowSub, { color: colors.foreground }]}>{ug.writingStyle.label}</Text>
                  </View>
                ) : null}

                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHead}>
                    <Feather name="clock" size={16} color="#f59e0b" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Heures &amp; domaines</Text>
                  </View>
                  {ug.hours.length > 0 ? (
                    <View style={styles.group}>
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Heures d'activité</Text>
                      <View style={styles.tagRow}>
                        {ug.hours.map((h) => (
                          <View key={h.value} style={[styles.tag, { borderColor: colors.border }]}>
                            <Text style={{ color: colors.foreground, fontSize: 12 }}>{h.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {ug.focus.length > 0 ? (
                    <View style={styles.group}>
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Domaines de travail</Text>
                      <View style={styles.tagRow}>
                        {ug.focus.map((f) => (
                          <View key={f.value} style={[styles.tag, { borderColor: colors.border }]}>
                            <Text style={{ color: colors.foreground, fontSize: 12 }}>{f.label} · {f.occurrences}×</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {ug.hours.length === 0 && ug.focus.length === 0 ? (
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>Pas encore de données.</Text>
                  ) : null}
                </View>

                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHead}>
                    <Feather name="zap" size={16} color="#f59e0b" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Thèmes &amp; contacts</Text>
                  </View>
                  {ug.themes.length > 0 ? (
                    <View style={styles.group}>
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Thèmes de tâches</Text>
                      <View style={styles.tagRow}>
                        {ug.themes.map((t) => (
                          <View key={t.value} style={[styles.tag, { borderColor: colors.border }]}>
                            <Text style={{ color: colors.foreground, fontSize: 12 }}>{t.label} · {t.occurrences}×</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {ug.contacts.length > 0 ? (
                    <View style={styles.group}>
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Interlocuteurs récurrents</Text>
                      <View style={styles.tagRow}>
                        {ug.contacts.map((c) => (
                          <View key={c.value} style={[styles.tag, { borderColor: colors.border }]}>
                            <Text style={{ color: colors.foreground, fontSize: 12 }}>{c.label} · {c.occurrences}×</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {ug.themes.length === 0 && ug.contacts.length === 0 ? (
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>Pas encore de données.</Text>
                  ) : null}
                </View>
              </>
            )}
          </View>
        ) : null}
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
  section: { marginTop: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  memberChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 2 },
});
