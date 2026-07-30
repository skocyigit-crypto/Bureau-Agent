import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTranslation } from "@/lib/i18n";

const PROACTIVE_API = `${API_BASE}/api/proactive`;

type Severity = "urgent" | "warning" | "info";
type Status = "pending" | "accepted" | "dismissed" | "done";

interface Suggestion {
  id: number;
  type: string;
  severity: Severity;
  title: string;
  detail: string | null;
  status: Status;
  actionType: string | null;
  feedback: "up" | "down" | null;
  createdAt: string;
}

const SEVERITY_META: Record<Severity, { labelKey: string; color: string }> = {
  urgent: { labelKey: "assistantProactifScreen.sevUrgent", color: "#ef4444" },
  warning: { labelKey: "assistantProactifScreen.sevWarning", color: "#f59e0b" },
  info: { labelKey: "assistantProactifScreen.sevInfo", color: "#3b82f6" },
};

const TYPE_META: Record<string, { labelKey: string; icon: keyof typeof Feather.glyphMap }> = {
  overdue_task: { labelKey: "assistantProactifScreen.typeOverdueTask", icon: "clock" },
  missed_call_followup: { labelKey: "assistantProactifScreen.typeMissedCall", icon: "phone-missed" },
  calendar_conflict: { labelKey: "assistantProactifScreen.typeCalendarConflict", icon: "calendar" },
  negative_call_followup: { labelKey: "assistantProactifScreen.typeNegativeCall", icon: "phone-off" },
  urgent_message: { labelKey: "assistantProactifScreen.typeUrgentMessage", icon: "message-square" },
  meeting_prep: { labelKey: "assistantProactifScreen.typeMeetingPrep", icon: "calendar" },
  inactive_contact: { labelKey: "assistantProactifScreen.typeInactiveContact", icon: "user-plus" },
  message_sla_breach: { labelKey: "assistantProactifScreen.typeMessageSla", icon: "message-square" },
  quiet_customer: { labelKey: "assistantProactifScreen.typeQuietCustomer", icon: "user-x" },
};

const ACTION_NAV: Record<string, { labelKey: string; route: string }> = {
  open_task: { labelKey: "assistantProactifScreen.actionOpenTask", route: "/tasks" },
  callback: { labelKey: "assistantProactifScreen.actionCallback", route: "/calls" },
  open_calendar: { labelKey: "assistantProactifScreen.actionOpenCalendar", route: "/calendar" },
  open_messages: { labelKey: "assistantProactifScreen.actionOpenMessages", route: "/messages" },
  open_contact: { labelKey: "assistantProactifScreen.actionOpenContact", route: "/contacts" },
};

const FILTERS: Array<{ key: Status; labelKey: string }> = [
  { key: "pending", labelKey: "assistantProactifScreen.filterPending" },
  { key: "accepted", labelKey: "assistantProactifScreen.filterAccepted" },
  { key: "dismissed", labelKey: "assistantProactifScreen.filterDismissed" },
  { key: "done", labelKey: "assistantProactifScreen.filterDone" },
];

export default function AssistantProactifScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { fetchAuth } = useAuth();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<Status>("pending");
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async (status: Status) => {
    setLoading(true);
    try {
      const res = await fetchAuth(`${PROACTIVE_API}/suggestions?status=${status}`);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      }
    } catch {
      /* fail-soft */
    } finally {
      setLoading(false);
    }
  }, [fetchAuth]);

  useEffect(() => { void load(filter); }, [filter, load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchAuth(`${PROACTIVE_API}/settings`);
        if (res.ok) { const d = await res.json(); setEnabled(d.enabled !== false); }
      } catch { /* fail-soft */ }
    })();
  }, [fetchAuth]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetchAuth(`${PROACTIVE_API}/run`, { method: "POST" });
      if (res.ok) {
        if (filter !== "pending") setFilter("pending"); else await load("pending");
      }
    } catch {
      /* fail-soft */
    } finally {
      setRunning(false);
    }
  }, [fetchAuth, filter, load]);

  const resolve = useCallback(async (id: number, action: "accept" | "dismiss") => {
    try {
      const res = await fetchAuth(`${PROACTIVE_API}/suggestions/${id}/${action}`, { method: "POST" });
      if (res.ok) setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* fail-soft */
    }
  }, [fetchAuth]);

  const sendFeedback = useCallback(async (id: number, value: "up" | "down") => {
    try {
      const res = await fetchAuth(`${PROACTIVE_API}/suggestions/${id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (res.ok) setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, feedback: value } : s)));
    } catch {
      /* fail-soft */
    }
  }, [fetchAuth]);

  const toggleEnabled = useCallback(async (next: boolean) => {
    setEnabled(next);
    try {
      const res = await fetchAuth(`${PROACTIVE_API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) setEnabled(!next);
    } catch {
      setEnabled(!next);
    }
  }, [fetchAuth]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{t("assistantProactifScreen.title")}</Text>
        <Pressable onPress={runNow} disabled={running} hitSlop={12}>
          {running ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={20} color={colors.primary} />}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(filter)} tintColor={colors.primary} />}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("assistantProactifScreen.autoMonitoring")}</Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
              {t("assistantProactifScreen.autoMonitoringDesc")}
            </Text>
          </View>
          <Switch value={enabled} onValueChange={toggleEnabled} />
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: active ? colors.primary : "transparent" },
                ]}
              >
                <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 13, fontWeight: "600" }}>
                  {t(f.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.primary} />
        ) : suggestions.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="inbox" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {filter === "pending" ? t("assistantProactifScreen.emptyPendingTitle") : t("assistantProactifScreen.emptyOtherTitle")}
            </Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              {filter === "pending"
                ? t("assistantProactifScreen.emptyPendingSub")
                : t("assistantProactifScreen.emptyOtherSub")}
            </Text>
          </View>
        ) : (
          suggestions.map((s) => {
            const sevMeta = SEVERITY_META[s.severity] ?? SEVERITY_META.info;
            const sev = { label: t(sevMeta.labelKey), color: sevMeta.color };
            const typeMeta = TYPE_META[s.type];
            const meta = { label: typeMeta ? t(typeMeta.labelKey) : s.type, icon: typeMeta?.icon ?? ("alert-triangle" as const) };
            const navMeta = s.actionType ? ACTION_NAV[s.actionType] : undefined;
            const nav = navMeta ? { label: t(navMeta.labelKey), route: navMeta.route } : undefined;
            return (
              <View
                key={s.id}
                style={[styles.suggCard, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: sev.color }]}
              >
                <View style={styles.suggHead}>
                  <Feather name={meta.icon} size={18} color={colors.mutedForeground} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.suggTitle, { color: colors.foreground }]}>{s.title}</Text>
                    {s.detail ? <Text style={[styles.suggDetail, { color: colors.mutedForeground }]}>{s.detail}</Text> : null}
                  </View>
                  <View style={[styles.sevBadge, { backgroundColor: sev.color + "22" }]}>
                    <Text style={{ color: sev.color, fontSize: 11, fontWeight: "700" }}>{sev.label}</Text>
                  </View>
                </View>

                <View style={styles.suggActions}>
                  <Text style={[styles.typeLabel, { color: colors.mutedForeground }]}>{meta.label}</Text>
                  <View style={{ flex: 1 }} />
                  {nav ? (
                    <Pressable onPress={() => router.push(nav.route as never)} style={[styles.actionBtn, { borderColor: colors.border }]}>
                      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>{nav.label}</Text>
                    </Pressable>
                  ) : null}
                  {s.status === "pending" ? (
                    <>
                      <Pressable onPress={() => sendFeedback(s.id, "up")} hitSlop={8} style={styles.iconBtn}>
                        <Feather name="thumbs-up" size={18} color={s.feedback === "up" ? "#22c55e" : colors.mutedForeground} />
                      </Pressable>
                      <Pressable onPress={() => sendFeedback(s.id, "down")} hitSlop={8} style={styles.iconBtn}>
                        <Feather name="thumbs-down" size={18} color={s.feedback === "down" ? "#ef4444" : colors.mutedForeground} />
                      </Pressable>
                      <Pressable onPress={() => resolve(s.id, "dismiss")} style={[styles.actionBtn, { borderColor: colors.border }]}>
                        <Feather name="x" size={16} color={colors.mutedForeground} />
                      </Pressable>
                      <Pressable onPress={() => resolve(s.id, "accept")} style={[styles.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                        <Feather name="check" size={16} color="#fff" />
                      </Pressable>
                    </>
                  ) : null}
                </View>
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
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 13, marginTop: 2 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 64, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
  suggCard: { borderRadius: 14, borderWidth: 1, borderLeftWidth: 4, padding: 14, marginBottom: 12 },
  suggHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  suggTitle: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  suggDetail: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  sevBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  suggActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  typeLabel: { fontSize: 12, fontWeight: "600" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  iconBtn: { padding: 4 },
});
