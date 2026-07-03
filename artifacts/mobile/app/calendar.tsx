import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { FAB } from "@/components/FAB";
import { FormModal } from "@/components/FormModal";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface CalendarEvent {
  id: number | string;
  title: string;
  description?: string;
  type: string;
  startDate: string;
  endDate: string;
  allDay?: boolean;
  location?: string;
  color?: string;
  status?: string;
  contactName?: string;
  contactPhone?: string;
}

interface OrgClosure {
  id: number;
  dateStart: string;
  dateEnd: string;
  label?: string;
}

const TYPE_COLORS: Record<string, string> = {
  rendez_vous: "#3b82f6",
  reunion: "#8b5cf6",
  tache: "#f59e0b",
  personnel: "#22c55e",
  appel: "#ec4899",
  autre: "#64748b",
};

const TYPE_LABELS: Record<string, string> = {
  rendez_vous: "Rendez-vous",
  reunion: "Reunion",
  tache: "Tache",
  personnel: "Personnel",
  appel: "Appel",
  autre: "Autre",
};

const DOW_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

const FORM_FIELDS = [
  { key: "title", label: "Titre", required: true },
  {
    key: "type", label: "Type", type: "select" as const, options: [
      { value: "rendez_vous", label: "Rendez-vous" },
      { value: "reunion", label: "Reunion" },
      { value: "appel", label: "Appel" },
      { value: "personnel", label: "Personnel" },
    ],
  },
  { key: "description", label: "Description", type: "multiline" as const },
  { key: "location", label: "Lieu" },
  { key: "contactName", label: "Contact" },
  { key: "contactPhone", label: "Tel. contact", type: "phone" as const },
];

function buildGrid(year: number, month: number, events: CalendarEvent[]) {
  const eventMap: Record<string, string[]> = {};
  events.forEach((ev) => {
    const key = new Date(ev.startDate).toISOString().slice(0, 10);
    if (!eventMap[key]) eventMap[key] = [];
    const color = ev.color || TYPE_COLORS[ev.type] || "#64748b";
    if (!eventMap[key].includes(color) && eventMap[key].length < 3) {
      eventMap[key].push(color);
    }
  });

  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay();
  startDow = (startDow + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<{ day: number | null; dateStr: string | null; eventColors: string[] }> = [];
  for (let i = 0; i < startDow; i++) cells.push({ day: null, dateStr: null, eventColors: [] });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, dateStr, eventColors: eventMap[dateStr] ?? [] });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, dateStr: null, eventColors: [] });
  return cells;
}

export default function CalendarScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventIdParam = Array.isArray(params.eventId) ? params.eventId[0] : params.eventId;
  const [focusedEventId, setFocusedEventId] = useState<string | null>(eventIdParam ?? null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(eventIdParam ?? null);
  useEffect(() => {
    if (eventIdParam) {
      setFocusedEventId(eventIdParam);
      setHighlightedEventId(eventIdParam);
    }
  }, [eventIdParam]);
  useEffect(() => {
    if (!highlightedEventId) return;
    const t = setTimeout(() => setHighlightedEventId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightedEventId]);
  const [orgProfile, setOrgProfile] = useState<{
    workingDays?: string;
    workingHoursStart?: string;
    workingHoursEnd?: string;
    appointmentTimezone?: string;
  } | null>(null);
  const [closures, setClosures] = useState<OrgClosure[]>([]);

  const isAdmin = user?.role === "administrateur" || user?.role === "super_admin";

  const fetchClosures = useCallback(async () => {
    try {
      const r = await fetchAuth(`${API_BASE}/api/org-closures`);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d)) setClosures(d);
      }
    } catch {}
  }, [fetchAuth]);

  useEffect(() => {
    fetchAuth(`${API_BASE}/api/org-profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOrgProfile(d))
      .catch(() => {});
    fetchClosures();
  }, [fetchAuth, fetchClosures]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") fetchClosures();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") fetchClosures();
    }, 5 * 60 * 1000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [fetchClosures]);


  const [showClosureSheet, setShowClosureSheet] = useState(false);
  const [closureSheetDate, setClosureSheetDate] = useState<string | null>(null);
  const [closureEndDate, setClosureEndDate] = useState<string | null>(null);
  const [closureLabel, setClosureLabel] = useState("");
  const [closureLoading, setClosureLoading] = useState(false);
  const [closureEndDateError, setClosureEndDateError] = useState<string | null>(null);

  const closureSheetClosure = useMemo(() => {
    if (!closureSheetDate) return null;
    return isDateClosed(closureSheetDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closureSheetDate, closures]);

  function openClosureSheet(dateStr: string) {
    setClosureSheetDate(dateStr);
    setClosureEndDate(dateStr);
    setClosureLabel("");
    setClosureEndDateError(null);
    setShowClosureSheet(true);
  }

  const DATE_RE_SIMPLE = /^\d{4}-\d{2}-\d{2}$/;

  function validateEndDate(end: string, start: string): string | null {
    if (!DATE_RE_SIMPLE.test(end)) return "Format attendu : AAAA-MM-JJ";
    const d = new Date(end + "T00:00:00Z");
    if (isNaN(d.getTime())) return "Date invalide";
    if (end < start) return "La date de fin doit être ≥ à la date de début";
    return null;
  }

  async function handleAddClosure() {
    if (!closureSheetDate) return;
    const endDate = closureEndDate ?? closureSheetDate;
    const err = validateEndDate(endDate, closureSheetDate);
    if (err) { setClosureEndDateError(err); return; }
    setClosureLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/org-closures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateStart: closureSheetDate, dateEnd: endDate, label: closureLabel.trim() || undefined }),
      });
      if (res.ok) {
        setShowClosureSheet(false);
        await fetchClosures();
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Erreur", err.error ?? "Impossible d'enregistrer la fermeture.");
      }
    } catch {
      Alert.alert("Erreur", "Erreur de connexion au serveur.");
    } finally {
      setClosureLoading(false);
    }
  }

  async function handleRemoveClosure(id: number) {
    setClosureLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/org-closures/${id}`, { method: "DELETE" });
      if (res.ok) {
        setShowClosureSheet(false);
        await fetchClosures();
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Erreur", err.error ?? "Impossible de supprimer la fermeture.");
      }
    } catch {
      Alert.alert("Erreur", "Erreur de connexion au serveur.");
    } finally {
      setClosureLoading(false);
    }
  }

  const workingDaySet = useMemo(() => {
    if (!orgProfile?.workingDays) return null;
    return new Set(String(orgProfile.workingDays).split(",").map(Number));
  }, [orgProfile]);

  function orgHhmmToLocalHour(hhMM: string, orgTz: string): number {
    const [hh, mm] = hhMM.split(":").map(Number);
    const now = new Date();
    const [yr, mo, dy] = now.toISOString().slice(0, 10).split("-").map(Number);
    const midnightUtc = new Date(Date.UTC(yr, mo - 1, dy, 0, 0, 0));
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: orgTz, hour: "2-digit", minute: "2-digit", hour12: false,
      });
      const parts = fmt.formatToParts(midnightUtc);
      const orgH = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
      const orgM = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
      const safeH = orgH === 24 ? 0 : orgH;
      const offsetMins = safeH <= 12 ? safeH * 60 + orgM : (safeH - 24) * 60 + orgM;
      const utcDate = new Date(midnightUtc.getTime() + (hh * 60 + mm - offsetMins) * 60 * 1000);
      return utcDate.getHours();
    } catch {
      return hh;
    }
  }

  function getIsoWeekdayInTz(d: Date, tz: string): number {
    try {
      const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d);
      const map: Record<string, number> = {
        Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
      };
      return map[name] ?? ((d.getDay() + 6) % 7 + 1);
    } catch {
      const dow = d.getDay();
      return dow === 0 ? 7 : dow;
    }
  }

  const workingHourStartLocal = useMemo(() => {
    if (!orgProfile?.workingHoursStart) return 9;
    const tz = orgProfile.appointmentTimezone || "UTC";
    return orgHhmmToLocalHour(orgProfile.workingHoursStart, tz);
  }, [orgProfile]);

  const workingHourEndLocal = useMemo(() => {
    if (!orgProfile?.workingHoursEnd) return 18;
    const tz = orgProfile.appointmentTimezone || "UTC";
    return orgHhmmToLocalHour(orgProfile.workingHoursEnd, tz);
  }, [orgProfile]);

  function isWorkingDateStr(dateStr: string): boolean {
    if (!workingDaySet) return true;
    const d = new Date(dateStr + "T12:00:00");
    const tz = orgProfile?.appointmentTimezone || "UTC";
    return workingDaySet.has(getIsoWeekdayInTz(d, tz));
  }

  function isDateClosed(dateStr: string): OrgClosure | null {
    for (const c of closures) {
      if (dateStr >= c.dateStart && dateStr <= c.dateEnd) return c;
    }
    return null;
  }

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(
    new Date().toISOString().slice(0, 10)
  );
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ type: "rendez_vous" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const fetchEvents = useCallback(async () => {
    try {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      end.setHours(23, 59, 59);
      const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
      const res = await fetchAuth(`${API_BASE}/api/calendar/events?${params}`);
      if (res.ok) {
        const data = await res.json();
        const all = [...(data.events ?? []), ...(data.taskEvents ?? [])];
        all.sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        setEvents(all);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [year, month, fetchAuth]);

  useEffect(() => { setLoading(true); fetchEvents(); fetchClosures(); }, [fetchEvents, fetchClosures]);

  useEffect(() => {
    if (!focusedEventId) return;
    const match = events.find((ev) => String(ev.id) === String(focusedEventId));
    if (match) {
      const d = new Date(match.startDate);
      setCurrentDate(d);
      setSelectedDateStr(d.toISOString().slice(0, 10));
      setSelected(match);
      setFocusedEventId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/calendar/events/${encodeURIComponent(focusedEventId)}`);
        if (!res.ok || cancelled) return;
        const ev = (await res.json()) as CalendarEvent;
        if (cancelled || !ev?.startDate) return;
        const d = new Date(ev.startDate);
        setCurrentDate(d);
        setSelectedDateStr(d.toISOString().slice(0, 10));
        setSelected(ev);
        setFocusedEventId(null);
      } catch {
        // ignore - user will see the calendar without focus
      }
    })();
    return () => { cancelled = true; };
  }, [focusedEventId, events, fetchAuth]);

  function onRefresh() { setRefreshing(true); fetchEvents(); fetchClosures(); }

  function changeMonth(delta: number) {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + delta);
    setCurrentDate(d);
    setSelectedDateStr(null);
  }

  function goToday() {
    setCurrentDate(new Date());
    setSelectedDateStr(new Date().toISOString().slice(0, 10));
  }

  const grid = useMemo(() => buildGrid(year, month, events), [year, month, events]);

  const filteredEvents = useMemo(() => {
    if (!selectedDateStr) return events;
    return events.filter((ev) => ev.startDate.slice(0, 10) === selectedDateStr);
  }, [events, selectedDateStr]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const monthLabel = currentDate.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  function formatEventTime(ev: CalendarEvent) {
    if (ev.allDay) return "Journee";
    const start = new Date(ev.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const end = new Date(ev.endDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${start} – ${end}`;
  }

  async function handleSubmit() {
    if (!formValues.title?.trim()) return;
    setFormLoading(true);
    try {
      const now = new Date();
      if (selectedDateStr) {
        const parts = selectedDateStr.split("-");
        now.setFullYear(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
      now.setHours(now.getHours() + 1, 0, 0, 0);
      const endDate = new Date(now);
      endDate.setHours(endDate.getHours() + 1);
      const body = { ...formValues, ...(editId ? {} : { startDate: now.toISOString(), endDate: endDate.toISOString(), allDay: false }) };
      const url = editId ? `${API_BASE}/api/calendar/events/${editId}` : `${API_BASE}/api/calendar/events`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ type: "rendez_vous" });
        fetchEvents();
      }
    } catch {} finally { setFormLoading(false); }
  }

  function openEdit(ev: CalendarEvent) {
    if (typeof ev.id === "string") return;
    setEditId(ev.id);
    setFormValues({
      title: ev.title || "",
      type: ev.type || "rendez_vous",
      description: ev.description || "",
      location: ev.location || "",
      contactName: ev.contactName || "",
      contactPhone: ev.contactPhone || "",
    });
    setSelected(null);
    setShowForm(true);
  }

  async function handleDelete(id: number | string) {
    if (typeof id === "string") return;
    try {
      await fetchAuth(`${API_BASE}/api/calendar/events/${id}`, { method: "DELETE" });
      setSelected(null);
      fetchEvents();
    } catch {}
  }

  const selectedDayLabel = selectedDateStr
    ? new Date(selectedDateStr + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    : monthLabel;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Calendrier</Text>
          <Pressable onPress={goToday} hitSlop={12}>
            <Text style={styles.todayBtn}>Auj.</Text>
          </Pressable>
        </View>

        <View style={styles.monthNav}>
          <Pressable onPress={() => changeMonth(-1)} hitSlop={16} style={styles.navBtn}>
            <Feather name="chevron-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</Text>
          <Pressable onPress={() => changeMonth(1)} hitSlop={16} style={styles.navBtn}>
            <Feather name="chevron-right" size={22} color="#ffffff" />
          </Pressable>
        </View>

        <View style={styles.dowRow}>
          {DOW_LABELS.map((d, i) => (
            <Text key={i} style={[styles.dowLabel, { color: i >= 5 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.6)" }]}>{d}</Text>
          ))}
        </View>

        <View style={styles.gridContainer}>
          {Array.from({ length: Math.ceil(grid.length / 7) }).map((_, rowIdx) => (
            <View key={rowIdx} style={styles.gridRow}>
              {grid.slice(rowIdx * 7, rowIdx * 7 + 7).map((cell, colIdx) => {
                const isToday = cell.dateStr === todayStr;
                const isSelected = cell.dateStr === selectedDateStr;
                const isWeekend = colIdx >= 5;
                return (
                  <Pressable
                    key={colIdx}
                    onPress={() => {
                      if (!cell.day) return;
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedDateStr(cell.dateStr === selectedDateStr ? null : cell.dateStr);
                    }}
                    style={[
                      styles.dayCell,
                      isSelected && { backgroundColor: colors.primary },
                      isToday && !isSelected && { backgroundColor: colors.primary + "30" },
                      !isSelected && !isToday && cell.dateStr && !isWorkingDateStr(cell.dateStr)
                        ? { backgroundColor: "rgba(0,0,0,0.18)" }
                        : undefined,
                      !isSelected && cell.dateStr && isDateClosed(cell.dateStr)
                        ? { backgroundColor: "rgba(239,68,68,0.22)" }
                        : undefined,
                    ]}
                  >
                    {cell.day ? (
                      <>
                        <Text style={[
                          styles.dayNum,
                          { color: isSelected ? "#fff" : isWeekend ? "rgba(255,255,255,0.5)" : "#fff" },
                          isToday && !isSelected && { fontFamily: "Inter_700Bold" },
                          !isSelected && cell.dateStr && !isWorkingDateStr(cell.dateStr)
                            ? { color: "rgba(255,255,255,0.35)" }
                            : undefined,
                          !isSelected && cell.dateStr && isDateClosed(cell.dateStr)
                            ? { color: "#fca5a5" }
                            : undefined,
                        ]}>
                          {cell.day}
                        </Text>
                        {!isSelected && cell.dateStr && isDateClosed(cell.dateStr) ? (
                          isAdmin ? (
                            <Pressable
                              onPress={() => openClosureSheet(cell.dateStr!)}
                              hitSlop={4}
                              style={styles.cellClosedToggle}
                            >
                              <Text style={styles.closedBadge}>Fermé</Text>
                              <Feather name="unlock" size={7} color="#fca5a5" />
                            </Pressable>
                          ) : (
                            <Text style={styles.closedBadge}>Fermé</Text>
                          )
                        ) : cell.eventColors.length > 0 ? (
                          <View style={styles.eventDots}>
                            {cell.eventColors.slice(0, 3).map((c, i) => (
                              <View key={i} style={[styles.eventDot, { backgroundColor: isSelected ? "rgba(255,255,255,0.8)" : c }]} />
                            ))}
                          </View>
                        ) : isAdmin && cell.dateStr && !isSelected ? (
                          <Pressable
                            onPress={() => openClosureSheet(cell.dateStr!)}
                            hitSlop={4}
                            style={styles.cellLockToggle}
                          >
                            <Feather name="lock" size={7} color="rgba(255,255,255,0.25)" />
                          </Pressable>
                        ) : null}
                      </>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredEvents}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View>
              <View style={styles.listHeader}>
                <Text style={[styles.listDateLabel, { color: colors.foreground }]}>
                  {selectedDayLabel.charAt(0).toUpperCase() + selectedDayLabel.slice(1)}
                </Text>
                <View style={[styles.countPill, { backgroundColor: colors.primary + "18" }]}>
                  <Text style={[styles.countPillText, { color: colors.primary }]}>{filteredEvents.length}</Text>
                </View>
              </View>
              {selectedDateStr && orgProfile && (() => {
                const closure = isDateClosed(selectedDateStr);
                const isOpen = !closure && isWorkingDateStr(selectedDateStr);
                const DAY_FROM = 6;
                const DAY_TO = 22;
                const slots = Array.from({ length: DAY_TO - DAY_FROM }, (_, i) => DAY_FROM + i);
                const closureLabel = closure
                  ? (closure.label ? `Fermé — ${closure.label}` : "Fermeture exceptionnelle")
                  : "Jour fermé — hors jours d'ouverture";
                return (
                  <View style={[styles.hoursTimeline, { borderColor: closure ? "#ef4444" : colors.border }]}>
                    <View style={styles.hoursTimelineHeader}>
                      <Text style={[styles.hoursTimelineLabel, { color: isOpen ? colors.primary : closure ? "#ef4444" : colors.mutedForeground, flex: 1 }]}>
                        {isOpen
                          ? `Ouvert ${orgProfile.workingHoursStart ?? ""} – ${orgProfile.workingHoursEnd ?? ""}`
                          : closureLabel}
                      </Text>
                      <View style={styles.hoursTimelineRight}>
                        {orgProfile.appointmentTimezone && (
                          <Text style={[styles.hoursTimelineTz, { color: colors.mutedForeground }]}>
                            {orgProfile.appointmentTimezone}
                          </Text>
                        )}
                        {isAdmin && (
                          <Pressable
                            onPress={() => openClosureSheet(selectedDateStr)}
                            hitSlop={10}
                            style={[styles.closureToggleBtn, { backgroundColor: closure ? "rgba(239,68,68,0.12)" : "rgba(0,0,0,0.06)" }]}
                          >
                            <Feather
                              name={closure ? "unlock" : "lock"}
                              size={13}
                              color={closure ? "#ef4444" : colors.mutedForeground}
                            />
                            <Text style={[styles.closureToggleBtnText, { color: closure ? "#ef4444" : colors.mutedForeground }]}>
                              {closure ? "Lever" : "Fermer"}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                    <View style={styles.hoursTimelineBar}>
                      {slots.map((h) => {
                        const active = isOpen && h >= workingHourStartLocal && h < workingHourEndLocal;
                        return (
                          <View
                            key={h}
                            style={[
                              styles.hoursTimelineSlot,
                              { backgroundColor: closure ? "rgba(239,68,68,0.25)" : active ? colors.primary : colors.border },
                              h === DAY_FROM && { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
                              h === DAY_TO - 1 && { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
                            ]}
                          />
                        );
                      })}
                    </View>
                    <View style={styles.hoursTimelineTicks}>
                      {[DAY_FROM, 9, 12, 15, 18, DAY_TO].map((h) => (
                        <Text key={h} style={[styles.hoursTimelineTickLabel, { color: colors.mutedForeground }]}>
                          {h}h
                        </Text>
                      ))}
                    </View>
                  </View>
                );
              })()}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="calendar"
              title="Aucun evenement"
              subtitle={selectedDateStr ? "Rien ce jour, appuyez sur + pour ajouter" : "Aucun evenement ce mois-ci"}
            />
          }
          renderItem={({ item: ev }) => {
            const evColor = ev.color || TYPE_COLORS[ev.type] || "#64748b";
            const isHighlighted = highlightedEventId != null && String(ev.id) === String(highlightedEventId);
            return (
              <Pressable
                onPress={() => { setHighlightedEventId(null); setSelected(ev); }}
                style={({ pressed }) => [
                  styles.eventCard,
                  { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: evColor },
                  isHighlighted && { backgroundColor: evColor + "1F", borderColor: evColor, borderWidth: 2 },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={styles.eventTimeBlock}>
                  <Text style={[styles.eventTimeText, { color: evColor }]}>
                    {ev.allDay ? "Journee" : new Date(ev.startDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                  {!ev.allDay && (
                    <Text style={[styles.eventEndTime, { color: colors.mutedForeground }]}>
                      {new Date(ev.endDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  )}
                </View>
                <View style={styles.eventContent}>
                  <Text style={[styles.eventTitle, { color: colors.foreground }]} numberOfLines={1}>{ev.title}</Text>
                  <View style={styles.eventMetaRow}>
                    {ev.location ? (
                      <View style={styles.eventMeta}>
                        <Feather name="map-pin" size={11} color={colors.mutedForeground} />
                        <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]} numberOfLines={1}>{ev.location}</Text>
                      </View>
                    ) : null}
                    {ev.contactName ? (
                      <View style={styles.eventMeta}>
                        <Feather name="user" size={11} color={colors.mutedForeground} />
                        <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]} numberOfLines={1}>{ev.contactName}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={[styles.typeBadge, { backgroundColor: evColor + "18" }]}>
                  <Text style={[styles.typeBadgeText, { color: evColor }]}>{TYPE_LABELS[ev.type] ?? ev.type}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <FAB
        icon="plus"
        onPress={() => {
          if (selectedDateStr && isDateClosed(selectedDateStr)) {
            const closure = isDateClosed(selectedDateStr)!;
            const msg = closure.label
              ? `Ce jour est marqué comme fermé (${closure.label}). Vous ne pouvez pas créer d'événement ici.`
              : "Ce jour est une fermeture exceptionnelle. Vous ne pouvez pas créer d'événement ici.";
            Alert.alert("Jour fermé", msg, [{ text: "OK" }]);
            return;
          }
          setEditId(null);
          setFormValues({ type: "rendez_vous" });
          setShowForm(true);
        }}
      />

      <FormModal
        visible={showForm}
        onClose={() => { setShowForm(false); setEditId(null); }}
        onSubmit={handleSubmit}
        title={editId ? "Modifier l'evenement" : "Nouvel evenement"}
        fields={FORM_FIELDS}
        values={formValues}
        onChange={(k, v) => setFormValues((p) => ({ ...p, [k]: v }))}
        loading={formLoading}
        icon="calendar"
        submitLabel={editId ? "Enregistrer" : "Creer"}
      />

      {selected ? (
        <DetailModal
          visible
          onClose={() => setSelected(null)}
          onEdit={typeof selected.id === "number" ? () => openEdit(selected) : undefined}
          onDelete={typeof selected.id === "number" ? () => handleDelete(selected.id) : undefined}
          title={selected.title}
          subtitle={selected.description}
          icon="calendar"
          iconColor={selected.color || TYPE_COLORS[selected.type] || "#64748b"}
          badge={{ label: TYPE_LABELS[selected.type] ?? selected.type, color: selected.color || TYPE_COLORS[selected.type] || "#64748b" }}
          fields={[
            { label: "Horaire", value: formatEventTime(selected), icon: "clock" },
            ...(selected.location ? [{ label: "Lieu", value: selected.location, icon: "map-pin" as const }] : []),
            ...(selected.contactName ? [{ label: "Contact", value: selected.contactName, icon: "user" as const }] : []),
            ...(selected.contactPhone ? [{ label: "Telephone", value: selected.contactPhone, icon: "phone" as const, action: "call" as const }] : []),
            ...(selected.status ? [{ label: "Statut", value: selected.status, icon: "info" as const }] : []),
          ]}
          extraActions={typeof selected.id === "number" ? [{
            label: "Créer un projet",
            icon: "folder",
            color: "#6366f1",
            onPress: async () => {
              try {
                const res = await fetchAuth(`${API_BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: selected.title, status: "planifie", priority: "moyenne", progress: 0, notes: `Créé depuis l'événement calendrier mobile` }) });
                if (res.ok) { setSelected(null); router.push("/projets" as any); }
              } catch {}
            },
          }] : undefined}
        />
      ) : null}

      <Modal visible={showClosureSheet} animationType="slide" transparent onRequestClose={() => setShowClosureSheet(false)}>
        <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.sheetContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setShowClosureSheet(false)} hitSlop={12}>
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {closureSheetClosure ? "Lever la fermeture" : "Marquer comme fermé"}
              </Text>
              <View style={{ width: 22 }} />
            </View>

            <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent} keyboardShouldPersistTaps="handled">
              {closureSheetDate ? (() => {
                const isRange = !closureSheetClosure && closureEndDate && closureEndDate > closureSheetDate;
                const startLabel = new Date(closureSheetDate + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
                const endLabel = closureEndDate ? new Date(closureEndDate + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : startLabel;
                const badgeColor = closureSheetClosure ? "#ef4444" : colors.primary;
                const badgeBg = closureSheetClosure ? "rgba(239,68,68,0.1)" : colors.primary + "12";
                return (
                  <View style={[styles.sheetDateBadge, { backgroundColor: badgeBg, flexDirection: "column", alignItems: "flex-start", gap: 2 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Feather name="calendar" size={15} color={badgeColor} />
                      <Text style={[styles.sheetDateText, { color: badgeColor }]}>
                        {isRange ? `Du ${startLabel}` : startLabel.charAt(0).toUpperCase() + startLabel.slice(1)}
                      </Text>
                    </View>
                    {isRange ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 23 }}>
                        <Feather name="arrow-right" size={13} color={badgeColor} />
                        <Text style={[styles.sheetDateText, { color: badgeColor }]}>au {endLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })() : null}

              {closureSheetClosure ? (
                <View>
                  <View style={[styles.sheetInfoBox, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.3)" }]}>
                    <Feather name="lock" size={16} color="#ef4444" />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sheetInfoTitle, { color: "#ef4444" }]}>Jour marqué fermé</Text>
                      {closureSheetClosure.label ? (
                        <Text style={[styles.sheetInfoSubtitle, { color: colors.mutedForeground }]}>{closureSheetClosure.label}</Text>
                      ) : (
                        <Text style={[styles.sheetInfoSubtitle, { color: colors.mutedForeground }]}>Fermeture exceptionnelle</Text>
                      )}
                    </View>
                  </View>
                  <Text style={[styles.sheetHint, { color: colors.mutedForeground }]}>
                    Supprimer cette fermeture rouvrira le jour aux rendez-vous.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 16 }}>
                  <View>
                    <Text style={[styles.sheetFieldLabel, { color: colors.mutedForeground }]}>Date de fin (optionnelle)</Text>
                    <TextInput
                      style={[
                        styles.sheetInput,
                        { backgroundColor: colors.muted, borderColor: closureEndDateError ? "#ef4444" : colors.border, color: colors.foreground },
                      ]}
                      placeholder={closureSheetDate ?? "AAAA-MM-JJ"}
                      placeholderTextColor={colors.mutedForeground}
                      value={closureEndDate ?? ""}
                      onChangeText={(v) => {
                        setClosureEndDate(v);
                        if (closureEndDateError) setClosureEndDateError(null);
                      }}
                      keyboardType="numeric"
                      returnKeyType="next"
                      maxLength={10}
                    />
                    {closureEndDateError ? (
                      <Text style={[styles.sheetHint, { color: "#ef4444", marginTop: 4 }]}>{closureEndDateError}</Text>
                    ) : (
                      <Text style={[styles.sheetHint, { color: colors.mutedForeground, marginTop: 4 }]}>
                        Laissez vide ou identique pour une fermeture d'un seul jour. Pour une semaine entière, entrez la date du dernier jour.
                      </Text>
                    )}
                  </View>
                  <View>
                    <Text style={[styles.sheetFieldLabel, { color: colors.mutedForeground }]}>Motif (optionnel)</Text>
                    <TextInput
                      style={[styles.sheetInput, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                      placeholder="ex : Congés, Formation, Jour férié…"
                      placeholderTextColor={colors.mutedForeground}
                      value={closureLabel}
                      onChangeText={setClosureLabel}
                      autoCapitalize="sentences"
                      returnKeyType="done"
                    />
                  </View>
                  <Text style={[styles.sheetHint, { color: colors.mutedForeground }]}>
                    Tous les jours de la plage seront bloqués pour les rendez-vous de l'organisation.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>
              <Pressable
                onPress={() => setShowClosureSheet(false)}
                style={[styles.sheetCancelBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.sheetCancelText, { color: colors.foreground }]}>Annuler</Text>
              </Pressable>
              {closureSheetClosure ? (
                <Pressable
                  onPress={() => {
                    Alert.alert(
                      "Lever la fermeture",
                      "Confirmer la suppression de cette fermeture ?",
                      [
                        { text: "Annuler", style: "cancel" },
                        { text: "Supprimer", style: "destructive", onPress: () => handleRemoveClosure(closureSheetClosure!.id) },
                      ]
                    );
                  }}
                  disabled={closureLoading}
                  style={({ pressed }) => [styles.sheetDestructBtn, { opacity: pressed || closureLoading ? 0.8 : 1 }]}
                >
                  {closureLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="unlock" size={16} color="#fff" />
                      <Text style={styles.sheetDestructText}>Lever la fermeture</Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={handleAddClosure}
                  disabled={closureLoading}
                  style={({ pressed }) => [styles.sheetSubmitBtn, { backgroundColor: colors.primary, opacity: pressed || closureLoading ? 0.8 : 1 }]}
                >
                  {closureLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="lock" size={16} color="#fff" />
                      <Text style={styles.sheetSubmitText}>Confirmer la fermeture</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  todayBtn: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)", backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  navBtn: { padding: 4 },
  monthLabel: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#ffffff" },
  dowRow: { flexDirection: "row", marginBottom: 4 },
  dowLabel: { flex: 1, textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  gridContainer: { marginBottom: 6 },
  gridRow: { flexDirection: "row" },
  dayCell: { flex: 1, alignItems: "center", paddingVertical: 5, borderRadius: 8, margin: 1 },
  dayNum: { fontSize: 14, fontFamily: "Inter_500Medium" },
  eventDots: { flexDirection: "row", gap: 2, marginTop: 2 },
  eventDot: { width: 4, height: 4, borderRadius: 2 },
  closedBadge: { fontSize: 7, fontFamily: "Inter_700Bold", color: "#fca5a5", marginTop: 1, letterSpacing: 0.2 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16 },
  listHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 10 },
  listDateLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  countPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  countPillText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  eventCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, borderLeftWidth: 4, marginBottom: 8 },
  eventTimeBlock: { width: 50, alignItems: "center", marginRight: 12 },
  eventTimeText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  eventEndTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  eventContent: { flex: 1 },
  eventTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  eventMetaRow: { gap: 3, marginTop: 3 },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  eventMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  hoursTimeline: { marginBottom: 12, padding: 10, borderRadius: 10, borderWidth: 1 },
  hoursTimelineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  hoursTimelineLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  hoursTimelineRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  hoursTimelineTz: { fontSize: 10, fontFamily: "Inter_400Regular" },
  hoursTimelineBar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 },
  hoursTimelineSlot: { flex: 1, height: 8 },
  hoursTimelineTicks: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  hoursTimelineTickLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },
  closureToggleBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  closureToggleBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cellClosedToggle: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 1 },
  cellLockToggle: { marginTop: 2, alignItems: "center" },
  sheetOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheetContainer: { maxHeight: "80%", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetBody: { maxHeight: 400 },
  sheetBodyContent: { padding: 20, gap: 16 },
  sheetDateBadge: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  sheetDateText: { fontSize: 14, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  sheetInfoBox: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  sheetInfoTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sheetInfoSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  sheetFieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6 },
  sheetInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, fontFamily: "Inter_400Regular" },
  sheetHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 10, lineHeight: 18 },
  sheetFooter: { flexDirection: "row", gap: 12, padding: 20, borderTopWidth: StyleSheet.hairlineWidth },
  sheetCancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sheetSubmitBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  sheetSubmitText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sheetDestructBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "#ef4444" },
  sheetDestructText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
