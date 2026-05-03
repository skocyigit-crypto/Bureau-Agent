import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface CheckinSession {
  id: number;
  type: string;
  status: string;
  checkInAt: string;
  checkOutAt?: string;
  breakMinutes?: number;
  totalMinutes?: number;
  employeeName?: string;
  location?: string;
  notes?: string;
}

interface NearestProject {
  id: number;
  titre: string;
  adresse: string | null;
  distanceKm: number;
}

const TYPE_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  bureau: { label: "Bureau", color: "#3b82f6", icon: "home" },
  distance: { label: "Distanciel", color: "#8b5cf6", icon: "wifi" },
  terrain: { label: "Terrain", color: "#22c55e", icon: "map-pin" },
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function CheckinsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user: currentUser } = useAuth();
  const isWeb = Platform.OS === "web";
  const [activeSession, setActiveSession] = useState<CheckinSession | null>(null);
  const [history, setHistory] = useState<CheckinSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);
  const [elapsed, setElapsed] = useState("00:00:00");
  const [locLoading, setLocLoading] = useState(false);
  const [nearestProject, setNearestProject] = useState<NearestProject | null>(null);
  const [locGranted, setLocGranted] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [activeRes, historyRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/checkins/current`),
        fetchAuth(`${API_BASE}/api/checkins?limit=30&sortOrder=desc`),
      ]);
      if (activeRes.ok) {
        const data = await activeRes.json();
        const active = data.active?.[0] || null;
        const paused = data.paused?.[0] || null;
        setActiveSession(active || paused || null);
      } else {
        setActiveSession(null);
      }
      if (historyRes.ok) {
        const data = await historyRes.json();
        setHistory(data.checkins ?? []);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (activeSession && activeSession.status === "present") {
      timerRef.current = setInterval(() => {
        const start = new Date(activeSession.checkInAt).getTime();
        const now = Date.now();
        const breakMs = (activeSession.breakMinutes || 0) * 60 * 1000;
        const diff = Math.max(0, Math.floor((now - start - breakMs) / 1000));
        const h = String(Math.floor(diff / 3600)).padStart(2, "0");
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
        const s = String(diff % 60).padStart(2, "0");
        setElapsed(`${h}:${m}:${s}`);
      }, 1000);
    } else if (activeSession && activeSession.status === "en_pause") {
      setElapsed("En pause");
    } else {
      setElapsed("00:00:00");
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeSession]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  async function detectLocation(): Promise<{ lat: number; lng: number; project: NearestProject | null } | null> {
    setLocLoading(true);
    try {
      if (Platform.OS !== "web") {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocGranted(false);
          setLocLoading(false);
          return null;
        }
        setLocGranted(true);
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;

      const res = await fetchAuth(`${API_BASE}/api/meetings/chantiers`);
      if (res.ok) {
        const data = await res.json();
        const projets: any[] = data.chantiers || [];
        let nearest: any = null;
        let minDist = Infinity;
        for (const p of projets) {
          if (p.latitude == null || p.longitude == null) continue;
          const d = haversineKm(lat, lng, p.latitude, p.longitude);
          if (d < minDist) { minDist = d; nearest = { ...p, distanceKm: Math.round(d * 100) / 100 }; }
        }
        const project = nearest && nearest.distanceKm <= 50 ? nearest : null;
        setNearestProject(project);
        return { lat, lng, project };
      }
      return { lat, lng, project: null };
    } catch {
      return null;
    } finally {
      setLocLoading(false);
    }
  }

  async function checkin(type: string) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActing(true);
    try {
      const employeeName = currentUser ? `${currentUser.prenom || ""} ${currentUser.nom || ""}`.trim() : "Utilisateur";
      let locationNote = "";

      if (type === "terrain") {
        const loc = await detectLocation();
        if (loc?.project) {
          locationNote = `Chantier: ${loc.project.titre} (${loc.project.distanceKm} km)`;
        } else if (loc) {
          locationNote = `GPS: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
        }
      }

      const res = await fetchAuth(`${API_BASE}/api/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          status: "present",
          employeeName,
          employeeRole: currentUser?.role || "agent",
          ...(locationNote ? { notes: locationNote } : {}),
        }),
      });
      if (res.ok) fetchData();
    } catch {} finally { setActing(false); }
  }

  async function checkout() {
    if (!activeSession) return;
    setActing(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/checkins/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "termine", checkOutAt: new Date().toISOString() }),
      });
      if (res.ok) fetchData();
    } catch {} finally { setActing(false); }
  }

  async function togglePause() {
    if (!activeSession) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActing(true);
    try {
      const newStatus = activeSession.status === "en_pause" ? "present" : "en_pause";
      const res = await fetchAuth(`${API_BASE}/api/checkins/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) fetchData();
    } catch {} finally { setActing(false); }
  }

  function confirmCheckout() {
    if (Platform.OS === "web") { checkout(); return; }
    Alert.alert("Depart", "Confirmer votre depart ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Confirmer", style: "destructive", onPress: checkout },
    ]);
  }

  function formatDuration(checkInAt: string, checkOutAt?: string, totalMinutes?: number) {
    if (totalMinutes && totalMinutes > 0) {
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (h > 0) return `${h}h${m > 0 ? ` ${m}min` : ""}`;
      return `${m}min`;
    }
    const start = new Date(checkInAt).getTime();
    const end = checkOutAt ? new Date(checkOutAt).getTime() : Date.now();
    const diff = Math.max(0, Math.floor((end - start) / 60000));
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    if (h > 0) return `${h}h${m > 0 ? ` ${m}min` : ""}`;
    return `${m}min`;
  }

  const weekStats = (() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekSessions = history.filter((s) => new Date(s.checkInAt) >= monday && s.status === "termine");
    const totalMin = weekSessions.reduce((sum, s) => sum + (s.totalMinutes || 0), 0);
    const days = new Set(weekSessions.map((s) => new Date(s.checkInAt).toDateString())).size;
    const target = 5 * 8 * 60;
    return { totalMin, days, sessions: weekSessions.length, pct: Math.min(Math.round((totalMin / target) * 100), 100), target };
  })();

  const isPaused = activeSession?.status === "en_pause";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Pointage</Text>
          <Pressable onPress={onRefresh} hitSlop={12}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={[styles.weekCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.weekTop}>
                <View>
                  <Text style={[styles.weekTitle, { color: colors.foreground }]}>Cette semaine</Text>
                  <Text style={[styles.weekHours, { color: colors.primary }]}>
                    {Math.floor(weekStats.totalMin / 60)}h{weekStats.totalMin % 60 > 0 ? ` ${weekStats.totalMin % 60}min` : ""}
                  </Text>
                </View>
                <View style={styles.weekMetaCol}>
                  <View style={styles.weekMetaRow}>
                    <Feather name="calendar" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.weekMetaText, { color: colors.mutedForeground }]}>{weekStats.days} jours</Text>
                  </View>
                  <View style={styles.weekMetaRow}>
                    <Feather name="clock" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.weekMetaText, { color: colors.mutedForeground }]}>{weekStats.sessions} sessions</Text>
                  </View>
                  <Text style={[styles.weekPct, { color: colors.primary }]}>{weekStats.pct}% / 40h</Text>
                </View>
              </View>
              <View style={[styles.weekBar, { backgroundColor: colors.muted }]}>
                <View style={[styles.weekBarFill, { width: `${weekStats.pct}%`, backgroundColor: weekStats.pct >= 100 ? "#22c55e" : colors.primary }]} />
              </View>
            </View>

            {history.some((h) => h.notes?.includes("[google-auto]") || h.notes?.includes("[google-sync]")) && (
              <View style={[styles.googleBanner, { backgroundColor: "#4285f415", borderColor: "#4285f430" }]}>
                <Feather name="refresh-cw" size={14} color="#4285f4" />
                <Text style={[styles.googleBannerText, { color: "#4285f4" }]}>
                  Google Workspace : synchronisation automatique active
                </Text>
              </View>
            )}

            {activeSession ? (
              <View style={[styles.activeCard, { backgroundColor: colors.card, borderColor: isPaused ? "#f59e0b" : "#22c55e" }]}>
                <View style={styles.activePulse}>
                  <View style={[styles.statusDot, { backgroundColor: isPaused ? "#f59e0b" : "#22c55e" }]} />
                  <Text style={[styles.activeLabel, { color: colors.mutedForeground }]}>
                    {isPaused ? "En pause" : "Session active"}
                  </Text>
                </View>
                <Text style={[styles.timerText, { color: colors.foreground }]}>{elapsed}</Text>
                <View style={styles.activeTypeBadge}>
                  <Feather
                    name={TYPE_MAP[activeSession.type]?.icon || "clock"}
                    size={14}
                    color={TYPE_MAP[activeSession.type]?.color || "#64748b"}
                  />
                  <Text style={[styles.activeTypeText, { color: TYPE_MAP[activeSession.type]?.color || "#64748b" }]}>
                    {TYPE_MAP[activeSession.type]?.label || activeSession.type}
                  </Text>
                </View>
                <Text style={[styles.startedAt, { color: colors.mutedForeground }]}>
                  Debut: {new Date(activeSession.checkInAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </Text>
                {activeSession.notes && activeSession.notes.includes("Chantier:") && (
                  <View style={[styles.locationNote, { backgroundColor: "#22c55e12" }]}>
                    <Feather name="map-pin" size={12} color="#22c55e" />
                    <Text style={[styles.locationNoteText, { color: "#22c55e" }]}>
                      {activeSession.notes.replace("Chantier: ", "")}
                    </Text>
                  </View>
                )}
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={togglePause}
                    disabled={acting}
                    style={[styles.actionBtn, { backgroundColor: "#f59e0b18" }]}
                  >
                    {acting ? <ActivityIndicator size="small" color="#f59e0b" /> : (
                      <>
                        <Feather name={isPaused ? "play" : "pause"} size={18} color="#f59e0b" />
                        <Text style={[styles.actionBtnText, { color: "#f59e0b" }]}>
                          {isPaused ? "Reprendre" : "Pause"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={confirmCheckout}
                    disabled={acting}
                    style={[styles.actionBtn, { backgroundColor: "#ef444418" }]}
                  >
                    {acting ? <ActivityIndicator size="small" color="#ef4444" /> : (
                      <>
                        <Feather name="log-out" size={18} color="#ef4444" />
                        <Text style={[styles.actionBtnText, { color: "#ef4444" }]}>Depart</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={[styles.checkinCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.checkinTitle, { color: colors.foreground }]}>Pointer votre arrivee</Text>
                <Text style={[styles.checkinSubtitle, { color: colors.mutedForeground }]}>Choisissez votre mode de travail</Text>
                {locGranted === false && (
                  <View style={[styles.locWarning, { backgroundColor: "#ef444412" }]}>
                    <Feather name="alert-triangle" size={12} color="#ef4444" />
                    <Text style={[styles.locWarningText, { color: "#ef4444" }]}>
                      Permission GPS refusee. Activez-la dans les parametres pour le mode Terrain.
                    </Text>
                  </View>
                )}
                {nearestProject && (
                  <View style={[styles.projectDetected, { backgroundColor: "#22c55e12", borderColor: "#22c55e30" }]}>
                    <Feather name="map-pin" size={14} color="#22c55e" />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.projectName, { color: colors.foreground }]}>{nearestProject.titre}</Text>
                      <Text style={[styles.projectDist, { color: "#22c55e" }]}>{nearestProject.distanceKm} km</Text>
                    </View>
                    <Pressable onPress={() => setNearestProject(null)} hitSlop={8}>
                      <Feather name="x" size={14} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                )}
                <View style={styles.typeRow}>
                  {Object.entries(TYPE_MAP).map(([key, val]) => (
                    <Pressable
                      key={key}
                      onPress={() => checkin(key)}
                      disabled={acting || locLoading}
                      style={({ pressed }) => [
                        styles.typeBtn,
                        { backgroundColor: val.color + "18" },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      {(acting || (locLoading && key === "terrain")) ? (
                        <ActivityIndicator size="small" color={val.color} />
                      ) : (
                        <>
                          <View style={[styles.typeBtnIcon, { backgroundColor: val.color + "30" }]}>
                            <Feather name={val.icon} size={24} color={val.color} />
                          </View>
                          <Text style={[styles.typeBtnLabel, { color: val.color }]}>{val.label}</Text>
                          {key === "terrain" && (
                            <Text style={[styles.typeBtnHint, { color: val.color + "90" }]}>GPS</Text>
                          )}
                        </>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Historique</Text>
            {history.length === 0 ? (
              <EmptyState icon="clock" title="Aucun pointage" subtitle="Votre historique apparaitra ici" />
            ) : (
              history.map((session) => {
                const typeInfo = TYPE_MAP[session.type] || { label: session.type, color: "#64748b", icon: "clock" as const };
                const isGoogleSync = session.notes?.includes("[google-auto]") || session.notes?.includes("[google-sync]");
                const hasGPS = session.notes?.includes("Chantier:") || session.notes?.includes("GPS:");
                const color = isGoogleSync ? "#4285f4" : typeInfo.color;
                const icon = isGoogleSync ? "refresh-cw" : typeInfo.icon;
                return (
                  <View key={session.id} style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: color }]}>
                    <View style={[styles.historyIcon, { backgroundColor: color + "18" }]}>
                      <Feather name={icon} size={16} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[styles.historyName, { color: colors.foreground }]}>
                          {isGoogleSync ? "Google Workspace" : typeInfo.label}
                        </Text>
                        {isGoogleSync && (
                          <View style={styles.googleChip}><Text style={styles.googleChipText}>Auto</Text></View>
                        )}
                        {hasGPS && !isGoogleSync && (
                          <Feather name="map-pin" size={10} color="#22c55e" />
                        )}
                      </View>
                      <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                        {new Date(session.checkInAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        {" · "}
                        {new Date(session.checkInAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        {session.checkOutAt && ` - ${new Date(session.checkOutAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
                      </Text>
                      {hasGPS && session.notes && (
                        <Text style={[styles.historyLocation, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {session.notes.replace("[google-auto] ", "").replace("[google-sync] ", "")}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.historyDuration, { color }]}>
                      {formatDuration(session.checkInAt, session.checkOutAt, session.totalMinutes)}
                    </Text>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  weekCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  weekTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  weekTitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4 },
  weekHours: { fontSize: 28, fontFamily: "Inter_700Bold" },
  weekMetaCol: { alignItems: "flex-end", gap: 3 },
  weekMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  weekMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  weekPct: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  weekBar: { height: 8, borderRadius: 4, overflow: "hidden" },
  weekBarFill: { height: "100%", borderRadius: 4 },
  googleBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16 },
  googleBannerText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  activeCard: { borderRadius: 16, borderWidth: 2, padding: 24, alignItems: "center", marginBottom: 24 },
  activePulse: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  activeLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  timerText: { fontSize: 48, fontFamily: "Inter_700Bold", marginBottom: 8 },
  activeTypeBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  activeTypeText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  startedAt: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  locationNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 16 },
  locationNoteText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  actionRow: { flexDirection: "row", gap: 12, width: "100%", marginTop: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  checkinCard: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center", marginBottom: 24 },
  checkinTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  checkinSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  locWarning: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 10, borderRadius: 8, marginBottom: 12, width: "100%" },
  locWarningText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 17 },
  projectDetected: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 14, width: "100%" },
  projectName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  projectDist: { fontSize: 11, fontFamily: "Inter_500Medium" },
  typeRow: { flexDirection: "row", gap: 12, width: "100%" },
  typeBtn: { flex: 1, alignItems: "center", padding: 16, borderRadius: 14, minHeight: 90 },
  typeBtnIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  typeBtnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  typeBtnHint: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  historyCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, padding: 14, marginBottom: 8, gap: 12 },
  historyIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  historyName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  historyMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  historyLocation: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  historyDuration: { fontSize: 14, fontFamily: "Inter_700Bold", flexShrink: 0 },
  googleChip: { backgroundColor: "#4285f420", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  googleChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#4285f4" },
});
