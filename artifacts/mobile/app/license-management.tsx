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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface ApiResponse {
  organisation: {
    id: number;
    name: string;
    bankIban?: string | null;
    bankBic?: string | null;
    siret?: string | null;
    tvaNumber?: string | null;
    autoInvoiceEnabled?: boolean;
    autoEmailInvoice?: boolean;
  };
  subscription: {
    plan: string;
    status: string;
    price: number;
    licenseKey?: string | null;
    trialEndsAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    trialDaysLeft?: number | null;
    aiEnabled?: boolean;
    stockEnabled?: boolean;
    automationEnabled?: boolean;
    maxUsers?: number;
    maxContacts?: number;
    maxCallsPerMonth?: number;
  } | null;
  billing: {
    totalOwed: number;
    totalPaid: number;
    pendingCount: number;
    paidCount: number;
    invoices: Array<{
      id: number;
      periodLabel?: string;
      plan?: string;
      baseAmount: number;
      overageAmount: number;
      totalAmount: number;
      status: string;
      createdAt?: string;
    }>;
  };
  clientBilling: {
    totalClientOwed: number;
    totalClientPaid: number;
    overdueCount: number;
    pendingCount: number;
    recentInvoices: Array<{
      id: number;
      reference: string;
      clientName?: string;
      clientEmail?: string;
      totalAmount: number;
      paidAmount: number;
      status: string;
      dueDate?: string | null;
      createdAt?: string;
    }>;
  };
  payments: Array<{
    id: number;
    amount: number;
    bankDate?: string | null;
    payerName?: string | null;
    bankRef?: string | null;
    status: string;
    matchConfidence?: number | null;
  }>;
  reminders: Array<{
    id: number;
    reminderLevel?: number;
    recipientEmail?: string;
    status?: string;
    sentAt?: string | null;
  }>;
  securityAlerts: Array<{ type: string; severity: string; message: string }>;
}

const PLAN_COLORS: Record<string, { color: string; bg: string }> = {
  starter:      { color: "#64748b", bg: "#f1f5f9" },
  professional: { color: "#3b82f6", bg: "#eff6ff" },
  business:     { color: "#8b5cf6", bg: "#f5f3ff" },
  enterprise:   { color: "#f59e0b", bg: "#fffbeb" },
  essai:        { color: "#22c55e", bg: "#f0fdf4" },
};

const STATUS_COLORS: Record<string, string> = {
  active:    "#22c55e",
  inactive:  "#ef4444",
  essai:     "#3b82f6",
  suspended: "#f59e0b",
  cancelled: "#94a3b8",
};

const INVOICE_STATUS: Record<string, { label: string; color: string }> = {
  en_attente: { label: "En attente", color: "#f59e0b" },
  payee:      { label: "Payée",      color: "#22c55e" },
  annulee:    { label: "Annulée",    color: "#94a3b8" },
};

const ALERT_COLORS: Record<string, string> = {
  critique: "#ef4444",
  alerte:   "#f59e0b",
  info:     "#3b82f6",
};

function fmtEur(v: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function SectionTitle({ title, icon, color }: { title: string; icon: keyof typeof Feather.glyphMap; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <Feather name={icon} size={15} color={color} />
      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color }}>{title}</Text>
    </View>
  );
}

export default function LicenseManagementScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/license-management/dashboard`);
      if (res.ok) setData(await res.json());
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  async function generateInvoice() {
    setActionLoading("generate");
    try {
      const res = await fetchAuth(`${API_BASE}/api/license-management/auto-generate-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (res.ok) { Alert.alert("Facture générée", "La facture a été créée."); load(); }
      else Alert.alert("Erreur", d.error ?? "Échec de génération");
    } finally { setActionLoading(null); }
  }

  async function sendAutoReminders() {
    setActionLoading("auto");
    try {
      const res = await fetchAuth(`${API_BASE}/api/license-management/auto-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const d = await res.json();
        Alert.alert("Rappels envoyés", d.message ?? `${d.sent ?? 0} rappel(s) envoyé(s)`);
      }
    } finally { setActionLoading(null); }
  }

  const plan = data?.subscription?.plan ?? "starter";
  const planCfg = PLAN_COLORS[plan] ?? PLAN_COLORS.starter;
  const subStatus = data?.subscription?.status ?? "inactive";
  const totalOwed = data?.billing?.totalOwed ?? 0;
  const totalPaid = data?.billing?.totalPaid ?? 0;
  const pendingCount = data?.billing?.pendingCount ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Licences & Facturation</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={16} color="#fff" />
          </Pressable>
        </View>

        {data && (
          <View style={styles.kpiRow}>
            {[
              { label: "Dû",        value: fmtEur(totalOwed),        color: totalOwed > 0 ? "#fca5a5" : "#86efac" },
              { label: "Encaissé",  value: fmtEur(totalPaid),        color: "#86efac" },
              { label: "En attente", value: String(pendingCount),     color: pendingCount > 0 ? "#fde68a" : "#fff" },
            ].map(k => (
              <View key={k.label} style={[styles.kpiChip, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
                <Text style={[styles.kpiVal, { color: k.color }]}>{k.value}</Text>
                <Text style={styles.kpiLbl}>{k.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#166534" /></View>
      ) : !data ? (
        <View style={styles.loadingBox}>
          <Feather name="lock" size={48} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Accès réservé aux administrateurs</Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#166834" />}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 40 : 24 }]}
        >
          {/* Security Alerts */}
          {data.securityAlerts.length > 0 && (
            <View style={{ gap: 6 }}>
              {data.securityAlerts.map((alert, i) => (
                <View key={i} style={[styles.alertRow, { borderColor: ALERT_COLORS[alert.severity] + "60", backgroundColor: ALERT_COLORS[alert.severity] + "15" }]}>
                  <Feather name={alert.severity === "critique" ? "alert-triangle" : alert.severity === "alerte" ? "alert-circle" : "info"} size={14} color={ALERT_COLORS[alert.severity]} />
                  <Text style={[styles.alertText, { color: ALERT_COLORS[alert.severity] }]}>{alert.message}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Plan card */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.planBanner, { backgroundColor: planCfg.bg }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planLabel, { color: planCfg.color }]}>PLAN ACTIF</Text>
                <Text style={[styles.planName, { color: planCfg.color }]}>{plan.charAt(0).toUpperCase() + plan.slice(1)}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[subStatus] ?? "#94a3b8" }]}>
                  <Text style={styles.statusDotText}>{subStatus}</Text>
                </View>
                {data.subscription?.trialDaysLeft != null && (
                  <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: planCfg.color }}>
                    {data.subscription.trialDaysLeft > 0 ? `Essai: ${data.subscription.trialDaysLeft}j restants` : "Essai expiré"}
                  </Text>
                )}
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={{ gap: 8 }}>
              {[
                { label: "Organisation", value: data.organisation.name },
                { label: "SIRET",        value: data.organisation.siret ?? "—" },
                { label: "Prix",         value: data.subscription ? fmtEur(data.subscription.price) + "/mois" : "—" },
                { label: "Clé licence",  value: data.subscription?.licenseKey ? `****${data.subscription.licenseKey.slice(-4)}` : "—" },
                { label: "Période début", value: fmtDate(data.subscription?.currentPeriodStart) },
                { label: "Période fin",   value: fmtDate(data.subscription?.currentPeriodEnd) },
                ...(data.subscription ? [
                  { label: "IA",           value: data.subscription.aiEnabled ? "Activée" : "Désactivée" },
                  { label: "Stock",        value: data.subscription.stockEnabled ? "Activé" : "Désactivé" },
                ] : []),
              ].map(row => (
                <View key={row.label} style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                  <Text style={[styles.infoValue, { color: colors.foreground }]}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Limites */}
          {data.subscription && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SectionTitle title="Limites du plan" icon="sliders" color="#6366f1" />
              <View style={{ gap: 8 }}>
                {[
                  { label: "Utilisateurs max", value: data.subscription.maxUsers ?? "—" },
                  { label: "Contacts max",     value: data.subscription.maxContacts ?? "—" },
                  { label: "Appels/mois max",  value: data.subscription.maxCallsPerMonth ?? "—" },
                ].map(row => (
                  <View key={row.label} style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>{String(row.value)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Actions */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Actions rapides" icon="zap" color="#166834" />
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={generateInvoice}
                style={[styles.actionBtn, { backgroundColor: "#166834" }]}
                disabled={actionLoading === "generate"}
              >
                {actionLoading === "generate" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Feather name="file-plus" size={15} color="#fff" />
                    <Text style={styles.actionBtnText}>Générer une facture</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={sendAutoReminders}
                style={[styles.actionBtn, { backgroundColor: "#f59e0b" }]}
                disabled={actionLoading === "auto"}
              >
                {actionLoading === "auto" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Feather name="bell" size={15} color="#fff" />
                    <Text style={styles.actionBtnText}>Envoyer rappels automatiques</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>

          {/* Abonnement invoices */}
          {data.billing.invoices.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SectionTitle title="Factures abonnement" icon="file-text" color="#0369a1" />
              <View style={{ gap: 8 }}>
                {data.billing.invoices.slice(0, 6).map(inv => {
                  const st = INVOICE_STATUS[inv.status] ?? { label: inv.status, color: "#64748b" };
                  return (
                    <View key={inv.id} style={[styles.invoiceRow, { borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.invoiceRef, { color: colors.mutedForeground }]}>{inv.periodLabel ?? "—"} · {inv.plan}</Text>
                        <Text style={[styles.invoiceAmount, { color: colors.foreground }]}>{fmtEur(inv.totalAmount)}</Text>
                      </View>
                      <View style={[styles.miniPill, { backgroundColor: st.color + "20" }]}>
                        <Text style={[styles.miniPillText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Client invoices */}
          {data.clientBilling.recentInvoices.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SectionTitle title="Factures clients" icon="credit-card" color="#7c3aed" />
              <View style={{ gap: 4, marginBottom: 10, flexDirection: "row" }}>
                <View style={[styles.kpiSmall, { backgroundColor: "#fef2f2" }]}>
                  <Text style={[styles.kpiSmallVal, { color: "#ef4444" }]}>{data.clientBilling.overdueCount}</Text>
                  <Text style={styles.kpiSmallLbl}>En retard</Text>
                </View>
                <View style={[styles.kpiSmall, { backgroundColor: "#fffbeb" }]}>
                  <Text style={[styles.kpiSmallVal, { color: "#f59e0b" }]}>{data.clientBilling.pendingCount}</Text>
                  <Text style={styles.kpiSmallLbl}>En attente</Text>
                </View>
                <View style={[styles.kpiSmall, { backgroundColor: "#f0fdf4" }]}>
                  <Text style={[styles.kpiSmallVal, { color: "#22c55e" }]}>{fmtEur(data.clientBilling.totalClientPaid)}</Text>
                  <Text style={styles.kpiSmallLbl}>Encaissé</Text>
                </View>
              </View>
              <View style={{ gap: 8 }}>
                {data.clientBilling.recentInvoices.slice(0, 6).map(inv => {
                  const isOverdue = inv.status !== "payee" && inv.dueDate && new Date(inv.dueDate) < new Date();
                  const st = isOverdue
                    ? { label: "En retard", color: "#ef4444" }
                    : INVOICE_STATUS[inv.status] ?? { label: inv.status, color: "#64748b" };
                  return (
                    <View key={inv.id} style={[styles.invoiceRow, { borderColor: isOverdue ? "#fecaca" : colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.invoiceRef, { color: colors.mutedForeground }]}>{inv.reference} · {inv.clientName}</Text>
                        <Text style={[styles.invoiceAmount, { color: colors.foreground }]}>{fmtEur(inv.totalAmount)}</Text>
                        {inv.dueDate && (
                          <Text style={[styles.invoiceDue, { color: colors.mutedForeground }]}>Échéance : {fmtDate(inv.dueDate)}</Text>
                        )}
                      </View>
                      <View style={[styles.miniPill, { backgroundColor: st.color + "20" }]}>
                        <Text style={[styles.miniPillText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Payments */}
          {data.payments.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SectionTitle title="Paiements reçus" icon="check-circle" color="#22c55e" />
              <View style={{ gap: 8 }}>
                {data.payments.slice(0, 6).map(p => (
                  <View key={p.id} style={[styles.paymentRow, { borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.invoiceRef, { color: colors.mutedForeground }]}>{p.payerName ?? p.bankRef ?? "—"}</Text>
                      <Text style={[styles.invoiceAmount, { color: "#22c55e" }]}>{fmtEur(p.amount)}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.invoiceDue, { color: colors.mutedForeground }]}>{fmtDate(p.bankDate)}</Text>
                      <View style={[styles.miniPill, { backgroundColor: p.status === "matched" ? "#dcfce7" : "#f1f5f9" }]}>
                        <Text style={[styles.miniPillText, { color: p.status === "matched" ? "#166534" : "#64748b" }]}>{p.status}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Organisation details */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Coordonnées bancaires" icon="briefcase" color="#64748b" />
            <View style={{ gap: 8 }}>
              {[
                { label: "IBAN",  value: data.organisation.bankIban ?? "Non configuré" },
                { label: "BIC",   value: data.organisation.bankBic ?? "—" },
                { label: "TVA",   value: data.organisation.tvaNumber ?? "—" },
                { label: "Fact. auto", value: data.organisation.autoInvoiceEnabled ? "Activée" : "Désactivée" },
                { label: "Email fact.", value: data.organisation.autoEmailInvoice ? "Activé" : "Désactivé" },
              ].map(row => (
                <View key={row.label} style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                  <Text style={[styles.infoValue, { color: colors.foreground }]}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#166834", paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  kpiRow: { flexDirection: "row", gap: 8 },
  kpiChip: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  kpiVal: { fontSize: 13, fontFamily: "Inter_700Bold" },
  kpiLbl: { fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  scrollContent: { padding: 12, gap: 12 },
  alertRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  alertText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  planBanner: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  planLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  planName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statusDot: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusDotText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff" },
  divider: { height: 1, marginVertical: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  actionBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  invoiceRow: { flexDirection: "row", alignItems: "flex-start", paddingBottom: 8, borderBottomWidth: 1, gap: 8 },
  paymentRow: { flexDirection: "row", alignItems: "flex-start", paddingBottom: 8, borderBottomWidth: 1, gap: 8 },
  invoiceRef: { fontSize: 10, fontFamily: "Inter_400Regular" },
  invoiceAmount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  invoiceDue: { fontSize: 11, fontFamily: "Inter_400Regular" },
  miniPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  miniPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  kpiSmall: { flex: 1, borderRadius: 8, padding: 8, alignItems: "center" },
  kpiSmallVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  kpiSmallLbl: { fontSize: 9, fontFamily: "Inter_400Regular", color: "#64748b" },
  reminderBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
});
