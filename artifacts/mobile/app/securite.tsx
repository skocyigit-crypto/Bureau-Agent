import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTranslation, type TFunction } from "@/lib/i18n";

const SECURITY_API = `${API_BASE}/api/security`;

type Risk = "safe" | "suspicious" | "dangerous";

interface UrlScanResult {
  url: string;
  displayUrl: string;
  domain: string;
  risk: Risk;
  reasons: string[];
}

interface ProtectionStatus {
  layers: Record<string, { active: boolean; label: string }>;
  summary: { total: number; dangerous: number; suspicious: number; last24h: number };
  recentScans: Array<{
    id: string; kind: string; target: string; verdict: Risk; details: string; at: string; engine?: string;
  }>;
}

interface SecurityAlert {
  id: string;
  kind: string;
  verdict: Risk;
  target: string;
  message: string;
  at: string;
}

interface SecurityScore {
  score: number;
  rating: "excellent" | "bon" | "moyen" | "faible";
  strengths: string[];
  recommendations: Array<{ id: string; severity: "high" | "medium" | "low"; title: string; detail: string }>;
  breakdown: Array<{ label: string; impact: number }>;
  notes: string[];
  threats7d: { dangerous: number; suspicious: number };
  computedAt: string;
}

const RATING_META: Record<SecurityScore["rating"], { labelKey: string; color: string }> = {
  excellent: { labelKey: "securiteScreen.ratings.excellent", color: "#22c55e" },
  bon:       { labelKey: "securiteScreen.ratings.bon",       color: "#3b82f6" },
  moyen:     { labelKey: "securiteScreen.ratings.moyen",     color: "#f59e0b" },
  faible:    { labelKey: "securiteScreen.ratings.faible",    color: "#ef4444" },
};

const SEVERITY_META: Record<"high" | "medium" | "low", { labelKey: string; color: string }> = {
  high:   { labelKey: "securiteScreen.severities.high",   color: "#ef4444" },
  medium: { labelKey: "securiteScreen.severities.medium", color: "#f59e0b" },
  low:    { labelKey: "securiteScreen.severities.low",    color: "#64748b" },
};

interface PiiFinding {
  kind: string;
  label: string;
  count: number;
  samples: string[];
}

interface PiiResult {
  hasPii: boolean;
  findings: PiiFinding[];
  summary: string;
}

type ListEntryType = "domain" | "phone";
type ListKind = "block" | "allow";

interface ListEntry {
  id: number;
  entryType: ListEntryType;
  listKind: ListKind;
  value: string;
  note: string | null;
  createdAt: string;
}

const RISK_META: Record<Risk, { labelKey: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  safe: { labelKey: "securiteScreen.risks.safe", color: "#22c55e", icon: "check-circle" },
  suspicious: { labelKey: "securiteScreen.risks.suspicious", color: "#f59e0b", icon: "alert-triangle" },
  dangerous: { labelKey: "securiteScreen.risks.dangerous", color: "#ef4444", icon: "x-circle" },
};

const KIND_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  url: "link", file: "file", whatsapp: "message-circle", call: "phone", email: "mail",
};

export default function SecuriteScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();

  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<UrlScanResult | null>(null);
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [score, setScore] = useState<SecurityScore | null>(null);
  const [weeklyEmail, setWeeklyEmail] = useState(false);
  const [weeklyEmailSaving, setWeeklyEmailSaving] = useState(false);
  const [nextdnsId, setNextdnsId] = useState("");

  // Vérification RGPD (texte libre)
  const [piiText, setPiiText] = useState("");
  const [piiResult, setPiiResult] = useState<PiiResult | null>(null);
  const [piiScanning, setPiiScanning] = useState(false);

  // Listes personnalisees (blocage / autorisation)
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [entryType, setEntryType] = useState<ListEntryType>("domain");
  const [listKind, setListKind] = useState<ListKind>("block");
  const [listValue, setListValue] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetchAuth(`${SECURITY_API}/lists`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch { /* ignore */ }
  }, [fetchAuth]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const addEntry = useCallback(async () => {
    const trimmed = listValue.trim();
    if (!trimmed) return;
    setSavingEntry(true);
    try {
      const res = await fetchAuth(`${SECURITY_API}/lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryType, listKind, value: trimmed }),
      });
      if (res.ok) {
        setListValue("");
        fetchEntries();
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert(t("securiteScreen.errorTitle"), err.error ?? t("securiteScreen.addFailed"));
      }
    } catch {
      Alert.alert(t("securiteScreen.networkError"), t("securiteScreen.checkConnection"));
    } finally {
      setSavingEntry(false);
    }
  }, [entryType, listKind, listValue, fetchAuth, fetchEntries, t]);

  const removeEntry = useCallback(async (id: number) => {
    try {
      const res = await fetchAuth(`${SECURITY_API}/lists/${id}`, { method: "DELETE" });
      if (res.ok) setEntries((prev) => prev.filter((e) => e.id !== id));
      else Alert.alert(t("securiteScreen.errorTitle"), t("securiteScreen.deleteFailed"));
    } catch {
      Alert.alert(t("securiteScreen.networkError"), t("securiteScreen.checkConnection"));
    }
  }, [fetchAuth, t]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchAuth(`${SECURITY_API}/protection-status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }, [fetchAuth]);

  const fetchScore = useCallback(async () => {
    try {
      const res = await fetchAuth(`${SECURITY_API}/score`);
      if (res.ok) setScore(await res.json());
    } catch { /* ignore */ }
  }, [fetchAuth]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetchAuth(`${SECURITY_API}/settings`);
      if (res.ok) {
        const data = await res.json();
        setWeeklyEmail(Boolean(data.weeklySecurityEmail));
      }
    } catch { /* ignore */ }
  }, [fetchAuth]);

  const toggleWeeklyEmail = useCallback(async (next: boolean) => {
    setWeeklyEmailSaving(true);
    setWeeklyEmail(next);
    try {
      const res = await fetchAuth(`${SECURITY_API}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklySecurityEmail: next }),
      });
      if (!res.ok) {
        setWeeklyEmail(!next);
        Alert.alert(t("securiteScreen.errorTitle"), t("securiteScreen.updateFailed"));
      }
    } catch {
      setWeeklyEmail(!next);
      Alert.alert(t("securiteScreen.networkError"), t("securiteScreen.checkConnection"));
    } finally {
      setWeeklyEmailSaving(false);
    }
  }, [fetchAuth, t]);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetchAuth(`${SECURITY_API}/alerts`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      }
    } catch { /* ignore */ }
  }, [fetchAuth]);

  useEffect(() => { fetchStatus(); fetchAlerts(); fetchScore(); fetchSettings(); }, [fetchStatus, fetchAlerts, fetchScore, fetchSettings]);

  const scanText = useCallback(async () => {
    const trimmed = piiText.trim();
    if (!trimmed) return;
    setPiiScanning(true);
    setPiiResult(null);
    try {
      const res = await fetchAuth(`${SECURITY_API}/scan-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.ok) {
        setPiiResult(await res.json());
        fetchStatus();
      } else {
        Alert.alert(t("securiteScreen.errorTitle"), t("securiteScreen.analyzeFailed"));
      }
    } catch {
      Alert.alert(t("securiteScreen.networkError"), t("securiteScreen.checkConnection"));
    } finally {
      setPiiScanning(false);
    }
  }, [piiText, fetchAuth, fetchStatus, t]);

  const scan = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setScanning(true);
    setResult(null);
    try {
      const res = await fetchAuth(`${SECURITY_API}/scan-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (res.ok) {
        setResult(await res.json());
        fetchStatus();
        fetchAlerts();
      } else {
        Alert.alert(t("securiteScreen.errorTitle"), t("securiteScreen.analyzeFailed"));
      }
    } catch {
      Alert.alert(t("securiteScreen.networkError"), t("securiteScreen.checkConnection"));
    } finally {
      setScanning(false);
    }
  }, [url, fetchAuth, fetchStatus, fetchAlerts, t]);

  const openSafely = useCallback(async (force = false) => {
    if (!result) return;
    const target = result.url.startsWith("http") ? result.url : `https://${result.url}`;
    const proceed = async () => {
      try {
        await WebBrowser.openBrowserAsync(target, {
          enableBarCollapsing: true,
          showTitle: true,
        });
      } catch {
        Alert.alert(t("securiteScreen.errorTitle"), t("securiteScreen.browserFailed"));
      }
    };
    if (result.risk !== "safe" && !force) {
      Alert.alert(
        result.risk === "dangerous" ? t("securiteScreen.dangerousLink") : t("securiteScreen.suspiciousLink"),
        t("securiteScreen.riskWarning"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("securiteScreen.openAnywayBtn"), style: "destructive", onPress: proceed },
        ],
      );
      return;
    }
    proceed();
  }, [result, t]);

  const rm = result ? RISK_META[result.risk] : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{t("securiteScreen.headerTitle")}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t("securiteScreen.headerSubtitle")}
          </Text>
        </View>
        <View style={[styles.shieldBadge, { backgroundColor: colors.success + "22" }]}>
          <Feather name="shield" size={20} color={colors.success} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
        {/* Score de sécurité */}
        {score && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHead}>
              <Feather name="activity" size={18} color={colors.info} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.scoreTitle")}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 4 }}>
              <View style={{ alignItems: "center", justifyContent: "center", width: 84, height: 84, borderRadius: 42, borderWidth: 6, borderColor: RATING_META[score.rating].color }}>
                <Text style={{ fontSize: 26, fontFamily: "Inter_700Bold", color: RATING_META[score.rating].color }}>{score.score}</Text>
                <Text style={{ fontSize: 9, color: colors.mutedForeground }}>/ 100</Text>
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ alignSelf: "flex-start", backgroundColor: RATING_META[score.rating].color + "22", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: RATING_META[score.rating].color }}>{t(RATING_META[score.rating].labelKey)}</Text>
                </View>
                {score.strengths.slice(0, 3).map((s, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="check-circle" size={12} color={colors.success} />
                    <Text style={{ fontSize: 12, color: colors.foreground, flex: 1 }} numberOfLines={1}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>

            {score.recommendations.length > 0 ? (
              <View style={{ gap: 8, marginTop: 12 }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground }}>{t("securiteScreen.recommendations")}</Text>
                {score.recommendations.map((r) => (
                  <View key={r.id} style={{ flexDirection: "row", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
                    <View style={{ alignSelf: "flex-start", backgroundColor: SEVERITY_META[r.severity].color + "22", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: SEVERITY_META[r.severity].color }}>{t(SEVERITY_META[r.severity].labelKey)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{r.title}</Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>{r.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
                <Feather name="check-circle" size={14} color={colors.success} />
                <Text style={{ fontSize: 13, color: colors.success }}>{t("securiteScreen.allGood")}</Text>
              </View>
            )}

            {score.notes.length > 0 && (
              <View style={{ gap: 4, marginTop: 10 }}>
                {score.notes.map((n, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                    <Feather name="info" size={12} color={colors.mutedForeground} style={{ marginTop: 2 }} />
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1 }}>{n}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Statut */}
        {status && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.protectionTitle")}</Text>
            <View style={styles.statsRow}>
              <Stat value={status.summary.total} label={t("securiteScreen.stat.analyses")} color={colors.info} colors={colors} />
              <Stat value={status.summary.dangerous} label={t("securiteScreen.stat.blocked")} color={colors.destructive} colors={colors} />
              <Stat value={status.summary.suspicious} label={t("securiteScreen.stat.suspicious")} color={colors.warning} colors={colors} />
              <Stat value={status.summary.last24h} label={t("securiteScreen.stat.last24h")} color={colors.mutedForeground} colors={colors} />
            </View>
            <View style={{ gap: 6, marginTop: 6 }}>
              {Object.entries(status.layers).map(([key, layer]) => (
                <View key={key} style={styles.layerRow}>
                  <Feather
                    name={layer.active ? "shield" : "shield-off"}
                    size={14}
                    color={layer.active ? colors.success : colors.mutedForeground}
                  />
                  <Text style={[styles.layerLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {layer.label}
                  </Text>
                  <Text style={{ fontSize: 11, color: layer.active ? colors.success : colors.mutedForeground }}>
                    {layer.active ? t("securiteScreen.layerActive") : t("securiteScreen.layerInactive")}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Scanner un lien */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Feather name="link" size={18} color={colors.info} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.scanTitle")}</Text>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t("securiteScreen.scanHint")}
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder={t("securiteScreen.urlPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            onSubmitEditing={scan}
          />
          <Pressable accessibilityRole="button"
            onPress={scan}
            disabled={scanning || !url.trim()}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: scanning || !url.trim() ? 0.6 : 1 }]}
          >
            {scanning
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.btnText, { color: colors.primaryForeground }]}>{t("securiteScreen.analyze")}</Text>}
          </Pressable>

          {result && rm && (
            <View style={[styles.resultBox, { borderColor: rm.color }]}>
              <View style={styles.cardHead}>
                <Feather name={rm.icon} size={18} color={rm.color} />
                <Text style={{ fontWeight: "700", color: rm.color }}>{t(rm.labelKey)}</Text>
                <Text style={{ color: colors.mutedForeground, flex: 1, textAlign: "right" }} numberOfLines={1}>
                  {result.domain}
                </Text>
              </View>
              {result.reasons.length > 0 ? (
                result.reasons.map((r, i) => (
                  <Text key={i} style={{ fontSize: 12, color: colors.mutedForeground }}>• {r}</Text>
                ))
              ) : (
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{t("securiteScreen.noRiskSignal")}</Text>
              )}
              <Pressable accessibilityRole="button"
                onPress={() => openSafely()}
                style={[styles.btnOutline, { borderColor: result.risk === "safe" ? colors.success : colors.destructive }]}
              >
                <Feather name="external-link" size={14} color={result.risk === "safe" ? colors.success : colors.destructive} />
                <Text style={{ color: result.risk === "safe" ? colors.success : colors.destructive, fontWeight: "600" }}>
                  {result.risk === "safe" ? t("securiteScreen.openSafe") : t("securiteScreen.openAnyway")}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Vérifier un texte (RGPD) */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Feather name="shield" size={18} color={colors.warning} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.gdprTitle")}</Text>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t("securiteScreen.gdprHint")}
          </Text>
          <TextInput
            value={piiText}
            onChangeText={setPiiText}
            placeholder={t("securiteScreen.gdprPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, minHeight: 90, textAlignVertical: "top" }]}
          />
          <Pressable accessibilityRole="button"
            onPress={scanText}
            disabled={piiScanning || !piiText.trim()}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: piiScanning || !piiText.trim() ? 0.6 : 1 }]}
          >
            {piiScanning
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.btnText, { color: colors.primaryForeground }]}>{t("securiteScreen.analyzeText")}</Text>}
          </Pressable>

          {piiResult && (
            piiResult.hasPii ? (
              <View style={[styles.resultBox, { borderColor: colors.warning }]}>
                <View style={styles.cardHead}>
                  <Feather name="alert-triangle" size={16} color={colors.warning} />
                  <Text style={{ fontWeight: "700", color: colors.warning }}>{t("securiteScreen.piiDetected")}</Text>
                </View>
                {piiResult.findings.map((f) => (
                  <Text key={f.kind} style={{ fontSize: 12, color: colors.mutedForeground }}>
                    • {f.count} {f.label} : {f.samples.join(", ")}
                  </Text>
                ))}
              </View>
            ) : (
              <View style={[styles.resultBox, { borderColor: colors.success }]}>
                <View style={styles.cardHead}>
                  <Feather name="check-circle" size={16} color={colors.success} />
                  <Text style={{ fontSize: 13, color: colors.foreground }}>{t("securiteScreen.noPii")}</Text>
                </View>
              </View>
            )
          )}
        </View>

        {/* Alertes de sécurité */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: alerts.length > 0 ? colors.destructive : colors.border }]}>
          <View style={styles.cardHead}>
            <Feather name="bell" size={18} color={colors.destructive} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.alertsTitle")}</Text>
            {alerts.length > 0 && (
              <View style={{ marginLeft: "auto", backgroundColor: colors.destructive, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{alerts.length}</Text>
              </View>
            )}
          </View>
          {alerts.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t("securiteScreen.noAlerts")}</Text>
          ) : (
            alerts.map((a) => (
              <View key={a.id} style={[styles.scanRow, { borderColor: colors.border }]}>
                <Feather name={KIND_ICON[a.kind] ?? "shield"} size={14} color={colors.destructive} />
                <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }} numberOfLines={2}>{a.message}</Text>
                <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                  {new Date(a.at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Activité récente */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Feather name="activity" size={18} color={colors.warning} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.recentTitle")}</Text>
          </View>
          {(status?.recentScans ?? []).length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t("securiteScreen.noRecent")}</Text>
          ) : (
            (status?.recentScans ?? []).map((s) => {
              const rmeta = RISK_META[s.verdict];
              return (
                <View key={s.id} style={[styles.scanRow, { borderColor: colors.border }]}>
                  <Feather name={KIND_ICON[s.kind] ?? "shield"} size={14} color={colors.mutedForeground} />
                  <Feather name={rmeta.icon} size={14} color={rmeta.color} />
                  <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }} numberOfLines={1}>{s.target}</Text>
                  {s.engine ? (
                    <Text style={{ fontSize: 9, color: colors.mutedForeground }} numberOfLines={1}>{s.engine}</Text>
                  ) : null}
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                    {new Date(s.at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {/* Listes personnalisées */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Feather name="list" size={18} color="#0d9488" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.listsTitle")}</Text>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t("securiteScreen.listsHint")}
          </Text>

          {/* Sélecteurs type + sens */}
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable accessibilityRole="button"
              onPress={() => setEntryType("domain")}
              style={[styles.toggle, { borderColor: colors.border, backgroundColor: entryType === "domain" ? "#0d9488" : colors.background }]}
            >
              <Feather name="globe" size={12} color={entryType === "domain" ? "#fff" : colors.mutedForeground} />
              <Text style={{ fontSize: 11, fontWeight: "600", color: entryType === "domain" ? "#fff" : colors.mutedForeground }}>{t("securiteScreen.site")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              onPress={() => setEntryType("phone")}
              style={[styles.toggle, { borderColor: colors.border, backgroundColor: entryType === "phone" ? "#0d9488" : colors.background }]}
            >
              <Feather name="phone" size={12} color={entryType === "phone" ? "#fff" : colors.mutedForeground} />
              <Text style={{ fontSize: 11, fontWeight: "600", color: entryType === "phone" ? "#fff" : colors.mutedForeground }}>{t("securiteScreen.phone")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              onPress={() => setListKind("block")}
              style={[styles.toggle, { borderColor: colors.border, backgroundColor: listKind === "block" ? colors.destructive : colors.background }]}
            >
              <Feather name="slash" size={12} color={listKind === "block" ? "#fff" : colors.mutedForeground} />
              <Text style={{ fontSize: 11, fontWeight: "600", color: listKind === "block" ? "#fff" : colors.mutedForeground }}>{t("securiteScreen.block")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              onPress={() => setListKind("allow")}
              style={[styles.toggle, { borderColor: colors.border, backgroundColor: listKind === "allow" ? colors.success : colors.background }]}
            >
              <Feather name="check" size={12} color={listKind === "allow" ? "#fff" : colors.mutedForeground} />
              <Text style={{ fontSize: 11, fontWeight: "600", color: listKind === "allow" ? "#fff" : colors.mutedForeground }}>{t("securiteScreen.allow")}</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 6 }}>
            <TextInput
              value={listValue}
              onChangeText={setListValue}
              placeholder={entryType === "domain" ? t("securiteScreen.domainPlaceholder") : t("securiteScreen.phonePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              onSubmitEditing={addEntry}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.add")}
              onPress={addEntry}
              disabled={savingEntry || !listValue.trim()}
              style={[styles.btn, { paddingHorizontal: 16, justifyContent: "center", backgroundColor: colors.primary, opacity: savingEntry || !listValue.trim() ? 0.6 : 1 }]}
            >
              {savingEntry
                ? <ActivityIndicator color={colors.primaryForeground} />
                : <Feather name="plus" size={18} color={colors.primaryForeground} />}
            </Pressable>
          </View>

          {entries.length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>{t("securiteScreen.noRules")}</Text>
          ) : (
            entries.map((e) => (
              <View key={e.id} style={[styles.scanRow, { borderColor: colors.border }]}>
                <Feather
                  name={e.listKind === "block" ? "slash" : "check-circle"}
                  size={14}
                  color={e.listKind === "block" ? colors.destructive : colors.success}
                />
                <Feather name={e.entryType === "domain" ? "globe" : "phone"} size={13} color={colors.mutedForeground} />
                <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }} numberOfLines={1}>{e.value}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t("common.delete")} onPress={() => removeEntry(e.id)} hitSlop={8}>
                  <Feather name="trash-2" size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ))
          )}
        </View>

        {/* Réglages : synthèse hebdomadaire par email (opt-in) */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Feather name="mail" size={18} color={colors.success} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.weeklyTitle")}</Text>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t("securiteScreen.weeklyHint")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
                {t("securiteScreen.weeklyEnable")}
              </Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
                {t("securiteScreen.weeklyDesc")}
              </Text>
            </View>
            <Switch
              value={weeklyEmail}
              disabled={weeklyEmailSaving}
              onValueChange={toggleWeeklyEmail}
              trackColor={{ true: colors.success }}
            />
          </View>
        </View>

        {/* Partenaires */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.info + "55" }]}>
          <View style={styles.cardHead}>
            <Feather name="zap" size={18} color={colors.info} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("securiteScreen.partnersTitle")}</Text>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {t("securiteScreen.partnersHint")}
          </Text>
          <TextInput
            value={nextdnsId}
            onChangeText={setNextdnsId}
            placeholder={t("securiteScreen.nextdnsPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <Pressable accessibilityRole="button"
            onPress={() => {
              const link = nextdnsId.trim()
                ? `https://my.nextdns.io/${encodeURIComponent(nextdnsId.trim())}/setup`
                : "https://my.nextdns.io/signup";
              Linking.openURL(link).catch(() => Alert.alert(t("securiteScreen.errorTitle"), t("securiteScreen.linkUnavailable")));
            }}
            style={[styles.btnOutline, { borderColor: colors.info }]}
          >
            <Feather name="external-link" size={14} color={colors.info} />
            <Text style={{ color: colors.info, fontWeight: "600" }}>
              {nextdnsId.trim() ? t("securiteScreen.nextdnsGuide") : t("securiteScreen.nextdnsCreate")}
            </Text>
          </Pressable>
          <View style={[styles.scanRow, { borderColor: colors.border, marginTop: 4 }]}>
            <Feather name="shield" size={14} color={colors.mutedForeground} />
            <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }}>{t("securiteScreen.bitdefender")}</Text>
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{t("securiteScreen.soon")}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ value, label, color, colors }: {
  value: number; label: string; color: string; colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.stat, { borderColor: colors.border }]}>
      <Text style={{ fontSize: 20, fontWeight: "800", color }}>{value}</Text>
      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 18, fontWeight: "700" },
  subtitle: { fontSize: 12 },
  shieldBadge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 17 },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  layerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  toggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8,
  },
  layerLabel: { flex: 1, fontSize: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnText: { fontWeight: "700", fontSize: 14 },
  btnOutline: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 10, marginTop: 4,
  },
  resultBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4, marginTop: 4 },
  scanRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
});
