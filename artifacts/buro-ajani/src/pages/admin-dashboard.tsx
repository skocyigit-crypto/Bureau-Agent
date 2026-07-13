import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Shield,
  TrendingUp,
  TrendingDown,
  Users,
  Sparkles,
  RefreshCw,
  ArrowLeft,
  Loader2,
  Euro,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { useWorkspaceUser } from "@/components/workspace-user";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type Metrics = {
  mrr: number;
  arr: number;
  activeCustomers: number;
  trialingCustomers: number;
  churnRate: number;
  churnedLast30: number;
  conversionRate: number;
  trialsStarted90: number;
  trialsConverted90: number;
};

type SeriesPoint = {
  month: string;
  mrr: number;
  churnRate: number;
  conversionRate: number;
  activeCustomers: number;
};

type PlanRow = { plan: string; label: string; count: number; mrr: number };

type DashboardPayload = {
  generatedAt: string;
  currency: string;
  metrics: Metrics;
  timeseries: SeriesPoint[];
  planBreakdown: PlanRow[];
};

function formatEur(v: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)} %`;
}

function formatMonthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

export default function AdminDashboardPage() {
  const { user } = useWorkspaceUser();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(soft = false) {
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/saas-dashboard`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload: DashboardPayload = await res.json();
      setData(payload);
    } catch (err: any) {
      toast({
        title: "Impossible de charger le tableau de bord",
        description: err?.message || "Erreur inconnue",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (user.role === "super_admin") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role]);

  if (user.role !== "super_admin") return <AccessDenied />;

  const m = data?.metrics;
  const series = data?.timeseries ?? [];
  const lastMrr = series.at(-1)?.mrr ?? 0;
  const prevMrr = series.at(-2)?.mrr ?? 0;
  const mrrDelta = prevMrr > 0 ? (lastMrr - prevMrr) / prevMrr : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => navigate("/admin")}
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Backoffice SaaS
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <h1 className="text-2xl font-semibold">Tableau de bord SaaS</h1>
            <Badge
              variant="outline"
              className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30"
            >
              Super-admin
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            MRR, churn, conversion d'essai — vue à 12 mois sur l'ensemble des
            organisations.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing || loading}
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Actualiser
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Chargement…
        </div>
      ) : !m ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Aucune donnée disponible pour le moment.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={<Euro className="w-5 h-5 text-emerald-600" />}
              label="MRR"
              value={formatEur(m.mrr)}
              hint={`ARR estimé ${formatEur(m.arr)}`}
              trend={mrrDelta}
            />
            <MetricCard
              icon={<Users className="w-5 h-5 text-blue-600" />}
              label="Clients payants"
              value={String(m.activeCustomers)}
              hint={`${m.trialingCustomers} essai${m.trialingCustomers > 1 ? "s" : ""} en cours`}
            />
            <MetricCard
              icon={<TrendingDown className="w-5 h-5 text-red-600" />}
              label="Churn (30 j)"
              value={formatPct(m.churnRate)}
              hint={`${m.churnedLast30} annulation${m.churnedLast30 > 1 ? "s" : ""}`}
            />
            <MetricCard
              icon={<Sparkles className="w-5 h-5 text-violet-600" />}
              label="Conversion essai → payant"
              value={formatPct(m.conversionRate)}
              hint={`${m.trialsConverted90}/${m.trialsStarted90} sur 90 j`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600" /> Évolution
                  du MRR (12 mois)
                </CardTitle>
                <CardDescription className="text-xs">
                  Somme des prix mensuels des abonnements payants actifs en fin
                  de mois.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={formatMonthLabel}
                      fontSize={12}
                    />
                    <YAxis
                      fontSize={12}
                      tickFormatter={(v) => `${Math.round(v)} €`}
                    />
                    <RechartsTooltip
                      formatter={(v: number) => formatEur(v)}
                      labelFormatter={formatMonthLabel}
                    />
                    <Area
                      type="monotone"
                      dataKey="mrr"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#mrrFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" /> Clients payants
                  actifs
                </CardTitle>
                <CardDescription className="text-xs">
                  Nombre d'abonnements payants actifs à la fin de chaque mois.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={formatMonthLabel}
                      fontSize={12}
                    />
                    <YAxis fontSize={12} allowDecimals={false} />
                    <RechartsTooltip labelFormatter={formatMonthLabel} />
                    <Bar
                      dataKey="activeCustomers"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-600" /> Churn mensuel
                </CardTitle>
                <CardDescription className="text-xs">
                  Annulations du mois ÷ clients actifs au début du mois.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={formatMonthLabel}
                      fontSize={12}
                    />
                    <YAxis
                      fontSize={12}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)} %`}
                    />
                    <RechartsTooltip
                      formatter={(v: number) => formatPct(v)}
                      labelFormatter={formatMonthLabel}
                    />
                    <Line
                      type="monotone"
                      dataKey="churnRate"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-600" /> Conversion
                  essai → payant
                </CardTitle>
                <CardDescription className="text-xs">
                  Essais démarrés dans le mois qui sont aujourd'hui en plan
                  payant actif.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={formatMonthLabel}
                      fontSize={12}
                    />
                    <YAxis
                      fontSize={12}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)} %`}
                      domain={[0, 1]}
                    />
                    <RechartsTooltip
                      formatter={(v: number) => formatPct(v)}
                      labelFormatter={formatMonthLabel}
                    />
                    <Line
                      type="monotone"
                      dataKey="conversionRate"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {data && data.planBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Répartition par plan</CardTitle>
                <CardDescription className="text-xs">
                  Clients payants actifs et MRR par plan d'abonnement.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-2 pr-4 font-medium">Plan</th>
                        <th className="py-2 pr-4 font-medium">Clients</th>
                        <th className="py-2 pr-4 font-medium">MRR</th>
                        <th className="py-2 pr-4 font-medium">Part du MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.planBreakdown.map((row) => {
                        const share = m.mrr > 0 ? row.mrr / m.mrr : 0;
                        return (
                          <tr key={row.plan} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{row.label}</td>
                            <td className="py-2 pr-4">{row.count}</td>
                            <td className="py-2 pr-4">{formatEur(row.mrr)}</td>
                            <td className="py-2 pr-4">{formatPct(share)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {data && (
            <p className="text-xs text-muted-foreground text-right">
              Données générées le{" "}
              {new Date(data.generatedAt).toLocaleString("fr-FR")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  trend?: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardDescription className="text-xs uppercase tracking-wide">
            {label}
          </CardDescription>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          {trend !== undefined && Number.isFinite(trend) && trend !== 0 && (
            <span
              className={`flex items-center gap-0.5 font-medium ${
                trend >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {trend >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {(trend * 100).toFixed(1)} %
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
