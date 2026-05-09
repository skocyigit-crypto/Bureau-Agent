import { useState, useEffect } from "react";
import { Bot, Zap, DollarSign, Phone, RotateCcw, Save, Info, TrendingUp, Activity, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useInlineSuggestEnabled } from "@/hooks/use-inline-suggest";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Legend, LineChart, Line,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Icon3D } from "@/components/icon-3d";

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
      toast({ title: "Erreur", description: "Impossible de charger les parametres IA.", variant: "destructive" });
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
        toast({ title: "Erreur", description: data.error || "Echec de la sauvegarde.", variant: "destructive" });
        return;
      }
      toast({ title: "Sauvegarde reussie", description: "Parametres IA mis a jour." });
      await loadData();
    } catch {
      toast({ title: "Erreur reseau", description: "Impossible de sauvegarder.", variant: "destructive" });
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

        <InlineSuggestSettingCard />

        {quota && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon3D icon={Zap} variant="amber" size="sm" />
                Utilisation IA ce mois-ci
              </CardTitle>
              <CardDescription>Suivi en temps reel de la consommation IA de votre organisation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    <DollarSign className="w-3.5 h-3.5 text-amber-500" />
                    Cout estimatif
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
                <p className="text-xs text-muted-foreground">{quota.percentCost.toFixed(1)}% du quota mensuel utilise</p>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Phone className="w-3.5 h-3.5 text-blue-500" />
                    Appels IA
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
                <p className="text-xs text-muted-foreground">{quota.percentCalls.toFixed(1)}% du quota mensuel utilise</p>
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
                    Tendance de consommation IA
                  </CardTitle>
                  <CardDescription>Evolution journaliere du cout et du nombre d'appels IA.</CardDescription>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Select value={chartMetric} onValueChange={(v) => setChartMetric(v as "cost" | "calls")}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost">Cout (USD)</SelectItem>
                      <SelectItem value="calls">Appels</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={chartDays} onValueChange={setChartDays}>
                    <SelectTrigger className="w-20 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7j</SelectItem>
                      <SelectItem value="14">14j</SelectItem>
                      <SelectItem value="30">30j</SelectItem>
                      <SelectItem value="60">60j</SelectItem>
                      <SelectItem value="90">90j</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Cout total</p>
                  <p className="font-semibold font-mono text-amber-600">{fmtCost(summary.totals.totalCostUsd)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Appels totaux</p>
                  <p className="font-semibold font-mono text-blue-600">{summary.totals.totalCalls.toLocaleString("fr-FR")}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Taux de succes</p>
                  <p className={`font-semibold font-mono ${Number(successRate) >= 95 ? "text-emerald-600" : Number(successRate) >= 80 ? "text-amber-600" : "text-red-600"}`}>
                    {successRate}%
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Tokens totaux</p>
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
                        formatter={(value: number) => [`${value.toFixed(4)} USD`, "Cout"]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="cost" fill={CHART_COLORS.cost} radius={[3, 3, 0, 0]} name="Cout (USD)" maxBarSize={32} />
                    </BarChart>
                  ) : (
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
                      <ReTooltip
                        formatter={(value: number) => [value.toLocaleString("fr-FR"), "Appels"]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="calls" fill={CHART_COLORS.calls} radius={[3, 3, 0, 0]} name="Appels IA" maxBarSize={32} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
                  <Activity className="w-4 h-4 mr-2" />
                  Aucune donnee d'utilisation sur cette periode.
                </div>
              )}

              {topRoutes.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Top routes IA ({chartDays}j)</p>
                  <div className="space-y-1.5">
                    {topRoutes.map((r) => (
                      <div key={r.route} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">{r.route}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="secondary" className="text-xs font-mono">{r.calls} appels</Badge>
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
              Persona de l'agent IA
            </CardTitle>
            <CardDescription>
              Personnalisez l'identite de votre receptionniste IA. Par defaut : <strong>Sophie Marchand</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name" className="flex items-center gap-1.5">
                Nom de l'agent
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Ce nom sera utilise dans les prompts IA et les transcriptions d'appels. Exemple : "Marie Dupont" ou "Alex".</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="agent-name"
                  placeholder="Sophie Marchand (defaut)"
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
              <p className="text-xs text-muted-foreground">Laissez vide pour utiliser le nom par defaut (Sophie Marchand).</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon3D icon={DollarSign} variant="emerald" size="sm" />
              Quotas IA mensuels
            </CardTitle>
            <CardDescription>
              Definissez les limites de consommation IA pour votre organisation. Laissez vide pour utiliser les limites systeme
              (cout : <strong>{DEFAULT_COST_USD} USD</strong>, appels : <strong>{DEFAULT_CALLS.toLocaleString("fr-FR")}</strong>).
              Une notification est automatiquement envoyee a partir de <strong>80% d'utilisation</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="quota-cost" className="flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-amber-500" />
                  Plafond cout mensuel (USD)
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Montant maximal en dollars US que votre organisation peut depenser en IA par mois. Min: 1 USD, Max: 10 000 USD.</p>
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
                  <Badge variant="outline" className="text-xs">Personnalise : {effectiveCostLimit} USD</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Systeme : {DEFAULT_COST_USD} USD</Badge>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="quota-calls" className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-blue-500" />
                  Plafond appels IA / mois
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Nombre maximum d'appels API IA par mois. Min: 100, Max: 1 000 000.</p>
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
                  <Badge variant="outline" className="text-xs">Personnalise : {effectiveCallsLimit.toLocaleString("fr-FR")} appels</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Systeme : {DEFAULT_CALLS.toLocaleString("fr-FR")} appels</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? "Sauvegarde..." : "Sauvegarder les parametres"}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={saving} className="gap-2">
            <RotateCcw className="w-4 h-4" />
            Annuler
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

function InlineSuggestSettingCard() {
  const [enabled, setEnabled] = useInlineSuggestEnabled();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon3D icon={Sparkles} variant="purple" size="sm" />
          Suggestions IA en ligne
        </CardTitle>
        <CardDescription>
          Affiche une suggestion grise (style ghost-text) pendant que vous redigez
          des notes internes, des notes de prospects et le corps des e-mails.
          Appuyez sur Tab pour accepter, Echap pour ignorer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Activer les suggestions en ligne</Label>
            <p className="text-xs text-muted-foreground">
              Lorsque cette option est desactivee, aucune suggestion n'est demandee
              ni affichee dans les champs de texte.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Activer les suggestions IA en ligne"
          />
        </div>
      </CardContent>
    </Card>
  );
}
