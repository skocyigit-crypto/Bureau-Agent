import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface RapportData {
  devis: { total: number; brouillon: number; envoye: number; accepte: number; refuse: number; expire: number; totalAmount: number; acceptedAmount: number; conversionRate: number };
  factures: { total: number; brouillon: number; emise: number; payee: number; annulee: number; totalAmount: number; paidAmount: number; remainingAmount: number; overdueCount: number };
  prospects: { total: number; prospect: number; qualification: number; proposition: number; negociation: number; gagne: number; perdu: number; totalValue: number; wonValue: number };
  stock: { total: number; alerte: number; rupture: number; totalValue: number };
  projets: { total: number; active: number; termine: number; overdue: number; avgProgress: number; totalBudget: number; totalSpent: number };
  monthlyRevenue: { month: string; revenue: number; invoiced: number; count: number }[];
  devisByMonth: { month: string; total: number; accepte: number; refuse: number }[];
  prospectsByStage: { stage: string; count: number; value: number }[];
  topProducts: { name: string; category: string; quantity: number; unitPrice: number; totalValue: number }[];
}

const MONTH_SHORT: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

const STAGE_COLORS: Record<string, string> = {
  prospect: "#6366f1", qualification: "#f59e0b", proposition: "#3b82f6",
  negociation: "#10b981", gagne: "#22c55e", perdu: "#ef4444",
};

const STAGE_LABELS: Record<string, string> = {
  prospect: "Prospect", qualification: "Qualification", proposition: "Proposition",
  negociation: "Négociation", gagne: "Gagné", perdu: "Perdu",
};

function fmtEur(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M€`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} k€`;
  return `${Math.round(n)} €`;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_SHORT[m] || m} ${y.slice(2)}`;
}

interface SectionTitleProps { title: string; icon: keyof typeof Feather.glyphMap; color: string; colors: any }
function SectionTitle({ title, icon, color, colors }: SectionTitleProps) {
  return (
    <View style={styles.sectionTitle}>
      <View style={[styles.sectionIcon, { backgroundColor: color + "20" }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <Text style={[styles.sectionTitleText, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

interface StatCardProps { label: string; value: string; sub?: string; color?: string; colors: any }
function StatCard({ label, value, sub, color = "#6366f1", colors }: StatCardProps) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: color + "25", borderLeftColor: color }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.foreground }]}>{label}</Text>
      {sub && <Text style={[styles.statSub, { color: colors.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}

interface MiniBarProps { value: number; max: number; color: string; label: string; count: number; colors: any }
function MiniBar({ value, max, color, label, count, colors }: MiniBarProps) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={styles.miniBarRow}>
      <Text style={[styles.miniBarLabel, { color: colors.mutedForeground }]} numberOfLines={1}>{label}</Text>
      <View style={styles.miniBarTrack}>
        <View style={[styles.miniBarFill, { backgroundColor: color, width: `${Math.min(100, pct)}%` as any }]} />
      </View>
      <Text style={[styles.miniBarCount, { color: colors.foreground }]}>{count}</Text>
    </View>
  );
}

export default function RapportCommercialScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [data, setData] = useState<RapportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [months, setMonths] = useState<"3" | "6" | "12">("6");

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/commercial/rapport?months=${months}`);
      if (res.ok) setData(await res.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, months]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  const periodOptions: { val: "3" | "6" | "12"; label: string }[] = [
    { val: "3", label: "3 mois" },
    { val: "6", label: "6 mois" },
    { val: "12", label: "12 mois" },
  ];

  const maxRevenue = data ? Math.max(...data.monthlyRevenue.map(r => r.revenue), 1) : 1;
  const maxProspectCount = data ? Math.max(...Object.values({ ...data.prospects }).filter(v => typeof v === "number") as number[], 1) : 1;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#1d4ed8", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Rapport Commercial</Text>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>
        <View style={styles.periodRow}>
          {periodOptions.map(p => (
            <Pressable
              key={p.val}
              onPress={() => setMonths(p.val)}
              style={[styles.periodChip, { backgroundColor: months === p.val ? "#fff" : "rgba(255,255,255,0.15)" }]}
            >
              <Text style={[styles.periodChipText, { color: months === p.val ? "#1d4ed8" : "rgba(255,255,255,0.85)" }]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1d4ed8" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Chargement du rapport…</Text>
        </View>
      ) : !data ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Impossible de charger le rapport</Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1d4ed8" />}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 }]}
        >
          {/* KPI Overview */}
          <View style={styles.kpiGrid}>
            <StatCard label="CA encaissé" value={fmtEur(data.factures.paidAmount)} sub={`sur ${fmtEur(data.factures.totalAmount)}`} color="#22c55e" colors={colors} />
            <StatCard label="Devis acceptés" value={fmtEur(data.devis.acceptedAmount)} sub={`Taux: ${data.devis.conversionRate ?? Math.round((data.devis.accepte / Math.max(1, data.devis.total)) * 100)}%`} color="#3b82f6" colors={colors} />
            <StatCard label="Pipeline" value={fmtEur(data.prospects.totalValue)} sub={`${data.prospects.total} prospects`} color="#8b5cf6" colors={colors} />
            <StatCard label="Impayés" value={fmtEur(data.factures.remainingAmount)} sub={`${data.factures.overdueCount} en retard`} color="#ef4444" colors={colors} />
          </View>

          {/* Devis */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Devis" icon="file-text" color="#3b82f6" colors={colors} />
            <View style={styles.metricRow}>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: colors.foreground }]}>{data.devis.total}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Total</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#22c55e" }]}>{data.devis.accepte}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Acceptés</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#f59e0b" }]}>{data.devis.envoye}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Envoyés</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#ef4444" }]}>{data.devis.refuse}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Refusés</Text>
              </View>
            </View>
            {data.devis.total > 0 && (
              <View style={[styles.progressBar, { backgroundColor: colors.border, marginTop: 12 }]}>
                <View style={[styles.progressFill, { width: `${Math.round((data.devis.accepte / data.devis.total) * 100)}%` as any, backgroundColor: "#22c55e" }]} />
              </View>
            )}
            <Text style={[styles.progressCaption, { color: colors.mutedForeground }]}>
              {data.devis.total > 0 ? `${Math.round((data.devis.accepte / data.devis.total) * 100)}% de conversion` : "Aucun devis"}
            </Text>
          </View>

          {/* Factures */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Factures" icon="file" color="#0891b2" colors={colors} />
            <View style={styles.metricRow}>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: colors.foreground }]}>{data.factures.total}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Total</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#22c55e" }]}>{data.factures.payee}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Payées</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#f59e0b" }]}>{data.factures.emise}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Émises</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#ef4444" }]}>{data.factures.overdueCount}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>En retard</Text>
              </View>
            </View>
            <View style={styles.amountRow}>
              <View>
                <Text style={[styles.amountBig, { color: "#22c55e" }]}>{fmtEur(data.factures.paidAmount)}</Text>
                <Text style={[styles.amountLbl, { color: colors.mutedForeground }]}>Encaissé</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.amountBig, { color: "#ef4444" }]}>{fmtEur(data.factures.remainingAmount)}</Text>
                <Text style={[styles.amountLbl, { color: colors.mutedForeground }]}>À encaisser</Text>
              </View>
            </View>
          </View>

          {/* Prospects Pipeline */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Pipeline Prospects" icon="trending-up" color="#8b5cf6" colors={colors} />
            <View style={styles.pipelineAmounts}>
              <View>
                <Text style={[styles.amountBig, { color: "#22c55e" }]}>{fmtEur(data.prospects.wonValue)}</Text>
                <Text style={[styles.amountLbl, { color: colors.mutedForeground }]}>Gagné</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.amountBig, { color: "#8b5cf6" }]}>{fmtEur(data.prospects.totalValue)}</Text>
                <Text style={[styles.amountLbl, { color: colors.mutedForeground }]}>Pipeline total</Text>
              </View>
            </View>
            {(["prospect", "qualification", "proposition", "negociation", "gagne", "perdu"] as const).map(stage => {
              const count = data.prospects[stage] as number ?? 0;
              const max = data.prospects.total || 1;
              return (
                <MiniBar key={stage} label={STAGE_LABELS[stage]} value={count} max={max} color={STAGE_COLORS[stage]} count={count} colors={colors} />
              );
            })}
          </View>

          {/* Projets */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Projets" icon="folder" color="#6366f1" colors={colors} />
            <View style={styles.metricRow}>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: colors.foreground }]}>{data.projets.total}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Total</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#3b82f6" }]}>{data.projets.active}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Actifs</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#22c55e" }]}>{data.projets.termine}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Terminés</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#ef4444" }]}>{data.projets.overdue}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>En retard</Text>
              </View>
            </View>
            {data.projets.total > 0 && (
              <>
                <View style={[styles.progressBar, { backgroundColor: colors.border, marginTop: 12 }]}>
                  <View style={[styles.progressFill, { width: `${Math.round(data.projets.avgProgress)}%` as any, backgroundColor: "#6366f1" }]} />
                </View>
                <Text style={[styles.progressCaption, { color: colors.mutedForeground }]}>
                  Avancement moyen: {Math.round(data.projets.avgProgress)}%
                </Text>
              </>
            )}
            {(data.projets.totalBudget > 0 || data.projets.totalSpent > 0) && (
              <View style={styles.amountRow}>
                <View>
                  <Text style={[styles.amountBig, { color: "#6366f1" }]}>{fmtEur(data.projets.totalBudget)}</Text>
                  <Text style={[styles.amountLbl, { color: colors.mutedForeground }]}>Budget total</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.amountBig, { color: "#f59e0b" }]}>{fmtEur(data.projets.totalSpent)}</Text>
                  <Text style={[styles.amountLbl, { color: colors.mutedForeground }]}>Dépensé</Text>
                </View>
              </View>
            )}
          </View>

          {/* Stock */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SectionTitle title="Stock" icon="package" color="#7c3aed" colors={colors} />
            <View style={styles.metricRow}>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: colors.foreground }]}>{data.stock.total}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Articles</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#f59e0b" }]}>{data.stock.alerte}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Alertes</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.metricNum, { color: "#ef4444" }]}>{data.stock.rupture}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Rupture</Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={[styles.amountBig, { color: "#7c3aed", fontSize: 14 }]}>{fmtEur(data.stock.totalValue)}</Text>
                <Text style={[styles.metricLbl, { color: colors.mutedForeground }]}>Valeur</Text>
              </View>
            </View>
          </View>

          {/* Revenus mensuels */}
          {data.monthlyRevenue.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SectionTitle title="Revenus mensuels" icon="bar-chart-2" color="#22c55e" colors={colors} />
              {data.monthlyRevenue.slice(-6).map((row) => (
                <View key={row.month} style={styles.revRow}>
                  <Text style={[styles.revMonth, { color: colors.mutedForeground }]}>{fmtMonth(row.month)}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={[styles.miniBarTrack, { backgroundColor: colors.border }]}>
                      <View style={[styles.miniBarFill, { backgroundColor: "#22c55e", width: `${Math.min(100, (row.revenue / maxRevenue) * 100)}%` as any }]} />
                    </View>
                  </View>
                  <Text style={[styles.revAmount, { color: "#22c55e" }]}>{fmtEur(row.revenue)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Top produits stock */}
          {data.topProducts.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <SectionTitle title="Top articles stock" icon="award" color="#f59e0b" colors={colors} />
              {data.topProducts.slice(0, 5).map((prod, i) => (
                <View key={i} style={[styles.topProdRow, { borderBottomColor: colors.border }]}>
                  <View style={[styles.topProdRank, { backgroundColor: "#f59e0b18" }]}>
                    <Text style={[styles.topProdRankText, { color: "#f59e0b" }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.topProdName, { color: colors.foreground }]} numberOfLines={1}>{prod.name}</Text>
                    <Text style={[styles.topProdCat, { color: colors.mutedForeground }]}>{prod.category} · {prod.quantity} unités</Text>
                  </View>
                  <Text style={[styles.topProdValue, { color: "#f59e0b" }]}>{fmtEur(prod.totalValue)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  periodRow: { flexDirection: "row", gap: 8 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  periodChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  scrollContent: { padding: 16, gap: 12 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  statCard: { width: "48%", flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 2 },
  statLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statSub: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  section: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  sectionIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sectionTitleText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  metricRow: { flexDirection: "row", justifyContent: "space-between" },
  metricItem: { flex: 1, alignItems: "center" },
  metricNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  metricLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },
  progressBar: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  progressCaption: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 5 },
  amountRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  pipelineAmounts: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  amountBig: { fontSize: 18, fontFamily: "Inter_700Bold" },
  amountLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  miniBarRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  miniBarLabel: { fontSize: 11, fontFamily: "Inter_400Regular", width: 90 },
  miniBarTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  miniBarFill: { height: "100%", borderRadius: 3 },
  miniBarCount: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 24, textAlign: "right" },
  revRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  revMonth: { fontSize: 11, fontFamily: "Inter_500Medium", width: 44 },
  revAmount: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 60, textAlign: "right" },
  topProdRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
  topProdRank: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  topProdRankText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  topProdName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  topProdCat: { fontSize: 11, fontFamily: "Inter_400Regular" },
  topProdValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
