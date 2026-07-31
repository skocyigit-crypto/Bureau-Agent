import aiTechImg from "@/assets/images/ai-technology.webp";
import { Icon3D } from "@/components/icon-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { streamSse } from "@/lib/ai-stream-client";
import { useQueryClient } from "@tanstack/react-query";
import {
useGetAiAgentReports,
useGetLatestAiAgentReports} from "@workspace/api-client-react";
import { Activity,AlertCircle,AlertTriangle,ArrowRight,BarChart3,Brain,CheckCircle2,ChevronDown,ChevronUp,CircleDot,ClipboardList,Clock,Cpu,Crown,Eye,FileText,HeartPulse,Lightbulb,Loader2,Mail,MessageSquare,Package,Phone,Play,Power,PowerOff,Printer,Radar,Receipt,RefreshCw,Rocket,Shield,Sparkles,Target,TrendingUp,UserCog,Users,Wrench,X,Zap } from "lucide-react";
import { useCallback,useEffect,useRef,useState } from "react";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const AGENT_ICONS: Record<string, any> = {
  phone: Phone, users: Users, clipboard: ClipboardList, mail: Mail,
  clock: Clock, shield: Shield, "trending-up": TrendingUp, crown: Crown,
  brain: Brain, receipt: Receipt, package: Package, "user-cog": UserCog,
};

function getScoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-destructive";
}

function getScoreLabelKey(score: number) {
  if (score >= 90) return "excellent";
  if (score >= 80) return "tresBien";
  if (score >= 70) return "bien";
  if (score >= 60) return "acceptable";
  if (score >= 40) return "aAmeliorer";
  return "critique";
}

function getSeverityBadge(severity: string, t: TFn) {
  switch (severity) {
    case "critique": return <Badge variant="destructive" className="text-[10px] h-5">{t("aiAgents.severity.critique")}</Badge>;
    case "haute": return <Badge className="text-[10px] h-5 bg-orange-500 hover:bg-orange-600">{t("aiAgents.severity.haute")}</Badge>;
    case "moyenne": return <Badge variant="secondary" className="text-[10px] h-5 bg-amber-100 text-amber-700">{t("aiAgents.severity.moyenne")}</Badge>;
    case "basse": return <Badge variant="secondary" className="text-[10px] h-5">{t("aiAgents.severity.basse")}</Badge>;
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
  const { t } = useTranslation();
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
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRunAgent(report.agentId)} aria-label={t("aiAgents.card.rerunAgent")}>
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
              <span>{report.errorsFound} {t(report.errorsFound > 1 ? "aiAgents.card.errors" : "aiAgents.card.error")}</span>
            </div>
          )}
          {report.warningsFound > 0 && (
            <div className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{report.warningsFound} {t(report.warningsFound > 1 ? "aiAgents.card.warnings" : "aiAgents.card.warning")}</span>
            </div>
          )}
          {report.suggestionsCount > 0 && (
            <div className="flex items-center gap-1 text-blue-600">
              <Lightbulb className="w-3.5 h-3.5" />
              <span>{report.suggestionsCount} {t(report.suggestionsCount > 1 ? "aiAgents.card.suggestions" : "aiAgents.card.suggestion")}</span>
            </div>
          )}
          {report.errorsFound === 0 && report.warningsFound === 0 && (
            <div className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t("aiAgents.card.noProblem")}</span>
            </div>
          )}
        </div>

        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 mr-1" /> : <ChevronDown className="w-3.5 h-3.5 mr-1" />}
          {expanded ? t("aiAgents.card.hideDetails") : t("aiAgents.card.showDetails")}
        </Button>

        {expanded && (
          <div className="space-y-4 pt-2">
            {report.errors && (report.errors as any[]).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> {t("aiAgents.card.errorsDetected")}
                </h4>
                {(report.errors as any[]).map((e: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-destructive/5 border border-destructive/10 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-destructive">{e.titre}</span>
                      <div className="flex items-center gap-1">
                        {e.deadline && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">{e.deadline}</span>}
                        {e.severity && getSeverityBadge(e.severity, t)}
                      </div>
                    </div>
                    <p className="text-muted-foreground">{e.description}</p>
                    {e.rootCause && <p className="text-amber-600 text-[11px]">{t("aiAgents.card.rootCause")} {e.rootCause}</p>}
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
                  <AlertTriangle className="w-3.5 h-3.5" /> {t("aiAgents.card.warningsTitle")}
                </h4>
                {(report.warnings as any[]).map((w: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 text-xs space-y-1">
                    <span className="font-medium text-amber-700">{w.titre}</span>
                    <p className="text-muted-foreground">{w.description}</p>
                    {w.impact && <p className="text-amber-600 text-[11px]">{t("aiAgents.card.impact")} {w.impact}</p>}
                    {w.threshold && <p className="text-muted-foreground text-[11px]">{t("aiAgents.card.threshold")} {w.threshold}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.suggestions && (report.suggestions as any[]).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-blue-600 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" /> {t("aiAgents.card.suggestionsTitle")}
                </h4>
                {(report.suggestions as any[]).map((s: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-blue-700">{s.titre}</span>
                      {s.priorite && getSeverityBadge(s.priorite, t)}
                    </div>
                    <p className="text-muted-foreground">{s.description}</p>
                    {s.benefice && <p className="text-blue-600 text-[11px]">{t("aiAgents.card.benefit")} {s.benefice}</p>}
                    {s.roi && <p className="text-emerald-600 text-[11px]">{t("aiAgents.card.roi")} {s.roi}</p>}
                    {s.effort && <p className="text-muted-foreground text-[11px]">{t("aiAgents.card.effort")} {s.effort}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.corrections && (report.corrections as any[]).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-purple-600 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> {t("aiAgents.card.correctionsToApply")}
                </h4>
                {(report.corrections as any[]).map((c: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-purple-700">{c.element}</span>
                      {c.urgence && getSeverityBadge(c.urgence, t)}
                    </div>
                    <p className="text-muted-foreground">{t("aiAgents.card.problem")} {c.probleme}</p>
                    <p className="text-foreground flex items-center gap-1">
                      <Target className="w-3 h-3 text-purple-500 shrink-0" /> {c.solution}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).trendAnalysis && (
              <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/20 dark:to-blue-950/20 border border-cyan-200/50 text-xs space-y-1">
                <h4 className="font-semibold text-cyan-700 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> {t("aiAgents.card.trendAnalysis")}
                </h4>
                <p className="text-muted-foreground">{(report.details as any).trendAnalysis}</p>
              </div>
            )}

            {report.details && (report.details as any).detectedPatterns && (report.details as any).detectedPatterns.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-violet-600 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> {t("aiAgents.card.detectedPatterns")}
                </h4>
                {((report.details as any).detectedPatterns as any[]).map((p: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200/50 text-xs space-y-1">
                    <span className="font-medium text-violet-700">{p.pattern}</span>
                    {p.evidence && <p className="text-muted-foreground text-[11px]">{t("aiAgents.card.evidence")} {p.evidence}</p>}
                    {p.risk && <p className="text-amber-600 text-[11px]">{t("aiAgents.card.risk")} {p.risk}</p>}
                    {p.recommendation && <p className="text-violet-600 text-[11px] flex items-center gap-1"><ArrowRight className="w-3 h-3 shrink-0" />{p.recommendation}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).predictions && (report.details as any).predictions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-orange-600 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> {t("aiAgents.card.predictions")}
                </h4>
                {((report.details as any).predictions as any[]).map((p: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-orange-700">{p.scenario}</span>
                      {p.horizon && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600">{p.horizon === '7_jours' ? t("aiAgents.card.days7") : t("aiAgents.card.days30")}</span>}
                    </div>
                    {p.impact && <p className="text-muted-foreground text-[11px]">{t("aiAgents.card.impact")} {p.impact}</p>}
                    {p.prevention && <p className="text-emerald-600 text-[11px] flex items-center gap-1"><Shield className="w-3 h-3 shrink-0" />{t("aiAgents.card.prevention")} {p.prevention}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).automations && (report.details as any).automations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-teal-600 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> {t("aiAgents.card.automations")}
                </h4>
                {((report.details as any).automations as any[]).map((a: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/20 border border-teal-200/50 text-xs space-y-1">
                    <span className="font-medium text-teal-700">{a.action}</span>
                    {a.gain && <p className="text-muted-foreground text-[11px]">{t("aiAgents.card.gain")} {a.gain}</p>}
                    {a.faisabilite && <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-600">{t("aiAgents.card.feasibility")} {a.faisabilite}</span>}
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).actionPlan && (report.details as any).actionPlan.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-indigo-600 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" /> {t("aiAgents.card.actionPlan")}
                </h4>
                {((report.details as any).actionPlan as any[]).map((a: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200/50 text-xs">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                      {a.etape || i + 1}
                    </div>
                    <div className="space-y-0.5">
                      <span className="font-medium">{a.action}</span>
                      {a.responsable && <p className="text-muted-foreground">{t("aiAgents.card.responsible")} {a.responsable}</p>}
                      {a.delai && <p className="text-indigo-600">{t("aiAgents.card.deadline")} {a.delai}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).crossAnalysis && (report.details as any).crossAnalysis.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-teal-600 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" /> {t("aiAgents.card.crossAnalysis")}
                </h4>
                {((report.details as any).crossAnalysis as any[]).map((c: any, i: number) => (
                  <div key={i} className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/20 border border-teal-200/50 text-xs space-y-1">
                    <p className="text-foreground">{c.observation}</p>
                    {c.agentsConcernes && <p className="text-teal-600">{t("aiAgents.card.agents")} {c.agentsConcernes.join(", ")}</p>}
                    {c.recommandation && <p className="font-medium text-teal-700">{c.recommandation}</p>}
                  </div>
                ))}
              </div>
            )}

            {report.details && (report.details as any).multiAI && (
              <div className="space-y-3">
                <Separator />
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5" /> {t("aiAgents.card.multiAI")}
                </h4>
                {(report.details as any).multiAI.providersUsed && (
                  <div className="flex gap-1.5 flex-wrap">
                    {((report.details as any).multiAI.providersUsed as string[]).map((p: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>
                    ))}
                  </div>
                )}
                {(report.details as any).multiAI.openaiVerification && (
                  <div className="p-2.5 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200/50 text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-green-600" />
                      <span className="font-semibold text-green-700">{t("aiAgents.card.openaiVerification")}</span>
                    </div>
                    <p className="text-muted-foreground">{(report.details as any).multiAI.openaiVerification.verification}</p>
                    {(report.details as any).multiAI.openaiVerification.incoherences?.length > 0 && (
                      <div className="space-y-1 mt-1">
                        <p className="text-[11px] font-medium text-amber-700">{t("aiAgents.card.incoherences")}</p>
                        {((report.details as any).multiAI.openaiVerification.incoherences as any[]).map((inc: any, j: number) => (
                          <p key={j} className="text-[11px] text-muted-foreground pl-2 border-l-2 border-amber-300">{inc.description}</p>
                        ))}
                      </div>
                    )}
                    {(report.details as any).multiAI.openaiVerification.pointsManques?.length > 0 && (
                      <div className="space-y-1 mt-1">
                        <p className="text-[11px] font-medium text-blue-700">{t("aiAgents.card.missedPoints")}</p>
                        {((report.details as any).multiAI.openaiVerification.pointsManques as any[]).map((pm: any, j: number) => (
                          <p key={j} className="text-[11px] text-muted-foreground pl-2 border-l-2 border-blue-300">{pm.description}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {(report.details as any).multiAI.anthropicStrategie && (
                  <div className="p-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200/50 text-xs space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-orange-600" />
                      <span className="font-semibold text-orange-700">{t("aiAgents.card.anthropicStrategy")}</span>
                    </div>
                    <p className="text-muted-foreground">{(report.details as any).multiAI.anthropicStrategie.strategieGlobale}</p>
                    {(report.details as any).multiAI.anthropicStrategie.prioritesStrategiques?.length > 0 && (
                      <div className="space-y-1 mt-1">
                        <p className="text-[11px] font-medium text-orange-700">{t("aiAgents.card.strategicPriorities")}</p>
                        {((report.details as any).multiAI.anthropicStrategie.prioritesStrategiques as any[]).map((ps: any, j: number) => (
                          <div key={j} className="text-[11px] pl-2 border-l-2 border-orange-300">
                            <span className="font-medium">{ps.titre}</span>
                            <span className="text-muted-foreground"> - {ps.description}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(report.details as any).multiAI.anthropicStrategie.risques?.length > 0 && (
                      <div className="space-y-1 mt-1">
                        <p className="text-[11px] font-medium text-red-700">{t("aiAgents.card.risksIdentified")}</p>
                        {((report.details as any).multiAI.anthropicStrategie.risques as any[]).map((r: any, j: number) => (
                          <p key={j} className="text-[11px] text-muted-foreground pl-2 border-l-2 border-red-300">{r.description} ({t("aiAgents.card.mitigation")} {r.mitigation})</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {report.executionTimeMs > 0 && (
              <p className="text-[10px] text-muted-foreground text-right">
                {t("aiAgents.card.executedIn", { time: (report.executionTimeMs / 1000).toFixed(1) })}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AiAgentsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("dashboard");
  const { isAtLeast } = useWorkspaceUser();
  const canRunAgents = isAtLeast("administrateur");
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState({ completedAgents: 0, totalAgents: 10 });
  const [runTimeline, setRunTimeline] = useState<Array<{ agentId: string; agentName: string; agentIcon: string; status: "pending" | "running" | "done" | "error" | "aborted"; score?: number; executionTimeMs?: number; error?: string }>>([]);
  const [superStatus, setSuperStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const runAllAbortRef = useRef<AbortController | null>(null);
  const [autoFixLoading, setAutoFixLoading] = useState(false);
  const [autoFixResult, setAutoFixResult] = useState<any>(null);
  const [predictions, setPredictions] = useState<any>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(false);
  const [streamingAgentId, setStreamingAgentId] = useState<string | null>(null);
  const [streamingAgentText, setStreamingAgentText] = useState("");
  const singleAgentAbortRef = useRef<AbortController | null>(null);

  const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");


  const { data: latestReports, isLoading: loadingLatest, isError: errorLatest } = useGetLatestAiAgentReports();
  const { data: allReports } = useGetAiAgentReports();

  const invalidateAgentQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/ai/agents");
      }
    });
  };

  const attachToRun = async (opts: { reattach: boolean }) => {
    const controller = new AbortController();
    runAllAbortRef.current = controller;
    setIsRunning(true);
    if (!opts.reattach) {
      setRunProgress({ completedAgents: 0, totalAgents: 10 });
      setRunTimeline([]);
      setSuperStatus("idle");
      toast({ title: t("aiAgents.toast.started"), description: t("aiAgents.toast.startedDesc") });
    } else {
      toast({ title: t("aiAgents.toast.inProgress"), description: t("aiAgents.toast.inProgressDesc") });
    }

    try {
      await streamSse("/ai/agents/run/stream", {}, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === "start") {
            setRunProgress({ completedAgents: 0, totalAgents: data?.totalAgents || 10 });
            if (Array.isArray(data?.agents)) {
              setRunTimeline(data.agents.map((a: any) => ({
                agentId: a.agentId,
                agentName: a.agentName,
                agentIcon: a.agentIcon,
                status: "pending" as const,
              })));
            }
          } else if (event === "agent-start") {
            setRunTimeline(prev => prev.map(t => t.agentId === data?.agentId ? { ...t, status: "running" } : t));
          } else if (event === "agent-done") {
            setRunTimeline(prev => prev.map(t => t.agentId === data?.agentId ? { ...t, status: "done", score: data?.score, executionTimeMs: data?.executionTimeMs } : t));
            invalidateAgentQueries();
          } else if (event === "agent-error") {
            setRunTimeline(prev => prev.map(t => t.agentId === data?.agentId ? { ...t, status: "error", error: data?.error } : t));
          } else if (event === "agent-aborted") {
            setRunTimeline(prev => prev.map(t => t.agentId === data?.agentId ? { ...t, status: "aborted" } : t));
          } else if (event === "progress") {
            setRunProgress({ completedAgents: data?.completedAgents || 0, totalAgents: data?.totalAgents || 10 });
          } else if (event === "super-start") {
            setSuperStatus("running");
          } else if (event === "super-done") {
            setSuperStatus("done");
            invalidateAgentQueries();
          } else if (event === "super-error") {
            setSuperStatus("error");
          } else if (event === "done") {
            toast({ title: t("aiAgents.toast.done"), description: t("aiAgents.toast.doneDesc") });
            invalidateAgentQueries();
          } else if (event === "aborted") {
            toast({ title: t("aiAgents.toast.aborted"), description: t("aiAgents.toast.abortedDesc", { done: data?.completedAgents ?? 0, total: data?.totalAgents ?? 10 }) });
            invalidateAgentQueries();
          } else if (event === "error") {
            toast({ title: t("aiAgents.toast.error"), description: data?.error || t("aiAgents.toast.runErrorDesc"), variant: "destructive" });
          }
        },
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // already handled by aborted event if server got the chance to emit it
      } else {
        console.error("[AIAgents] stream failed:", err);
        toast({ title: t("aiAgents.toast.error"), description: err?.message || t("aiAgents.toast.runFailDesc"), variant: "destructive" });
      }
    } finally {
      setIsRunning(false);
      runAllAbortRef.current = null;
    }
  };

  const handleRunAll = async () => {
    if (isRunning) return;
    await attachToRun({ reattach: false });
  };

  const cancelRunAll = async () => {
    try {
      await fetch(`${BASE_URL}/api/ai/agents/run/cancel`, {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("[AIAgents] cancel failed:", err);
    }
    toast({ title: t("aiAgents.toast.cancelRequested"), description: t("aiAgents.toast.cancelRequestedDesc") });
  };

  // Reattach to an in-flight run when the page mounts (after tab switch / refresh)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/ai/agents/run/status`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.status === "running" && !runAllAbortRef.current) {
          await attachToRun({ reattach: true });
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutoFix = async () => {
    setAutoFixLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/ai/agents/auto-fix`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" });
      if (!res.ok) throw new Error(t("aiAgents.toast.serverError"));
      const data = await res.json();
      setAutoFixResult(data);
      toast({
        title: t("aiAgents.fixesApplied", { count: data.totalFixes }),
        description: data.fixes.map((f: any) => f.description).join(", ") || t("aiAgents.toast.noFixNeeded"),
      });
      invalidateAgentQueries();
    } catch (err) {
      console.error("[AIAgents] Auto-fix error:", err);
      toast({ title: t("aiAgents.toast.error"), description: t("aiAgents.toast.autoFixFailDesc"), variant: "destructive" });
    } finally {
      setAutoFixLoading(false);
    }
  };

  const loadPredictions = async () => {
    setPredictionsLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${BASE_URL}/api/ai/predictions`, { credentials: "include", signal: controller.signal });
      if (!res.ok) throw new Error(t("aiAgents.toast.serverError"));
      const data = await res.json();
      setPredictions(data);
    } catch (err: any) {
      console.error("[AIAgents] Predictions error:", err);
      const msg = err?.name === "AbortError"
        ? t("aiAgents.toast.predTimeout")
        : t("aiAgents.toast.predFailDesc");
      toast({ title: t("aiAgents.toast.error"), description: msg, variant: "destructive" });
    } finally {
      clearTimeout(timeout);
      setPredictionsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "predictions" && !predictions && !predictionsLoading) {
      loadPredictions();
    }
  }, [activeTab]);

  const handleRunSingle = async (agentId: string) => {
    if (streamingAgentId) return;
    setStreamingAgentId(agentId);
    setStreamingAgentText("");
    const controller = new AbortController();
    singleAgentAbortRef.current = controller;
    try {
      await streamSse(`/ai/agents/run/${agentId}/stream`, {}, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === "token" && data?.chunk) setStreamingAgentText(prev => prev + data.chunk);
          else if (event === "cached" && typeof data?.text === "string") setStreamingAgentText(data.text);
          else if (event === "report") {
            invalidateAgentQueries();
          } else if (event === "done") {
            toast({ title: t("aiAgents.toast.agentDone"), description: t("aiAgents.toast.agentDoneDesc") });
            invalidateAgentQueries();
          } else if (event === "aborted") {
            toast({ title: t("aiAgents.toast.agentAborted"), description: t("aiAgents.toast.agentAbortedDesc") });
          } else if (event === "error") {
            toast({ title: t("aiAgents.toast.error"), description: data?.error || t("aiAgents.toast.agentFailDesc"), variant: "destructive" });
          }
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ title: t("aiAgents.toast.error"), description: err?.message || t("aiAgents.toast.agentFailDesc"), variant: "destructive" });
      }
    } finally {
      setStreamingAgentId(null);
      singleAgentAbortRef.current = null;
    }
  };

  const cancelSingleAgent = () => {
    if (singleAgentAbortRef.current) {
      singleAgentAbortRef.current.abort();
    }
  };

  const latestMap = (latestReports || {}) as Record<string, any>;
  const superReport = latestMap["super_agent"];
  const agentReports = Object.values(latestMap).filter((r: any) => !r.isSuperReport);
  const totalErrors = agentReports.reduce((acc: number, r: any) => acc + (r.errorsFound || 0), 0);
  const totalWarnings = agentReports.reduce((acc: number, r: any) => acc + (r.warningsFound || 0), 0);
  const totalSuggestions = agentReports.reduce((acc: number, r: any) => acc + (r.suggestionsCount || 0), 0);
  const avgScore = agentReports.length > 0 ? Math.round(agentReports.reduce((acc: number, r: any) => acc + (r.score || 0), 0) / agentReports.length) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Brain} variant="purple" size="md" /> {t("aiAgents.title")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("aiAgents.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canRunAgents && (
            <Button variant="outline" onClick={handleAutoFix} disabled={autoFixLoading} className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/20">
              {autoFixLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
              {t("aiAgents.autoFix")}
            </Button>
          )}
          <Button variant="outline" size="icon" title={t("aiAgents.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          {canRunAgents ? (
            <>
              <Button onClick={handleRunAll} disabled={isRunning} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700">
                {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                {isRunning ? t("aiAgents.analyzing", { done: runProgress.completedAgents, total: runProgress.totalAgents }) : t("aiAgents.runAll")}
              </Button>
              {isRunning && (
                <Button variant="outline" size="sm" onClick={cancelRunAll} className="border-red-300 text-red-700 hover:bg-red-50">
                  <X className="w-3.5 h-3.5 mr-1" />{t("common.cancel")}
                </Button>
              )}
            </>
          ) : (
            <Badge variant="secondary" className="py-1.5 px-3 text-xs">
              <Eye className="w-3 h-3 mr-1.5" /> {t("aiAgents.readMode")}
            </Badge>
          )}
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={aiTechImg} alt={t("aiAgents.aiAlt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-purple-900/80 via-indigo-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">{t("aiAgents.heroTitle")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("aiAgents.heroSubtitle")}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/10 border-purple-200/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center">
              <Crown className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold">{superReport?.score || avgScore || "-"}</p>
              <p className="text-xs text-muted-foreground">{t("aiAgents.globalScore")}</p>
              {(superReport?.score || avgScore) > 0 && (
                <p className={`text-[10px] font-medium ${getScoreColor(superReport?.score || avgScore)}`}>
                  {t(`aiAgents.scoreLabel.${getScoreLabelKey(superReport?.score || avgScore)}`)}
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
              <p className="text-xs text-muted-foreground">{t("aiAgents.errorsDetected")}</p>
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
              <p className="text-xs text-muted-foreground">{t("aiAgents.warnings")}</p>
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
              <p className="text-xs text-muted-foreground">{t("aiAgents.suggestions")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {(isRunning || runTimeline.length > 0) && (
        <Card className="border-purple-300 bg-gradient-to-br from-purple-50/60 to-indigo-50/40 dark:from-purple-950/20 dark:to-indigo-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {isRunning ? <Loader2 className="w-5 h-5 animate-spin text-purple-600" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                <div>
                  <CardTitle className="text-base">
                    {isRunning ? t("aiAgents.liveAnalysis") : t("aiAgents.analysisComplete")}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {runProgress.completedAgents}/{runProgress.totalAgents} {t("aiAgents.agentsSuffix")} - Super Agent: {superStatus === "idle" ? t("aiAgents.superIdle") : superStatus === "running" ? t("aiAgents.superRunning") : superStatus === "done" ? t("aiAgents.superDone") : t("aiAgents.superError")}
                  </CardDescription>
                </div>
              </div>
              <div className="w-40">
                <Progress value={runProgress.totalAgents ? (runProgress.completedAgents / runProgress.totalAgents) * 100 : 0} className="h-2" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {runTimeline.map((item) => {
              const Icon = AGENT_ICONS[item.agentIcon] || Brain;
              return (
                <div key={item.agentId} className="flex items-center gap-3 px-2 py-1.5 rounded-md bg-background/40">
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-medium flex-1 truncate">{item.agentName}</span>
                  {item.status === "pending" && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1"><CircleDot className="w-3 h-3" />{t("aiAgents.timeline.pending")}</span>
                  )}
                  {item.status === "running" && (
                    <span className="text-[10px] text-purple-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{t("aiAgents.timeline.analyzing")}</span>
                  )}
                  {item.status === "done" && (
                    <span className="text-[10px] flex items-center gap-2">
                      <span className={`font-bold ${getScoreColor(item.score ?? 0)}`}>{item.score}</span>
                      {typeof item.executionTimeMs === "number" && item.executionTimeMs > 0 && (
                        <span className="text-muted-foreground">{(item.executionTimeMs / 1000).toFixed(1)}s</span>
                      )}
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    </span>
                  )}
                  {item.status === "error" && (
                    <span className="text-[10px] text-destructive flex items-center gap-1" title={item.error}><AlertCircle className="w-3.5 h-3.5" />{t("aiAgents.timeline.error")}</span>
                  )}
                  {item.status === "aborted" && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1"><X className="w-3 h-3" />{t("aiAgents.timeline.aborted")}</span>
                  )}
                </div>
              );
            })}
            {superStatus !== "idle" && (
              <div className="flex items-center gap-3 px-2 py-1.5 rounded-md bg-gradient-to-r from-purple-100/40 to-indigo-100/40 dark:from-purple-900/20 dark:to-indigo-900/20 mt-2">
                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center shrink-0">
                  <Crown className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-medium flex-1 truncate">{t("aiAgents.superAgentSynthesis")}</span>
                {superStatus === "running" && <span className="text-[10px] text-purple-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{t("aiAgents.synthesizing")}</span>}
                {superStatus === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                {superStatus === "error" && <AlertCircle className="w-3.5 h-3.5 text-destructive" />}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {streamingAgentId && (
        <Card className="border-violet-300 bg-violet-50/40 dark:bg-violet-950/10">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
                <span className="text-sm font-semibold text-violet-700">
                  {t("aiAgents.agentResponding", { id: streamingAgentId })}
                </span>
              </div>
              <Button onClick={cancelSingleAgent} variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-50">
                <X className="w-3.5 h-3.5 mr-1" />{t("common.cancel")}
              </Button>
            </div>
            {streamingAgentText && (
              <pre className="text-[10px] whitespace-pre-wrap font-mono text-muted-foreground max-h-48 overflow-auto bg-white/60 dark:bg-black/20 rounded p-2">
                {streamingAgentText}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dashboard" className="flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" /> {t("aiAgents.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-1.5">
            <Brain className="w-4 h-4" /> {t("aiAgents.tabs.agents")}
          </TabsTrigger>
          <TabsTrigger value="historique" className="flex items-center gap-1.5">
            <FileText className="w-4 h-4" /> {t("aiAgents.tabs.history")}
          </TabsTrigger>
          <TabsTrigger value="predictions" className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" /> {t("aiAgents.tabs.predictions")}
          </TabsTrigger>
          <TabsTrigger value="anomalies" className="flex items-center gap-1.5">
            <Radar className="w-4 h-4" /> {t("aiAgents.tabs.anomalies")}
          </TabsTrigger>
          <TabsTrigger value="autopilot" className="flex items-center gap-1.5">
            <Rocket className="w-4 h-4" /> {t("aiAgents.tabs.autopilot")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          {loadingLatest ? (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Loader2 className="w-10 h-10 mx-auto text-muted-foreground/50 animate-spin mb-4" />
                <p className="text-sm text-muted-foreground">{t("aiAgents.loadingReports")}</p>
              </CardContent>
            </Card>
          ) : errorLatest ? (
            <Card className="border-dashed border-destructive/30">
              <CardContent className="p-12 text-center">
                <AlertCircle className="w-10 h-10 mx-auto text-destructive/50 mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t("aiAgents.loadError")}</h3>
                <p className="text-sm text-muted-foreground mb-4">{t("aiAgents.loadErrorDesc")}</p>
                <Button variant="outline" onClick={() => invalidateAgentQueries()}>
                  <RefreshCw className="w-4 h-4 mr-2" /> {t("aiAgents.retry")}
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
                <h3 className="text-lg font-semibold mb-2">{t("aiAgents.noReports")}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("aiAgents.noReportsDesc")}
                </p>
                {canRunAgents && (
                  <Button onClick={handleRunAll} disabled={isRunning} className="bg-gradient-to-r from-purple-600 to-indigo-600">
                    {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    {isRunning ? t("aiAgents.analyzing", { done: runProgress.completedAgents, total: runProgress.totalAgents }) : t("aiAgents.runAnalysis")}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="agents" className="space-y-4">
          {agentReports.length > 0 ? (
            agentReports.map((report: any) => (
              <AgentCard key={report.agentId} report={report} onRunAgent={canRunAgents ? handleRunSingle : undefined} />
            ))
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">{t("aiAgents.noAgentReports")}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="historique">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("aiAgents.historyTitle")}</CardTitle>
              <CardDescription>{t("aiAgents.historyDesc")}</CardDescription>
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
                <p className="text-sm text-muted-foreground text-center py-8">{t("aiAgents.noHistory")}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="predictions" className="space-y-6">
          {predictionsLoading ? (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Loader2 className="w-10 h-10 mx-auto text-purple-500 animate-spin mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t("aiAgents.pred.analyzing")}</h3>
                <p className="text-sm text-muted-foreground">{t("aiAgents.pred.analyzingDesc")}</p>
              </CardContent>
            </Card>
          ) : predictions?.predictions ? (
            <>
              {autoFixResult && autoFixResult.totalFixes > 0 && (
                <Card className="border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/20 dark:to-green-950/10">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <h4 className="font-semibold text-emerald-800 dark:text-emerald-300">{t("aiAgents.fixesApplied", { count: autoFixResult.totalFixes })}</h4>
                    </div>
                    <div className="space-y-1">
                      {autoFixResult.fixes.map((fix: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                          <Wrench className="w-3 h-3 shrink-0" />
                          <span>{fix.description} ({fix.count})</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-4 md:grid-cols-4">
                <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/10 border-blue-200/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Phone className="w-5 h-5 text-blue-600" />
                      <span className="text-xs font-medium text-muted-foreground">{t("aiAgents.pred.callsPredicted")}</span>
                    </div>
                    <p className="text-2xl font-bold">{predictions.predictions.callVolume?.predicted || 0}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <Badge variant="outline" className={`text-[10px] h-4 ${
                        predictions.predictions.callVolume?.trend === "hausse" ? "text-emerald-600 border-emerald-300" :
                        predictions.predictions.callVolume?.trend === "baisse" ? "text-red-600 border-red-300" : "text-blue-600 border-blue-300"
                      }`}>
                        {predictions.predictions.callVolume?.trend === "hausse" ? "↑" : predictions.predictions.callVolume?.trend === "baisse" ? "↓" : "→"} {predictions.predictions.callVolume?.trend}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{t("aiAgents.pred.confidence", { n: predictions.predictions.callVolume?.confidence || 0 })}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/20 dark:to-green-950/10 border-emerald-200/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ClipboardList className="w-5 h-5 text-emerald-600" />
                      <span className="text-xs font-medium text-muted-foreground">{t("aiAgents.pred.tasksCompleted")}</span>
                    </div>
                    <p className="text-2xl font-bold">{predictions.predictions.taskCompletion?.predictedCompleted || 0}</p>
                    <Badge variant="outline" className={`text-[10px] h-4 ${
                      predictions.predictions.taskCompletion?.velocityTrend === "acceleration" ? "text-emerald-600 border-emerald-300" :
                      predictions.predictions.taskCompletion?.velocityTrend === "deceleration" ? "text-red-600 border-red-300" : "text-blue-600 border-blue-300"
                    }`}>
                      {predictions.predictions.taskCompletion?.velocityTrend || "stable"}
                    </Badge>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/10 border-violet-200/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-5 h-5 text-violet-600" />
                      <span className="text-xs font-medium text-muted-foreground">{t("aiAgents.pred.newContacts")}</span>
                    </div>
                    <p className="text-2xl font-bold">{predictions.predictions.contactGrowth?.predictedNew || 0}</p>
                    <Badge variant="outline" className={`text-[10px] h-4 ${
                      predictions.predictions.contactGrowth?.trend === "croissance" ? "text-emerald-600 border-emerald-300" :
                      predictions.predictions.contactGrowth?.trend === "declin" ? "text-red-600 border-red-300" : "text-blue-600 border-blue-300"
                    }`}>
                      {predictions.predictions.contactGrowth?.trend || "stable"}
                    </Badge>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 border-amber-200/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <HeartPulse className="w-5 h-5 text-amber-600" />
                      <span className="text-xs font-medium text-muted-foreground">{t("aiAgents.pred.customerSatisfaction")}</span>
                    </div>
                    <p className="text-2xl font-bold">{predictions.predictions.customerSatisfaction?.score || 0}<span className="text-sm text-muted-foreground">/100</span></p>
                    <Badge variant="outline" className={`text-[10px] h-4 ${
                      predictions.predictions.customerSatisfaction?.trend === "amelioration" ? "text-emerald-600 border-emerald-300" :
                      predictions.predictions.customerSatisfaction?.trend === "degradation" ? "text-red-600 border-red-300" : "text-blue-600 border-blue-300"
                    }`}>
                      {predictions.predictions.customerSatisfaction?.trend || "stable"}
                    </Badge>
                  </CardContent>
                </Card>
              </div>

              {predictions.predictions.weeklyForecast?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Radar className="w-4 h-4 text-purple-500" /> {t("aiAgents.pred.dailyForecast")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 md:grid-cols-7">
                      {predictions.predictions.weeklyForecast.map((day: any, i: number) => (
                        <div key={i} className={`text-center p-3 rounded-lg border ${
                          day.alertLevel === "rouge" ? "bg-red-50 dark:bg-red-950/20 border-red-200" :
                          day.alertLevel === "jaune" ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200" :
                          "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200"
                        }`}>
                          <p className="text-xs font-semibold">{day.day?.substring(0, 3)}</p>
                          <p className="text-lg font-bold mt-1">{day.callsPredicted || 0}</p>
                          <p className="text-[10px] text-muted-foreground">{t("aiAgents.pred.calls")}</p>
                          <p className="text-xs font-medium mt-0.5">{day.tasksPredicted || 0}</p>
                          <p className="text-[10px] text-muted-foreground">{t("aiAgents.pred.tasks")}</p>
                          <div className={`mt-1 w-2 h-2 rounded-full mx-auto ${
                            day.alertLevel === "rouge" ? "bg-red-500" :
                            day.alertLevel === "jaune" ? "bg-amber-500" : "bg-emerald-500"
                          }`} />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {predictions.predictions.operationalRisks?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Shield className="w-4 h-4 text-red-500" /> {t("aiAgents.pred.operationalRisks")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {predictions.predictions.operationalRisks.map((risk: any, i: number) => (
                      <div key={i} className={`p-3 rounded-lg border ${
                        risk.probability === "haute" ? "bg-red-50 dark:bg-red-950/20 border-red-200/50" :
                        risk.probability === "moyenne" ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200/50" :
                        "bg-blue-50 dark:bg-blue-950/20 border-blue-200/50"
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{risk.risk}</span>
                          <div className="flex items-center gap-1">
                            {getSeverityBadge(risk.probability, t)}
                            <Badge variant="outline" className="text-[10px] h-5">{risk.impact}</Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{risk.mitigation}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {predictions.predictions.opportunities?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-500" /> {t("aiAgents.pred.opportunities")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {predictions.predictions.opportunities.map((opp: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50">
                        <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{opp.opportunity}</span>
                        <p className="text-xs text-muted-foreground mt-1">{t("aiAgents.pred.impact")} {opp.potentialImpact}</p>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                          <Zap className="w-3 h-3" /> {opp.actionRequired}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {predictions.predictions.strategicRecommendations?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4 text-violet-500" /> {t("aiAgents.pred.strategicRecommendations")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {predictions.predictions.strategicRecommendations.map((rec: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <span className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                          <p className="text-muted-foreground">{rec}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{t("aiAgents.pred.generatedAt", { date: new Date(predictions.generatedAt).toLocaleString("fr-FR") })}</p>
                <Button variant="outline" size="sm" onClick={loadPredictions} disabled={predictionsLoading} className="gap-1">
                  <RefreshCw className="w-3 h-3" /> {t("aiAgents.pred.refresh")}
                </Button>
              </div>
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <TrendingUp className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t("aiAgents.pred.title")}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                  {t("aiAgents.pred.emptyDesc")}
                </p>
                <Button onClick={loadPredictions} disabled={predictionsLoading} className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600">
                  <Sparkles className="w-4 h-4" /> {t("aiAgents.pred.generate")}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="anomalies" className="space-y-6">
          <AnomalyDetectionPanel />
        </TabsContent>

        <TabsContent value="autopilot" className="space-y-6">
          <AutopilotPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AnomalyDetectionPanel() {
  const { t } = useTranslation();
  const [anomalyData, setAnomalyData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const scanAnomalies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/ai/anomalies`, { credentials: "include" });
      if (!res.ok) throw new Error(t("aiAgents.toast.serverError"));
      const data = await res.json();
      setAnomalyData(data);
    } catch {
      toast({ title: t("aiAgents.toast.error"), description: t("aiAgents.anomaly.scanFailDesc"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [BASE, toast, t]);

  useEffect(() => { scanAnomalies(); }, []);

  const getSeverityColor = (s: string) => {
    switch (s) {
      case "critique": return "border-red-500/50 bg-red-50 dark:bg-red-950/20";
      case "haute": return "border-orange-500/50 bg-orange-50 dark:bg-orange-950/20";
      case "moyenne": return "border-amber-500/50 bg-amber-50 dark:bg-amber-950/20";
      case "basse": return "border-blue-500/50 bg-blue-50 dark:bg-blue-950/20";
      default: return "border-border";
    }
  };

  const getSeverityIcon = (s: string) => {
    switch (s) {
      case "critique": return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case "haute": return <AlertCircle className="w-5 h-5 text-orange-500" />;
      case "moyenne": return <Eye className="w-5 h-5 text-amber-500" />;
      case "basse": return <Lightbulb className="w-5 h-5 text-blue-500" />;
      default: return <Activity className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const globalStatusConfig: Record<string, { label: string; color: string; icon: any }> = {
    ok: { label: t("aiAgents.anomaly.status.ok"), color: "text-emerald-600", icon: CheckCircle2 },
    basse: { label: t("aiAgents.anomaly.status.basse"), color: "text-blue-600", icon: Lightbulb },
    moyenne: { label: t("aiAgents.anomaly.status.moyenne"), color: "text-amber-600", icon: Eye },
    haute: { label: t("aiAgents.anomaly.status.haute"), color: "text-orange-600", icon: AlertCircle },
    critique: { label: t("aiAgents.anomaly.status.critique"), color: "text-red-600", icon: AlertTriangle },
  };

  const gs = globalStatusConfig[anomalyData?.globalSeverity || "ok"] || globalStatusConfig.ok;
  const GsIcon = gs.icon;

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-gray-50 dark:from-slate-900/50 dark:to-gray-900/50 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
                <Radar className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">{t("aiAgents.anomaly.title")}</CardTitle>
                <CardDescription>{t("aiAgents.anomaly.subtitle")}</CardDescription>
              </div>
            </div>
            <Button onClick={scanAnomalies} disabled={loading} variant="outline" size="sm">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
              {t("aiAgents.anomaly.rescan")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {loading && !anomalyData ? (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("aiAgents.anomaly.analyzing")}</p>
            </div>
          ) : anomalyData ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border">
                <div className="flex items-center gap-3">
                  <GsIcon className={`w-8 h-8 ${gs.color}`} />
                  <div>
                    <p className={`text-lg font-bold ${gs.color}`}>{gs.label}</p>
                    <p className="text-sm text-muted-foreground">{t("aiAgents.anomaly.detectedCount", { count: anomalyData.summary.total })}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {anomalyData.summary.critique > 0 && <Badge variant="destructive">{t("aiAgents.anomaly.critiqueCount", { count: anomalyData.summary.critique })}</Badge>}
                  {anomalyData.summary.haute > 0 && <Badge className="bg-orange-500 hover:bg-orange-600">{t("aiAgents.anomaly.hauteCount", { count: anomalyData.summary.haute })}</Badge>}
                  {anomalyData.summary.moyenne > 0 && <Badge className="bg-amber-100 text-amber-700">{t("aiAgents.anomaly.moyenneCount", { count: anomalyData.summary.moyenne })}</Badge>}
                  {anomalyData.summary.basse > 0 && <Badge variant="secondary">{t("aiAgents.anomaly.basseCount", { count: anomalyData.summary.basse })}</Badge>}
                </div>
              </div>

              {anomalyData.anomalies.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                  <p className="font-semibold text-emerald-700">{t("aiAgents.anomaly.none")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("aiAgents.anomaly.allNormal")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {anomalyData.anomalies.map((a: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl border-2 ${getSeverityColor(a.severity)} transition-all hover:shadow-md`}>
                      <div className="flex items-start gap-3">
                        {getSeverityIcon(a.severity)}
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="font-semibold text-sm">{a.title}</h4>
                            {getSeverityBadge(a.severity, t)}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{a.description}</p>
                          {a.suggestedAction && (
                            <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 rounded-lg px-2.5 py-1.5">
                              <Wrench className="w-3 h-3 shrink-0" />
                              <span>{a.suggestedAction}</span>
                            </div>
                          )}
                        </div>
                        {a.metric && (
                          <div className="text-right shrink-0">
                            <p className="text-2xl font-bold text-foreground">{a.metric}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground text-right">
                {t("aiAgents.anomaly.lastAnalysis", { date: anomalyData.checkedAt ? new Date(anomalyData.checkedAt).toLocaleString("fr-FR") : "-" })}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function AutopilotPanel() {
  const { t } = useTranslation();
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [status, setStatus] = useState<any>(null);
  const [cycleResult, setCycleResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const { toast } = useToast();
  const { isAtLeast } = useWorkspaceUser();
  const canRunAgents = isAtLeast("administrateur");

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const fetchStatus = async () => {
      try {
        const r = await fetch(`${baseUrl}/api/ai/autopilot/status`, { credentials: "include", signal: controller.signal });
        if (mounted && r.ok) setStatus(await r.json());
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("[AIAgents] autopilot status fetch failed:", err);
      }
    };
    fetchStatus();
    const poll = setInterval(fetchStatus, 60000);
    return () => { mounted = false; controller.abort(); clearInterval(poll); };
  }, [baseUrl]);

  const runCycle = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${baseUrl}/api/ai/autopilot/run`, { method: "POST", credentials: "include" });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || err.details || t("aiAgents.auto.cycleFail")); }
      toast({ title: t("aiAgents.auto.cycleStarted"), description: t("aiAgents.auto.cycleStartedDesc") });
      setTimeout(async () => { try { const r2 = await fetch(`${baseUrl}/api/ai/autopilot/status`, { credentials: "include" }); if (r2.ok) setStatus(await r2.json()); } catch {} }, 5000);
    } catch (e: any) {
      toast({ title: t("aiAgents.toast.error"), description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const startAutopilot = async () => {
    setStarting(true);
    try {
      const r = await fetch(`${baseUrl}/api/ai/autopilot/start`, { method: "POST", credentials: "include" });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || t("aiAgents.auto.activationFail")); }
      const data = await r.json();
      if (data.firstCycle) setCycleResult(data.firstCycle);
      toast({ title: t("aiAgents.auto.activated"), description: t("aiAgents.auto.activatedDesc") });
      try { const r2 = await fetch(`${baseUrl}/api/ai/autopilot/status`, { credentials: "include" }); if (r2.ok) setStatus(await r2.json()); } catch {}
    } catch (e: any) {
      toast({ title: t("aiAgents.toast.error"), description: e.message, variant: "destructive" });
    } finally { setStarting(false); }
  };

  const stopAutopilot = async () => {
    setStopping(true);
    try {
      await fetch(`${baseUrl}/api/ai/autopilot/stop`, { method: "POST", credentials: "include" });
      toast({ title: t("aiAgents.auto.deactivated") });
      try { const r2 = await fetch(`${baseUrl}/api/ai/autopilot/status`, { credentials: "include" }); if (r2.ok) setStatus(await r2.json()); } catch {}
    } catch (e: any) {
      toast({ title: t("aiAgents.toast.error"), description: e.message, variant: "destructive" });
    } finally { setStopping(false); }
  };

  const severityColor = (s: string) => {
    switch (s) {
      case "critique": return "bg-red-500";
      case "haute": return "bg-orange-500";
      case "moyenne": return "bg-amber-500";
      default: return "bg-gray-400";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white shadow-lg">
            <Rocket className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
              {t("aiAgents.auto.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("aiAgents.auto.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canRunAgents ? (
            <>
              <Button onClick={runCycle} disabled={loading} variant="outline" className="gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {t("aiAgents.auto.manualCycle")}
              </Button>
              {status?.active ? (
                <Button onClick={stopAutopilot} disabled={stopping} variant="destructive" className="gap-2">
                  {stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
                  {t("aiAgents.auto.stop")}
                </Button>
              ) : (
                <Button onClick={startAutopilot} disabled={starting} className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700">
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                  {t("aiAgents.auto.activate")}
                </Button>
              )}
            </>
          ) : (
            <Badge variant="secondary" className="py-1.5 px-3 text-xs">
              <Eye className="w-3 h-3 mr-1.5" /> {t("aiAgents.readMode")}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className={`${status?.active ? 'border-emerald-300 dark:border-emerald-700' : 'border-muted'}`}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${status?.active ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                <HeartPulse className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("aiAgents.auto.status")}</p>
                <p className={`text-sm font-bold ${status?.active ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                  {status?.active ? t("aiAgents.auto.active") : t("aiAgents.auto.inactive")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600">
                <Radar className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("aiAgents.auto.cycles")}</p>
                <p className="text-sm font-bold">{status?.cycleCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-fuchsia-100 dark:bg-fuchsia-900/30 flex items-center justify-center text-fuchsia-600">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("aiAgents.auto.corrections")}</p>
                <p className="text-sm font-bold">{status?.fixesApplied ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600">
                <Eye className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("aiAgents.auto.issuesFound")}</p>
                <p className="text-sm font-bold">{status?.issuesFound ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {cycleResult && (
        <>
          <Card className="border-violet-200 dark:border-violet-800 bg-gradient-to-br from-violet-50/30 to-fuchsia-50/20 dark:from-violet-950/10 dark:to-fuchsia-950/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white flex items-center justify-center">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">{t("aiAgents.auto.diagnosticCycle", { n: cycleResult.cycleNumber })}</CardTitle>
                    <CardDescription className="text-xs">
                      {cycleResult.durationMs ? `${(cycleResult.durationMs / 1000).toFixed(1)}s` : ""} — {t("aiAgents.auto.consensusScore", { n: cycleResult.consensusScore })}
                    </CardDescription>
                  </div>
                </div>
                <AgentScoreRing score={cycleResult.consensusScore || 50} size={64} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Gemini", data: cycleResult.aiDiagnostics?.gemini, color: "from-blue-500 to-cyan-500", icon: Cpu },
                  { label: "OpenAI", data: cycleResult.aiDiagnostics?.openai, color: "from-green-500 to-emerald-500", icon: Brain },
                  { label: "Anthropic", data: cycleResult.aiDiagnostics?.anthropic, color: "from-orange-500 to-red-500", icon: MessageSquare },
                ].map(({ label, data, color, icon: AiIcon }) => (
                  <div key={label} className="p-3 rounded-xl border border-border/50 bg-background/80 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white`}>
                        <AiIcon className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{label}</p>
                        {data ? (
                          <p className={`text-lg font-bold ${getScoreColor(data.score || 50)}`}>{data.score}/100</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">{t("aiAgents.auto.notAvailable")}</p>
                        )}
                      </div>
                    </div>
                    {data?.diagnosis && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{data.diagnosis.substring(0, 120)}{data.diagnosis.length > 120 ? "..." : ""}</p>
                    )}
                    {data && (
                      <div className="flex gap-1.5">
                        <Badge variant="outline" className="text-[9px] h-4">{t("aiAgents.auto.actions", { count: data.actions || 0 })}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4">{t("aiAgents.auto.improvements", { count: data.improvements || 0 })}</Badge>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {cycleResult.consensus && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-violet-100/50 to-fuchsia-100/50 dark:from-violet-900/20 dark:to-fuchsia-900/20 border border-violet-200/50 space-y-3">
                  <h4 className="text-xs font-bold text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
                    <Crown className="w-3.5 h-3.5" /> {t("aiAgents.auto.consensus")}
                  </h4>
                  <p className="text-sm text-foreground/90 leading-relaxed">{cycleResult.consensus.consensus}</p>

                  {cycleResult.consensus.agreements?.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-emerald-600">{t("aiAgents.auto.agreements")}</p>
                      {cycleResult.consensus.agreements.map((a: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{a}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {cycleResult.consensus.topActions?.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-violet-600">{t("aiAgents.auto.priorityActions")}</p>
                      {cycleResult.consensus.topActions.slice(0, 5).map((a: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-background/60 text-[11px]">
                          <div className="w-5 h-5 rounded-full bg-violet-500 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                            {i + 1}
                          </div>
                          <div className="flex-1">
                            <span className="font-medium">{a.action}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {a.agreedBy?.map((src: string) => (
                                <Badge key={src} variant="outline" className="text-[8px] h-3.5">{src}</Badge>
                              ))}
                              <Badge className={`text-[8px] h-3.5 ${a.urgency === "immediate" ? "bg-red-500" : a.urgency === "court_terme" ? "bg-amber-500" : "bg-blue-500"}`}>
                                {a.urgency}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {cycleResult.consensus.nextCycleRecommendation && (
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50 text-[11px]">
                      <ArrowRight className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                      <span className="text-blue-700 dark:text-blue-400">{cycleResult.consensus.nextCycleRecommendation}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {cycleResult.issues?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  {t("aiAgents.auto.issuesDetected", { count: cycleResult.issues.length })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cycleResult.issues.map((issue: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${severityColor(issue.severity)}`} />
                        <div>
                          <p className="text-sm font-medium">{issue.title}</p>
                          <p className="text-[10px] text-muted-foreground">{issue.category}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{issue.count}</Badge>
                        <Badge className={`text-[10px] ${severityColor(issue.severity)} text-white`}>{issue.severity}</Badge>
                        {issue.autoFixable && (
                          <Badge className="text-[10px] bg-emerald-500 text-white">
                            <Wrench className="w-2.5 h-2.5 mr-0.5" /> {t("aiAgents.auto.autoFixed")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {cycleResult.autoFixes?.length > 0 && (
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  {t("aiAgents.auto.autoFixes", { count: cycleResult.autoFixes.length })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cycleResult.autoFixes.map((fix: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{fix.description}</p>
                        <p className="text-[10px] text-muted-foreground">{fix.action} — {fix.result}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {cycleResult.allPredictions?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                  {t("aiAgents.auto.predictions")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {cycleResult.allPredictions.slice(0, 6).map((pred: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg border border-border/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-[9px] h-4">{pred.source}</Badge>
                        <Badge className={`text-[9px] h-4 ${pred.probability === "haute" ? "bg-red-500" : pred.probability === "moyenne" ? "bg-amber-500" : "bg-blue-500"} text-white`}>
                          {pred.probability}
                        </Badge>
                      </div>
                      <p className="text-xs font-medium">{pred.trend}</p>
                      {pred.recommendation && <p className="text-[10px] text-muted-foreground">{pred.recommendation}</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {status?.recentLogs?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              {t("aiAgents.auto.journal")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-1.5 font-mono text-[11px]">
                {status.recentLogs.map((log: any, i: number) => (
                  <div key={i} className={`flex items-start gap-2 p-2 rounded ${
                    log.type === "error" ? "bg-red-50 dark:bg-red-950/20" :
                    log.type === "fix" ? "bg-emerald-50 dark:bg-emerald-950/20" :
                    log.type === "ai" ? "bg-violet-50 dark:bg-violet-950/20" :
                    "bg-muted/30"
                  }`}>
                    <CircleDot className={`w-3 h-3 mt-0.5 shrink-0 ${
                      log.type === "error" ? "text-red-500" :
                      log.type === "fix" ? "text-emerald-500" :
                      log.type === "ai" ? "text-violet-500" :
                      "text-muted-foreground"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString("fr-FR")}</span>
                        {log.provider && <Badge variant="outline" className="text-[8px] h-3.5">{log.provider}</Badge>}
                      </div>
                      <p className="text-foreground break-words">{log.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {!cycleResult && !status?.recentLogs?.length && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Rocket className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t("aiAgents.auto.ready")}</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              {t("aiAgents.auto.readyDesc")}
            </p>
            {canRunAgents && (
              <div className="flex items-center justify-center gap-3">
                <Button onClick={runCycle} disabled={loading} variant="outline" className="gap-2">
                  <Play className="w-4 h-4" /> {t("aiAgents.auto.manualCycle")}
                </Button>
                <Button onClick={startAutopilot} disabled={starting} className="gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-600">
                  <Power className="w-4 h-4" /> {t("aiAgents.auto.activateAutopilot")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
