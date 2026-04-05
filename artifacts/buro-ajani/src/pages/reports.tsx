import { useState } from "react";
import { FileText, Calendar, TrendingUp, TrendingDown, Minus, Phone, CheckSquare, MessageSquare, Users, Loader2, RefreshCw, Trash2, ChevronRight, Award, AlertTriangle, Clock, ArrowUp, ArrowDown, BarChart3, Sparkles, Download, Eye } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon3D } from "@/components/icon-3d";
import analyticsWorkImg from "@/assets/images/analytics-work.png";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useGenerateDailyReport, useListDailyReports, useGetActivitySummary, useDeleteDailyReport, getListDailyReportsQueryKey, getGetActivitySummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";

type Metrics = {
  calls?: { total?: number; answered?: number; missed?: number; avgDuration?: number; inbound?: number; outbound?: number; answerRate?: number; sentiment?: { positif?: number; negatif?: number; neutre?: number } };
  tasks?: { completed?: number; created?: number; overdue?: number; highPriority?: number };
  messages?: { total?: number; unread?: number; urgent?: number };
  contacts?: { added?: number };
  pointsAttention?: string[];
  tendance?: string;
  prochainePriorite?: string;
  activites?: Array<{ heure?: string; description?: string; categorie?: string }>;
};

type Recommendation = {
  titre?: string;
  description?: string;
  priorite?: string;
  categorie?: string;
};

type Report = {
  id: number;
  reportDate: string;
  summary: string;
  highlights: unknown;
  metrics: unknown;
  aiInsights?: string | null;
  aiRecommendations: unknown;
  callsCount: number;
  tasksCompleted: number;
  tasksCreated: number;
  messagesCount: number;
  contactsAdded: number;
  avgCallDuration: number;
  answerRate: number;
  score: number;
  status: string;
  createdAt: string;
};

function formatDate(dateStr: string) {
  try {
    if (!dateStr) return "";
    const str = dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00`;
    const d = new Date(str);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr: string) {
  try {
    if (!dateStr) return "";
    const str = dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00`;
    const d = new Date(str);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  } catch {
    return dateStr;
  }
}

function formatDuration(seconds: number) {
  if (!seconds) return "0s";
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-500" : score >= 40 ? "text-orange-500" : "text-red-500";
  const bgColor = score >= 80 ? "bg-emerald-100" : score >= 60 ? "bg-amber-100" : score >= 40 ? "bg-orange-100" : "bg-red-100";
  const label = score >= 80 ? "Excellent" : score >= 60 ? "Bon" : score >= 40 ? "Moyen" : "A ameliorer";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`${bgColor} rounded-full w-16 h-16 flex items-center justify-center`}>
        <span className={`text-2xl font-bold ${color}`}>{score}</span>
      </div>
      <span className={`text-xs font-medium ${color}`}>{label}</span>
    </div>
  );
}

function TrendIcon({ tendance }: { tendance?: string }) {
  if (tendance === "hausse") return <ArrowUp className="w-4 h-4 text-emerald-500" />;
  if (tendance === "baisse") return <ArrowDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

function PriorityBadge({ priorite }: { priorite?: string }) {
  const colors: Record<string, string> = {
    haute: "bg-red-100 text-red-700",
    moyenne: "bg-amber-100 text-amber-700",
    basse: "bg-blue-100 text-blue-700",
  };
  return <Badge className={`${colors[priorite || ""] || "bg-gray-100 text-gray-700"} text-[10px]`}>{priorite || "inconnue"}</Badge>;
}

function CategoryIcon({ categorie }: { categorie?: string }) {
  const icons: Record<string, React.ReactNode> = {
    appels: <Phone className="w-3.5 h-3.5 text-blue-500" />,
    appel: <Phone className="w-3.5 h-3.5 text-blue-500" />,
    taches: <CheckSquare className="w-3.5 h-3.5 text-purple-500" />,
    tache: <CheckSquare className="w-3.5 h-3.5 text-purple-500" />,
    messages: <MessageSquare className="w-3.5 h-3.5 text-amber-500" />,
    message: <MessageSquare className="w-3.5 h-3.5 text-amber-500" />,
    contacts: <Users className="w-3.5 h-3.5 text-emerald-500" />,
    contact: <Users className="w-3.5 h-3.5 text-emerald-500" />,
    general: <BarChart3 className="w-3.5 h-3.5 text-gray-500" />,
  };
  return <>{icons[categorie || ""] || <BarChart3 className="w-3.5 h-3.5 text-gray-500" />}</>;
}

export default function Reports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [viewingReport, setViewingReport] = useState<Report | null>(null);
  const [activeTab, setActiveTab] = useState("generer");

  const { data: reportsData, isLoading: loadingReports } = useListDailyReports({ limit: 30, offset: 0 });
  const { data: activityData, isLoading: loadingActivity } = useGetActivitySummary();
  const generateReport = useGenerateDailyReport();
  const deleteReport = useDeleteDailyReport();

  const handleGenerate = () => {
    generateReport.mutate({ data: { date: selectedDate } }, {
      onSuccess: (data: any) => {
        toast({ title: "Rapport genere", description: `Le rapport du ${formatDate(selectedDate)} a ete genere avec succes.` });
        queryClient.invalidateQueries({ queryKey: getListDailyReportsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetActivitySummaryQueryKey() });
        if (data?.report) {
          setViewingReport(data.report);
          setActiveTab("historique");
        }
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible de generer le rapport. Reessayez.", variant: "destructive" });
      },
    });
  };

  const handleDelete = (id: number) => {
    deleteReport.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Rapport supprime", description: "Le rapport a ete supprime." });
        queryClient.invalidateQueries({ queryKey: getListDailyReportsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetActivitySummaryQueryKey() });
        if (viewingReport?.id === id) setViewingReport(null);
      },
    });
  };

  const reports = (reportsData as any)?.reports || [];
  const todayData = (activityData as any)?.today;
  const weekReports = (activityData as any)?.weekReports || [];
  const weekStats = (activityData as any)?.weekStats;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3"><Icon3D icon={FileText} variant="rose" size="md" /> Rapports Journaliers</h1>
          <p className="text-muted-foreground mt-1">Suivi des activites et rapports IA generes automatiquement.</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-44"
          />
          <Button onClick={handleGenerate} disabled={generateReport.isPending} className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white">
            {generateReport.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Generation...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generer le rapport
              </>
            )}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={analyticsWorkImg} alt="Rapports et analyses" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-rose-900/80 via-rose-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Rapports automatises</h3>
              <p className="text-white/80 text-sm mt-1">Bilans quotidiens generes par l'IA avec indicateurs de performance.</p>
            </div>
          </div>
        </div>
      </Card>

      {todayData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Appels du jour</p>
                  <p className="text-2xl font-bold">{todayData.calls?.total || 0}</p>
                  <p className="text-xs text-muted-foreground">{todayData.calls?.answerRate || 0}% repondus</p>
                </div>
                <Phone className="w-8 h-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Taches terminees</p>
                  <p className="text-2xl font-bold">{todayData.tasks?.completed || 0}</p>
                  <p className="text-xs text-muted-foreground">{todayData.tasks?.created || 0} creees</p>
                </div>
                <CheckSquare className="w-8 h-8 text-purple-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Messages</p>
                  <p className="text-2xl font-bold">{todayData.messages?.total || 0}</p>
                  <p className="text-xs text-muted-foreground">{todayData.messages?.unread || 0} non lus</p>
                </div>
                <MessageSquare className="w-8 h-8 text-amber-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Nouveaux contacts</p>
                  <p className="text-2xl font-bold">{todayData.contacts?.added || 0}</p>
                  <p className="text-xs text-muted-foreground">Duree moy. {formatDuration(todayData.calls?.avgDuration || 0)}</p>
                </div>
                <Users className="w-8 h-8 text-emerald-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {weekStats && weekReports.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Performance hebdomadaire
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <span className="text-3xl font-bold text-primary">{weekStats.avgScore}</span>
                <span className="text-xs text-muted-foreground">Score moyen</span>
              </div>
              <Separator orientation="vertical" className="h-12" />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{weekStats.totalReports} rapport(s) cette semaine</span>
                {weekStats.bestDay && (
                  <span className="text-xs text-muted-foreground">
                    Meilleur jour : {formatShortDate(weekStats.bestDay.date || weekStats.bestDay.reportDate || "")} (score {weekStats.bestDay.score})
                  </span>
                )}
              </div>
              <Separator orientation="vertical" className="h-12 hidden md:block" />
              <div className="flex gap-3 flex-wrap">
                {weekReports.slice(0, 7).map((r: any) => (
                  <div key={r.id} className="flex flex-col items-center gap-0.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      r.score >= 80 ? "bg-emerald-100 text-emerald-700" :
                      r.score >= 60 ? "bg-amber-100 text-amber-700" :
                      r.score >= 40 ? "bg-orange-100 text-orange-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {r.score}
                    </div>
                    <span className="text-[9px] text-muted-foreground">{formatShortDate(r.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="generer">Rapport du jour</TabsTrigger>
          <TabsTrigger value="historique">
            Historique ({reports.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generer" className="space-y-4 mt-4">
          <AiSuggestionsCard pageContext="rapports" />

          {generateReport.isPending && (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-violet-500" />
                <p className="text-lg font-medium">L'IA analyse les donnees de la journee...</p>
                <p className="text-sm text-muted-foreground">Generation du rapport en cours. Cela peut prendre quelques secondes.</p>
              </CardContent>
            </Card>
          )}

          {!generateReport.isPending && viewingReport && (
            <ReportDetail report={viewingReport} />
          )}

          {!generateReport.isPending && !viewingReport && (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center gap-4 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/30" />
                <h3 className="text-lg font-medium">Aucun rapport selectionne</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Selectionnez une date et cliquez sur "Generer le rapport" pour que l'IA analyse les activites de la journee et produise un rapport detaille.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="historique" className="mt-4">
          {loadingReports ? (
            <Card>
              <CardContent className="p-8 flex items-center justify-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Chargement des rapports...</span>
              </CardContent>
            </Card>
          ) : reports.length === 0 ? (
            <Card>
              <CardContent className="p-12 flex flex-col items-center justify-center gap-4 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/30" />
                <h3 className="text-lg font-medium">Aucun rapport genere</h3>
                <p className="text-sm text-muted-foreground">Les rapports generes apparaitront ici.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {reports.map((report: Report) => (
                <Card key={report.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setViewingReport(report)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <ScoreGauge score={report.score} />
                        <div>
                          <h3 className="font-medium">{formatDate(report.reportDate)}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-1 max-w-lg">{report.summary}</p>
                          <div className="flex gap-3 mt-1.5">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {report.callsCount} appels
                            </span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <CheckSquare className="w-3 h-3" /> {report.tasksCompleted} terminees
                            </span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" /> {report.messagesCount} messages
                            </span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="w-3 h-3" /> {report.contactsAdded} contacts
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setViewingReport(report); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" onClick={(e) => { e.stopPropagation(); handleDelete(report.id); }}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!viewingReport && activeTab === "historique"} onOpenChange={(open) => { if (!open) setViewingReport(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Rapport du {viewingReport ? formatDate(viewingReport.reportDate) : ""}</DialogTitle>
            <DialogDescription>Rapport genere par l'IA</DialogDescription>
          </DialogHeader>
          {viewingReport && <ReportDetail report={viewingReport} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportDetail({ report }: { report: Report }) {
  const metrics = (report.metrics || {}) as Metrics;
  const highlights = Array.isArray(report.highlights) ? report.highlights as string[] : [];
  const recommendations = Array.isArray(report.aiRecommendations) ? report.aiRecommendations as Recommendation[] : [];
  const activites = Array.isArray(metrics.activites) ? metrics.activites : [];
  const pointsAttention = Array.isArray(metrics.pointsAttention) ? metrics.pointsAttention : [];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <ScoreGauge score={report.score} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg">{formatDate(report.reportDate)}</h3>
            <TrendIcon tendance={metrics.tendance} />
            <Badge variant="outline" className="text-xs">{metrics.tendance === "hausse" ? "En hausse" : metrics.tendance === "baisse" ? "En baisse" : "Stable"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{report.summary}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Phone className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-medium text-blue-700">Appels</span>
          </div>
          <p className="text-xl font-bold text-blue-900">{report.callsCount}</p>
          <p className="text-xs text-blue-600">{report.answerRate}% repondus | {formatDuration(report.avgCallDuration)} moy.</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckSquare className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-medium text-purple-700">Taches</span>
          </div>
          <p className="text-xl font-bold text-purple-900">{report.tasksCompleted}</p>
          <p className="text-xs text-purple-600">{report.tasksCreated} creees</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-amber-700">Messages</span>
          </div>
          <p className="text-xl font-bold text-amber-900">{report.messagesCount}</p>
          <p className="text-xs text-amber-600">{metrics.messages?.unread || 0} non lus</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700">Contacts</span>
          </div>
          <p className="text-xl font-bold text-emerald-900">{report.contactsAdded}</p>
          <p className="text-xs text-emerald-600">Nouveaux contacts</p>
        </div>
      </div>

      {highlights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-500" />
              Points forts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {highlights.map((h, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5">+</span>
                  <span>{String(h)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {pointsAttention.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Points d'attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {pointsAttention.map((p, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">!</span>
                  <span>{String(p)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              Recommandations IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((rec, i) => (
                <div key={i} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <CategoryIcon categorie={rec.categorie} />
                      <span className="text-sm font-medium">{rec.titre}</span>
                    </div>
                    <PriorityBadge priorite={rec.priorite} />
                  </div>
                  <p className="text-xs text-muted-foreground">{rec.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activites.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              Chronologie des activites
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activites.map((act, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="flex items-center gap-2 min-w-[80px]">
                    <CategoryIcon categorie={act.categorie} />
                    <span className="text-xs text-muted-foreground font-mono">{act.heure}</span>
                  </div>
                  <span>{act.description}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {metrics.prochainePriorite && (
        <Card className="bg-gradient-to-r from-violet-50 to-purple-50 border-violet-200">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="bg-violet-100 rounded-full p-2">
              <ChevronRight className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-violet-900">Prochaine priorite</h4>
              <p className="text-sm text-violet-700">{metrics.prochainePriorite}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
