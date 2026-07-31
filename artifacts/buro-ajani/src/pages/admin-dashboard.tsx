import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
Activity,
ArrowLeft,
Euro,
Loader2,
RefreshCw,
Shield,
Sparkles,
TrendingDown,
TrendingUp,
Users,
} from "lucide-react";
import { useEffect,useState } from "react";
import {
Area,
AreaChart,
Bar,
BarChart,
CartesianGrid,
Line,
LineChart,
Tooltip as RechartsTooltip,
ResponsiveContainer,
XAxis,
YAxis
} from "recharts";
import { useLocation } from "wouter";

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
  const { t } = useTranslation();
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
        title: t("adminDashboard.toast.loadError"),
        description: err?.message || t("adminDashboard.toast.unknownError"),
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
            <ArrowLeft className="w-4 h-4 mr-1" /> {t("adminDashboard.back")}
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <h1 className="text-2xl font-semibold">{t("adminDashboard.title")}</h1>
            <Badge
              variant="outline"
              className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30"
            >
              {t("adminDashboard.superAdmin")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t("adminDashboard.subtitle")}
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
          {t("adminDashboard.refresh")}
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" /> {t("adminDashboard.loading")}
        </div>
      ) : !m ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("adminDashboard.noData")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={<Euro className="w-5 h-5 text-emerald-600" />}
              label={t("adminDashboard.metrics.mrr")}
              value={formatEur(m.mrr)}
              hint={t("adminDashboard.metrics.arrHint", { value: formatEur(m.arr) })}
              trend={mrrDelta}
            />
            <MetricCard
              icon={<Users className="w-5 h-5 text-blue-600" />}
              label={t("adminDashboard.metrics.activeCustomers")}
              value={String(m.activeCustomers)}
              hint={t("adminDashboard.metrics.trialingHint", { count: m.trialingCustomers })}
            />
            <MetricCard
              icon={<TrendingDown className="w-5 h-5 text-red-600" />}
              label={t("adminDashboard.metrics.churn")}
              value={formatPct(m.churnRate)}
              hint={t("adminDashboard.metrics.churnHint", { count: m.churnedLast30 })}
            />
            <MetricCard
              icon={<Sparkles className="w-5 h-5 text-violet-600" />}
              label={t("adminDashboard.metrics.conversion")}
              value={formatPct(m.conversionRate)}
              hint={t("adminDashboard.metrics.conversionHint", { converted: m.trialsConverted90, started: m.trialsStarted90 })}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600" /> {t("adminDashboard.charts.mrrTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("adminDashboard.charts.mrrDesc")}
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
                  <Activity className="w-4 h-4 text-blue-600" /> {t("adminDashboard.charts.activeTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("adminDashboard.charts.activeDesc")}
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
                  <TrendingDown className="w-4 h-4 text-red-600" /> {t("adminDashboard.charts.churnTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("adminDashboard.charts.churnDesc")}
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
                  <Sparkles className="w-4 h-4 text-violet-600" /> {t("adminDashboard.charts.conversionTitle")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("adminDashboard.charts.conversionDesc")}
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
                <CardTitle className="text-base">{t("adminDashboard.planTable.title")}</CardTitle>
                <CardDescription className="text-xs">
                  {t("adminDashboard.planTable.desc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-2 pr-4 font-medium">{t("adminDashboard.planTable.plan")}</th>
                        <th className="py-2 pr-4 font-medium">{t("adminDashboard.planTable.clients")}</th>
                        <th className="py-2 pr-4 font-medium">{t("adminDashboard.planTable.mrr")}</th>
                        <th className="py-2 pr-4 font-medium">{t("adminDashboard.planTable.share")}</th>
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
              {t("adminDashboard.generatedAt", { date: new Date(data.generatedAt).toLocaleString("fr-FR") })}
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
