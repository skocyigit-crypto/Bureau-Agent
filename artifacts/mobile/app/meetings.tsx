import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Location from "expo-location";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ActionItem {
  titre: string;
  description?: string;
  priorite: "haute" | "moyenne" | "basse";
  echeanceJours: number;
  assigneA?: string;
}

interface TacheCreee {
  id: number;
  titre: string;
  priorite: string;
  echeance: string;
}

interface ChantierProche {
  id: number;
  titre: string;
  adresse: string | null;
  status: string;
  distanceKm: number;
}

interface CompileResult {
  resume: string;
  pointsCles: string[];
  decisionsActees: string[];
  actionItems: ActionItem[];
  tasksCreees: TacheCreee[];
  chantierLePlusProche: ChantierProche | null;
  compiledAt: string;
}

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------
const PRIORITY_COLORS: Record<string, string> = {
  haute: "#ef4444",
  moyenne: "#f59e0b",
  basse: "#22c55e",
};

function PriorityBadge({ value }: { value: string }) {
  const color = PRIORITY_COLORS[value] || "#94a3b8";
  return (
    <View style={[styles.badge, { backgroundColor: color + "20", borderColor: color + "50" }]}>
      <Text style={[styles.badgeText, { color }]}>{value.toUpperCase()}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function MeetingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();

  const [notes, setNotes] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<CompileResult | null>(null);

  // Location
  const [locLoading, setLocLoading] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [chantierManuel, setChantierManuel] = useState<ChantierProche | null>(null);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const animateIn = useCallback(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // -----------------------------------------------------------------------
  // Get GPS location
  // -----------------------------------------------------------------------
  const getLocation = useCallback(async () => {
    setLocLoading(true);
    setLocError(null);

    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocError("Permission de localisation refusee. Activez-la dans les parametres.");
          setLocLoading(false);
          return;
        }
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      setPosition({ lat, lng });

      // Try to find nearest chantier
      const res = await fetchAuth(`${API_BASE}/api/meetings/chantiers`);
      if (res.ok) {
        const data = await res.json();
        const projets: any[] = data.chantiers || [];
        let nearest: any = null;
        let minDist = Infinity;

        for (const p of projets) {
          if (p.latitude == null || p.longitude == null) continue;
          const d = haversineKm(lat, lng, p.latitude, p.longitude);
          if (d < minDist) {
            minDist = d;
            nearest = { ...p, distanceKm: Math.round(d * 100) / 100 };
          }
        }

        if (nearest && nearest.distanceKm <= 50) {
          setChantierManuel(nearest);
        } else {
          setChantierManuel(null);
        }
      }
    } catch (err: any) {
      setLocError("Impossible d'obtenir la position : " + (err.message || "Erreur inconnue"));
    } finally {
      setLocLoading(false);
    }
  }, [fetchAuth]);

  // -----------------------------------------------------------------------
  // Compile meeting
  // -----------------------------------------------------------------------
  const compileMeeting = useCallback(async () => {
    if (notes.trim().length < 10) {
      Alert.alert("Notes insuffisantes", "Saisissez au moins 10 caracteres de notes.");
      return;
    }

    setCompiling(true);
    Keyboard.dismiss();

    try {
      const body: any = { notes: notes.trim() };
      if (position) {
        body.latitude = position.lat;
        body.longitude = position.lng;
      }

      const res = await fetchAuth(`${API_BASE}/api/meetings/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Erreur", err.error || "Echec de la compilation.");
        return;
      }

      const data: CompileResult = await res.json();
      setResult(data);
      animateIn();
    } catch (err: any) {
      Alert.alert("Erreur", err.message || "Erreur reseau.");
    } finally {
      setCompiling(false);
    }
  }, [notes, position, fetchAuth, animateIn]);

  const reset = useCallback(() => {
    setResult(null);
    setNotes("");
    setPosition(null);
    setChantierManuel(null);
    setLocError(null);
  }, []);

  const chantierDetecte = result?.chantierLePlusProche ?? chantierManuel;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={[styles.headerIcon, { backgroundColor: "#8b5cf6" + "20" }]}>
              <Feather name="users" size={18} color="#8b5cf6" />
            </View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Réunion IA</Text>
          </View>
          {result && (
            <Pressable onPress={reset} style={styles.resetBtn}>
              <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Input section */}
          {!result && (
            <View style={styles.inputSection}>
              {/* Notes textarea */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Feather name="file-text" size={16} color="#8b5cf6" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Notes de réunion</Text>
                </View>
                <TextInput
                  style={[styles.notesInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                  placeholder="Saisissez vos notes... Qui était présent, ce qui a été discuté, les décisions, les prochaines étapes..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  numberOfLines={8}
                  value={notes}
                  onChangeText={setNotes}
                  textAlignVertical="top"
                  scrollEnabled={false}
                />
                <Text style={[styles.charCount, { color: colors.mutedForeground }]}>
                  {notes.length} / 8000 caractères
                </Text>
              </View>

              {/* Geolocation */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Feather name="map-pin" size={16} color="#22c55e" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Chantier (optionnel)</Text>
                </View>

                {chantierDetecte ? (
                  <View style={[styles.chantierCard, { backgroundColor: "#22c55e" + "10", borderColor: "#22c55e" + "40" }]}>
                    <Feather name="check-circle" size={18} color="#22c55e" />
                    <View style={styles.chantierInfo}>
                      <Text style={[styles.chantierName, { color: colors.foreground }]}>{chantierDetecte.titre}</Text>
                      {chantierDetecte.adresse && (
                        <Text style={[styles.chantierAddress, { color: colors.mutedForeground }]}>{chantierDetecte.adresse}</Text>
                      )}
                      <Text style={[styles.chantierDist, { color: "#22c55e" }]}>
                        {chantierDetecte.distanceKm} km · {chantierDetecte.status}
                      </Text>
                    </View>
                    <Pressable onPress={() => { setChantierManuel(null); setPosition(null); }}>
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable
                      style={[styles.locBtn, { backgroundColor: "#22c55e" + "15", borderColor: "#22c55e" + "40" }]}
                      onPress={getLocation}
                      disabled={locLoading}
                    >
                      {locLoading ? (
                        <ActivityIndicator size="small" color="#22c55e" />
                      ) : (
                        <Feather name="navigation" size={16} color="#22c55e" />
                      )}
                      <Text style={[styles.locBtnText, { color: "#22c55e" }]}>
                        {locLoading ? "Localisation en cours..." : "Détecter mon chantier"}
                      </Text>
                    </Pressable>
                    {locError && (
                      <Text style={[styles.locError, { color: colors.destructive }]}>{locError}</Text>
                    )}
                    {position && !chantierDetecte && (
                      <Text style={[styles.locNote, { color: colors.mutedForeground }]}>
                        📍 Position obtenue ({position.lat.toFixed(4)}, {position.lng.toFixed(4)}).
                        Aucun chantier trouvé à moins de 50 km — assignez des coordonnées GPS à vos projets.
                      </Text>
                    )}
                  </>
                )}
              </View>

              {/* Compile button */}
              <Pressable
                style={[styles.compileBtn, compiling && styles.compileBtnDisabled]}
                onPress={compileMeeting}
                disabled={compiling}
              >
                {compiling ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.compileBtnText}>Compilation IA en cours...</Text>
                  </>
                ) : (
                  <>
                    <Feather name="cpu" size={18} color="#fff" />
                    <Text style={styles.compileBtnText}>Compiler la réunion</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {/* Results */}
          {result && (
            <Animated.View style={{ opacity: fadeAnim }}>
              {/* Chantier detected */}
              {result.chantierLePlusProche && (
                <View style={[styles.card, { backgroundColor: "#22c55e" + "08", borderColor: "#22c55e" + "30" }]}>
                  <View style={styles.cardHeader}>
                    <Feather name="map-pin" size={16} color="#22c55e" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Chantier identifié</Text>
                    <View style={[styles.badge, { backgroundColor: "#22c55e" + "20", borderColor: "#22c55e" + "40", marginLeft: "auto" }]}>
                      <Text style={[styles.badgeText, { color: "#22c55e" }]}>{result.chantierLePlusProche.distanceKm} km</Text>
                    </View>
                  </View>
                  <Text style={[styles.chantierName, { color: colors.foreground, marginTop: 4 }]}>
                    {result.chantierLePlusProche.titre}
                  </Text>
                  {result.chantierLePlusProche.adresse && (
                    <Text style={[styles.chantierAddress, { color: colors.mutedForeground }]}>
                      {result.chantierLePlusProche.adresse}
                    </Text>
                  )}
                </View>
              )}

              {/* Summary */}
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <Feather name="align-left" size={16} color="#8b5cf6" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Résumé</Text>
                </View>
                <Text style={[styles.resumeText, { color: colors.foreground }]}>{result.resume}</Text>
                <Text style={[styles.compiledAt, { color: colors.mutedForeground }]}>
                  Compilé le {new Date(result.compiledAt).toLocaleString("fr-FR")}
                </Text>
              </View>

              {/* Key points */}
              {result.pointsCles.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Feather name="list" size={16} color="#3b82f6" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Points clés</Text>
                    <View style={[styles.countBadge, { backgroundColor: "#3b82f6" + "20" }]}>
                      <Text style={[styles.countBadgeText, { color: "#3b82f6" }]}>{result.pointsCles.length}</Text>
                    </View>
                  </View>
                  {result.pointsCles.map((pt, i) => (
                    <View key={i} style={styles.listItem}>
                      <View style={[styles.dot, { backgroundColor: "#3b82f6" }]} />
                      <Text style={[styles.listItemText, { color: colors.foreground }]}>{pt}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Decisions */}
              {result.decisionsActees.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Feather name="check-square" size={16} color="#f59e0b" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Décisions actées</Text>
                    <View style={[styles.countBadge, { backgroundColor: "#f59e0b" + "20" }]}>
                      <Text style={[styles.countBadgeText, { color: "#f59e0b" }]}>{result.decisionsActees.length}</Text>
                    </View>
                  </View>
                  {result.decisionsActees.map((d, i) => (
                    <View key={i} style={styles.listItem}>
                      <Feather name="check" size={14} color="#f59e0b" style={{ marginTop: 1 }} />
                      <Text style={[styles.listItemText, { color: colors.foreground }]}>{d}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Tasks created */}
              {result.tasksCreees.length > 0 && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.cardHeader}>
                    <Feather name="zap" size={16} color="#22c55e" />
                    <Text style={[styles.cardTitle, { color: colors.foreground }]}>Tâches créées</Text>
                    <View style={[styles.countBadge, { backgroundColor: "#22c55e" + "20" }]}>
                      <Text style={[styles.countBadgeText, { color: "#22c55e" }]}>{result.tasksCreees.length}</Text>
                    </View>
                  </View>
                  {result.tasksCreees.map((t, i) => (
                    <View key={i} style={[styles.taskRow, { borderColor: colors.border }]}>
                      <View style={[styles.taskCheckIcon, { backgroundColor: "#22c55e" + "20" }]}>
                        <Feather name="check" size={12} color="#22c55e" />
                      </View>
                      <View style={styles.taskInfo}>
                        <Text style={[styles.taskTitle, { color: colors.foreground }]}>{t.titre}</Text>
                        <Text style={[styles.taskMeta, { color: colors.mutedForeground }]}>
                          Échéance : {t.echeance}
                        </Text>
                      </View>
                      <PriorityBadge value={t.priorite} />
                    </View>
                  ))}
                </View>
              )}

              {/* Action buttons */}
              <View style={styles.actionRow}>
                <Pressable style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={reset}>
                  <Feather name="plus" size={16} color={colors.foreground} />
                  <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Nouvelle réunion</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: "#8b5cf6", borderColor: "#8b5cf6" }]}
                  onPress={() => router.push("/(tabs)/tasks" as any)}
                >
                  <Feather name="check-square" size={16} color="#fff" />
                  <Text style={[styles.actionBtnText, { color: "#fff" }]}>Voir les tâches</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </View>
    </TouchableWithoutFeedback>
  );
}

// ---------------------------------------------------------------------------
// Haversine (client side for immediate feedback)
// ---------------------------------------------------------------------------
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 6, marginRight: 8 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  headerIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  resetBtn: { padding: 6 },

  content: { padding: 16, gap: 14 },

  inputSection: { gap: 14 },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: "600", flex: 1 },

  notesInput: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    minHeight: 160,
    fontSize: 14,
    lineHeight: 22,
  },
  charCount: { fontSize: 12, textAlign: "right", marginTop: 6 },

  locBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  locBtnText: { fontSize: 14, fontWeight: "600" },
  locError: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  locNote: { fontSize: 12, marginTop: 8, lineHeight: 18 },

  chantierCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  chantierInfo: { flex: 1 },
  chantierName: { fontSize: 14, fontWeight: "600" },
  chantierAddress: { fontSize: 12, marginTop: 2 },
  chantierDist: { fontSize: 12, marginTop: 4, fontWeight: "600" },

  compileBtn: {
    backgroundColor: "#8b5cf6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 16,
    borderRadius: 14,
  },
  compileBtnDisabled: { opacity: 0.6 },
  compileBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: "700" },

  countBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: { fontSize: 11, fontWeight: "700" },

  resumeText: { fontSize: 14, lineHeight: 22 },
  compiledAt: { fontSize: 11, marginTop: 8 },

  listItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  listItemText: { flex: 1, fontSize: 14, lineHeight: 20 },

  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskCheckIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  taskInfo: { flex: 1 },
  taskTitle: { fontSize: 13, fontWeight: "600" },
  taskMeta: { fontSize: 11, marginTop: 2 },

  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: 13, fontWeight: "600" },
});
