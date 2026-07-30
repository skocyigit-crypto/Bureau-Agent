import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTranslation } from "@/lib/i18n";

interface SubscriptionData {
  organisation: {
    name: string;
    email: string;
    plan: string;
    maxUsers: number;
    currentUsers: number;
    storageUsed?: number;
    storageLimit?: number;
    trialEndsAt?: string;
    createdAt?: string;
  };
  subscription?: {
    plan: string;
    status: string;
    startDate?: string;
    endDate?: string;
    billingCycle?: string;
    amount?: number;
  };
  usage?: {
    contacts: number;
    calls: number;
    tasks: number;
    messages: number;
    documents: number;
    aiTokensUsed?: number;
    aiTokensLimit?: number;
  };
  features?: string[];
  invoices?: Array<{
    id: number;
    reference: string;
    amount: number;
    status: string;
    date: string;
  }>;
}

const PLAN_COLORS: Record<string, { color: string; bg: string; labelKey: string; icon: keyof typeof Feather.glyphMap }> = {
  starter:      { color: "#64748b", bg: "#f1f5f9", labelKey: "abonnementScreen.plan.starter",     icon: "box" },
  pro:          { color: "#3b82f6", bg: "#eff6ff", labelKey: "abonnementScreen.plan.pro",         icon: "trending-up" },
  business:     { color: "#8b5cf6", bg: "#f5f3ff", labelKey: "abonnementScreen.plan.business",    icon: "briefcase" },
  enterprise:   { color: "#f59e0b", bg: "#fffbeb", labelKey: "abonnementScreen.plan.enterprise",  icon: "star" },
  super_admin:  { color: "#ef4444", bg: "#fef2f2", labelKey: "abonnementScreen.plan.super_admin", icon: "shield" },
  gratuit:      { color: "#22c55e", bg: "#f0fdf4", labelKey: "abonnementScreen.plan.gratuit",     icon: "gift" },
  trial:        { color: "#0891b2", bg: "#f0f9ff", labelKey: "abonnementScreen.plan.trial",       icon: "clock" },
};

const STATUS_COLORS: Record<string, string> = {
  actif: "#22c55e", active: "#22c55e",
  expirée: "#ef4444", expired: "#ef4444",
  suspendu: "#f59e0b", suspended: "#f59e0b",
  essai: "#0891b2", trial: "#0891b2",
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  actif: "abonnementScreen.status.actif", active: "abonnementScreen.status.actif",
  expirée: "abonnementScreen.status.expiree", expired: "abonnementScreen.status.expiree",
  suspendu: "abonnementScreen.status.suspendu", suspended: "abonnementScreen.status.suspendu",
  essai: "abonnementScreen.status.essai", trial: "abonnementScreen.status.essai",
};

function fmtDate(d: string | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function fmtEur(v: number | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
}

function UsageBar({ label, used, total, color }: { label: string; used: number; total?: number; color: string }) {
  const colors = useColors();
  const pct = total && total > 0 ? Math.min(100, (used / total) * 100) : null;
  return (
    <View style={usageStyles.row}>
      <View style={usageStyles.rowTop}>
        <Text style={[usageStyles.label, { color: colors.foreground }]}>{label}</Text>
        <Text style={[usageStyles.value, { color: colors.mutedForeground }]}>
          {used.toLocaleString("fr-FR")}{total ? ` / ${total.toLocaleString("fr-FR")}` : ""}
        </Text>
      </View>
      {pct !== null && (
        <View style={[usageStyles.track, { backgroundColor: color + "18" }]}>
          <View style={[usageStyles.fill, { width: `${pct}%` as any, backgroundColor: pct > 85 ? "#ef4444" : color }]} />
        </View>
      )}
    </View>
  );
}

const usageStyles = StyleSheet.create({
  row: { gap: 4, marginBottom: 10 },
  rowTop: { flexDirection: "row", justifyContent: "space-between" },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  value: { fontSize: 12, fontFamily: "Inter_400Regular" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
});

export default function AbonnementScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [data, setData] = useState<SubscriptionData | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const load = useCallback(async () => {
    try {
      const [subRes, invoiceRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/my-subscription`),
        fetchAuth(`${API_BASE}/api/my-subscription/invoices`).catch(() => null),
      ]);
      if (subRes.ok) {
        const d = await subRes.json();
        setData(d);
      }
      if (invoiceRes?.ok) {
        const d = await invoiceRes.json();
        setInvoices(d.invoices ?? d ?? []);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function handleUpgradeRequest() {
    if (!upgradeMsg.trim()) return;
    setUpgradeLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/my-subscription/upgrade-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: upgradeMsg }),
      });
      if (res.ok) {
        setShowUpgrade(false);
        setUpgradeMsg("");
        Alert.alert(t("abonnementScreen.upgradeSentTitle"), t("abonnementScreen.upgradeSent"));
      }
    } finally { setUpgradeLoading(false); }
  }

  const plan = data?.organisation?.plan ?? "starter";
  const planCfg = PLAN_COLORS[plan] ?? PLAN_COLORS.starter;
  const subStatus = data?.subscription?.status ?? "actif";
  const statusColor = STATUS_COLORS[subStatus] ?? "#64748b";
  const statusLabel = STATUS_LABEL_KEYS[subStatus] ? t(STATUS_LABEL_KEYS[subStatus]) : subStatus;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: planCfg.color, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>{t("abonnementScreen.headerTitle")}</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={16} color="#fff" />
          </Pressable>
        </View>
        {data && (
          <View style={styles.planBanner}>
            <View style={[styles.planIconBox, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Feather name={planCfg.icon} size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>{data.organisation.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[styles.planBadge, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                  <Text style={styles.planBadgeText}>{t(planCfg.labelKey)}</Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                  <View style={[styles.statusDotInner, { backgroundColor: "#fff" }]} />
                  <Text style={styles.statusDotText}>{statusLabel}</Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={planCfg.color} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={planCfg.color} />}
        >
          {/* Subscription details */}
          {data?.subscription && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("abonnementScreen.planInfoTitle")}</Text>
              {[
                { key: "plan", label: t("abonnementScreen.rowPlan"), value: t(planCfg.labelKey) },
                { key: "statut", label: t("abonnementScreen.rowStatut"), value: statusLabel, color: statusColor },
                { key: "billing", label: t("abonnementScreen.rowBillingCycle"), value: data.subscription.billingCycle === "mensuel" ? t("abonnementScreen.billingMensuel") : data.subscription.billingCycle === "annuel" ? t("abonnementScreen.billingAnnuel") : data.subscription.billingCycle ?? "—" },
                { key: "montant", label: t("abonnementScreen.rowMontant"), value: data.subscription.amount ? fmtEur(data.subscription.amount) : "—" },
                { key: "start", label: t("abonnementScreen.rowStart"), value: fmtDate(data.subscription.startDate) },
                { key: "renewal", label: t("abonnementScreen.rowRenewal"), value: fmtDate(data.subscription.endDate) },
              ].map(r => (
                <View key={r.key} style={[styles.detailRow, { borderColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{r.label}</Text>
                  <Text style={[styles.detailValue, { color: r.color ?? colors.foreground }]}>{r.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Users */}
          {data?.organisation && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("abonnementScreen.licencesTitle")}</Text>
              <View style={styles.licenceRow}>
                <View style={styles.licenceItem}>
                  <Text style={[styles.licenceNum, { color: planCfg.color }]}>{data.organisation.currentUsers}</Text>
                  <Text style={[styles.licenceLbl, { color: colors.mutedForeground }]}>{t("abonnementScreen.licenceUsed")}</Text>
                </View>
                <View style={[styles.licenceDivider, { backgroundColor: colors.border }]} />
                <View style={styles.licenceItem}>
                  <Text style={[styles.licenceNum, { color: colors.foreground }]}>{data.organisation.maxUsers}</Text>
                  <Text style={[styles.licenceLbl, { color: colors.mutedForeground }]}>{t("abonnementScreen.licenceMax")}</Text>
                </View>
                <View style={[styles.licenceDivider, { backgroundColor: colors.border }]} />
                <View style={styles.licenceItem}>
                  <Text style={[styles.licenceNum, { color: "#22c55e" }]}>{Math.max(0, data.organisation.maxUsers - data.organisation.currentUsers)}</Text>
                  <Text style={[styles.licenceLbl, { color: colors.mutedForeground }]}>{t("abonnementScreen.licenceAvailable")}</Text>
                </View>
              </View>
              <View style={[styles.licenceBar, { backgroundColor: colors.muted }]}>
                <View style={[styles.licenceBarFill, {
                  width: `${Math.min(100, (data.organisation.currentUsers / data.organisation.maxUsers) * 100)}%` as any,
                  backgroundColor: data.organisation.currentUsers >= data.organisation.maxUsers ? "#ef4444" : planCfg.color,
                }]} />
              </View>
            </View>
          )}

          {/* Usage */}
          {data?.usage && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("abonnementScreen.usageTitle")}</Text>
              <UsageBar label={t("abonnementScreen.usageContacts")} used={data.usage.contacts} color={planCfg.color} />
              <UsageBar label={t("abonnementScreen.usageCalls")} used={data.usage.calls} color={planCfg.color} />
              <UsageBar label={t("abonnementScreen.usageTasks")} used={data.usage.tasks} color={planCfg.color} />
              <UsageBar label={t("abonnementScreen.usageMessages")} used={data.usage.messages} color={planCfg.color} />
              <UsageBar label={t("abonnementScreen.usageDocuments")} used={data.usage.documents} color={planCfg.color} />
              {data.usage.aiTokensLimit && (
                <UsageBar label={t("abonnementScreen.usageAiTokens")} used={data.usage.aiTokensUsed ?? 0} total={data.usage.aiTokensLimit} color="#8b5cf6" />
              )}
            </View>
          )}

          {/* Features */}
          {data?.features && data.features.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("abonnementScreen.featuresTitle")}</Text>
              {data.features.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Feather name="check" size={14} color={planCfg.color} />
                  <Text style={[styles.featureText, { color: colors.foreground }]}>{f}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Invoices */}
          {invoices.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t("abonnementScreen.invoicesTitle")}</Text>
              {invoices.slice(0, 5).map((inv, i) => (
                <View key={i} style={[styles.invoiceRow, { borderColor: colors.border }]}>
                  <View>
                    <Text style={[styles.invoiceRef, { color: colors.foreground }]}>{inv.reference || t("abonnementScreen.invoiceFallback", { id: inv.id })}</Text>
                    <Text style={[styles.invoiceDate, { color: colors.mutedForeground }]}>{fmtDate(inv.date)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.invoiceAmount, { color: colors.foreground }]}>{fmtEur(inv.amount)}</Text>
                    <View style={[styles.invoiceStatus, { backgroundColor: inv.status === "payee" ? "#22c55e18" : "#f59e0b18" }]}>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: inv.status === "payee" ? "#22c55e" : "#f59e0b" }}>
                        {inv.status === "payee" ? t("abonnementScreen.invoicePaid") : t("abonnementScreen.invoicePending")}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Upgrade */}
          {!showUpgrade ? (
            <Pressable
              onPress={() => setShowUpgrade(true)}
              style={[styles.upgradeBtn, { backgroundColor: planCfg.color }]}
            >
              <Feather name="arrow-up-circle" size={18} color="#fff" />
              <Text style={styles.upgradeBtnText}>{t("abonnementScreen.upgradeBtn")}</Text>
            </Pressable>
          ) : (
            <View style={[styles.upgradeForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.upgradeFormTitle, { color: colors.foreground }]}>{t("abonnementScreen.upgradeFormTitle")}</Text>
              <Text style={[styles.upgradeFormSub, { color: colors.mutedForeground }]}>
                {t("abonnementScreen.upgradeFormSub")}
              </Text>
              <TextInput
                style={[styles.upgradeTextarea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                value={upgradeMsg}
                onChangeText={setUpgradeMsg}
                placeholder={t("abonnementScreen.upgradePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => setShowUpgrade(false)} style={[styles.cancelBtn, { borderColor: colors.border }]}>
                  <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  onPress={handleUpgradeRequest}
                  disabled={upgradeLoading || !upgradeMsg.trim()}
                  style={[styles.sendBtn, { backgroundColor: planCfg.color, opacity: upgradeLoading || !upgradeMsg.trim() ? 0.6 : 1 }]}
                >
                  {upgradeLoading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={14} color="#fff" />}
                  <Text style={styles.sendBtnText}>{t("abonnementScreen.send")}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  planBanner: { flexDirection: "row", alignItems: "center", gap: 12 },
  planIconBox: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  planName: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff", marginBottom: 4 },
  planBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  planBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  statusDot: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusDotInner: { width: 6, height: 6, borderRadius: 3 },
  statusDotText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#fff" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 4 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 10 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1 },
  detailLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  detailValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  licenceRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  licenceItem: { flex: 1, alignItems: "center" },
  licenceNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  licenceLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  licenceDivider: { width: 1, height: 36 },
  licenceBar: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 6 },
  licenceBarFill: { height: 6, borderRadius: 3 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  invoiceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1 },
  invoiceRef: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  invoiceDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  invoiceAmount: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  invoiceStatus: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  upgradeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, marginTop: 4 },
  upgradeBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  upgradeForm: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10, marginTop: 4 },
  upgradeFormTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  upgradeFormSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  upgradeTextarea: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 100, lineHeight: 20 },
  cancelBtn: { flex: 1, borderWidth: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  sendBtn: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 10 },
  sendBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
