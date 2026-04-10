import { useState, useEffect } from "react";
import {
  Brain, User, Plug, Lightbulb, CheckCircle2, AlertCircle, ArrowRight,
  ChevronDown, ChevronUp, Shield, Zap, MessageSquare, X, Loader2,
  Smartphone, Mail, Calendar, HardDrive
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

interface DiscoveryData {
  salutation: string;
  profilStatus: {
    complet: boolean;
    champsManquants: string[];
    conseil: string;
  };
  appsConnectees: {
    count: number;
    resume: string;
    optimisations: string[];
  };
  appsRecommandees: Array<{
    nom: string;
    raison: string;
    priorite: string;
    benefice: string;
  }>;
  habituesTravail: {
    resume: string;
    points_forts: string[];
    axes_amelioration: string[];
  };
  actionsSuggerees: Array<{
    titre: string;
    description: string;
    type: string;
    priorite: string;
    lien: string;
  }>;
  question: string;
}

const TYPE_ICONS: Record<string, typeof Brain> = {
  profil: User,
  integration: Plug,
  productivite: Zap,
  securite: Shield,
};

const PRIORITY_COLORS: Record<string, string> = {
  haute: "bg-red-100 text-red-700 border-red-200",
  moyenne: "bg-amber-100 text-amber-700 border-amber-200",
  basse: "bg-blue-100 text-blue-700 border-blue-200",
};

export function AiDiscoveryPanel() {
  const [data, setData] = useState<DiscoveryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    const sessionKey = "adb_discovery_dismissed";
    if (sessionStorage.getItem(sessionKey) === "true") {
      setDismissed(true);
      return;
    }

    const lastLoad = sessionStorage.getItem("adb_discovery_ts");
    const cached = sessionStorage.getItem("adb_discovery_data");
    if (lastLoad && cached) {
      const elapsed = Date.now() - parseInt(lastLoad, 10);
      if (elapsed < 30 * 60 * 1000) {
        try {
          setData(JSON.parse(cached));
          setHasLoaded(true);
          return;
        } catch (err) { console.warn("[AIDiscovery] failed:", err); }
      }
    }

    const timer = setTimeout(() => loadDiscovery(), 1500);
    return () => clearTimeout(timer);
  }, []);

  const loadDiscovery = async () => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = import.meta.env.BASE_URL || "/";
      const resp = await fetch(`${baseUrl}/api/ai/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error("Erreur serveur");
      const result = await resp.json();
      setData(result);
      setHasLoaded(true);
      sessionStorage.setItem("adb_discovery_data", JSON.stringify(result));
      sessionStorage.setItem("adb_discovery_ts", Date.now().toString());
    } catch (err: any) {
      setError(err.message);
      setHasLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("adb_discovery_dismissed", "true");
  };

  if (dismissed || (!loading && !data && !error && hasLoaded)) return null;

  if (loading && !data) {
    return (
      <Card className="border-indigo-200/50 bg-gradient-to-br from-indigo-50/50 to-purple-50/30 dark:from-indigo-950/20 dark:to-purple-950/10">
        <CardContent className="p-5 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
          <span className="text-sm text-muted-foreground">L'Agent IA analyse votre profil et vos applications...</span>
        </CardContent>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card className="border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/10">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <AlertCircle className="w-4 h-4" />
            <span>La decouverte IA n'a pas pu se charger.</span>
          </div>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={loadDiscovery}>
            Reessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const profilProgress = data.profilStatus?.complet ? 100 :
    Math.max(20, 100 - ((data.profilStatus?.champsManquants?.length || 0) * 20));

  return (
    <Card className="border-indigo-200/50 bg-gradient-to-br from-indigo-50/50 to-purple-50/30 dark:from-indigo-950/20 dark:to-purple-950/10 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm">Agent IA - Decouverte</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Analyse personnalisee de votre espace</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDismiss}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{data.salutation}</p>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-indigo-100 dark:border-indigo-900/30">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-indigo-500" />
              <span className="text-xs font-semibold">Profil</span>
              {data.profilStatus.complet ? (
                <Badge variant="outline" className="text-[9px] h-4 ml-auto bg-emerald-100 text-emerald-700 border-emerald-300">Complet</Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] h-4 ml-auto bg-amber-100 text-amber-700 border-amber-300">Incomplet</Badge>
              )}
            </div>
            <Progress value={profilProgress} className="h-1.5 mb-1.5" />
            {!data.profilStatus.complet && data.profilStatus.champsManquants.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Manquant: {data.profilStatus.champsManquants.join(", ")}
              </p>
            )}
            {data.profilStatus.complet && (
              <p className="text-[10px] text-emerald-600">Tous les champs sont remplis</p>
            )}
          </div>

          <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-indigo-100 dark:border-indigo-900/30">
            <div className="flex items-center gap-2 mb-2">
              <Plug className="w-4 h-4 text-purple-500" />
              <span className="text-xs font-semibold">Applications</span>
              <Badge variant="outline" className="text-[9px] h-4 ml-auto">{data.appsConnectees.count} connectee{data.appsConnectees.count !== 1 ? 's' : ''}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">{data.appsConnectees.resume}</p>
          </div>

          <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-indigo-100 dark:border-indigo-900/30">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-semibold">Activite</span>
            </div>
            <p className="text-[10px] text-muted-foreground">{(data.habituesTravail?.resume || "Analyse en cours...").slice(0, 120)}{(data.habituesTravail?.resume?.length || 0) > 120 ? "..." : ""}</p>
          </div>
        </div>

        {data.appsRecommandees.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-purple-700">
              <Lightbulb className="w-3.5 h-3.5" /> Applications recommandees pour vous
            </h4>
            <div className="grid gap-2 md:grid-cols-2">
              {data.appsRecommandees.slice(0, expanded ? undefined : 2).map((app, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-white/80 dark:bg-white/5 border text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{app.nom}</span>
                    <Badge variant="outline" className={`text-[9px] h-4 ${PRIORITY_COLORS[app.priorite] || ""}`}>
                      {app.priorite === "haute" ? "Recommande" : app.priorite === "moyenne" ? "Utile" : "Optionnel"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{app.raison}</p>
                  <p className="text-purple-600 text-[11px]">{app.benefice}</p>
                </div>
              ))}
            </div>
            {data.appsRecommandees.length > 2 && (
              <Button variant="ghost" size="sm" className="text-[11px] h-7 w-full" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                {expanded ? "Voir moins" : `+${data.appsRecommandees.length - 2} autres recommandations`}
              </Button>
            )}
          </div>
        )}

        {data.actionsSuggerees.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-indigo-700">
              <ArrowRight className="w-3.5 h-3.5" /> Actions suggerees
            </h4>
            <div className="space-y-1.5">
              {data.actionsSuggerees.slice(0, 3).map((action, i) => {
                const Icon = TYPE_ICONS[action.type] || Zap;
                return (
                  <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-white/60 dark:bg-white/5 border text-xs">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      action.type === "securite" ? "bg-red-100 text-red-600" :
                      action.type === "profil" ? "bg-blue-100 text-blue-600" :
                      action.type === "integration" ? "bg-purple-100 text-purple-600" :
                      "bg-amber-100 text-amber-600"
                    }`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{action.titre}</span>
                      <p className="text-[10px] text-muted-foreground truncate">{action.description}</p>
                    </div>
                    <Badge variant="outline" className={`text-[9px] h-4 shrink-0 ${PRIORITY_COLORS[action.priorite] || ""}`}>
                      {action.priorite}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.question && (
          <div className="p-3 rounded-lg bg-gradient-to-r from-indigo-100/50 to-purple-100/50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200/50">
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
              <p className="text-xs text-indigo-800 dark:text-indigo-200">{data.question}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
