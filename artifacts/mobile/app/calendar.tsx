import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { DetailModal } from "@/components/DetailModal";
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
  contactEmail?: string;
  priority?: string;
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

const FORM_FIELDS = [
  { key: "title", label: "Titre", required: true },
  { key: "type", label: "Type", type: "select" as const, options: [
    { value: "rendez_vous", label: "Rendez-vous" },
    { value: "reunion", label: "Reunion" },
    { value: "appel", label: "Appel" },
    { value: "personnel", label: "Personnel" },
  ]},
  { key: "description", label: "Description", type: "multiline" as const },
  { key: "location", label: "Lieu" },
  { key: "contactName", label: "Contact" },
  { key: "contactPhone", label: "Tel. contact", type: "phone" as const },
];

export default function CalendarScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({ type: "rendez_vous" });
  const [formLoading, setFormLoading] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const start = new Date(selectedDate);
      start.setDate(1);
      const end = new Date(selectedDate);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59);
      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });
      const res = await fetchAuth(`${API_BASE}/api/calendar/events?${params}`);
      if (res.ok) {
        const data = await res.json();
        const all = [...(data.events ?? []), ...(data.taskEvents ?? [])];
        all.sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        setEvents(all);
      }
    } catch (err) { console.warn("[Calendar] fetch failed:", err); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDate, fetchAuth]);

  useEffect(() => { setLoading(true); fetchEvents(); }, [fetchEvents]);

  function onRefresh() { setRefreshing(true); fetchEvents(); }

  function changeMonth(delta: number) {
    const d = new Date(selectedDate);
    d.setMonth(d.getMonth() + delta);
    setSelectedDate(d);
  }

  function formatTime(dateStr: string, allDay?: boolean) {
    if (allDay) return "Journee";
    return new Date(dateStr).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDateHeader(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }

  const grouped = events.reduce((acc: Record<string, CalendarEvent[]>, ev) => {
    const key = new Date(ev.startDate).toLocaleDateString("fr-FR");
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});

  const sections = Object.entries(grouped).map(([date, items]) => ({
    date,
    dateLabel: formatDateHeader(items[0].startDate),
    items,
  }));

  async function handleSubmit() {
    if (!formValues.title?.trim()) return;
    setFormLoading(true);
    try {
      const now = new Date();
      now.setHours(now.getHours() + 1, 0, 0, 0);
      const endDate = new Date(now);
      endDate.setHours(endDate.getHours() + 1);
      const body = {
        ...formValues,
        ...(editId ? {} : { startDate: now.toISOString(), endDate: endDate.toISOString(), allDay: false }),
      };
      const url = editId ? `${API_BASE}/api/calendar/events/${editId}` : `${API_BASE}/api/calendar/events`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetchAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setFormValues({ type: "rendez_vous" });
        fetchEvents();
      }
    } catch (err) { console.warn("[Calendar] submit failed:", err); } finally { setFormLoading(false); }
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

  function openNew() {
    setEditId(null);
    setFormValues({ type: "rendez_vous" });
    setShowForm(true);
  }

  async function handleDelete(id: number | string) {
    if (typeof id === "string") return;
    try {
      await fetchAuth(`${API_BASE}/api/calendar/events/${id}`, { method: "DELETE" });
      setSelected(null);
      fetchEvents();
    } catch (err) { console.warn("[Calendar] delete failed:", err); }
  }

  const monthLabel = selectedDate.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Calendrier</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.monthNav}>
          <Pressable onPress={() => changeMonth(-1)} hitSlop={12}>
            <Feather name="chevron-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Pressable onPress={() => changeMonth(1)} hitSlop={12}>
            <Feather name="chevron-right" size={22} color="#ffffff" />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState icon="calendar" title="Aucun evenement" subtitle="Aucun evenement ce mois-ci" />
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.date}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item: section }) => (
            <View style={styles.daySection}>
              <Text style={[styles.dayLabel, { color: colors.foreground }]}>{section.dateLabel}</Text>
              {section.items.map((ev) => {
                const evColor = ev.color || TYPE_COLORS[ev.type] || "#64748b";
                return (
                  <Pressable
                    key={String(ev.id)}
                    onPress={() => setSelected(ev)}
                    style={({ pressed }) => [
                      styles.eventCard,
                      { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: evColor },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={styles.eventTime}>
                      <Text style={[styles.eventTimeText, { color: evColor }]}>
                        {formatTime(ev.startDate, ev.allDay)}
                      </Text>
                    </View>
                    <View style={styles.eventContent}>
                      <Text style={[styles.eventTitle, { color: colors.foreground }]} numberOfLines={1}>{ev.title}</Text>
                      {ev.location ? (
                        <View style={styles.eventMeta}>
                          <Feather name="map-pin" size={11} color={colors.mutedForeground} />
                          <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>{ev.location}</Text>
                        </View>
                      ) : null}
                      {ev.contactName ? (
                        <View style={styles.eventMeta}>
                          <Feather name="user" size={11} color={colors.mutedForeground} />
                          <Text style={[styles.eventMetaText, { color: colors.mutedForeground }]}>{ev.contactName}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={[styles.typeBadge, { backgroundColor: evColor + "18" }]}>
                      <Text style={[styles.typeBadgeText, { color: evColor }]}>
                        {TYPE_LABELS[ev.type] ?? ev.type}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        />
      )}

      <FAB icon="plus" onPress={openNew} />

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
        submitLabel="Creer"
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
            { label: "Debut", value: new Date(selected.startDate).toLocaleString("fr-FR"), icon: "clock" },
            { label: "Fin", value: new Date(selected.endDate).toLocaleString("fr-FR"), icon: "clock" },
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
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#ffffff", textTransform: "capitalize" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { flex: 1, justifyContent: "center" },
  listContent: { padding: 16 },
  daySection: { marginBottom: 20 },
  dayLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10, textTransform: "capitalize" },
  eventCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, borderLeftWidth: 4, marginBottom: 8 },
  eventTime: { marginRight: 12 },
  eventTimeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  eventContent: { flex: 1 },
  eventTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  eventMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
