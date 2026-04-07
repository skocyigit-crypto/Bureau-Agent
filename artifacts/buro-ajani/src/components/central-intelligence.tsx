import { useState, useEffect } from "react";
import {
  Brain, AlertTriangle, CheckCircle2, Clock, Phone, MessageSquare,
  Package, Users, ArrowRight, ChevronDown, ChevronUp, X, Loader2,
  Flame, CalendarClock, Info, Copy, ExternalLink, RefreshCw,
  TrendingUp, TrendingDown, Gauge, FileText, Zap
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";

interface CentralIntelligenceData {
  scoreSante: number;
  niveauSante: string;
  briefingMatinal: string;
  urgences: Array<{
    titre: string;
    action: string;
    categorie: string;
    lien: string;
  }>;
  brouillonsReponses: Array<{
    messageId: number;
    expediteur: string;
    categorie: string;
    brouillon: string;
    sujetResume: string;
  }>;
  contactsARelancer: Array<{
    nom: string;
    entreprise: string;
    telephone: string;
    joursDepuisDernierAppel: number;
    raison: string;
    prioriteRelance: string;
  }>;
  alertesStock: Array<{
    article: string;
    quantiteActuelle: number;
    seuilMin: number;
    urgence: string;
    action: string;
  }>;
  metriquesExpress: {
    tauxReponse: string;
    tachesEnRetard: number;
    messagesUrgents: number;
    contactsARelancer: number;
    articlesEnAlerte: number;
  };
  conseilDuJour: string;
}

const CATEGORIE_CONFIG: Record<string, { icon: typeof Flame; color: string; bg: string; label: string }> = {
  CRITIQUE: { icon: Flame, color: "text-red-600", bg: "bg-red-100 border-red-200", label: "Critique" },
  A_PLANIFIER: { icon: CalendarClock, color: "text-amber-600", bg: "bg-amber-100 border-amber-200", label: "A planifier" },
  INFO: { icon: Info, color: "text-blue-600", bg: "bg-blue-100 border-blue-200", label: "Info" },
};

const SANTE_CONFIG: Record<string, { color: string; bg: string; ring: string }> = {
  critique: { color: "text-red-600", bg: "bg-red-500", ring: "ring-red-200" },
  alerte: { color: "text-amber-600", bg: "bg-amber-500", ring: "ring-amber-200" },
  bon: { color: "text-emerald-600", bg: "bg-emerald-500", ring: "ring-emerald-200" },
  excellent: { color: "text-emerald-600", bg: "bg-emerald-500", ring: "ring-emerald-200" },
};

function ScoreGauge({ score, niveau }: { score: number; niveau: string }) {
  const config = SANTE_CONFIG[niveau] || SANTE_CONFIG.bon;
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/20" />
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6" strokeLinecap="round"
          className={config.color}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-xl font-bold ${config.color}`}>{score}</span>
        <span className="text-[9px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

function CategorieTag({ categorie }: { categorie: string }) {
  const cfg = CATEGORIE_CONFIG[categorie] || CATEGORIE_CONFIG.INFO;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[9px] h-5 gap-1 ${cfg.bg} ${cfg.color} border shrink-0`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  );
}

export function CentralIntelligence() {
  const [data, setData] = useState<CentralIntelligenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("urgences");

  useEffect(() => {
    const cached = sessionStorage.getItem("adb_ci_data");
    const cachedTs = sessionStorage.getItem("adb_ci_ts");
    if (cached && cachedTs) {
      const elapsed = Date.now() - parseInt(cachedTs, 10);
      if (elapsed < 15 * 60 * 1000) {
        try {
          setData(JSON.parse(cached));
          return;
        } catch {}
      }
    }
    const timer = setTimeout(() => loadData(), 800);
    return () => clearTimeout(timer);
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = import.meta.env.BASE_URL || "/";
      const resp = await fetch(`${baseUrl}/api/ai/central-intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        if (resp.status === 401) return;
        throw new Error("Erreur serveur");
      }
      const result = await resp.json();
      setData(result);
      sessionStorage.setItem("adb_ci_data", JSON.stringify(result));
      sessionStorage.setItem("adb_ci_ts", Date.now().toString());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyDraft = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading && !data) {
    return (
      <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/30 dark:from-slate-950/50 dark:to-indigo-950/20">
        <CardContent className="p-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">Intelligence Centrale en cours d'analyse...</p>
            <p className="text-[11px] text-muted-foreground">Scan des taches, messages, appels, stock et contacts</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/30 dark:from-slate-950/50 dark:to-indigo-950/20">
        <CardContent className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium">Intelligence Centrale indisponible</p>
              <p className="text-[11px] text-muted-foreground">L'analyse automatique reprendra dans quelques instants</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setError(null); loadData(); }}>
            <RefreshCw className="w-3 h-3 mr-1" />
            Reessayer
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const santeConfig = SANTE_CONFIG[data.niveauSante] || SANTE_CONFIG.bon;
  const critiques = data.urgences.filter(u => u.categorie === "CRITIQUE");
  const aPlanifier = data.urgences.filter(u => u.categorie === "A_PLANIFIER");
  const infos = data.urgences.filter(u => u.categorie === "INFO");
  const m = data.metriquesExpress;

  const tabCounts = {
    urgences: data.urgences.length,
    messages: data.brouillonsReponses.length,
    relances: data.contactsARelancer.length,
    stock: data.alertesStock.length,
  };

  return (
    <Card className="border-slate-200 bg-gradient-to-br from-white to-indigo-50/20 dark:from-slate-950/50 dark:to-indigo-950/10 overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center shadow-lg shadow-indigo-200/50">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                Intelligence Centrale
                <Badge variant="outline" className={`text-[9px] h-4 ${santeConfig.color}`}>
                  {data.niveauSante === "critique" ? "Alerte critique" :
                   data.niveauSante === "alerte" ? "Attention requise" :
                   data.niveauSante === "excellent" ? "Excellent" : "Situation stable"}
                </Badge>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">Briefing automatique en temps reel</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { sessionStorage.removeItem("adb_ci_data"); sessionStorage.removeItem("adb_ci_ts"); loadData(); }} title="Actualiser">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-start gap-4">
          <ScoreGauge score={data.scoreSante} niveau={data.niveauSante} />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "Taux reponse", value: m.tauxReponse, icon: Phone, alert: parseInt(m.tauxReponse) < 80 },
                { label: "Retards", value: String(m.tachesEnRetard), icon: Clock, alert: m.tachesEnRetard > 0 },
                { label: "Msg urgents", value: String(m.messagesUrgents), icon: MessageSquare, alert: m.messagesUrgents > 0 },
                { label: "Relances", value: String(m.contactsARelancer), icon: Users, alert: m.contactsARelancer > 3 },
                { label: "Stock", value: String(m.articlesEnAlerte), icon: Package, alert: m.articlesEnAlerte > 0 },
              ].map((kpi) => (
                <div key={kpi.label} className={`p-2 rounded-lg border text-center ${kpi.alert ? "bg-red-50/50 border-red-200/50" : "bg-white/60 border-slate-100"}`}>
                  <kpi.icon className={`w-3.5 h-3.5 mx-auto mb-1 ${kpi.alert ? "text-red-500" : "text-slate-400"}`} />
                  <p className={`text-sm font-bold ${kpi.alert ? "text-red-600" : ""}`}>{kpi.value}</p>
                  <p className="text-[9px] text-muted-foreground">{kpi.label}</p>
                </div>
              ))}
            </div>
            {data.briefingMatinal && (
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                <p className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">{data.briefingMatinal}</p>
              </div>
            )}
          </div>
        </div>

        {!collapsed && (
          <>
            <Separator />

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-8 w-full">
                <TabsTrigger value="urgences" className="text-[11px] h-6 gap-1">
                  <Flame className="w-3 h-3" /> Actions ({tabCounts.urgences})
                </TabsTrigger>
                <TabsTrigger value="messages" className="text-[11px] h-6 gap-1">
                  <MessageSquare className="w-3 h-3" /> Reponses ({tabCounts.messages})
                </TabsTrigger>
                <TabsTrigger value="relances" className="text-[11px] h-6 gap-1">
                  <Phone className="w-3 h-3" /> Relances ({tabCounts.relances})
                </TabsTrigger>
                <TabsTrigger value="stock" className="text-[11px] h-6 gap-1">
                  <Package className="w-3 h-3" /> Stock ({tabCounts.stock})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="urgences" className="mt-2 space-y-1.5">
                {data.urgences.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Aucune action urgente. Situation sous controle.</p>
                ) : (
                  data.urgences.map((u, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/80 dark:bg-white/5 border text-xs">
                      <CategorieTag categorie={u.categorie} />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{u.titre}</span>
                        <p className="text-muted-foreground mt-0.5">{u.action}</p>
                      </div>
                      {u.lien && (
                        <Link href={u.lien}>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="messages" className="mt-2 space-y-1.5">
                {data.brouillonsReponses.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Aucun message en attente de reponse.</p>
                ) : (
                  data.brouillonsReponses.map((br, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-white/80 dark:bg-white/5 border text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CategorieTag categorie={br.categorie} />
                          <span className="font-medium">{br.expediteur}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{br.sujetResume}</span>
                      </div>
                      <div className="p-2 rounded bg-indigo-50/50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30">
                        <p className="text-[11px] text-indigo-900 dark:text-indigo-200 italic">{br.brouillon}</p>
                      </div>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => handleCopyDraft(br.messageId, br.brouillon)}
                        >
                          {copiedId === br.messageId ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          {copiedId === br.messageId ? "Copie" : "Copier"}
                        </Button>
                        <Link href="/messages">
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1">
                            <ExternalLink className="w-3 h-3" /> Ouvrir
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="relances" className="mt-2 space-y-1.5">
                {data.contactsARelancer.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Aucun contact a relancer pour le moment.</p>
                ) : (
                  data.contactsARelancer.map((c, i) => (
                    <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/80 dark:bg-white/5 border text-xs">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        c.prioriteRelance === "haute" ? "bg-red-100 text-red-600" :
                        c.prioriteRelance === "moyenne" ? "bg-amber-100 text-amber-600" :
                        "bg-blue-100 text-blue-600"
                      }`}>
                        <Phone className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.nom}</span>
                          {c.entreprise !== "N/A" && (
                            <span className="text-[10px] text-muted-foreground">- {c.entreprise}</span>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-0.5">{c.raison}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-muted-foreground">{c.joursDepuisDernierAppel}j sans appel</p>
                        <p className="text-[10px] font-mono">{c.telephone}</p>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="stock" className="mt-2 space-y-1.5">
                {data.alertesStock.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">Aucune alerte stock.</p>
                ) : (
                  data.alertesStock.map((s, i) => (
                    <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-white/80 dark:bg-white/5 border text-xs">
                      <CategorieTag categorie={s.urgence} />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{s.article}</span>
                        <p className="text-muted-foreground mt-0.5">{s.action}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${s.quantiteActuelle <= 0 ? "text-red-600" : s.quantiteActuelle <= s.seuilMin ? "text-amber-600" : ""}`}>
                          {s.quantiteActuelle}/{s.seuilMin}
                        </p>
                        <p className="text-[9px] text-muted-foreground">qte/seuil</p>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>
            </Tabs>

            {data.conseilDuJour && (
              <>
                <Separator />
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-gradient-to-r from-amber-50/50 to-orange-50/30 dark:from-amber-900/10 dark:to-orange-900/10 border border-amber-100/50">
                  <Zap className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-900 dark:text-amber-200">{data.conseilDuJour}</p>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
