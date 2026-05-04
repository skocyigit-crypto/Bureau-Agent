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

interface LicenseDashboard {
  organisation: {
    id: number;
    name: string;
    email: string;
    plan: string;
    licenceCount: number;
    billingCycle?: string;
    trialEndsAt?: string;
    subscriptionStatus?: string;
  };
  subscription: {
    id?: number;
    plan: string;
    status: string;
    amount?: number;
    billingCycle?: string;
    startDate?: string;
    renewalDate?: string;
    licenceCount: number;
  } | null;
  invoices: Array<{
    id: number;
    reference: string;
    amount: number;
    totalAmount: number;
    status: string;
    dueDate?: string;
    createdAt: string;
  }>;
  payments: Array<{
    id: number;
    amount: number;
    paymentDate: string;
    method?: string;
    status: string;
    reference?: string;
  }>;
  totalOwed: number;
  totalPaid: number;
  pendingInvoicesCount: number;
}

const PLAN_COLORS: Record<string, { color: string; bg: string }> = {
  starter:     { color: "#64748b", bg: "#f1f5f9" },
  professional:{ color: "#3b82f6", bg: "#eff6ff" },
  business:    { color: "#8b5cf6", bg: "#f5f3ff" },
  enterprise:  { color: "#f59e0b", bg: "#fffbeb" },
  trial:       { color: "#22c55e", bg: "#f0fdf4" },
};

const STATUS_COLORS: Record<string, string> = {
  active:    "#22c55e",
  inactive:  "#ef4444",
  trial:     "#3b82f6",
  suspended: "#f59e0b",
  cancelled: "#94a3b8",
};

const INVOICE_STATUS: Record<string, { label: string; color: string }> = {
  en_attente: { label: "En attente", color: "#f59e0b" },
  payee:      { label: "Payée",      color: "#22c55e" },
  annulee:    { label: "Annulée",    color: "#94a3b8" },
  en_retard:  { label: "En retard",  color: "#ef4444" },
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

  const [data, setData] = useState<LicenseDashboard | null>(null);
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

  async function sendPaymentReminder(invoiceId: number) {
    setActionLoading("reminder-" + invoiceId);
    try {
      const res = await fetchAuth(`${API_BASE}/api/license-management/send-payment-reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      if (res.ok) Alert.alert("Rappel envoyé", "Un email de rappel a été envoyé.");
    } finally { setActionLoading(null); }
  }

  async function generateInvoice() {
    setActionLoading("generate");
    try {
      const res = await fetchAuth(`${API_BASE}/api/license-management/auto-generate-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) { Alert.alert("Facture générée", "La facture a été créée."); load(); }
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
      if (res.ok) { const d = await res.json(); Alert.alert("Rappels envoyés", d.message ?? "Rappels automatiques envoyés."); }
    } finally { setActionLoading(null); }
  }

  const plan = data?.organisation?.plan ?? "starter";
  const planCfg = PLAN_COLORS[plan] ?? PLAN_COLORS.starter;
  const subStatus = data?.subscription?.status ?? data?.organisation?.subscriptionStatus ?? "inactive";

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
              { label: "Dû",        value: fmtEur(data.totalOwed),          color: data.totalOwed > 0 ? "#fca5a5" : "#86efac" },
              { label: "Encaissé",  value: fmtEur(data.totalPaid),          color: "#86efac" },
              { label: "Factures",  value: String(data.pendingInvoicesCount), color: data.pendingInvoicesCount > 0 ? "#fde68a" : "#fff" },
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#166534" />}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 40 : 24 }]}
        >
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
                {data.organisation.trialEndsAt && (
                  <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: planCfg.color }}>
                    Trial jusqu'au {fmtDate(data.organisation.trialEndsAt)}
                  </Text>
                )}
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={{ gap: 8 }}>
              {[
                { label: "Organisation",    value: data.organisation.name },
                { label: "Email",           value: data.organisation.email },
                { label: "Licences",        value: String(data.organisation.licenceCount) },
                ...(data.subscription ? [
                  { label: "Montant",       value: data.subscription.amount != null ? fmtEur(data.subscription.amount) : "—" },
                  { label: "Facturation",   value: data.subscription.billingCycle === "annuel" ? "Annuelle" : "Mensuelle" },
                  { label: "Début",         value: fmtDate(data.subscription.startDate) },
                  { label: "Renouvellement", value: fmtDate(data.subscription.renewalDate) },
                ] : []),
              ].map(row => (
                <View key={row.label} style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                  <Text style={[styles.infoValue, { color: colors.foreground }]}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Actions */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Actions rapides" icon="zap" color="#166534" />
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={generateInvoice}
                style={[styles.actionBtn, { backgroundColor: "#166534" }]}
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

          {/* Invoices */}
          {data.invoices.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SectionTitle title="Factures récentes" icon="credit-card" color="#0369a1" />
              <View style={{ gap: 8 }}>
                {data.invoices.slice(0, 8).map(inv => {
                  const st = INVOICE_STATUS[inv.status] ?? { label: inv.status, color: "#64748b" };
                  const isPending = inv.status === "en_attente" || inv.status === "en_retard";
                  return (
                    <View key={inv.id} style={[styles.invoiceRow, { borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.invoiceRef, { color: colors.mutedForeground }]}>{inv.reference}</Text>
                        <Text style={[styles.invoiceAmount, { color: colors.foreground }]}>{fmtEur(inv.totalAmount)}</Text>
                        {inv.dueDate && (
                          <Text style={[styles.invoiceDue, { color: colors.mutedForeground }]}>Échéance : {fmtDate(inv.dueDate)}</Text>
                        )}
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <View style={[styles.miniPill, { backgroundColor: st.color + "20" }]}>
                          <Text style={[styles.miniPillText, { color: st.color }]}>{st.label}</Text>
                        </View>
                        {isPending && (
                          <Pressable
                            onPress={() => sendPaymentReminder(inv.id)}
                            style={[styles.reminderBtn, { borderColor: "#f59e0b" }]}
                            disabled={actionLoading === "reminder-" + inv.id}
                          >
                            {actionLoading === "reminder-" + inv.id ? (
                              <ActivityIndicator size="small" color="#f59e0b" />
                            ) : (
                              <>
                                <Feather name="bell" size={11} color="#f59e0b" />
                                <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#f59e0b" }}>Relancer</Text>
                              </>
                            )}
                          </Pressable>
                        )}
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
                      <Text style={[styles.invoiceRef, { color: colors.mutedForeground }]}>{p.reference ?? "—"}</Text>
                      <Text style={[styles.invoiceAmount, { color: "#22c55e" }]}>{fmtEur(p.amount)}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.invoiceDue, { color: colors.mutedForeground }]}>{fmtDate(p.paymentDate)}</Text>
                      {p.method && <Text style={[styles.invoiceDue, { color: colors.mutedForeground }]}>{p.method}</Text>}
                    </View>
                  </View>
                ))}
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
  header: { backgroundColor: "#166534", paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
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
  reminderBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
});
