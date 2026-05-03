import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
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
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
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

  useEffect(() => { setLoading(true); fetchEvents(); }, [fetchEvents]);

  function onRefresh() { setRefreshing(true); fetchEvents(); }

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
                    ]}
                  >
                    {cell.day ? (
                      <>
                        <Text style={[
                          styles.dayNum,
                          { color: isSelected ? "#fff" : isWeekend ? "rgba(255,255,255,0.5)" : "#fff" },
                          isToday && !isSelected && { fontFamily: "Inter_700Bold" },
                        ]}>
                          {cell.day}
                        </Text>
                        {cell.eventColors.length > 0 && (
                          <View style={styles.eventDots}>
                            {cell.eventColors.slice(0, 3).map((c, i) => (
                              <View key={i} style={[styles.eventDot, { backgroundColor: isSelected ? "rgba(255,255,255,0.8)" : c }]} />
                            ))}
                          </View>
                        )}
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
            <View style={styles.listHeader}>
              <Text style={[styles.listDateLabel, { color: colors.foreground }]}>
                {selectedDayLabel.charAt(0).toUpperCase() + selectedDayLabel.slice(1)}
              </Text>
              <View style={[styles.countPill, { backgroundColor: colors.primary + "18" }]}>
                <Text style={[styles.countPillText, { color: colors.primary }]}>{filteredEvents.length}</Text>
              </View>
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
            return (
              <Pressable
                onPress={() => setSelected(ev)}
                style={({ pressed }) => [
                  styles.eventCard,
                  { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: evColor },
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

      <FAB icon="plus" onPress={() => { setEditId(null); setFormValues({ type: "rendez_vous" }); setShowForm(true); }} />

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
        />
      ) : null}
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
});
