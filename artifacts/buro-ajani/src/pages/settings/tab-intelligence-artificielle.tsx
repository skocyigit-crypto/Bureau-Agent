import { useState, useEffect } from "react";
import { Bot, Zap, DollarSign, Phone, RotateCcw, Save, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

export function TabIntelligenceArtificielle() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AiSettings>({ aiQuotaCostUsd: null, aiQuotaCalls: null, aiAgentName: null });
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [agentName, setAgentName] = useState("");
  const [quotaCost, setQuotaCost] = useState("");
  const [quotaCalls, setQuotaCalls] = useState("");

  useEffect(() => {
    loadData();
  }, []);

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
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, any> = {};

      const trimmedName = agentName.trim();
      body.aiAgentName = trimmedName || null;

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
                    <span className={quota.percentCost >= 90 ? "text-red-500 font-bold" : quota.percentCost >= 70 ? "text-amber-500 font-semibold" : ""}>
                      {quota.used.costUsd.toFixed(3)} USD
                    </span>
                    <span className="text-muted-foreground"> / {quota.limits.maxCostUsdPerMonth} USD</span>
                  </span>
                </div>
                <Progress
                  value={quota.percentCost}
                  className={`h-2 ${quota.percentCost >= 90 ? "[&>div]:bg-red-500" : quota.percentCost >= 70 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
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
                    <span className={quota.percentCalls >= 90 ? "text-red-500 font-bold" : quota.percentCalls >= 70 ? "text-amber-500 font-semibold" : ""}>
                      {quota.used.calls.toLocaleString("fr-FR")}
                    </span>
                    <span className="text-muted-foreground"> / {quota.limits.maxCallsPerMonth.toLocaleString("fr-FR")}</span>
                  </span>
                </div>
                <Progress
                  value={quota.percentCalls}
                  className={`h-2 ${quota.percentCalls >= 90 ? "[&>div]:bg-red-500" : quota.percentCalls >= 70 ? "[&>div]:bg-amber-500" : "[&>div]:bg-blue-500"}`}
                />
                <p className="text-xs text-muted-foreground">{quota.percentCalls.toFixed(1)}% du quota mensuel utilise</p>
              </div>
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
