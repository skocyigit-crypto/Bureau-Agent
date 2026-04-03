import { useState } from "react";
import {
  Brain, Crown, Phone, Users, ClipboardList, Mail, Clock, Shield, TrendingUp,
  Play, Loader2, AlertCircle, AlertTriangle, Lightbulb, CheckCircle2, RefreshCw,
  ChevronDown, ChevronUp, Zap, Target, ArrowRight, Settings, Power, PowerOff,
  Activity, BarChart3, FileText
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  useRunAllAiAgents, useGetLatestAiAgentReports, useGetAiAgentReports,
  useStartAiAgentsAutoRun, useStopAiAgentsAutoRun, useGetAiAgentsConfig,
  useRunSingleAiAgent
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const AGENT_ICONS: Record<string, any> = {
  phone: Phone, users: Users, clipboard: ClipboardList, mail: Mail,
  clock: Clock, shield: Shield, "trending-up": TrendingUp, crown: Crown,
  brain: Brain,
};

function getScoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-destructive";
}

function getScoreBg(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-destructive";
}

function getScoreLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Tres bien";
  if (score >= 70) return "Bien";
  if (score >= 60) return "Acceptable";
  if (score >= 40) return "A ameliorer";
  return "Critique";
}

function getSeverityBadge(severity: string) {
  switch (severity) {
    case "critique": return <Badge variant="destructive" className="text-[10px] h-5">Critique</Badge>;
    case "haute": return <Badge className="text-[10px] h-5 bg-orange-500 hover:bg-orange-600">Haute</Badge>;
    case "moyenne": return <Badge variant="secondary" className="text-[10px] h-5 bg-amber-100 text-amber-700">Moyenne</Badge>;
    case "basse": return <Badge variant="secondary" className="text-[10px] h-5">Basse</Badge>;
    default: return <Badge variant="outline" className="text-[10px] h-5">{severity}</Badge>;
  }
}

function AgentScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={4} className="text-muted/30" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={4}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className={getScoreColor(score)} style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-lg font-bold ${getScoreColor(score)}`}>{score}</span>
      </div>
    </div>
  );
}

function AgentCard({ report, onRunAgent }: { report: any; onRunAgent?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const IconComponent = AGENT_ICONS[report.agentIcon] || Brain;

  return (
    <Card className={`transition-all ${report.isSuperReport ? 'border-purple-300 dark:border-purple-700 bg-gradient-to-br from-purple-50/30 to-indigo-50/20 dark:from-purple-950/10 dark:to-indigo-950/5' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${report.isSuperReport ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white' : 'bg-muted'}`}>
              <IconComponent className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-sm">{report.agentName}</CardTitle>
              <CardDescription className="text-xs">{report.reportDate}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AgentScoreRing score={report.score} size={52} />
            {onRunAgent && !report.isSuperReport && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRunAgent(report.agentId)}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{(() => {
          const s = report.summary;
          if (typeof s === "string" && s.trim().startsWith("{")) {
            try {
              const parsed = JSON.parse(s);
              return parsed.summary || s;
            } catch { return s; }
          }
          return s;
        })()}</p>

        <div className="flex items-center gap-3 text-xs">
          {report.errorsFound > 0 && (
            <div className="flex items-center gap-1 text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{report.errorsFound} erreur{report.errorsFound > 1 ? 's' : ''}</span>
            </div>
          )}
          {report.warningsFound > 0 && (
            <div className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{report.warningsFound} alerte{report.warningsFound > 1 ? 's' : ''}</span>
            </div>
          )}
          {report.suggestionsCount > 0 && (
            <div className="flex items-center gap-1 text-blue-600">
              <Lightbulb className="w-3.5 h-3.5" />
              <span>{report.suggestionsCount} suggestion{report.suggestionsCount > 1 ? 's' : ''}</span>
            </div>
          )}
          {report.errorsFound === 0 && report.warningsFound === 0 && (
            <div className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Aucun probleme detecte</span>
            </div>
          )}
        </div>

        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 mr-1" /> : <ChevronDown className="w-3.5 h-3.5 mr-1" />}
          {expanded ? "Masquer les details" : "Voir les details"}
        </Button>

        {expanded && (
          <div className="space-y-4 pt-2">
            {report.errors && (report.errors as any[]).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> Erreurs detectees
                </h4>
                {(report.errors as any[]).map((e: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-destructive/5 border border-destructive/10 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-destructive">{e.titre}</span>
                      {e.severity && getSeverityBadge(e.severity)}
                    </div>
                    <p className="text-muted-foreground">{e.description}</p>
                    {e.action && (
                      <p className="text-foreground flex items-center gap-1 mt-1">
                        <ArrowRight className="w-3 h-3 text-destructive shrink-0" /> {e.action}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {report.warnings && (report.warnings as any[]).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Alertes
                </h4>
                {(report.warnings as any[]).map((w: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 text-xs space-y-1">
                    <span className="font-medium text-amber-700">{w.titre}</span>
                    <p className="text-muted-foreground">{w.description}</p>
                    {w.impact && <p className="text-amber-600 text-[11px]">Impact: {w.impact}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.suggestions && (report.suggestions as any[]).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-blue-600 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" /> Suggestions
                </h4>
                {(report.suggestions as any[]).map((s: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-blue-700">{s.titre}</span>
                      {s.priorite && getSeverityBadge(s.priorite)}
                    </div>
                    <p className="text-muted-foreground">{s.description}</p>
                    {s.benefice && <p className="text-blue-600 text-[11px]">Benefice: {s.benefice}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.corrections && (report.corrections as any[]).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-purple-600 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> Corrections a appliquer
                </h4>
                {(report.corrections as any[]).map((c: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-purple-700">{c.element}</span>
                      {c.urgence && getSeverityBadge(c.urgence)}
                    </div>
                    <p className="text-muted-foreground">Probleme: {c.probleme}</p>
                    <p className="text-foreground flex items-center gap-1">
                      <Target className="w-3 h-3 text-purple-500 shrink-0" /> {c.solution}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).actionPlan && (report.details as any).actionPlan.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-indigo-600 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" /> Plan d'action
                </h4>
                {((report.details as any).actionPlan as any[]).map((a: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200/50 text-xs">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                      {a.etape || i + 1}
                    </div>
                    <div className="space-y-0.5">
                      <span className="font-medium">{a.action}</span>
                      {a.responsable && <p className="text-muted-foreground">Responsable: {a.responsable}</p>}
                      {a.delai && <p className="text-indigo-600">Delai: {a.delai}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).crossAnalysis && (report.details as any).crossAnalysis.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-teal-600 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" /> Analyse transversale
                </h4>
                {((report.details as any).crossAnalysis as any[]).map((c: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/20 border border-teal-200/50 text-xs space-y-1">
                    <p className="text-foreground">{c.observation}</p>
                    {c.agentsConcernes && <p className="text-teal-600">Agents: {c.agentsConcernes.join(", ")}</p>}
                    {c.recommandation && <p className="font-medium text-teal-700">{c.recommandation}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.executionTimeMs > 0 && (
              <p className="text-[10px] text-muted-foreground text-right">
                Execute en {(report.executionTimeMs / 1000).toFixed(1)}s
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AiAgentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("dashboard");

  const runAll = useRunAllAiAgents();
  const runSingle = useRunSingleAiAgent();
  const startAuto = useStartAiAgentsAutoRun();
  const stopAuto = useStopAiAgentsAutoRun();

  const { data: latestReports, isLoading: loadingLatest, isError: errorLatest } = useGetLatestAiAgentReports();
  const { data: config } = useGetAiAgentsConfig();
  const { data: allReports, isLoading: loadingHistory } = useGetAiAgentReports();

  const invalidateAgentQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/ai/agents");
      }
    });
  };

  const handleRunAll = () => {
    runAll.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Analyse terminee", description: "Tous les agents IA ont termine leur analyse." });
        invalidateAgentQueries();
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'executer les agents IA.", variant: "destructive" });
      }
    });
  };

  const handleRunSingle = (agentId: string) => {
    runSingle.mutate({ agentId }, {
      onSuccess: () => {
        toast({ title: "Agent termine", description: "L'analyse de l'agent est terminee." });
        invalidateAgentQueries();
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'executer cet agent.", variant: "destructive" });
      }
    });
  };

  const handleStartAuto = () => {
    startAuto.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Execution automatique activee", description: "Les agents s'executeront toutes les 2 heures." });
        invalidateAgentQueries();
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'activer l'execution automatique.", variant: "destructive" });
      }
    });
  };

  const handleStopAuto = () => {
    stopAuto.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Execution automatique arretee" });
        invalidateAgentQueries();
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'arreter l'execution automatique.", variant: "destructive" });
      }
    });
  };

  const latestMap = (latestReports || {}) as Record<string, any>;
  const superReport = latestMap["super_agent"];
  const agentReports = Object.values(latestMap).filter((r: any) => !r.isSuperReport);
  const totalErrors = agentReports.reduce((acc: number, r: any) => acc + (r.errorsFound || 0), 0);
  const totalWarnings = agentReports.reduce((acc: number, r: any) => acc + (r.warningsFound || 0), 0);
  const totalSuggestions = agentReports.reduce((acc: number, r: any) => acc + (r.suggestionsCount || 0), 0);
  const avgScore = agentReports.length > 0 ? Math.round(agentReports.reduce((acc: number, r: any) => acc + (r.score || 0), 0) / agentReports.length) : 0;

  const isRunning = runAll.isPending || startAuto.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agents IA</h1>
          <p className="text-muted-foreground mt-1">
            7 agents specialises + Super IA qui analysent, corrigent et ameliorent votre bureau en continu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {config?.autoRunEnabled ? (
            <Button variant="outline" onClick={handleStopAuto} disabled={stopAuto.isPending}>
              <PowerOff className="w-4 h-4 mr-2" />
              Arreter l'auto-execution
            </Button>
          ) : (
            <Button variant="outline" onClick={handleStartAuto} disabled={startAuto.isPending}>
              {startAuto.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Power className="w-4 h-4 mr-2" />}
              Activer l'auto-execution
            </Button>
          )}
          <Button onClick={handleRunAll} disabled={isRunning} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700">
            {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Lancer tous les agents
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/10 border-purple-200/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center">
              <Crown className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold">{superReport?.score || avgScore || "-"}</p>
              <p className="text-xs text-muted-foreground">Score Global</p>
              {(superReport?.score || avgScore) > 0 && (
                <p className={`text-[10px] font-medium ${getScoreColor(superReport?.score || avgScore)}`}>
                  {getScoreLabel(superReport?.score || avgScore)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalErrors}</p>
              <p className="text-xs text-muted-foreground">Erreurs detectees</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalWarnings}</p>
              <p className="text-xs text-muted-foreground">Alertes</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Lightbulb className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalSuggestions}</p>
              <p className="text-xs text-muted-foreground">Suggestions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {isRunning && (
        <Card className="border-purple-300 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/10">
          <CardContent className="p-6 flex items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            <div>
              <p className="font-semibold">Analyse en cours...</p>
              <p className="text-sm text-muted-foreground">
                Les 7 agents IA analysent votre bureau. Le Super Agent synthetisera ensuite les resultats.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dashboard" className="flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" /> Vue d'ensemble
          </TabsTrigger>
          <TabsTrigger value="super" className="flex items-center gap-1.5">
            <Crown className="w-4 h-4" /> Super Agent
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-1.5">
            <Brain className="w-4 h-4" /> Agents ({agentReports.length})
          </TabsTrigger>
          <TabsTrigger value="historique" className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" /> Historique
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          {loadingLatest ? (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Loader2 className="w-10 h-10 mx-auto text-muted-foreground/50 animate-spin mb-4" />
                <p className="text-sm text-muted-foreground">Chargement des rapports...</p>
              </CardContent>
            </Card>
          ) : errorLatest ? (
            <Card className="border-dashed border-destructive/30">
              <CardContent className="p-12 text-center">
                <AlertCircle className="w-10 h-10 mx-auto text-destructive/50 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Erreur de chargement</h3>
                <p className="text-sm text-muted-foreground mb-4">Impossible de charger les rapports des agents IA.</p>
                <Button variant="outline" onClick={() => invalidateAgentQueries()}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Reessayer
                </Button>
              </CardContent>
            </Card>
          ) : agentReports.length > 0 ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {agentReports.map((report: any) => {
                  const Icon = AGENT_ICONS[report.agentIcon] || Brain;
                  return (
                    <Card key={report.agentId} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setActiveTab("agents")}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                              <Icon className="w-4 h-4" />
                            </div>
                            <span className="text-sm font-medium">{report.agentName?.replace("Agent ", "")}</span>
                          </div>
                          <span className={`text-lg font-bold ${getScoreColor(report.score)}`}>{report.score}</span>
                        </div>
                        <Progress value={report.score} className="h-1.5 mb-2" />
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {report.errorsFound > 0 && <span className="text-destructive">{report.errorsFound} err.</span>}
                          {report.warningsFound > 0 && <span className="text-amber-600">{report.warningsFound} alert.</span>}
                          {report.suggestionsCount > 0 && <span className="text-blue-600">{report.suggestionsCount} sug.</span>}
                          {report.errorsFound === 0 && report.warningsFound === 0 && <span className="text-emerald-600">OK</span>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {superReport && (
                <AgentCard report={superReport} />
              )}
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Brain className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Aucun rapport disponible</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Lancez les agents IA pour obtenir une analyse complete de votre bureau.
                </p>
                <Button onClick={handleRunAll} disabled={isRunning} className="bg-gradient-to-r from-purple-600 to-indigo-600">
                  {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Lancer l'analyse
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="super" className="space-y-4">
          {superReport ? (
            <AgentCard report={superReport} />
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Crown className="w-12 h-12 mx-auto text-purple-300 mb-3" />
                <p className="text-sm text-muted-foreground">Lancez d'abord tous les agents pour que le Super Agent puisse synthetiser les resultats.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="agents" className="space-y-4">
          {agentReports.length > 0 ? (
            agentReports.map((report: any) => (
              <AgentCard key={report.agentId} report={report} onRunAgent={handleRunSingle} />
            ))
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">Aucun rapport d'agent. Lancez l'analyse pour commencer.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="historique">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historique des rapports</CardTitle>
              <CardDescription>Les 50 derniers rapports generes</CardDescription>
            </CardHeader>
            <CardContent>
              {allReports && (allReports as any[]).length > 0 ? (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {(allReports as any[]).map((report: any) => {
                      const Icon = AGENT_ICONS[report.agentIcon] || Brain;
                      return (
                        <div key={report.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${report.isSuperReport ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-muted'}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{report.agentName}</p>
                              <p className="text-[10px] text-muted-foreground">{report.reportDate} - {(report.executionTimeMs / 1000).toFixed(1)}s</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 text-xs">
                              {report.errorsFound > 0 && <Badge variant="destructive" className="h-5 text-[10px]">{report.errorsFound}</Badge>}
                              {report.warningsFound > 0 && <Badge className="h-5 text-[10px] bg-amber-500">{report.warningsFound}</Badge>}
                              {report.suggestionsCount > 0 && <Badge variant="secondary" className="h-5 text-[10px]">{report.suggestionsCount}</Badge>}
                            </div>
                            <span className={`text-sm font-bold ${getScoreColor(report.score)}`}>{report.score}</span>
                            <Badge variant={report.status === "termine" ? "secondary" : "destructive"} className="text-[10px]">
                              {report.status === "termine" ? "OK" : report.status}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Aucun historique disponible.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
