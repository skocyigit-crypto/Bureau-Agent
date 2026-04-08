import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
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
  startTime: string;
  endTime?: string;
  pauseStart?: string;
  totalPause?: number;
  location?: string;
  notes?: string;
}

const TYPE_MAP: Record<string, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  bureau: { label: "Bureau", color: "#3b82f6", icon: "home" },
  distance: { label: "Distance", color: "#8b5cf6", icon: "wifi" },
  terrain: { label: "Terrain", color: "#22c55e", icon: "map-pin" },
};

export default function CheckinsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [activeSession, setActiveSession] = useState<CheckinSession | null>(null);
  const [history, setHistory] = useState<CheckinSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);
  const [elapsed, setElapsed] = useState("00:00:00");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [activeRes, historyRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/checkins/current`),
        fetchAuth(`${API_BASE}/api/checkins?limit=20&sortOrder=desc`),
      ]);
      if (activeRes.ok) {
        const data = await activeRes.json();
        const active = data.active?.[0] || data.checkin || null;
        const paused = data.paused?.[0] || null;
        setActiveSession(active ? { ...active, status: "active" } : paused ? { ...paused, status: "paused" } : null);
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
    if (activeSession?.status === "active") {
      timerRef.current = setInterval(() => {
        const start = new Date(activeSession.startTime).getTime();
        const now = Date.now();
        const pauseMs = (activeSession.totalPause || 0) * 1000;
        const diff = Math.max(0, Math.floor((now - start - pauseMs) / 1000));
        const h = String(Math.floor(diff / 3600)).padStart(2, "0");
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
        const s = String(diff % 60).padStart(2, "0");
        setElapsed(`${h}:${m}:${s}`);
      }, 1000);
    } else {
      setElapsed("00:00:00");
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeSession]);

  function onRefresh() { setRefreshing(true); fetchData(); }

  async function checkin(type: string) {
    setActing(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
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
    setActing(true);
    try {
      const newStatus = activeSession.status === "paused" ? "present" : "en_pause";
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
      { text: "Confirmer", onPress: checkout },
    ]);
  }

  function formatDuration(startStr: string, endStr?: string) {
    const start = new Date(startStr).getTime();
    const end = endStr ? new Date(endStr).getTime() : Date.now();
    const diff = Math.max(0, Math.floor((end - start) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Pointage</Text>
          <View style={{ width: 22 }} />
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
            {activeSession ? (
              <View style={[styles.activeCard, { backgroundColor: colors.card, borderColor: "#22c55e" }]}>
                <View style={[styles.statusDot, { backgroundColor: activeSession.status === "paused" ? "#f59e0b" : "#22c55e" }]} />
                <Text style={[styles.activeLabel, { color: colors.mutedForeground }]}>
                  {activeSession.status === "paused" ? "En pause" : "Session active"}
                </Text>
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
                  Debut: {new Date(activeSession.startTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </Text>
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={togglePause}
                    disabled={acting}
                    style={[styles.actionBtn, { backgroundColor: "#f59e0b18" }]}
                  >
                    {acting ? <ActivityIndicator size="small" color="#f59e0b" /> : (
                      <>
                        <Feather name={activeSession.status === "paused" ? "play" : "pause"} size={18} color="#f59e0b" />
                        <Text style={[styles.actionBtnText, { color: "#f59e0b" }]}>
                          {activeSession.status === "paused" ? "Reprendre" : "Pause"}
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
                <View style={styles.typeRow}>
                  {Object.entries(TYPE_MAP).map(([key, val]) => (
                    <Pressable
                      key={key}
                      onPress={() => checkin(key)}
                      disabled={acting}
                      style={({ pressed }) => [
                        styles.typeBtn,
                        { backgroundColor: val.color + "18" },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      {acting ? <ActivityIndicator size="small" color={val.color} /> : (
                        <>
                          <View style={[styles.typeBtnIcon, { backgroundColor: val.color + "30" }]}>
                            <Feather name={val.icon} size={24} color={val.color} />
                          </View>
                          <Text style={[styles.typeBtnLabel, { color: val.color }]}>{val.label}</Text>
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
              history.map(session => {
                const typeInfo = TYPE_MAP[session.type] || { label: session.type, color: "#64748b", icon: "clock" as const };
                return (
                  <View key={session.id} style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[styles.historyIcon, { backgroundColor: typeInfo.color + "18" }]}>
                      <Feather name={typeInfo.icon} size={16} color={typeInfo.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.historyName, { color: colors.foreground }]}>{typeInfo.label}</Text>
                      <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                        {new Date(session.startTime).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        {" • "}
                        {new Date(session.startTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        {session.endTime && ` - ${new Date(session.endTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
                      </Text>
                    </View>
                    <Text style={[styles.historyDuration, { color: typeInfo.color }]}>
                      {formatDuration(session.startTime, session.endTime)}
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
  activeCard: { borderRadius: 16, borderWidth: 2, padding: 24, alignItems: "center", marginBottom: 24 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginBottom: 8 },
  activeLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4 },
  timerText: { fontSize: 48, fontFamily: "Inter_700Bold", marginBottom: 8 },
  activeTypeBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  activeTypeText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  startedAt: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 20 },
  actionRow: { flexDirection: "row", gap: 12, width: "100%" },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  actionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  checkinCard: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center", marginBottom: 24 },
  checkinTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  checkinSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 20 },
  typeRow: { flexDirection: "row", gap: 12, width: "100%" },
  typeBtn: { flex: 1, alignItems: "center", padding: 16, borderRadius: 14 },
  typeBtnIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  typeBtnLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  historyCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8, gap: 12 },
  historyIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  historyName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  historyMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  historyDuration: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
