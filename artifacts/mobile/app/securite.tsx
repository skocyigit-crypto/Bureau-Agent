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
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

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
    id: string; kind: string; target: string; verdict: Risk; details: string; at: string;
  }>;
}

const RISK_META: Record<Risk, { label: string; color: string; icon: keyof typeof Feather.glyphMap }> = {
  safe: { label: "Sûr", color: "#22c55e", icon: "check-circle" },
  suspicious: { label: "Suspect", color: "#f59e0b", icon: "alert-triangle" },
  dangerous: { label: "Dangereux", color: "#ef4444", icon: "x-circle" },
};

const KIND_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  url: "link", file: "file", whatsapp: "message-circle", call: "phone", email: "mail",
};

export default function SecuriteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();

  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<UrlScanResult | null>(null);
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [nextdnsId, setNextdnsId] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchAuth(`${SECURITY_API}/protection-status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }, [fetchAuth]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

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
      } else {
        Alert.alert("Erreur", "Analyse impossible.");
      }
    } catch {
      Alert.alert("Erreur réseau", "Vérifiez votre connexion.");
    } finally {
      setScanning(false);
    }
  }, [url, fetchAuth, fetchStatus]);

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
        Alert.alert("Erreur", "Impossible d'ouvrir le navigateur sécurisé.");
      }
    };
    if (result.risk !== "safe" && !force) {
      Alert.alert(
        result.risk === "dangerous" ? "Lien dangereux" : "Lien suspect",
        "Ce lien présente un risque. Voulez-vous vraiment l'ouvrir ?",
        [
          { text: "Annuler", style: "cancel" },
          { text: "Ouvrir quand même", style: "destructive", onPress: proceed },
        ],
      );
      return;
    }
    proceed();
  }, [result]);

  const rm = result ? RISK_META[result.risk] : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Centre de sécurité</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Vérifiez liens, appels et messages
          </Text>
        </View>
        <View style={[styles.shieldBadge, { backgroundColor: colors.success + "22" }]}>
          <Feather name="shield" size={20} color={colors.success} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 16 }}>
        {/* Statut */}
        {status && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Votre protection</Text>
            <View style={styles.statsRow}>
              <Stat value={status.summary.total} label="Analyses" color={colors.info} colors={colors} />
              <Stat value={status.summary.dangerous} label="Bloquées" color={colors.destructive} colors={colors} />
              <Stat value={status.summary.suspicious} label="Suspects" color={colors.warning} colors={colors} />
              <Stat value={status.summary.last24h} label="24h" color={colors.mutedForeground} colors={colors} />
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
                    {layer.active ? "Actif" : "Inactif"}
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
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Scanner un lien</Text>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Vérifiez un lien suspect avant de l'ouvrir.
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://exemple.com/lien"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            onSubmitEditing={scan}
          />
          <Pressable
            onPress={scan}
            disabled={scanning || !url.trim()}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: scanning || !url.trim() ? 0.6 : 1 }]}
          >
            {scanning
              ? <ActivityIndicator color={colors.primaryForeground} />
              : <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Analyser</Text>}
          </Pressable>

          {result && rm && (
            <View style={[styles.resultBox, { borderColor: rm.color }]}>
              <View style={styles.cardHead}>
                <Feather name={rm.icon} size={18} color={rm.color} />
                <Text style={{ fontWeight: "700", color: rm.color }}>{rm.label}</Text>
                <Text style={{ color: colors.mutedForeground, flex: 1, textAlign: "right" }} numberOfLines={1}>
                  {result.domain}
                </Text>
              </View>
              {result.reasons.length > 0 ? (
                result.reasons.map((r, i) => (
                  <Text key={i} style={{ fontSize: 12, color: colors.mutedForeground }}>• {r}</Text>
                ))
              ) : (
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Aucun signal de risque détecté.</Text>
              )}
              <Pressable
                onPress={() => openSafely()}
                style={[styles.btnOutline, { borderColor: result.risk === "safe" ? colors.success : colors.destructive }]}
              >
                <Feather name="external-link" size={14} color={result.risk === "safe" ? colors.success : colors.destructive} />
                <Text style={{ color: result.risk === "safe" ? colors.success : colors.destructive, fontWeight: "600" }}>
                  {result.risk === "safe" ? "Ouvrir en navigation sécurisée" : "Ouvrir malgré le risque"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Activité récente */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Feather name="activity" size={18} color={colors.warning} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Activité récente</Text>
          </View>
          {(status?.recentScans ?? []).length === 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>Aucune analyse récente. Tout est calme.</Text>
          ) : (
            (status?.recentScans ?? []).map((s) => {
              const rmeta = RISK_META[s.verdict];
              return (
                <View key={s.id} style={[styles.scanRow, { borderColor: colors.border }]}>
                  <Feather name={KIND_ICON[s.kind] ?? "shield"} size={14} color={colors.mutedForeground} />
                  <Feather name={rmeta.icon} size={14} color={rmeta.color} />
                  <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }} numberOfLines={1}>{s.target}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                    {new Date(s.at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {/* Partenaires */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.info + "55" }]}>
          <View style={styles.cardHead}>
            <Feather name="zap" size={18} color={colors.info} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Protection étendue</Text>
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            NextDNS bloque phishing et publicités sur tout l'appareil.
          </Text>
          <TextInput
            value={nextdnsId}
            onChangeText={setNextdnsId}
            placeholder="ID de profil NextDNS"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <Pressable
            onPress={() => {
              const link = nextdnsId.trim()
                ? `https://my.nextdns.io/${encodeURIComponent(nextdnsId.trim())}/setup`
                : "https://my.nextdns.io/signup";
              Linking.openURL(link).catch(() => Alert.alert("Erreur", "Lien indisponible."));
            }}
            style={[styles.btnOutline, { borderColor: colors.info }]}
          >
            <Feather name="external-link" size={14} color={colors.info} />
            <Text style={{ color: colors.info, fontWeight: "600" }}>
              {nextdnsId.trim() ? "Guide d'installation" : "Créer un compte NextDNS"}
            </Text>
          </Pressable>
          <View style={[styles.scanRow, { borderColor: colors.border, marginTop: 4 }]}>
            <Feather name="shield" size={14} color={colors.mutedForeground} />
            <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }}>Bitdefender (antivirus pro)</Text>
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Bientôt</Text>
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
