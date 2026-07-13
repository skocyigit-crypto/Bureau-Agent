import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { Sparkles, X, ThumbsUp, ThumbsDown, RefreshCw, AlertTriangle, Info, AlertCircle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface Insight {
  id: number;
  category: string;
  severity: "info" | "warn" | "critical";
  title: string;
  message: string;
  actionUrl: string | null;
  actionLabel: string | null;
  vote: number;
  generatedAt: string;
}

const API = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function severityStyles(sev: string) {
  switch (sev) {
    case "critical":
      return { bg: "bg-rose-50 dark:bg-rose-950/20", border: "border-rose-200 dark:border-rose-900/40", text: "text-rose-700 dark:text-rose-400", Icon: AlertTriangle };
    case "warn":
      return { bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-900/40", text: "text-amber-700 dark:text-amber-400", Icon: AlertCircle };
    default:
      return { bg: "bg-sky-50 dark:bg-sky-950/20", border: "border-sky-200 dark:border-sky-900/40", text: "text-sky-700 dark:text-sky-400", Icon: Info };
  }
}

export function AiSpot() {
  const { toast } = useToast();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/ai-insights`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setInsights(Array.isArray(data?.insights) ? data.insights : []);
    } catch {
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismiss = async (id: number) => {
    setInsights(curr => curr.filter(i => i.id !== id));
    try {
      const r = await fetch(`${API}/api/ai-insights/${id}/dismiss`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error();
    } catch {
      toast({ title: "Erreur", description: "Impossible de masquer.", variant: "destructive" });
      load();
    }
  };

  const vote = async (id: number, value: 1 | -1) => {
    setInsights(curr => curr.map(i => i.id === id ? { ...i, vote: value } : i));
    try {
      const r = await fetch(`${API}/api/ai-insights/${id}/vote`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!r.ok) throw new Error();
    } catch {
      load();
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const r = await fetch(`${API}/api/ai-insights/regenerate`, { method: "POST", credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({ title: "Patientez", description: data?.error || "Reessayez plus tard.", variant: r.status === 429 ? "default" : "destructive" });
      } else {
        toast({ title: "Insights actualises", description: `${data?.generated ?? 0} suggestion(s) generee(s).` });
        await load();
      }
    } catch {
      toast({ title: "Erreur", description: "Echec de la regeneration.", variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-violet-200/60 dark:border-violet-900/40 bg-gradient-to-br from-violet-50/50 to-indigo-50/30 dark:from-violet-950/20 dark:to-indigo-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-600" />AI Spot</CardTitle>
          <CardDescription className="text-xs">Analyse en cours...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (insights.length === 0) {
    return (
      <Card className="border-violet-200/60 dark:border-violet-900/40 bg-gradient-to-br from-violet-50/50 to-indigo-50/30 dark:from-violet-950/20 dark:to-indigo-950/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-600" />AI Spot</CardTitle>
              <CardDescription className="text-xs">Aucune alerte. Tout est sous controle.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={regenerate} disabled={regenerating} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
              <span className="text-xs">Actualiser</span>
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-violet-200/60 dark:border-violet-900/40 bg-gradient-to-br from-violet-50/50 to-indigo-50/30 dark:from-violet-950/20 dark:to-indigo-950/10 premium-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-violet-100 dark:bg-violet-900/40">
              <Sparkles className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <CardTitle className="text-base">AI Spot</CardTitle>
              <CardDescription className="text-xs">Suggestions proactives prioritaires</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">{insights.length}</Badge>
            <Button variant="ghost" size="sm" onClick={regenerate} disabled={regenerating} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
              <span className="text-xs hidden sm:inline">Actualiser</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map(insight => {
          const s = severityStyles(insight.severity);
          const Body = (
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${s.bg} ${s.border} transition-colors hover:shadow-sm`}>
              <s.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.text}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-semibold ${s.text} truncate`}>{insight.title}</p>
                  <Badge variant="outline" className="text-[10px] uppercase">{insight.category}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{insight.message}</p>
                {insight.actionUrl && insight.actionLabel && (
                  <span className={`inline-flex items-center gap-1 mt-2 text-xs font-medium ${s.text} hover:underline`}>
                    {insight.actionLabel} <ArrowRight className="w-3 h-3" />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost" size="icon"
                  className={`h-7 w-7 ${insight.vote === 1 ? "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40" : "text-muted-foreground"}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); vote(insight.id, 1); }}
                  title="Utile"
                ><ThumbsUp className="w-3.5 h-3.5" /></Button>
                <Button
                  variant="ghost" size="icon"
                  className={`h-7 w-7 ${insight.vote === -1 ? "text-rose-600 bg-rose-100 dark:bg-rose-900/40" : "text-muted-foreground"}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); vote(insight.id, -1); }}
                  title="Pas utile"
                ><ThumbsDown className="w-3.5 h-3.5" /></Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(insight.id); }}
                  title="Masquer"
                ><X className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          );
          return insight.actionUrl ? (
            <Link key={insight.id} href={insight.actionUrl}>{Body}</Link>
          ) : (
            <div key={insight.id}>{Body}</div>
          );
        })}
      </CardContent>
    </Card>
  );
}
