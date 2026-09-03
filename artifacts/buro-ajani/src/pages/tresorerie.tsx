import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
AlertTriangle,
CalendarClock,
Info,
Loader2,
RefreshCw,
Save,
ShieldCheck,
TrendingDown,
TrendingUp,
Wallet,
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface TreasurySettings {
  configured: boolean;
  currentCash: number;
  monthlyFixedCosts: number;
  defaultAutoliquidation: boolean;
  updatedAt: string | null;
}

interface OverdueInvoice {
  id: number;
  reference: string;
  clientName: string;
  remaining: number;
  dueDate: string | null;
  daysOverdue: number;
}

interface TreasuryRisk {
  configured: boolean;
  currentCash: number;
  monthlyFixedCosts: number;
  defaultAutoliquidation: boolean;
  horizonDays: number;
  pendingCount: number;
  pendingTotal: number;
  expectedCollectible: number;
  overdue: OverdueInvoice[];
  overdueCount: number;
  overdueTotal: number;
  expensesPayableCount: number;
  expensesPayableTotal: number;
  simulation: {
    runs: number;
    insolvencyProbability: number;
    projectedP5: number;
    projectedMedian: number;
    projectedP95: number;
    projectedMin: number;
  };
  alert: boolean;
  recommendation: string | null;
}

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );

function riskLevel(p: number): { key: string; tint: string; bar: string } {
  if (p > 0.15) return { key: "high", tint: "text-red-600", bar: "bg-red-500" };
  if (p > 0.075) return { key: "watch", tint: "text-amber-600", bar: "bg-amber-500" };
  return { key: "healthy", tint: "text-emerald-600", bar: "bg-emerald-500" };
}

export default function TresoreriePage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [cash, setCash] = useState("");
  const [fixedCosts, setFixedCosts] = useState("");
  const [autoliq, setAutoliq] = useState(false);
  const [, setConfigured] = useState(false);
  const [risk, setRisk] = useState<TreasuryRisk | null>(null);

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const res = await fetch(`${BASE}/api/treasury/settings`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data: TreasurySettings = await res.json();
      setConfigured(data.configured);
      setCash(data.configured ? String(data.currentCash) : "");
      setFixedCosts(data.configured ? String(data.monthlyFixedCosts) : "");
      setAutoliq(data.defaultAutoliquidation);
    } catch {
      toast({
        title: t("tresorerie.toast.loadErrorTitle"),
        description: t("tresorerie.toast.loadErrorDesc"),
        variant: "destructive",
      });
    } finally {
      setLoadingSettings(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    const currentCash = Number(cash);
    const monthlyFixedCosts = Number(fixedCosts);
    if (!Number.isFinite(currentCash) || currentCash < 0 || !Number.isFinite(monthlyFixedCosts) || monthlyFixedCosts < 0) {
      toast({
        title: t("tresorerie.toast.invalidTitle"),
        description: t("tresorerie.toast.invalidDesc"),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/treasury/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCash, monthlyFixedCosts, defaultAutoliquidation: autoliq }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setConfigured(true);
      toast({ title: t("tresorerie.toast.savedTitle"), description: t("tresorerie.toast.savedDesc") });
    } catch {
      toast({ title: t("tresorerie.toast.saveErrorTitle"), description: t("tresorerie.toast.saveErrorDesc"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`${BASE}/api/treasury/risk`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data: TreasuryRisk = await res.json();
      setRisk(data);
      if (!data.configured) {
        toast({
          title: t("tresorerie.toast.notConfiguredTitle"),
          description: t("tresorerie.toast.notConfiguredDesc"),
        });
      }
    } catch {
      toast({ title: t("tresorerie.toast.analyzeErrorTitle"), description: t("tresorerie.toast.analyzeErrorDesc"), variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const prob = risk?.simulation.insolvencyProbability ?? 0;
  const level = riskLevel(prob);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
          <Wallet className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("tresorerie.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("tresorerie.subtitle")}
          </p>
        </div>
      </div>

      {/* Paramètres */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("tresorerie.settings.title")}</CardTitle>
          <CardDescription>
            {t("tresorerie.settings.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loadingSettings ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cash">{t("tresorerie.settings.cashLabel")}</Label>
                  <Input aria-label={t("tresorerie.settings.cashLabel")}
                    id="cash"
                    type="number"
                    min="0"
                    step="100"
                    inputMode="decimal"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder={t("tresorerie.settings.cashPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fixed">{t("tresorerie.settings.fixedLabel")}</Label>
                  <Input aria-label={t("tresorerie.settings.fixedLabel")}
                    id="fixed"
                    type="number"
                    min="0"
                    step="100"
                    inputMode="decimal"
                    value={fixedCosts}
                    onChange={(e) => setFixedCosts(e.target.value)}
                    placeholder={t("tresorerie.settings.fixedPlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">{t("tresorerie.settings.fixedHint")}</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="autoliq" className="cursor-pointer">
                    {t("tresorerie.settings.autoliqLabel")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("tresorerie.settings.autoliqHint")}
                  </p>
                </div>
                <Switch id="autoliq" checked={autoliq} onCheckedChange={setAutoliq} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveSettings} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t("common.save")}
                </Button>
                <Button variant="secondary" onClick={analyze} disabled={analyzing}>
                  {analyzing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {t("tresorerie.settings.analyze")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Résultats */}
      {risk && risk.configured && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-lg">
                <span>{t("tresorerie.result.riskTitle", { days: risk.horizonDays })}</span>
                <Badge variant={risk.alert ? "destructive" : "secondary"} className="gap-1">
                  {risk.alert ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  {t(`tresorerie.risk.${level.key}`)}
                </Badge>
              </CardTitle>
              <CardDescription>
                {t("tresorerie.result.mcDesc", { runs: risk.simulation.runs.toLocaleString("fr-FR") })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">{t("tresorerie.result.negProb")}</span>
                  <span className={`text-2xl font-bold ${level.tint}`}>{(prob * 100).toFixed(1)}%</span>
                </div>
                <Progress value={Math.min(100, prob * 100)} className="h-2" />
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingDown className="h-3.5 w-3.5" /> {t("tresorerie.result.p5")}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{eur(risk.simulation.projectedP5)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wallet className="h-3.5 w-3.5" /> {t("tresorerie.result.median")}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{eur(risk.simulation.projectedMedian)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" /> {t("tresorerie.result.p95")}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{eur(risk.simulation.projectedP95)}</div>
                </div>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="text-muted-foreground">
                  {t("tresorerie.result.pending")}{" "}
                  <span className="font-medium text-foreground">
                    {risk.pendingCount} ({eur(risk.pendingTotal)})
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {t("tresorerie.result.expected")}{" "}
                  <span className="font-medium text-foreground">{eur(risk.expectedCollectible)}</span>
                </div>
              </div>

              {risk.recommendation && (
                <div
                  className={`flex gap-2 rounded-lg border p-3 text-sm ${
                    risk.alert ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{risk.recommendation}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarClock className="h-5 w-5 text-amber-600" />
                {t("tresorerie.overdue.title", { count: risk.overdueCount })}
              </CardTitle>
              <CardDescription>
                {t("tresorerie.overdue.desc", { total: eur(risk.overdueTotal) })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {risk.overdue.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("tresorerie.overdue.empty")}</p>
              ) : (
                <ul className="divide-y">
                  {risk.overdue.slice(0, 20).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{o.clientName}</div>
                        <div className="text-xs text-muted-foreground">
                          {o.reference}
                          {o.dueDate
                            ? t("tresorerie.overdue.dueDate", { date: new Date(o.dueDate).toLocaleDateString("fr-FR") })
                            : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-red-600">
                          {t("tresorerie.overdue.daysBadge", { days: o.daysOverdue })}
                        </Badge>
                        <span className="font-semibold">{eur(o.remaining)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {risk.expensesPayableCount > 0 && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex items-center gap-3 text-sm">
                  <TrendingDown className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span>
                    <strong>{risk.expensesPayableCount}</strong> {t("tresorerie.expenses.payableMid")}{" "}
                    <strong>{eur(risk.expensesPayableTotal)}</strong> {t("tresorerie.expenses.payableSuffix")}
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={() => (window.location.href = `${BASE}/depenses`)}>
                  {t("tresorerie.expenses.viewExpenses")}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {risk && !risk.configured && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Info className="h-5 w-5 shrink-0" />
            {t("tresorerie.notConfigured.message")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
