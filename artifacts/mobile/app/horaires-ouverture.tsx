import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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
  TextInput,
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

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
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
    if (!isValidTime(form.workingHoursStart)) {
      Alert.alert("Format invalide", "L'heure d'ouverture doit etre au format HH:MM (ex: 09:00).");
      return;
    }
    if (!isValidTime(form.workingHoursEnd)) {
      Alert.alert("Format invalide", "L'heure de fermeture doit etre au format HH:MM (ex: 18:00).");
      return;
    }
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
                  Format 24 h — ex : 09:00 et 18:00
                </Text>
              </View>
            </View>

            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                  Ouverture
                </Text>
                <TextInput
                  style={[
                    styles.timeInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.secondary,
                      borderColor: isValidTime(form.workingHoursStart)
                        ? colors.border
                        : "#ef4444",
                    },
                  ]}
                  value={form.workingHoursStart}
                  onChangeText={(v) =>
                    isAdmin && setForm((f) => ({ ...f, workingHoursStart: v }))
                  }
                  editable={isAdmin}
                  placeholder="09:00"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  autoCorrect={false}
                />
              </View>

              <View style={[styles.timeSeparator, { backgroundColor: colors.border }]} />

              <View style={styles.timeField}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                  Fermeture
                </Text>
                <TextInput
                  style={[
                    styles.timeInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.secondary,
                      borderColor: isValidTime(form.workingHoursEnd)
                        ? colors.border
                        : "#ef4444",
                    },
                  ]}
                  value={form.workingHoursEnd}
                  onChangeText={(v) =>
                    isAdmin && setForm((f) => ({ ...f, workingHoursEnd: v }))
                  }
                  editable={isAdmin}
                  placeholder="18:00"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  autoCorrect={false}
                />
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
    </View>
  );
}

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
  timeInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
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
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#00000060",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerItemText: { fontSize: 15, fontFamily: "Inter_400Regular" },
});
