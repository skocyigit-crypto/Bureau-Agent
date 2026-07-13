import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const WEEKDAYS = [
  { value: 1, label: "Lundi", short: "Lun" },
  { value: 2, label: "Mardi", short: "Mar" },
  { value: 3, label: "Mercredi", short: "Mer" },
  { value: 4, label: "Jeudi", short: "Jeu" },
  { value: 5, label: "Vendredi", short: "Ven" },
  { value: 6, label: "Samedi", short: "Sam" },
  { value: 7, label: "Dimanche", short: "Dim" },
] as const;

const TIMEZONE_OPTIONS = [
  { value: "Europe/Paris", label: "Europe/Paris (France)" },
  { value: "Europe/Brussels", label: "Europe/Bruxelles (Belgique)" },
  { value: "Europe/Zurich", label: "Europe/Zurich (Suisse)" },
  { value: "Europe/Luxembourg", label: "Europe/Luxembourg" },
  { value: "Europe/London", label: "Europe/Londres (Royaume-Uni)" },
  { value: "Europe/Madrid", label: "Europe/Madrid (Espagne)" },
  { value: "Europe/Lisbon", label: "Europe/Lisbonne (Portugal)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (Allemagne)" },
  { value: "Europe/Rome", label: "Europe/Rome (Italie)" },
  { value: "Europe/Istanbul", label: "Europe/Istanbul (Turquie)" },
  { value: "Africa/Casablanca", label: "Afrique/Casablanca (Maroc)" },
  { value: "Africa/Algiers", label: "Afrique/Alger (Algerie)" },
  { value: "Africa/Tunis", label: "Afrique/Tunis (Tunisie)" },
  { value: "America/Montreal", label: "Amerique/Montreal (Quebec)" },
  { value: "UTC", label: "UTC (temps universel)" },
] as const;

const DURATION_OPTIONS = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 heure" },
  { value: 90, label: "1 h 30" },
  { value: 120, label: "2 heures" },
] as const;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function fmt(n: number): string {
  return String(n).padStart(2, "0");
}

function parseWorkingDays(value: string | null | undefined): number[] {
  if (!value) return [1, 2, 3, 4, 5];
  const days = value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return days.length > 0
    ? Array.from(new Set(days)).sort((a, b) => a - b)
    : [1, 2, 3, 4, 5];
}

interface PickerModalProps {
  visible: boolean;
  title: string;
  options: ReadonlyArray<{ value: string | number; label: string }>;
  selected: string | number;
  onSelect: (value: string | number) => void;
  onClose: () => void;
}

function PickerModal({ visible, title, options, selected, onSelect, onClose }: PickerModalProps) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View
          style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <FlatList
            data={options as { value: string | number; label: string }[]}
            keyExtractor={(item) => String(item.value)}
            style={{ maxHeight: 340 }}
            renderItem={({ item }) => {
              const isSelected = item.value === selected;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.pickerItem,
                    { borderBottomColor: colors.border },
                    isSelected && { backgroundColor: colors.primary + "15" },
                    pressed && { opacity: 0.6 },
                  ]}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    onSelect(item.value);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      styles.pickerItemText,
                      { color: isSelected ? colors.primary : colors.foreground },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {isSelected && (
                    <Feather name="check" size={16} color={colors.primary} />
                  )}
                </Pressable>
              );
            }}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

interface TimePickerModalProps {
  visible: boolean;
  title: string;
  value: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

const DRUM_ITEM_HEIGHT = 46;
const DRUM_VISIBLE = 5;
const DRUM_LIST_HEIGHT = DRUM_ITEM_HEIGHT * DRUM_VISIBLE;

function TimePickerModal({ visible, title, value, onConfirm, onClose }: TimePickerModalProps) {
  const colors = useColors();
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const hourListRef = useRef<FlatList>(null);
  const minuteListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      const parts = value.split(":");
      const h = Math.min(23, Math.max(0, parseInt(parts[0] ?? "0", 10)));
      const m = Math.min(59, Math.max(0, parseInt(parts[1] ?? "0", 10)));
      setHour(h);
      setMinute(m);
      setTimeout(() => {
        hourListRef.current?.scrollToIndex({ index: h, animated: false, viewPosition: 0.5 });
        minuteListRef.current?.scrollToIndex({ index: m, animated: false, viewPosition: 0.5 });
      }, 80);
    }
  }, [visible, value]);

  function scrollToHour(h: number) {
    setHour(h);
    if (Platform.OS !== "web") Haptics.selectionAsync();
    hourListRef.current?.scrollToIndex({ index: h, animated: true, viewPosition: 0.5 });
  }

  function scrollToMinute(m: number) {
    setMinute(m);
    if (Platform.OS !== "web") Haptics.selectionAsync();
    minuteListRef.current?.scrollToIndex({ index: m, animated: true, viewPosition: 0.5 });
  }

  function handleConfirm() {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm(`${fmt(hour)}:${fmt(minute)}`);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View
          style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={[drumStyles.display, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Text style={[drumStyles.displayText, { color: colors.primary }]}>
              {fmt(hour)} : {fmt(minute)}
            </Text>
          </View>

          <View style={drumStyles.columns}>
            <Text style={[drumStyles.colLabel, { color: colors.mutedForeground }]}>Heure</Text>
            <View style={{ width: 16 }} />
            <Text style={[drumStyles.colLabel, { color: colors.mutedForeground }]}>Minute</Text>
          </View>

          <View style={drumStyles.columns}>
            <View style={[drumStyles.drumWrap, { borderColor: colors.border }]}>
              <View
                style={[
                  drumStyles.selectionHighlight,
                  { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" },
                ]}
                pointerEvents="none"
              />
              <FlatList
                ref={hourListRef}
                data={HOURS}
                keyExtractor={(i) => String(i)}
                style={{ height: DRUM_LIST_HEIGHT }}
                showsVerticalScrollIndicator={false}
                snapToInterval={DRUM_ITEM_HEIGHT}
                decelerationRate="fast"
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.y / DRUM_ITEM_HEIGHT);
                  scrollToHour(Math.min(23, Math.max(0, idx)));
                }}
                getItemLayout={(_, index) => ({
                  length: DRUM_ITEM_HEIGHT,
                  offset: DRUM_ITEM_HEIGHT * index,
                  index,
                })}
                ListHeaderComponent={<View style={{ height: DRUM_ITEM_HEIGHT * 2 }} />}
                ListFooterComponent={<View style={{ height: DRUM_ITEM_HEIGHT * 2 }} />}
                renderItem={({ item }) => {
                  const selected = item === hour;
                  return (
                    <Pressable
                      style={[
                        drumStyles.drumItem,
                        { height: DRUM_ITEM_HEIGHT },
                      ]}
                      onPress={() => scrollToHour(item)}
                    >
                      <Text
                        style={[
                          drumStyles.drumText,
                          { color: selected ? colors.primary : colors.foreground },
                          selected && drumStyles.drumTextSelected,
                        ]}
                      >
                        {fmt(item)}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>

            <Text style={[drumStyles.colonSep, { color: colors.mutedForeground }]}>:</Text>

            <View style={[drumStyles.drumWrap, { borderColor: colors.border }]}>
              <View
                style={[
                  drumStyles.selectionHighlight,
                  { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" },
                ]}
                pointerEvents="none"
              />
              <FlatList
                ref={minuteListRef}
                data={MINUTES}
                keyExtractor={(i) => String(i)}
                style={{ height: DRUM_LIST_HEIGHT }}
                showsVerticalScrollIndicator={false}
                snapToInterval={DRUM_ITEM_HEIGHT}
                decelerationRate="fast"
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.y / DRUM_ITEM_HEIGHT);
                  scrollToMinute(Math.min(59, Math.max(0, idx)));
                }}
                getItemLayout={(_, index) => ({
                  length: DRUM_ITEM_HEIGHT,
                  offset: DRUM_ITEM_HEIGHT * index,
                  index,
                })}
                ListHeaderComponent={<View style={{ height: DRUM_ITEM_HEIGHT * 2 }} />}
                ListFooterComponent={<View style={{ height: DRUM_ITEM_HEIGHT * 2 }} />}
                renderItem={({ item }) => {
                  const selected = item === minute;
                  return (
                    <Pressable
                      style={[
                        drumStyles.drumItem,
                        { height: DRUM_ITEM_HEIGHT },
                      ]}
                      onPress={() => scrollToMinute(item)}
                    >
                      <Text
                        style={[
                          drumStyles.drumText,
                          { color: selected ? colors.primary : colors.foreground },
                          selected && drumStyles.drumTextSelected,
                        ]}
                      >
                        {fmt(item)}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              drumStyles.confirmBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={handleConfirm}
          >
            <Text style={[drumStyles.confirmText, { color: colors.primaryForeground }]}>
              Confirmer
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

export default function HorairesOuvertureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";
  const isAdmin =
    user?.role === "super_admin" || user?.role === "administrateur";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tzModalVisible, setTzModalVisible] = useState(false);
  const [durationModalVisible, setDurationModalVisible] = useState(false);
  const [timePickerField, setTimePickerField] = useState<"start" | "end" | null>(null);

  const [form, setForm] = useState({
    workingDays: [1, 2, 3, 4, 5] as number[],
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    appointmentTimezone: "Europe/Paris",
    appointmentDurationMinutes: 30,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/org-profile`);
      if (res.ok) {
        const data = await res.json();
        setForm({
          workingDays: parseWorkingDays(data.workingDays),
          workingHoursStart: data.workingHoursStart || "09:00",
          workingHoursEnd: data.workingHoursEnd || "18:00",
          appointmentTimezone: data.appointmentTimezone || "Europe/Paris",
          appointmentDurationMinutes: data.appointmentDurationMinutes || 30,
        });
      } else {
        Alert.alert("Erreur", "Impossible de charger les horaires.");
      }
    } catch {
      Alert.alert("Erreur reseau", "Verifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  }, [fetchAuth]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!isAdmin) return;
    if (form.workingDays.length === 0) {
      Alert.alert("Jours invalides", "Selectionnez au moins un jour d'ouverture.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/org-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDays: form.workingDays.join(","),
          workingHoursStart: form.workingHoursStart,
          workingHoursEnd: form.workingHoursEnd,
          appointmentTimezone: form.appointmentTimezone,
          appointmentDurationMinutes: form.appointmentDurationMinutes,
        }),
      });
      if (res.ok) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Enregistre", "Les horaires d'ouverture ont ete mis a jour.");
      } else {
        const data = await res.json().catch(() => ({}));
        Alert.alert("Erreur", data.error || "Echec de la mise a jour.");
      }
    } catch {
      Alert.alert("Erreur reseau", "Verifiez votre connexion.");
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(dayValue: number) {
    if (!isAdmin) return;
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setForm((f) => ({
      ...f,
      workingDays: f.workingDays.includes(dayValue)
        ? f.workingDays.filter((d) => d !== dayValue)
        : [...f.workingDays, dayValue].sort((a, b) => a - b),
    }));
  }

  const selectedTzLabel =
    TIMEZONE_OPTIONS.find((t) => t.value === form.appointmentTimezone)?.label ??
    form.appointmentTimezone;
  const selectedDurationLabel =
    DURATION_OPTIONS.find((d) => d.value === form.appointmentDurationMinutes)?.label ??
    `${form.appointmentDurationMinutes} minutes`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.secondary,
            paddingTop: (isWeb ? 67 : insets.top) + 12,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={22} color="#ffffff" />
        </Pressable>
        <Text style={styles.headerTitle}>Horaires d'ouverture</Text>
        {isAdmin ? (
          <Pressable
            onPress={save}
            disabled={saving}
            style={[styles.saveButton, { backgroundColor: "#ffffff20" }]}
            hitSlop={8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>Enregistrer</Text>
            )}
          </Pressable>
        ) : (
          <View style={{ width: 90 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Chargement…
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: isWeb ? 40 : insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {!isAdmin && (
            <View
              style={[
                styles.readOnlyBanner,
                { backgroundColor: colors.secondary, borderColor: colors.border },
              ]}
            >
              <Feather name="lock" size={14} color={colors.mutedForeground} />
              <Text style={[styles.readOnlyText, { color: colors.mutedForeground }]}>
                Consultation uniquement — seuls les administrateurs peuvent modifier ces reglages.
              </Text>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: "#6366f115" }]}>
                <Feather name="calendar" size={18} color="#6366f1" />
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Jours d'ouverture
                </Text>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                  Jours ou votre entreprise prend des rendez-vous.
                </Text>
              </View>
            </View>

            <View style={styles.daysRow}>
              {WEEKDAYS.map((day) => {
                const active = form.workingDays.includes(day.value);
                return (
                  <Pressable
                    key={day.value}
                    onPress={() => toggleDay(day.value)}
                    disabled={!isAdmin}
                    style={({ pressed }) => [
                      styles.dayButton,
                      {
                        backgroundColor: active ? colors.primary : colors.secondary,
                        borderColor: active ? colors.primary : colors.border,
                        opacity: pressed ? 0.7 : !isAdmin ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayButtonText,
                        { color: active ? colors.primaryForeground : colors.foreground },
                      ]}
                    >
                      {day.short}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: "#3b82f615" }]}>
                <Feather name="clock" size={18} color="#3b82f6" />
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Heures d'ouverture
                </Text>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                  Appuyez pour choisir l'heure via le selecteur.
                </Text>
              </View>
            </View>

            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                  Ouverture
                </Text>
                <Pressable
                  onPress={() => isAdmin && setTimePickerField("start")}
                  disabled={!isAdmin}
                  style={({ pressed }) => [
                    styles.timeButton,
                    {
                      backgroundColor: colors.secondary,
                      borderColor: colors.border,
                      opacity: pressed ? 0.7 : !isAdmin ? 0.55 : 1,
                    },
                  ]}
                >
                  <Feather name="clock" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.timeButtonText, { color: colors.foreground }]}>
                    {form.workingHoursStart}
                  </Text>
                </Pressable>
              </View>

              <View style={[styles.timeSeparator, { backgroundColor: colors.border }]} />

              <View style={styles.timeField}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                  Fermeture
                </Text>
                <Pressable
                  onPress={() => isAdmin && setTimePickerField("end")}
                  disabled={!isAdmin}
                  style={({ pressed }) => [
                    styles.timeButton,
                    {
                      backgroundColor: colors.secondary,
                      borderColor: colors.border,
                      opacity: pressed ? 0.7 : !isAdmin ? 0.55 : 1,
                    },
                  ]}
                >
                  <Feather name="clock" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.timeButtonText, { color: colors.foreground }]}>
                    {form.workingHoursEnd}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: "#10b98115" }]}>
                <Feather name="globe" size={18} color="#10b981" />
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Fuseau horaire
                </Text>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                  Reference pour le calcul des creneaux.
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => isAdmin && setTzModalVisible(true)}
              disabled={!isAdmin}
              style={({ pressed }) => [
                styles.selectorButton,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : !isAdmin ? 0.55 : 1,
                },
              ]}
            >
              <Text style={[styles.selectorText, { color: colors.foreground }]} numberOfLines={1}>
                {selectedTzLabel}
              </Text>
              {isAdmin && <Feather name="chevron-down" size={16} color={colors.mutedForeground} />}
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: "#f59e0b15" }]}>
                <Feather name="watch" size={18} color="#f59e0b" />
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Duree par defaut
                </Text>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                  Duree standard d'un rendez-vous.
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => isAdmin && setDurationModalVisible(true)}
              disabled={!isAdmin}
              style={({ pressed }) => [
                styles.selectorButton,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : !isAdmin ? 0.55 : 1,
                },
              ]}
            >
              <Text style={[styles.selectorText, { color: colors.foreground }]}>
                {selectedDurationLabel}
              </Text>
              {isAdmin && <Feather name="chevron-down" size={16} color={colors.mutedForeground} />}
            </Pressable>
          </View>

          <View
            style={[
              styles.infoBox,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <Feather name="info" size={14} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Ces reglages s'appliquent immediatement au calcul des creneaux libres et aux
              disponibilites annoncees par l'assistant telephonique.
            </Text>
          </View>
        </ScrollView>
      )}

      <PickerModal
        visible={tzModalVisible}
        title="Fuseau horaire"
        options={TIMEZONE_OPTIONS}
        selected={form.appointmentTimezone}
        onSelect={(v) => setForm((f) => ({ ...f, appointmentTimezone: String(v) }))}
        onClose={() => setTzModalVisible(false)}
      />

      <PickerModal
        visible={durationModalVisible}
        title="Duree par defaut"
        options={DURATION_OPTIONS}
        selected={form.appointmentDurationMinutes}
        onSelect={(v) => setForm((f) => ({ ...f, appointmentDurationMinutes: Number(v) }))}
        onClose={() => setDurationModalVisible(false)}
      />

      <TimePickerModal
        visible={timePickerField === "start"}
        title="Heure d'ouverture"
        value={form.workingHoursStart}
        onConfirm={(v) => setForm((f) => ({ ...f, workingHoursStart: v }))}
        onClose={() => setTimePickerField(null)}
      />

      <TimePickerModal
        visible={timePickerField === "end"}
        title="Heure de fermeture"
        value={form.workingHoursEnd}
        onConfirm={(v) => setForm((f) => ({ ...f, workingHoursEnd: v }))}
        onClose={() => setTimePickerField(null)}
      />
    </View>
  );
}

const drumStyles = StyleSheet.create({
  display: {
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  displayText: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: 2,
  },
  columns: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 24,
    marginTop: 8,
    gap: 0,
  },
  colLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  drumWrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  selectionHighlight: {
    position: "absolute",
    left: 0,
    right: 0,
    height: DRUM_ITEM_HEIGHT,
    top: DRUM_ITEM_HEIGHT * 2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    zIndex: 1,
    pointerEvents: "none",
  },
  drumItem: {
    alignItems: "center",
    justifyContent: "center",
  },
  drumText: {
    fontSize: 20,
    fontFamily: "Inter_400Regular",
  },
  drumTextSelected: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
  },
  colonSep: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginHorizontal: 10,
    marginTop: 20,
  },
  confirmBtn: {
    marginHorizontal: 24,
    marginVertical: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  backButton: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  saveButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 90,
    alignItems: "center",
  },
  saveButtonText: {
    color: "#ffffff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  scrollContent: { padding: 16, gap: 14 },
  readOnlyBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  readOnlyText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 16 },
  daysRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  dayButtonText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  timeField: { flex: 1, gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  timeButtonText: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  timeSeparator: { width: 1, height: 36, marginTop: 18 },
  selectorButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  selectorText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#00000055",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerItemText: { fontSize: 15, fontFamily: "Inter_400Regular" },
});
