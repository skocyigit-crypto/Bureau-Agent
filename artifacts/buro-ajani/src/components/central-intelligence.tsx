import { useState, useEffect } from "react";
import {
  Brain, AlertTriangle, CheckCircle2, Clock, Phone, MessageSquare,
  Package, Users, ArrowRight, ChevronDown, ChevronUp, Loader2,
  Flame, CalendarClock, Info, Copy, ExternalLink, RefreshCw,
  Zap, Shield, Target, Crosshair, FileText, TrendingUp,
  CircleAlert, Siren, BarChart3, ClipboardCheck, Send
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";

interface Resolution {
  probleme: string;
  solution: string;
  categorie: string;
  module: string;
  lien: string;
  actionType: string;
}

interface BrouillonReponse {
  messageId: number | null;
  expediteur: string;
  eisenhower: string;
  brouillon: string;
  sujetResume: string;
  actionSuggestion: string;
}

interface FicheRappel {
  contact: string;
  motif: string;
  priorite: string;
  scriptAppel: string;
  lien: string;
}

interface RelanceStrategique {
  nom: string;
  entreprise: string;
  telephone: string;
  joursDepuisDernierAppel: number;
  potentiel: string;
  scriptRelance: string;
  prioriteRelance: string;
}

interface AlerteStock {
  article: string;
  quantiteActuelle: number;
  seuilMin: number;
  urgence: string;
  action: string;
  rupturePrevue48h: boolean;
  bonCommande: string;
}

interface OptimisationPlanning {
  constat: string;
  suggestion: string;
}

interface CentralIntelligenceData {
  scoreSante: number;
  niveauSante: string;
  modeCommando: boolean;
  briefingExecutif: string;
  resolutions: Resolution[];
  brouillonsReponses: BrouillonReponse[];
  fichesRappel: FicheRappel[];
  relancesStrategiques: RelanceStrategique[];
  alertesStock: AlerteStock[];
  optimisationsPlanning: OptimisationPlanning[];
  metriquesExpress: {
    tauxReponse: string;
    tachesEnRetard: number;
    messagesUrgents: number;
    contactsARelancer: number;
    articlesEnAlerte: number;
  };
  directiveStrategique: string;
}

const CATEGORIE_CONFIG: Record<string, { icon: typeof Flame; color: string; bg: string; border: string; label: string }> = {
  CRITIQUE: { icon: Flame, color: "text-red-600", bg: "bg-red-50", border: "border-red-200", label: "Critique" },
  A_PLANIFIER: { icon: CalendarClock, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", label: "A planifier" },
  INFO: { icon: Info, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", label: "Info" },
};

const EISENHOWER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  urgent_important: { label: "Urgent + Important", color: "text-red-700", bg: "bg-red-100 border-red-300" },
  urgent: { label: "Urgent", color: "text-amber-700", bg: "bg-amber-100 border-amber-300" },
  important: { label: "Important", color: "text-blue-700", bg: "bg-blue-100 border-blue-300" },
  info: { label: "Information", color: "text-slate-600", bg: "bg-slate-100 border-slate-300" },
};

const MODULE_CONFIG: Record<string, { icon: typeof Shield; label: string; color: string }> = {
  reconnaissance: { icon: Crosshair, label: "Reconnaissance", color: "text-red-500" },
  communication: { icon: MessageSquare, label: "Communication", color: "text-blue-500" },
  logistique: { icon: Package, label: "Logistique", color: "text-emerald-500" },
};

const SANTE_CONFIG: Record<string, { color: string; stroke: string; bg: string; textColor: string }> = {
  critique: { color: "text-red-600", stroke: "stroke-red-500", bg: "bg-red-500", textColor: "text-red-50" },
  alerte: { color: "text-orange-600", stroke: "stroke-orange-500", bg: "bg-orange-500", textColor: "text-orange-50" },
  vigilance: { color: "text-amber-600", stroke: "stroke-amber-500", bg: "bg-amber-500", textColor: "text-amber-50" },
  bon: { color: "text-emerald-600", stroke: "stroke-emerald-500", bg: "bg-emerald-500", textColor: "text-emerald-50" },
  excellent: { color: "text-emerald-600", stroke: "stroke-emerald-500", bg: "bg-emerald-500", textColor: "text-emerald-50" },
};

function ScoreGauge({ score, niveau, commando }: { score: number; niveau: string; commando: boolean }) {
  const config = SANTE_CONFIG[niveau] || SANTE_CONFIG.bon;
  const circumference = 2 * Math.PI * 44;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/15" />
        <circle cx="50" cy="50" r="44" fill="none" strokeWidth="5" strokeLinecap="round"
          className={config.stroke}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-black ${config.color}`}>{score}</span>
        <span className="text-[9px] text-muted-foreground font-medium">/100</span>
      </div>
      {commando && (
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center animate-pulse shadow-lg shadow-red-300">
          <Siren className="w-3.5 h-3.5 text-white" />
        </div>
      )}
    </div>
  );
}

function CategorieTag({ categorie }: { categorie: string }) {
  const cfg = CATEGORIE_CONFIG[categorie] || CATEGORIE_CONFIG.INFO;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[9px] h-5 gap-1 ${cfg.bg} ${cfg.color} ${cfg.border} border shrink-0`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  );
}

function EisenhowerTag({ eisenhower }: { eisenhower: string }) {
  const cfg = EISENHOWER_CONFIG[eisenhower] || EISENHOWER_CONFIG.info;
  return (
    <Badge variant="outline" className={`text-[9px] h-5 gap-0.5 ${cfg.bg} ${cfg.color} border shrink-0`}>
      {cfg.label}
    </Badge>
  );
}

function ActionButton({ type, lien, text, onCopy }: { type: string; lien: string; text?: string; onCopy?: () => void }) {
  if (type === "copier" && onCopy) {
    return (
      <Button variant="default" size="sm" className="h-7 text-[10px] gap-1 bg-indigo-600 hover:bg-indigo-700" onClick={onCopy}>
        <ClipboardCheck className="w-3 h-3" /> Valider
      </Button>
    );
  }
  return (
    <Link href={lien}>
      <Button variant="default" size="sm" className="h-7 text-[10px] gap-1 bg-indigo-600 hover:bg-indigo-700">
        <ArrowRight className="w-3 h-3" /> {type === "valider" ? "Valider" : "Traiter"}
      </Button>
    </Link>
  );
}

export function CentralIntelligence() {
  const [data, setData] = useState<CentralIntelligenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("resolutions");

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

  const handleCopy = (id: number | null, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading && !data) {
    return (
      <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/30">
        <CardContent className="p-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">Assistant Executif en analyse...</p>
            <p className="text-[11px] text-muted-foreground">Scan complet : taches, messages, appels, stock, contacts, planning</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card className="border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/30">
        <CardContent className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium">Assistant Executif indisponible</p>
              <p className="text-[11px] text-muted-foreground">L'analyse reprendra dans quelques instants</p>
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

  const config = SANTE_CONFIG[data.niveauSante] || SANTE_CONFIG.bon;
  const m = data.metriquesExpress;
  const critiques = data.resolutions.filter(r => r.categorie === "CRITIQUE");
  const aPlanifier = data.resolutions.filter(r => r.categorie === "A_PLANIFIER");
  const infos = data.resolutions.filter(r => r.categorie === "INFO");

  const tabCounts = {
    resolutions: data.resolutions.length,
    messages: data.brouillonsReponses.length,
    appels: data.fichesRappel.length + data.relancesStrategiques.length,
    stock: data.alertesStock.length + data.optimisationsPlanning.length,
  };

  return (
    <Card className={`overflow-hidden ${data.modeCommando ? "border-red-300 bg-gradient-to-br from-red-50/30 to-white" : "border-slate-200 bg-gradient-to-br from-white to-indigo-50/20"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${data.modeCommando ? "bg-gradient-to-br from-red-600 to-red-800 shadow-red-200/50" : "bg-gradient-to-br from-indigo-600 to-purple-700 shadow-indigo-200/50"}`}>
              {data.modeCommando ? <Siren className="w-5 h-5 text-white" /> : <Brain className="w-5 h-5 text-white" />}
            </div>
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                Assistant Executif
                {data.modeCommando && (
                  <Badge className="text-[9px] h-4 bg-red-600 text-white border-0 animate-pulse">
                    Mode Commando
                  </Badge>
                )}
                <Badge variant="outline" className={`text-[9px] h-4 ${config.color}`}>
                  {data.niveauSante === "critique" ? "Etat critique" :
                   data.niveauSante === "alerte" ? "Alerte active" :
                   data.niveauSante === "vigilance" ? "Vigilance" :
                   data.niveauSante === "excellent" ? "Situation optimale" : "Sous controle"}
                </Badge>
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.modeCommando ? "Interventions prioritaires en cours" : "Briefing executif en temps reel"}
              </p>
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
          <ScoreGauge score={data.scoreSante} niveau={data.niveauSante} commando={data.modeCommando} />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "Taux reponse", value: m.tauxReponse, icon: Phone, alert: parseInt(m.tauxReponse) < 80 },
                { label: "Retards", value: String(m.tachesEnRetard), icon: Clock, alert: m.tachesEnRetard > 0 },
                { label: "Msg urgents", value: String(m.messagesUrgents), icon: MessageSquare, alert: m.messagesUrgents > 0 },
                { label: "Relances", value: String(m.contactsARelancer), icon: Users, alert: m.contactsARelancer > 3 },
                { label: "Stock", value: String(m.articlesEnAlerte), icon: Package, alert: m.articlesEnAlerte > 0 },
              ].map((kpi) => (
                <div key={kpi.label} className={`p-2 rounded-lg border text-center ${kpi.alert ? "bg-red-50/70 border-red-200/60" : "bg-white/60 border-slate-100"}`}>
                  <kpi.icon className={`w-3.5 h-3.5 mx-auto mb-1 ${kpi.alert ? "text-red-500" : "text-slate-400"}`} />
                  <p className={`text-sm font-bold ${kpi.alert ? "text-red-600" : ""}`}>{kpi.value}</p>
                  <p className="text-[9px] text-muted-foreground">{kpi.label}</p>
                </div>
              ))}
            </div>
            {data.briefingExecutif && (
              <div className={`p-2.5 rounded-lg border ${data.modeCommando ? "bg-red-50/50 border-red-200/50" : "bg-slate-50 border-slate-100"}`}>
                <p className="text-[11px] text-slate-700 whitespace-pre-line leading-relaxed font-medium">{data.briefingExecutif}</p>
              </div>
            )}
          </div>
        </div>

        {!collapsed && (
          <>
            <Separator />

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-8 w-full">
                <TabsTrigger value="resolutions" className="text-[11px] h-6 gap-1">
                  <Target className="w-3 h-3" /> Resolutions ({tabCounts.resolutions})
                </TabsTrigger>
                <TabsTrigger value="messages" className="text-[11px] h-6 gap-1">
                  <MessageSquare className="w-3 h-3" /> Reponses ({tabCounts.messages})
                </TabsTrigger>
                <TabsTrigger value="appels" className="text-[11px] h-6 gap-1">
                  <Phone className="w-3 h-3" /> Appels ({tabCounts.appels})
                </TabsTrigger>
                <TabsTrigger value="stock" className="text-[11px] h-6 gap-1">
                  <Package className="w-3 h-3" /> Logistique ({tabCounts.stock})
                </TabsTrigger>
              </TabsList>

              {/* === MODULE 1: RESOLUTIONS (GESTION DE CRISE) === */}
              <TabsContent value="resolutions" className="mt-2 space-y-1.5">
                {data.resolutions.length === 0 ? (
                  <div className="text-center py-4">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400 mb-1" />
                    <p className="text-xs text-muted-foreground">Zero probleme detecte. Situation optimale.</p>
                  </div>
                ) : (
                  <>
                    {critiques.length > 0 && (
                      <div className="space-y-1.5">
                        {critiques.map((r, i) => (
                          <ResolutionCard key={`c-${i}`} resolution={r} onCopy={() => handleCopy(i, r.solution)} />
                        ))}
                      </div>
                    )}
                    {aPlanifier.length > 0 && (
                      <div className="space-y-1.5">
                        {aPlanifier.map((r, i) => (
                          <ResolutionCard key={`p-${i}`} resolution={r} onCopy={() => handleCopy(100 + i, r.solution)} />
                        ))}
                      </div>
                    )}
                    {infos.length > 0 && (
                      <div className="space-y-1.5">
                        {infos.map((r, i) => (
                          <ResolutionCard key={`i-${i}`} resolution={r} onCopy={() => handleCopy(200 + i, r.solution)} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              {/* === MODULE 2: COMMUNICATION & CONTACTS === */}
              <TabsContent value="messages" className="mt-2 space-y-1.5">
                {data.brouillonsReponses.length === 0 ? (
                  <div className="text-center py-4">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400 mb-1" />
                    <p className="text-xs text-muted-foreground">Aucun message en attente.</p>
                  </div>
                ) : (
                  data.brouillonsReponses.map((br, i) => (
                    <div key={i} className="p-3 rounded-lg bg-white/80 border text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <EisenhowerTag eisenhower={br.eisenhower} />
                          <span className="font-semibold text-slate-800">{br.expediteur}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground italic">{br.sujetResume}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-indigo-50/60 border border-indigo-100">
                        <p className="text-[11px] text-indigo-900 leading-relaxed">{br.brouillon}</p>
                      </div>
                      {br.actionSuggestion && (
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          Apres envoi : {br.actionSuggestion}
                        </p>
                      )}
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => handleCopy(br.messageId, br.brouillon)}
                        >
                          {copiedId === br.messageId ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          {copiedId === br.messageId ? "Copie" : "Copier"}
                        </Button>
                        <Link href="/messages">
                          <Button variant="default" size="sm" className="h-6 text-[10px] gap-1 bg-indigo-600 hover:bg-indigo-700">
                            <Send className="w-3 h-3" /> Envoyer
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

              {/* === MODULE : APPELS (FICHES RAPPEL + RELANCES STRATEGIQUES) === */}
              <TabsContent value="appels" className="mt-2 space-y-3">
                {data.fichesRappel.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <CircleAlert className="w-3 h-3" /> Fiches de rappel
                    </p>
                    {data.fichesRappel.map((f, i) => (
                      <div key={i} className="p-3 rounded-lg bg-white/80 border text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              f.priorite === "haute" ? "bg-red-100 text-red-600" :
                              f.priorite === "moyenne" ? "bg-amber-100 text-amber-600" :
                              "bg-blue-100 text-blue-600"
                            }`}>
                              <Phone className="w-3.5 h-3.5" />
                            </div>
                            <span className="font-semibold">{f.contact}</span>
                          </div>
                          <Badge variant="outline" className={`text-[9px] h-5 ${
                            f.priorite === "haute" ? "bg-red-50 text-red-600 border-red-200" :
                            f.priorite === "moyenne" ? "bg-amber-50 text-amber-600 border-amber-200" :
                            "bg-blue-50 text-blue-600 border-blue-200"
                          }`}>
                            {f.priorite}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">{f.motif}</p>
                        {f.scriptAppel && (
                          <div className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100">
                            <p className="text-[10px] text-emerald-800 italic">"{f.scriptAppel}"</p>
                          </div>
                        )}
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => handleCopy(300 + i, f.scriptAppel)}>
                            {copiedId === 300 + i ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            Script
                          </Button>
                          <Link href="/appels">
                            <Button variant="default" size="sm" className="h-6 text-[10px] gap-1 bg-indigo-600 hover:bg-indigo-700">
                              <Phone className="w-3 h-3" /> Rappeler
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {data.relancesStrategiques.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Target className="w-3 h-3" /> Relances strategiques
                    </p>
                    {data.relancesStrategiques.map((c, i) => (
                      <div key={i} className="p-3 rounded-lg bg-white/80 border text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              c.prioriteRelance === "haute" ? "bg-red-100 text-red-600" :
                              c.prioriteRelance === "moyenne" ? "bg-amber-100 text-amber-600" :
                              "bg-blue-100 text-blue-600"
                            }`}>
                              <Users className="w-3.5 h-3.5" />
                            </div>
                            <div>
                              <span className="font-semibold">{c.nom}</span>
                              {c.entreprise !== "N/A" && (
                                <span className="text-muted-foreground ml-1">- {c.entreprise}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-muted-foreground">{c.joursDepuisDernierAppel}j sans contact</p>
                          </div>
                        </div>
                        <p className="text-muted-foreground">{c.potentiel}</p>
                        {c.scriptRelance && (
                          <div className="p-2 rounded-lg bg-blue-50/60 border border-blue-100">
                            <p className="text-[10px] text-blue-800 italic">"{c.scriptRelance}"</p>
                          </div>
                        )}
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => handleCopy(400 + i, c.scriptRelance)}>
                            {copiedId === 400 + i ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            Script
                          </Button>
                          <Link href="/contacts">
                            <Button variant="default" size="sm" className="h-6 text-[10px] gap-1 bg-indigo-600 hover:bg-indigo-700">
                              <Phone className="w-3 h-3" /> Appeler
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {data.fichesRappel.length === 0 && data.relancesStrategiques.length === 0 && (
                  <div className="text-center py-4">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400 mb-1" />
                    <p className="text-xs text-muted-foreground">Aucun appel a traiter.</p>
                  </div>
                )}
              </TabsContent>

              {/* === MODULE 3: LOGISTIQUE & STOCK === */}
              <TabsContent value="stock" className="mt-2 space-y-3">
                {data.alertesStock.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Package className="w-3 h-3" /> Alertes stock
                    </p>
                    {data.alertesStock.map((s, i) => (
                      <div key={i} className={`p-3 rounded-lg border text-xs space-y-1.5 ${s.rupturePrevue48h ? "bg-red-50/50 border-red-200" : "bg-white/80"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CategorieTag categorie={s.urgence} />
                            <span className="font-semibold">{s.article}</span>
                            {s.rupturePrevue48h && (
                              <Badge className="text-[9px] h-4 bg-red-600 text-white border-0">
                                Rupture 48h
                              </Badge>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-bold ${s.quantiteActuelle <= 0 ? "text-red-600" : s.quantiteActuelle <= s.seuilMin ? "text-amber-600" : ""}`}>
                              {s.quantiteActuelle}/{s.seuilMin}
                            </p>
                            <p className="text-[9px] text-muted-foreground">qte/seuil</p>
                          </div>
                        </div>
                        <p className="text-muted-foreground">{s.action}</p>
                        {s.bonCommande && (
                          <div className="p-2 rounded-lg bg-amber-50/60 border border-amber-100">
                            <p className="text-[10px] font-medium text-amber-800 flex items-center gap-1 mb-1">
                              <FileText className="w-3 h-3" /> Bon de commande :
                            </p>
                            <p className="text-[10px] text-amber-700">{s.bonCommande}</p>
                          </div>
                        )}
                        <div className="flex justify-end gap-1.5">
                          {s.bonCommande && (
                            <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={() => handleCopy(500 + i, s.bonCommande)}>
                              {copiedId === 500 + i ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              Copier BC
                            </Button>
                          )}
                          <Link href="/stock">
                            <Button variant="default" size="sm" className="h-6 text-[10px] gap-1 bg-indigo-600 hover:bg-indigo-700">
                              <ArrowRight className="w-3 h-3" /> Gerer
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {data.optimisationsPlanning.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <BarChart3 className="w-3 h-3" /> Optimisations planning
                    </p>
                    {data.optimisationsPlanning.map((o, i) => (
                      <div key={i} className="p-3 rounded-lg bg-white/80 border text-xs">
                        <p className="font-medium text-slate-700">{o.constat}</p>
                        <p className="text-emerald-700 mt-1 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 shrink-0" />
                          {o.suggestion}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {data.alertesStock.length === 0 && data.optimisationsPlanning.length === 0 && (
                  <div className="text-center py-4">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-400 mb-1" />
                    <p className="text-xs text-muted-foreground">Stock et planning sous controle.</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {data.directiveStrategique && (
              <>
                <Separator />
                <div className={`flex items-start gap-2 p-3 rounded-lg border ${data.modeCommando ? "bg-gradient-to-r from-red-50/50 to-amber-50/30 border-red-200/50" : "bg-gradient-to-r from-amber-50/50 to-orange-50/30 border-amber-100/50"}`}>
                  <Zap className={`w-4 h-4 mt-0.5 shrink-0 ${data.modeCommando ? "text-red-500" : "text-amber-500"}`} />
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Directive strategique</p>
                    <p className={`text-xs font-medium ${data.modeCommando ? "text-red-800" : "text-amber-900"}`}>{data.directiveStrategique}</p>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ResolutionCard({ resolution, onCopy }: { resolution: Resolution; onCopy: () => void }) {
  const modCfg = MODULE_CONFIG[resolution.module] || MODULE_CONFIG.reconnaissance;
  const ModIcon = modCfg.icon;

  return (
    <div className="p-3 rounded-lg bg-white/80 border text-xs space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CategorieTag categorie={resolution.categorie} />
          <ModIcon className={`w-3.5 h-3.5 shrink-0 ${modCfg.color}`} />
        </div>
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-slate-800">{resolution.probleme}</p>
        <div className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100">
          <p className="text-[11px] text-emerald-800">{resolution.solution}</p>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        {resolution.actionType === "copier" && (
          <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={onCopy}>
            <Copy className="w-3 h-3" /> Copier
          </Button>
        )}
        <ActionButton type={resolution.actionType} lien={resolution.lien} onCopy={onCopy} />
      </div>
    </div>
  );
}
