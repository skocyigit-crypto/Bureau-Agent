import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
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

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Provider {
  id: number;
  provider: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  phoneNumbers: string[];
  capabilities: string[];
}

interface Stats {
  calls: { total: number; successful: number; failed: number; totalDuration: number };
  sms: { total: number; successful: number; failed: number };
  providers: { total: number; active: number };
}

export default function TelephonyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [tab, setTab] = useState<"call" | "sms" | "providers">("call");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [callTo, setCallTo] = useState("");
  const [smsTo, setSmsTo] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/telephony/providers`),
        fetchAuth(`${API_BASE}/api/telephony/stats`),
      ]);
      if (pRes.ok) { const d = await pRes.json(); setProviders(d.providers || []); }
      if (sRes.ok) { const d = await sRes.json(); setStats(d); }
    } catch (e) { console.warn("[Telephony] fetch error:", e); }
    setLoading(false);
  }, [fetchAuth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function haptic() {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  async function doCall() {
    if (!callTo.trim()) return;
    haptic();
    setActionLoading(true);
    setResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/telephony/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: callTo, record: true }),
      });
      const data = await res.json();
      setResult({
        success: data.success,
        message: data.success ? `Appel lance via ${data.provider}` : `Echec: ${data.error}`,
      });
      if (data.success) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCallTo("");
      }
    } catch (e: any) {
      setResult({ success: false, message: e.message });
    }
    setActionLoading(false);
  }

  async function doSms() {
    if (!smsTo.trim() || !smsBody.trim()) return;
    haptic();
    setActionLoading(true);
    setResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/telephony/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: smsTo, body: smsBody }),
      });
      const data = await res.json();
      setResult({
        success: data.success,
        message: data.success ? `SMS envoye via ${data.provider}` : `Echec: ${data.error}`,
      });
      if (data.success) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSmsTo("");
        setSmsBody("");
      }
    } catch (e: any) {
      setResult({ success: false, message: e.message });
    }
    setActionLoading(false);
  }

  function fallbackCall() {
    if (!callTo.trim()) return;
    Linking.openURL(`tel:${callTo}`);
  }

  const activeProviders = providers.filter(p => p.isActive);
  const hasProvider = activeProviders.length > 0;

  const CAPABILITY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
    voice: "phone",
    sms: "message-square",
    whatsapp: "message-circle",
    video: "video",
    recording: "mic",
    ivr: "grid",
    transcription: "file-text",
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Telephonie</Text>
            <Text style={styles.headerSub}>
              {hasProvider ? `${activeProviders.length} fournisseur${activeProviders.length > 1 ? "s" : ""} actif${activeProviders.length > 1 ? "s" : ""}` : "Aucun fournisseur"}
            </Text>
          </View>
        </View>
        <View style={[styles.tabRow, { marginTop: 12 }]}>
          {([
            { key: "call" as const, label: "Appeler", icon: "phone-call" as const },
            { key: "sms" as const, label: "SMS", icon: "message-square" as const },
            { key: "providers" as const, label: "Config", icon: "settings" as const },
          ]).map(t => (
            <Pressable
              key={t.key}
              onPress={() => { setTab(t.key); setResult(null); }}
              style={[styles.tabBtn, { backgroundColor: tab === t.key ? colors.primary : "rgba(255,255,255,0.1)" }]}
            >
              <Feather name={t.icon} size={14} color={tab === t.key ? "#fff" : "rgba(255,255,255,0.7)"} />
              <Text style={[styles.tabText, { color: tab === t.key ? "#fff" : "rgba(255,255,255,0.7)" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 100 }]}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {result && (
              <View style={[styles.resultBanner, { backgroundColor: result.success ? "#22c55e15" : "#ef444415", borderColor: result.success ? "#22c55e" : "#ef4444" }]}>
                <Feather name={result.success ? "check-circle" : "alert-circle"} size={16} color={result.success ? "#22c55e" : "#ef4444"} />
                <Text style={[styles.resultText, { color: result.success ? "#22c55e" : "#ef4444" }]}>{result.message}</Text>
              </View>
            )}

            {tab === "call" && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: "#22c55e18" }]}>
                    <Feather name="phone-call" size={20} color="#22c55e" />
                  </View>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Passer un appel</Text>
                </View>

                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Numero de destination</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  value={callTo}
                  onChangeText={setCallTo}
                  placeholder="+33612345678"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                />

                {hasProvider ? (
                  <Pressable
                    onPress={doCall}
                    disabled={actionLoading || !callTo.trim()}
                    style={({ pressed }) => [styles.actionBtn, { backgroundColor: "#22c55e", opacity: (actionLoading || !callTo.trim()) ? 0.5 : pressed ? 0.8 : 1 }]}
                  >
                    {actionLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Feather name="phone-call" size={16} color="#fff" />
                        <Text style={styles.actionBtnText}>Appeler via {activeProviders[0]?.label || "fournisseur"}</Text>
                      </>
                    )}
                  </Pressable>
                ) : (
                  <View>
                    <Pressable
                      onPress={fallbackCall}
                      disabled={!callTo.trim()}
                      style={({ pressed }) => [styles.actionBtn, { backgroundColor: "#3b82f6", opacity: !callTo.trim() ? 0.5 : pressed ? 0.8 : 1 }]}
                    >
                      <Feather name="phone" size={16} color="#fff" />
                      <Text style={styles.actionBtnText}>Appeler (telephone natif)</Text>
                    </Pressable>
                    <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                      Configurez un fournisseur (Twilio, Vonage, etc.) pour les appels via l'application
                    </Text>
                  </View>
                )}
              </View>
            )}

            {tab === "sms" && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: "#3b82f618" }]}>
                    <Feather name="message-square" size={20} color="#3b82f6" />
                  </View>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Envoyer un SMS</Text>
                </View>

                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Numero de destination</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  value={smsTo}
                  onChangeText={setSmsTo}
                  placeholder="+33612345678"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                />

                <Text style={[styles.inputLabel, { color: colors.mutedForeground, marginTop: 12 }]}>Message</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  value={smsBody}
                  onChangeText={setSmsBody}
                  placeholder="Votre message..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  numberOfLines={3}
                />

                {hasProvider ? (
                  <Pressable
                    onPress={doSms}
                    disabled={actionLoading || !smsTo.trim() || !smsBody.trim()}
                    style={({ pressed }) => [styles.actionBtn, { backgroundColor: "#3b82f6", opacity: (actionLoading || !smsTo.trim() || !smsBody.trim()) ? 0.5 : pressed ? 0.8 : 1 }]}
                  >
                    {actionLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Feather name="send" size={16} color="#fff" />
                        <Text style={styles.actionBtnText}>Envoyer</Text>
                      </>
                    )}
                  </Pressable>
                ) : (
                  <View>
                    <Pressable
                      onPress={() => { if (smsTo.trim()) Linking.openURL(`sms:${smsTo}${smsBody ? `?body=${encodeURIComponent(smsBody)}` : ""}`); }}
                      disabled={!smsTo.trim()}
                      style={({ pressed }) => [styles.actionBtn, { backgroundColor: "#3b82f6", opacity: !smsTo.trim() ? 0.5 : pressed ? 0.8 : 1 }]}
                    >
                      <Feather name="message-square" size={16} color="#fff" />
                      <Text style={styles.actionBtnText}>SMS (application native)</Text>
                    </Pressable>
                    <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                      Configurez un fournisseur pour envoyer des SMS depuis l'application
                    </Text>
                  </View>
                )}
              </View>
            )}

            {tab === "providers" && (
              <View>
                {stats && (
                  <View style={styles.statsRow}>
                    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Feather name="phone" size={16} color="#22c55e" />
                      <Text style={[styles.statValue, { color: colors.foreground }]}>{stats.calls.successful}</Text>
                      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Appels</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Feather name="message-square" size={16} color="#3b82f6" />
                      <Text style={[styles.statValue, { color: colors.foreground }]}>{stats.sms.successful}</Text>
                      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>SMS</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Feather name="settings" size={16} color={colors.primary} />
                      <Text style={[styles.statValue, { color: colors.foreground }]}>{stats.providers.active}</Text>
                      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Actifs</Text>
                    </View>
                  </View>
                )}

                {providers.length === 0 ? (
                  <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Feather name="phone-off" size={32} color={colors.mutedForeground} />
                    <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Aucun fournisseur</Text>
                    <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                      Configurez Twilio, Vonage, Telnyx, Plivo, Sinch ou Bandwidth depuis le panneau web
                    </Text>
                  </View>
                ) : (
                  providers.map(p => (
                    <View key={p.id} style={[styles.providerCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: p.isActive ? 1 : 0.5 }]}>
                      <View style={[styles.providerIcon, { backgroundColor: colors.primary + "15" }]}>
                        <Feather name="phone" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.providerHeader}>
                          <Text style={[styles.providerName, { color: colors.foreground }]}>{p.label}</Text>
                          {p.isDefault && (
                            <View style={[styles.badge, { backgroundColor: "#f59e0b20" }]}>
                              <Text style={[styles.badgeText, { color: "#f59e0b" }]}>Defaut</Text>
                            </View>
                          )}
                          <View style={[styles.badge, { backgroundColor: p.isActive ? "#22c55e20" : "#ef444420" }]}>
                            <Text style={[styles.badgeText, { color: p.isActive ? "#22c55e" : "#ef4444" }]}>
                              {p.isActive ? "Actif" : "Inactif"}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.providerSub, { color: colors.mutedForeground }]}>
                          {p.provider} · {p.phoneNumbers.join(", ") || "Pas de numero"}
                        </Text>
                        <View style={styles.capRow}>
                          {p.capabilities.slice(0, 4).map(c => (
                            <View key={c} style={[styles.capBadge, { backgroundColor: colors.background }]}>
                              <Feather name={CAPABILITY_ICONS[c] || "circle"} size={10} color={colors.mutedForeground} />
                              <Text style={[styles.capText, { color: colors.mutedForeground }]}>{c}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  ))
                )}

                <View style={[styles.infoBox, { backgroundColor: colors.secondary }]}>
                  <Feather name="info" size={16} color="rgba(255,255,255,0.7)" />
                  <Text style={styles.infoText}>
                    La configuration des fournisseurs se fait depuis le panneau web (Telephonie). Fournisseurs supportes: Twilio, Vonage, Telnyx, Plivo, Sinch, Bandwidth.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  backBtn: { marginRight: 12, padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 1 },
  tabRow: { flexDirection: "row", gap: 8 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10 },
  tabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  loadingContainer: { paddingVertical: 60, alignItems: "center" },
  resultBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 14 },
  resultText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  card: { borderRadius: 14, borderWidth: 1, padding: 18, marginBottom: 16 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 16 },
  actionBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  hintText: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 10, lineHeight: 16 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: "center", gap: 4 },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  emptyCard: { borderWidth: 1, borderRadius: 14, padding: 30, alignItems: "center", gap: 8, marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  providerCard: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8, gap: 12 },
  providerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  providerHeader: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  providerName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  providerSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  capRow: { flexDirection: "row", gap: 4, marginTop: 6, flexWrap: "wrap" },
  capBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  capText: { fontSize: 9, fontFamily: "Inter_400Regular" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 12, marginTop: 16 },
  infoText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", lineHeight: 16 },
});
