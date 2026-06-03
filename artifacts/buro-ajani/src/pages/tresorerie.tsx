import { useState, useEffect, useCallback } from "react";
import {
  Wallet,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Save,
  RefreshCw,
  CalendarClock,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

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

function riskLevel(p: number): { label: string; tint: string; bar: string } {
  if (p > 0.15) return { label: "Risque élevé", tint: "text-red-600", bar: "bg-red-500" };
  if (p > 0.075) return { label: "Sous surveillance", tint: "text-amber-600", bar: "bg-amber-500" };
  return { label: "Trésorerie saine", tint: "text-emerald-600", bar: "bg-emerald-500" };
}

export default function TresoreriePage() {
  const { toast } = useToast();
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [cash, setCash] = useState("");
  const [fixedCosts, setFixedCosts] = useState("");
  const [autoliq, setAutoliq] = useState(false);
  const [configured, setConfigured] = useState(false);
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
        title: "Chargement impossible",
        description: "Impossible de charger les paramètres de trésorerie.",
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
        title: "Valeurs invalides",
        description: "Saisissez un solde et des charges fixes positifs.",
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
      toast({ title: "Paramètres enregistrés", description: "Vous pouvez lancer l'analyse de risque." });
    } catch {
      toast({ title: "Échec", description: "Enregistrement impossible.", variant: "destructive" });
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
          title: "Trésorerie non configurée",
          description: "Renseignez votre solde et vos charges fixes pour obtenir une probabilité.",
        });
      }
    } catch {
      toast({ title: "Échec", description: "Analyse impossible.", variant: "destructive" });
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
          <h1 className="text-2xl font-bold tracking-tight">Trésorerie &amp; Radar de risque</h1>
          <p className="text-sm text-muted-foreground">
            Estimez le risque de tension de trésorerie sur 90 jours à partir de vos factures réelles et
            d'une simulation Monte Carlo. Aucune action automatique : uniquement des alertes.
          </p>
        </div>
      </div>

      {/* Paramètres */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mes paramètres de trésorerie</CardTitle>
          <CardDescription>
            Les seules données que le système ne peut pas déduire de vos factures.
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
                  <Label htmlFor="cash">Solde de trésorerie actuel (€)</Label>
                  <Input
                    id="cash"
                    type="number"
                    min="0"
                    step="100"
                    inputMode="decimal"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder="Ex : 25000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fixed">Charges fixes mensuelles (€)</Label>
                  <Input
                    id="fixed"
                    type="number"
                    min="0"
                    step="100"
                    inputMode="decimal"
                    value={fixedCosts}
                    onChange={(e) => setFixedCosts(e.target.value)}
                    placeholder="Ex : 8000"
                  />
                  <p className="text-xs text-muted-foreground">URSSAF, salaires, loyer, entretien véhicules…</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="autoliq" className="cursor-pointer">
                    Autoliquidation de TVA par défaut
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Sous-traitance BTP : vous encaissez le HT et non le TTC.
                  </p>
                </div>
                <Switch id="autoliq" checked={autoliq} onCheckedChange={setAutoliq} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveSettings} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Enregistrer
                </Button>
                <Button variant="secondary" onClick={analyze} disabled={analyzing}>
                  {analyzing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Analyser le risque
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
                <span>Risque de tension sur {risk.horizonDays} jours</span>
                <Badge variant={risk.alert ? "destructive" : "secondary"} className="gap-1">
                  {risk.alert ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  {level.label}
                </Badge>
              </CardTitle>
              <CardDescription>
                Simulation Monte Carlo sur {risk.simulation.runs.toLocaleString("fr-FR")} scénarios.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Probabilité de trésorerie négative</span>
                  <span className={`text-2xl font-bold ${level.tint}`}>{(prob * 100).toFixed(1)}%</span>
                </div>
                <Progress value={Math.min(100, prob * 100)} className="h-2" />
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingDown className="h-3.5 w-3.5" /> Scénario pessimiste (P5)
                  </div>
                  <div className="mt-1 text-lg font-semibold">{eur(risk.simulation.projectedP5)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Wallet className="h-3.5 w-3.5" /> Solde médian projeté
                  </div>
                  <div className="mt-1 text-lg font-semibold">{eur(risk.simulation.projectedMedian)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" /> Scénario optimiste (P95)
                  </div>
                  <div className="mt-1 text-lg font-semibold">{eur(risk.simulation.projectedP95)}</div>
                </div>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="text-muted-foreground">
                  Factures en attente :{" "}
                  <span className="font-medium text-foreground">
                    {risk.pendingCount} ({eur(risk.pendingTotal)})
                  </span>
                </div>
                <div className="text-muted-foreground">
                  Encaissement attendu :{" "}
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
                Factures en retard ({risk.overdueCount})
              </CardTitle>
              <CardDescription>
                {eur(risk.overdueTotal)} à recouvrer — relancez en priorité pour sécuriser la caisse.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {risk.overdue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune facture en retard. 👍</p>
              ) : (
                <ul className="divide-y">
                  {risk.overdue.slice(0, 20).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{o.clientName}</div>
                        <div className="text-xs text-muted-foreground">
                          {o.reference}
                          {o.dueDate
                            ? ` · échéance ${new Date(o.dueDate).toLocaleDateString("fr-FR")}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-red-600">
                          +{o.daysOverdue} j
                        </Badge>
                        <span className="font-semibold">{eur(o.remaining)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {risk && !risk.configured && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Info className="h-5 w-5 shrink-0" />
            Renseignez votre solde de trésorerie et vos charges fixes ci-dessus, enregistrez, puis relancez
            l'analyse pour obtenir une probabilité de risque.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
