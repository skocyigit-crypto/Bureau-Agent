import { Icon3D } from "@/components/icon-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip,TooltipContent,TooltipProvider,TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { Activity,Bot,DollarSign,Info,Phone,RotateCcw,Save,TrendingUp,Zap } from "lucide-react";
import { useEffect,useState } from "react";
import {
Bar,
BarChart,
CartesianGrid,Tooltip as ReTooltip,
ResponsiveContainer,
XAxis,YAxis
} from "recharts";

const DEFAULT_COST_USD = 50;
const DEFAULT_CALLS = 5000;

interface AiSettings {
  aiQuotaCostUsd: number | null;
  aiQuotaCalls: number | null;
  aiAgentName: string | null;
}

interface QuotaStatus {
  used: { costUsd: number; calls: number };
  limits: { maxCostUsdPerMonth: number; maxCallsPerMonth: number };
  percentCost: number;
  percentCalls: number;
}

interface DayStats {
  day: string;
  calls: number;
  tokens: number;
  costUsd: number;
}

interface RouteStats {
  route: string;
  calls: number;
  tokens: number;
  costUsd: number;
}

interface ModelStats {
  model: string;
  provider: string;
  calls: number;
  tokens: number;
  costUsd: number;
}

interface SummaryData {
  period: { days: number; since: string };
  totals: {
    totalCalls: number;
    successCalls: number;
    errorCalls: number;
    totalTokens: number;
    totalCostUsd: number;
    avgDurationMs: number;
  };
  byDay: DayStats[];
  byRoute: RouteStats[];
  byModel: ModelStats[];
}

const CHART_COLORS = {
  cost: "#f59e0b",
  calls: "#3b82f6",
  tokens: "#8b5cf6",
  success: "#10b981",
  error: "#ef4444",
};

function shortDay(day: string): string {
  const d = new Date(day + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function fmtCost(v: number) {
  return v < 0.001 ? `<0.001$` : `${v.toFixed(3)}$`;
}

export function TabIntelligenceArtificielle() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AiSettings>({ aiQuotaCostUsd: null, aiQuotaCalls: null, aiAgentName: null });
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chartDays, setChartDays] = useState("30");
  const [chartMetric, setChartMetric] = useState<"cost" | "calls">("cost");

  const [agentName, setAgentName] = useState("");
  const [quotaCost, setQuotaCost] = useState("");
  const [quotaCalls, setQuotaCalls] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadSummary(Number(chartDays));
  }, [chartDays]);

  async function loadData() {
    setLoading(true);
    try {
      const [settingsRes, quotaRes] = await Promise.all([
        fetch("/api/ai-usage/settings", { credentials: "include" }),
        fetch("/api/ai-usage/quota", { credentials: "include" }),
      ]);
      if (settingsRes.ok) {
        const data: AiSettings = await settingsRes.json();
        setSettings(data);
        setAgentName(data.aiAgentName || "");
        setQuotaCost(data.aiQuotaCostUsd != null ? String(data.aiQuotaCostUsd) : "");
        setQuotaCalls(data.aiQuotaCalls != null ? String(data.aiQuotaCalls) : "");
      }
      if (quotaRes.ok) {
        const data: QuotaStatus = await quotaRes.json();
        setQuota(data);
      }
    } catch {
      toast({ title: t("settingsIntelligenceArtificielle.error"), description: t("settingsIntelligenceArtificielle.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
    await loadSummary(Number(chartDays));
  }

  async function loadSummary(days: number) {
    try {
      const res = await fetch(`/api/ai-usage/summary?days=${days}`, { credentials: "include" });
      if (res.ok) setSummary(await res.json());
    } catch {
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, any> = {};
      body.aiAgentName = agentName.trim() || null;
      const costVal = quotaCost.trim();
      body.aiQuotaCostUsd = costVal === "" ? null : Number(costVal);
      const callsVal = quotaCalls.trim();
      body.aiQuotaCalls = callsVal === "" ? null : parseInt(callsVal);

      const res = await fetch("/api/ai-usage/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: t("settingsIntelligenceArtificielle.error"), description: data.error || t("settingsIntelligenceArtificielle.saveFailed"), variant: "destructive" });
        return;
      }
      toast({ title: t("settingsIntelligenceArtificielle.saveSuccess"), description: t("settingsIntelligenceArtificielle.saveSuccessDesc") });
      await loadData();
    } catch {
      toast({ title: t("settingsIntelligenceArtificielle.networkError"), description: t("settingsIntelligenceArtificielle.networkDesc"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setAgentName(settings.aiAgentName || "");
    setQuotaCost(settings.aiQuotaCostUsd != null ? String(settings.aiQuotaCostUsd) : "");
    setQuotaCalls(settings.aiQuotaCalls != null ? String(settings.aiQuotaCalls) : "");
  }

  const effectiveCostLimit = settings.aiQuotaCostUsd ?? DEFAULT_COST_USD;
  const effectiveCallsLimit = settings.aiQuotaCalls ?? DEFAULT_CALLS;

  const chartData = (summary?.byDay || []).map(d => ({
    day: shortDay(d.day),
    cost: Number(d.costUsd.toFixed(4)),
    calls: d.calls,
    tokens: d.tokens,
  }));

  const topRoutes = (summary?.byRoute || []).slice(0, 5);
  const successRate = summary
    ? summary.totals.totalCalls > 0
      ? ((summary.totals.successCalls / summary.totals.totalCalls) * 100).toFixed(1)
      : "100.0"
    : null;

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">

        {quota && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon3D icon={Zap} variant="amber" size="sm" />
                {t("settingsIntelligenceArtificielle.usageTitle")}
              </CardTitle>
              <CardDescription>{t("settingsIntelligenceArtificielle.usageDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    <DollarSign className="w-3.5 h-3.5 text-amber-500" />
                    {t("settingsIntelligenceArtificielle.estCost")}
                  </span>
                  <span className="font-mono">
                    <span className={quota.percentCost >= 95 ? "text-red-500 font-bold" : quota.percentCost >= 80 ? "text-amber-500 font-semibold" : ""}>
                      {quota.used.costUsd.toFixed(3)} USD
                    </span>
                    <span className="text-muted-foreground"> / {quota.limits.maxCostUsdPerMonth} USD</span>
                  </span>
                </div>
                <Progress
                  value={quota.percentCost}
                  className={`h-2 ${quota.percentCost >= 95 ? "[&>div]:bg-red-500" : quota.percentCost >= 80 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
                />
                <p className="text-xs text-muted-foreground">{t("settingsIntelligenceArtificielle.quotaUsed", { pct: quota.percentCost.toFixed(1) })}</p>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Phone className="w-3.5 h-3.5 text-blue-500" />
                    {t("settingsIntelligenceArtificielle.aiCalls")}
                  </span>
                  <span className="font-mono">
                    <span className={quota.percentCalls >= 95 ? "text-red-500 font-bold" : quota.percentCalls >= 80 ? "text-amber-500 font-semibold" : ""}>
                      {quota.used.calls.toLocaleString("fr-FR")}
                    </span>
                    <span className="text-muted-foreground"> / {quota.limits.maxCallsPerMonth.toLocaleString("fr-FR")}</span>
                  </span>
                </div>
                <Progress
                  value={quota.percentCalls}
                  className={`h-2 ${quota.percentCalls >= 95 ? "[&>div]:bg-red-500" : quota.percentCalls >= 80 ? "[&>div]:bg-amber-500" : "[&>div]:bg-blue-500"}`}
                />
                <p className="text-xs text-muted-foreground">{t("settingsIntelligenceArtificielle.quotaUsed", { pct: quota.percentCalls.toFixed(1) })}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {summary && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon3D icon={TrendingUp} variant="blue" size="sm" />
                    {t("settingsIntelligenceArtificielle.trendTitle")}
                  </CardTitle>
                  <CardDescription>{t("settingsIntelligenceArtificielle.trendDesc")}</CardDescription>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Select value={chartMetric} onValueChange={(v) => setChartMetric(v as "cost" | "calls")}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost">{t("settingsIntelligenceArtificielle.costUsd")}</SelectItem>
                      <SelectItem value="calls">{t("settingsIntelligenceArtificielle.calls")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={chartDays} onValueChange={setChartDays}>
                    <SelectTrigger className="w-20 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">{t("settingsIntelligenceArtificielle.daysShort", { n: 7 })}</SelectItem>
                      <SelectItem value="14">{t("settingsIntelligenceArtificielle.daysShort", { n: 14 })}</SelectItem>
                      <SelectItem value="30">{t("settingsIntelligenceArtificielle.daysShort", { n: 30 })}</SelectItem>
                      <SelectItem value="60">{t("settingsIntelligenceArtificielle.daysShort", { n: 60 })}</SelectItem>
                      <SelectItem value="90">{t("settingsIntelligenceArtificielle.daysShort", { n: 90 })}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("settingsIntelligenceArtificielle.totalCost")}</p>
                  <p className="font-semibold font-mono text-amber-600">{fmtCost(summary.totals.totalCostUsd)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("settingsIntelligenceArtificielle.totalCalls")}</p>
                  <p className="font-semibold font-mono text-blue-600">{summary.totals.totalCalls.toLocaleString("fr-FR")}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("settingsIntelligenceArtificielle.successRate")}</p>
                  <p className={`font-semibold font-mono ${Number(successRate) >= 95 ? "text-emerald-600" : Number(successRate) >= 80 ? "text-amber-600" : "text-red-600"}`}>
                    {successRate}%
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{t("settingsIntelligenceArtificielle.totalTokens")}</p>
                  <p className="font-semibold font-mono text-purple-600">{summary.totals.totalTokens.toLocaleString("fr-FR")}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  {chartMetric === "cost" ? (
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}$`} width={45} />
                      <ReTooltip
                        formatter={(value: number) => [`${value.toFixed(4)} USD`, t("settingsIntelligenceArtificielle.cost")]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="cost" fill={CHART_COLORS.cost} radius={[3, 3, 0, 0]} name={t("settingsIntelligenceArtificielle.costUsd")} maxBarSize={32} />
                    </BarChart>
                  ) : (
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                      <ReTooltip
                        formatter={(value: number) => [value.toLocaleString("fr-FR"), t("settingsIntelligenceArtificielle.calls")]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="calls" fill={CHART_COLORS.calls} radius={[3, 3, 0, 0]} name={t("settingsIntelligenceArtificielle.barCalls")} maxBarSize={32} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
                  <Activity className="w-4 h-4 mr-2" />
                  {t("settingsIntelligenceArtificielle.noData")}
                </div>
              )}

              {topRoutes.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("settingsIntelligenceArtificielle.topRoutes", { days: chartDays })}</p>
                  <div className="space-y-1.5">
                    {topRoutes.map((r) => (
                      <div key={r.route} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">{r.route}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="secondary" className="text-xs font-mono">{t("settingsIntelligenceArtificielle.routeCalls", { count: r.calls })}</Badge>
                          <span className="text-xs font-mono text-amber-600">{fmtCost(r.costUsd)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon3D icon={Bot} variant="navy" size="sm" />
              {t("settingsIntelligenceArtificielle.personaTitle")}
            </CardTitle>
            <CardDescription>
              {t("settingsIntelligenceArtificielle.personaDesc")} <strong>Sophie Marchand</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name" className="flex items-center gap-1.5">
                {t("settingsIntelligenceArtificielle.agentName")}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">{t("settingsIntelligenceArtificielle.agentTooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="agent-name"
                  placeholder={t("settingsIntelligenceArtificielle.agentPlaceholder")}
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  maxLength={100}
                  className="max-w-sm"
                />
                {agentName && (
                  <Badge variant="secondary" className="gap-1">
                    <Bot className="w-3 h-3" />
                    {agentName.split(" ")[0]}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("settingsIntelligenceArtificielle.agentHint")}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon3D icon={DollarSign} variant="emerald" size="sm" />
              {t("settingsIntelligenceArtificielle.quotasTitle")}
            </CardTitle>
            <CardDescription>
              {t("settingsIntelligenceArtificielle.quotasDesc1")} <strong>{t("settingsIntelligenceArtificielle.quotasCostVal", { cost: DEFAULT_COST_USD })}</strong>{t("settingsIntelligenceArtificielle.quotasDesc2")} <strong>{DEFAULT_CALLS.toLocaleString("fr-FR")}</strong>{t("settingsIntelligenceArtificielle.quotasDesc3")} <strong>{t("settingsIntelligenceArtificielle.quotas80")}</strong>{t("settingsIntelligenceArtificielle.quotasDesc4")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="quota-cost" className="flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-amber-500" />
                  {t("settingsIntelligenceArtificielle.costCap")}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{t("settingsIntelligenceArtificielle.costTooltip")}</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="quota-cost"
                    type="number"
                    placeholder={String(DEFAULT_COST_USD)}
                    value={quotaCost}
                    onChange={e => setQuotaCost(e.target.value)}
                    min={1}
                    max={10000}
                    step={1}
                    className="pl-9 max-w-[200px]"
                  />
                </div>
                {settings.aiQuotaCostUsd != null ? (
                  <Badge variant="outline" className="text-xs">{t("settingsIntelligenceArtificielle.customCost", { cost: effectiveCostLimit })}</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">{t("settingsIntelligenceArtificielle.systemCost", { cost: DEFAULT_COST_USD })}</Badge>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="quota-calls" className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-blue-500" />
                  {t("settingsIntelligenceArtificielle.callsCap")}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{t("settingsIntelligenceArtificielle.callsTooltip")}</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="quota-calls"
                    type="number"
                    placeholder={String(DEFAULT_CALLS)}
                    value={quotaCalls}
                    onChange={e => setQuotaCalls(e.target.value)}
                    min={100}
                    max={1000000}
                    step={100}
                    className="pl-9 max-w-[200px]"
                  />
                </div>
                {settings.aiQuotaCalls != null ? (
                  <Badge variant="outline" className="text-xs">{t("settingsIntelligenceArtificielle.customCalls", { calls: effectiveCallsLimit.toLocaleString("fr-FR") })}</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">{t("settingsIntelligenceArtificielle.systemCalls", { calls: DEFAULT_CALLS.toLocaleString("fr-FR") })}</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? t("settingsIntelligenceArtificielle.saving") : t("settingsIntelligenceArtificielle.saveBtn")}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={saving} className="gap-2">
            <RotateCcw className="w-4 h-4" />
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

