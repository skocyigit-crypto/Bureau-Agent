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
import { useTranslation, type TFunction } from "@/lib/i18n";

const LEARNING_API = `${API_BASE}/api/ai-learning`;

interface Preference {
  kind: string;
  key: string;
  upCount: number;
  downCount: number;
  score: number;
  updatedAt: string;
  suppressed?: boolean;
  suppressionOverridden?: boolean;
}
interface Pattern {
  patternType: string;
  label: string;
  value: string;
  occurrences: number;
  lastSeenAt: string | null;
}
interface Correction {
  title: string;
  category: string;
  note: string | null;
  decidedAt: string | null;
}

const SUGGESTION_LABEL_KEYS: Record<string, string> = {
  overdue_task: "iaApprentissageScreen.suggestionOverdueTask",
  missed_call_followup: "iaApprentissageScreen.suggestionMissedCall",
  calendar_conflict: "iaApprentissageScreen.suggestionCalendarConflict",
};
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  calls: "iaApprentissageScreen.catCalls", tasks: "iaApprentissageScreen.catTasks",
  finance: "iaApprentissageScreen.catFinance", contacts: "iaApprentissageScreen.catContacts",
  projets: "iaApprentissageScreen.catProjets", prospects: "iaApprentissageScreen.catProspects",
  general: "iaApprentissageScreen.catGeneral",
};
const PROPOSAL_CATEGORY_LABEL_KEYS: Record<string, string> = {
  tache: "iaApprentissageScreen.propTache", email: "iaApprentissageScreen.propEmail",
  sms: "iaApprentissageScreen.propSms", rappel: "iaApprentissageScreen.propRappel",
  relance: "iaApprentissageScreen.propRelance", contact: "iaApprentissageScreen.propContact",
  autre: "iaApprentissageScreen.propAutre",
};

function prefLabel(p: Preference, t: TFunction): string {
  if (p.kind === "suggestion_type") { const k = SUGGESTION_LABEL_KEYS[p.key]; return k ? t(k) : p.key; }
  const k = CATEGORY_LABEL_KEYS[p.key]; return k ? t(k) : p.key;
}

// "il y a 2 h", "il y a 5 min", "à l'instant"… à partir d'une date ISO.
function relativeTime(iso: string | null, t: TFunction): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return t("iaApprentissageScreen.timeNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("iaApprentissageScreen.timeMin", { min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("iaApprentissageScreen.timeHour", { h });
  const j = Math.floor(h / 24);
  if (j < 30) return t("iaApprentissageScreen.timeDay", { j });
  const mois = Math.floor(j / 30);
  return t("iaApprentissageScreen.timeMonth", { mois });
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
  computedAt: string | null;
  facts: UserFact[];
}
interface LearnableUser {
  id: number;
  nom: string;
  prenom: string;
  role: string;
  factCount: number;
}

const ROLE_LABEL_KEYS: Record<string, string> = {
  super_admin: "iaApprentissageScreen.roleDirigeant", administrateur: "iaApprentissageScreen.roleAdmin",
  agent: "iaApprentissageScreen.roleAgent", lecture_seule: "iaApprentissageScreen.roleReadOnly",
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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { fetchAuth, user } = useAuth();

  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [reactivating, setReactivating] = useState<string | null>(null);

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
        setUserProfile({ userId: data.userId ?? uid, computedAt: data.computedAt ?? null, facts: data.facts ?? [] });
      } else {
        setUserProfile({ userId: uid, computedAt: null, facts: [] });
      }
    } catch {
      setUserProfile({ userId: uid, computedAt: null, facts: [] });
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
        setUserProfile({ userId: data.profile?.userId ?? selectedUserId, computedAt: data.profile?.computedAt ?? null, facts: data.profile?.facts ?? [] });
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
        setCorrections(data.corrections ?? []);
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
        setCorrections(data.profile?.corrections ?? []);
      }
    } catch {
      /* fail-soft */
    } finally {
      setRecomputing(false);
    }
  }, [fetchAuth]);

  const reactivate = useCallback(async (type: string) => {
    setReactivating(type);
    try {
      const res = await fetchAuth(`${LEARNING_API}/reactivate-suggestion-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setPreferences(data.profile?.preferences ?? []);
        setPatterns(data.profile?.patterns ?? []);
        setCorrections(data.profile?.corrections ?? []);
      }
    } catch {
      /* fail-soft */
    } finally {
      setReactivating(null);
    }
  }, [fetchAuth]);

  const liked = preferences.filter((p) => p.score >= 0.34 && p.upCount + p.downCount >= 1);
  // Types mis en sourdine (le moteur n'en produit plus) — affichés à part avec
  // une action « Réafficher », et exclus de la liste « moins appréciées ».
  const muted = preferences.filter((p) => p.suppressed);
  const disliked = preferences.filter(
    (p) => p.score <= -0.34 && p.upCount + p.downCount >= 1 && !p.suppressed,
  );
  const callers = patterns.filter((p) => p.patternType === "frequent_caller");
  const hours = patterns.filter((p) => p.patternType === "busy_hour");
  const themes = patterns.filter((p) => p.patternType === "task_theme");

  const isEmpty = !loading && preferences.length === 0 && patterns.length === 0 && corrections.length === 0;

  const ug = groupUserFacts(userProfile?.facts ?? []);
  const userEmpty = !userLoading && (userProfile?.facts.length ?? 0) === 0;
  const viewingSelf = selectedUserId === user?.id;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.title")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.refresh")} onPress={recompute} disabled={recomputing} hitSlop={12}>
          {recomputing ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={20} color={colors.primary} />}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          {t("iaApprentissageScreen.intro")}
        </Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.primary} />
        ) : isEmpty ? (
          <View style={styles.empty}>
            <Feather name="inbox" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.emptyTitle")}</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              {t("iaApprentissageScreen.emptySub")}
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHead}>
                <Feather name="thumbs-up" size={16} color="#22c55e" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.prefTitle")}</Text>
              </View>
              <Text style={[styles.rowSub, { color: colors.mutedForeground, marginBottom: 12 }]}>
                {t("iaApprentissageScreen.prefDesc")}
              </Text>
              {liked.length === 0 && disliked.length === 0 ? (
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                  {t("iaApprentissageScreen.prefEmpty")}
                </Text>
              ) : null}
              {liked.map((p) => (
                <View key={`up-${p.kind}-${p.key}`} style={styles.row}>
                  <Feather name="trending-up" size={16} color="#22c55e" />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{prefLabel(p, t)}</Text>
                  <View style={[styles.badge, { backgroundColor: "#22c55e22" }]}>
                    <Text style={{ color: "#16a34a", fontSize: 12, fontWeight: "700" }}>{p.upCount} 👍</Text>
                  </View>
                </View>
              ))}
              {disliked.map((p) => (
                <View key={`down-${p.kind}-${p.key}`} style={styles.row}>
                  <Feather name="trending-down" size={16} color="#ef4444" />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{prefLabel(p, t)}</Text>
                  <View style={[styles.badge, { backgroundColor: "#ef444422" }]}>
                    <Text style={{ color: "#dc2626", fontSize: 12, fontWeight: "700" }}>{p.downCount} 👎</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHead}>
                <Feather name="zap" size={16} color="#f59e0b" />
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.habitsTitle")}</Text>
              </View>
              <Text style={[styles.rowSub, { color: colors.mutedForeground, marginBottom: 12 }]}>
                {t("iaApprentissageScreen.habitsDesc")}
              </Text>
              {callers.length > 0 ? (
                <View style={styles.group}>
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.frequentCallers")}</Text>
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
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.busyCallHours")}</Text>
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
                  <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.recurringTaskThemes")}</Text>
                  <View style={styles.tagRow}>
                    {themes.map((th) => (
                      <View key={th.value} style={[styles.tag, { borderColor: colors.border }]}>
                        <Text style={{ color: colors.foreground, fontSize: 12 }}>{th.label} · {th.occurrences}×</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {callers.length === 0 && hours.length === 0 && themes.length === 0 ? (
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                  {t("iaApprentissageScreen.habitsEmpty")}
                </Text>
              ) : null}
            </View>

            {muted.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#f59e0b66" }]}>
                <View style={styles.cardHead}>
                  <Feather name="bell-off" size={16} color="#d97706" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.mutedTitle")}</Text>
                </View>
                <Text style={[styles.rowSub, { color: colors.mutedForeground, marginBottom: 12 }]}>
                  {t("iaApprentissageScreen.mutedDesc")}
                  {isManager ? t("iaApprentissageScreen.mutedManagerHint") : t("iaApprentissageScreen.mutedUserHint")}
                </Text>
                {muted.map((p) => (
                  <View key={`muted-${p.kind}-${p.key}`} style={styles.row}>
                    <Feather name="bell-off" size={16} color="#d97706" />
                    <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={1}>{prefLabel(p, t)}</Text>
                    <View style={[styles.badge, { backgroundColor: "#ef444422" }]}>
                      <Text style={{ color: "#dc2626", fontSize: 12, fontWeight: "700" }}>{p.downCount} 👎</Text>
                    </View>
                    {isManager ? (
                      <Pressable accessibilityRole="button"
                        onPress={() => reactivate(p.key)}
                        disabled={reactivating === p.key}
                        style={[styles.reactivateBtn, { borderColor: colors.primary }]}
                        hitSlop={6}
                      >
                        {reactivating === p.key ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Feather name="bell" size={13} color={colors.primary} />
                            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>{t("iaApprentissageScreen.reactivate")}</Text>
                          </>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {corrections.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHead}>
                  <Feather name="x-circle" size={16} color="#dc2626" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.correctionsTitle")}</Text>
                </View>
                <Text style={[styles.rowSub, { color: colors.mutedForeground, marginBottom: 12 }]}>
                  {t("iaApprentissageScreen.correctionsDesc")}
                </Text>
                {corrections.map((c, i) => (
                  <View key={`corr-${i}`} style={styles.correctionRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Feather name="thumbs-down" size={14} color="#dc2626" />
                        <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={2}>{c.title}</Text>
                      </View>
                      {c.note ? (
                        <Text style={[styles.rowSub, { color: colors.mutedForeground, marginTop: 4 }]} numberOfLines={2}>
                          {t("iaApprentissageScreen.noteQuote", { note: c.note })}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <View style={[styles.tag, { borderColor: colors.border }]}>
                        <Text style={{ color: colors.foreground, fontSize: 11 }}>
                          {PROPOSAL_CATEGORY_LABEL_KEYS[c.category] ? t(PROPOSAL_CATEGORY_LABEL_KEYS[c.category]) : c.category}
                        </Text>
                      </View>
                      {c.decidedAt ? (
                        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                          {new Date(c.decidedAt).toLocaleDateString("fr-FR")}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}

        {/* --- Profil PERSONNEL (par employé) --- */}
        {!loading ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Feather name="user" size={18} color="#8b5cf6" />
              <Text style={[styles.sectionTitle, { color: colors.foreground, flex: 1 }]}>
                {viewingSelf ? t("iaApprentissageScreen.yourProfile") : t("iaApprentissageScreen.employeeProfile")}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("common.refresh")} onPress={recomputeUser} disabled={userRecomputing || userLoading} hitSlop={12}>
                {userRecomputing ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={18} color={colors.primary} />}
              </Pressable>
            </View>
            <Text style={[styles.lastAnalysis, { color: colors.mutedForeground }]}>
              {userRecomputing
                ? t("iaApprentissageScreen.analyzing")
                : relativeTime(userProfile?.computedAt ?? null, t)
                  ? t("iaApprentissageScreen.lastAnalysis", { time: relativeTime(userProfile?.computedAt ?? null, t) ?? "" })
                  : t("iaApprentissageScreen.neverAnalyzed")}
            </Text>
            <Text style={[styles.intro, { color: colors.mutedForeground }]}>
              {isManager
                ? t("iaApprentissageScreen.profileIntroManager")
                : t("iaApprentissageScreen.profileIntroUser")}
            </Text>

            {isManager && team.length > 0 ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHead}>
                  <Feather name="users" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.chooseEmployee")}</Text>
                </View>
                <View style={styles.tagRow}>
                  {team.map((m) => {
                    const active = m.id === selectedUserId;
                    return (
                      <Pressable accessibilityRole="button"
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
                          {(ROLE_LABEL_KEYS[m.role] ? t(ROLE_LABEL_KEYS[m.role]) : m.role)}{m.factCount > 0 ? ` · ${m.factCount}` : ""}
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
                  {viewingSelf ? t("iaApprentissageScreen.userEmptySelf") : t("iaApprentissageScreen.userEmptyOther")}
                </Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  {t("iaApprentissageScreen.userEmptySub")}
                </Text>
              </View>
            ) : (
              <>
                {ug.writingStyle ? (
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.cardHead}>
                      <Feather name="edit-3" size={16} color="#8b5cf6" />
                      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.writingStyleTitle")}</Text>
                    </View>
                    <Text style={[styles.rowSub, { color: colors.mutedForeground, marginBottom: 8 }]}>
                      {t("iaApprentissageScreen.writingStyleDesc")}
                    </Text>
                    <Text style={[styles.rowSub, { color: colors.foreground }]}>{ug.writingStyle.label}</Text>
                  </View>
                ) : null}

                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHead}>
                    <Feather name="clock" size={16} color="#f59e0b" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.hoursDomainsTitle")}</Text>
                  </View>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground, marginBottom: 12 }]}>
                    {t("iaApprentissageScreen.hoursDomainsDesc")}
                  </Text>
                  {ug.hours.length > 0 ? (
                    <View style={styles.group}>
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.activityHours")}</Text>
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
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.workDomains")}</Text>
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
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.noDataYet")}</Text>
                  ) : null}
                </View>

                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHead}>
                    <Feather name="zap" size={16} color="#f59e0b" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("iaApprentissageScreen.themesContactsTitle")}</Text>
                  </View>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground, marginBottom: 12 }]}>
                    {t("iaApprentissageScreen.themesContactsDesc")}
                  </Text>
                  {ug.themes.length > 0 ? (
                    <View style={styles.group}>
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.taskThemes")}</Text>
                      <View style={styles.tagRow}>
                        {ug.themes.map((th) => (
                          <View key={th.value} style={[styles.tag, { borderColor: colors.border }]}>
                            <Text style={{ color: colors.foreground, fontSize: 12 }}>{th.label} · {th.occurrences}×</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {ug.contacts.length > 0 ? (
                    <View style={styles.group}>
                      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.recurringContacts")}</Text>
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
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{t("iaApprentissageScreen.noDataYet")}</Text>
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
  lastAnalysis: { fontSize: 12, marginTop: 4, marginBottom: 8 },
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
  reactivateBtn: {
    flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  correctionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8 },
  group: { marginBottom: 14 },
  groupLabel: { fontSize: 12, fontWeight: "600", marginBottom: 8 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  section: { marginTop: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  memberChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 2 },
});
