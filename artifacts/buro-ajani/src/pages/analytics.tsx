import { useState, useCallback, useEffect } from "react";
import { useGetCallAnalytics, useGetCallDistribution, useGetHourlyPerformance, useGetWeeklyReport, useGetTaskStats, useGetAiInlineSuggestMetrics } from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon3D } from "@/components/icon-3d";
import analyticsWorkImg from "@/assets/images/analytics-work.png";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Phone, PhoneIncoming, PhoneMissed, Voicemail, TrendingUp, TrendingDown,
  BarChart3, Clock, Target, AlertTriangle, CheckCircle2, Sparkles, Loader2,
  ArrowUpRight, ArrowDownRight, Activity, Zap, Shield, Brain, Printer, Download,
  FolderKanban
} from "lucide-react";

const BASE = import.meta.env.BASE_URL ?? "/";

interface AIAnalysis {
  resumeExecutif: string;
  pointsForts: { titre: string; detail: string }[];
  pointsAttention: { titre: string; detail: string; recommandation: string }[];
  tendances: { titre: string; detail: string }[];
  recommandations: { priorite: string; action: string; impact: string }[];
  scoreGlobal: number;
}

export default function Analytics() {
  const [period, setPeriod] = useState<"today" | "week" | "month" | "year">("week");
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: analytics, isLoading: isAnalyticsLoading } = useGetCallAnalytics(
    { period },
    { query: { queryKey: ["callAnalytics", period] } }
  );

  const { data: distribution, isLoading: isDistributionLoading } = useGetCallDistribution(
    { query: { queryKey: ["callDistribution"] } }
  );

  const { data: hourlyPerf, isLoading: isHourlyLoading } = useGetHourlyPerformance(
    { query: { queryKey: ["hourlyPerformance"] } }
  );

  const { data: weeklyReport, isLoading: isWeeklyLoading } = useGetWeeklyReport(
    { query: { queryKey: ["weeklyReport"] } }
  );

  const { data: taskStats, isLoading: isTaskStatsLoading } = useGetTaskStats(
    { query: { queryKey: ["taskStats"] } }
  );

  const [projetsStats, setProjetsStats] = useState<{
    total: number; active: number; termine: number; overdue: number;
    avgProgress: number; highPriority: number; byStatus: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    fetch(`${BASE}api/projets/stats`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setProjetsStats(d))
      .catch(() => {});
  }, []);

  const COLORS = ['hsl(142.1 76.2% 36.3%)', 'hsl(215.4 16.3% 46.9%)', 'hsl(0 84.2% 60.2%)', 'hsl(43 96% 56%)', 'hsl(221 83% 53%)'];
  const SENTIMENT_COLORS: Record<string, string> = {
    'tres_positif': 'hsl(142.1 76.2% 28%)',
    'positif': 'hsl(142.1 76.2% 36.3%)',
    'neutre': 'hsl(215.4 16.3% 46.9%)',
    'negatif': 'hsl(0 84.2% 60.2%)',
    'tres_negatif': 'hsl(0 84.2% 45%)'
  };
  const STATUS_COLORS: Record<string, string> = {
    'repondu': 'hsl(142.1 76.2% 36.3%)',
    'manque': 'hsl(0 84.2% 60.2%)',
    'messagerie': 'hsl(43 96% 56%)'
  };

  const requestAIAnalysis = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const apiBase = `${BASE}api`;
      const resp = await fetch(`${apiBase}/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ period }),
      });
      if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
      const data = await resp.json();
      setAiAnalysis(data);
    } catch (e: any) {
      setAiError(e.message || "Erreur lors de l'analyse IA");
    } finally {
      setAiLoading(false);
    }
  }, [period]);

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600";
    if (score >= 60) return "text-amber-600";
    return "text-destructive";
  };

  const priorityColor = (p: string) => {
    if (p === "haute") return "destructive" as const;
    if (p === "moyenne") return "default" as const;
    return "secondary" as const;
  };

  const answeredCount = analytics?.totalAnswered ?? 0;
  const missedCount = analytics?.totalMissed ?? 0;
  const voicemailCount = analytics?.totalVoicemail ?? 0;
  const totalCalls = answeredCount + missedCount + voicemailCount;
  const answerRate = analytics?.answerRate ?? 0;

  const radarData = [
    { subject: "Reponse", value: answerRate, fullMark: 100 },
    { subject: "Taches", value: taskStats?.completionRate ?? 0, fullMark: 100 },
    { subject: "Sentiment+", value: distribution?.bySentiment ? Math.round((distribution.bySentiment.find((s: any) => s.sentiment === "positif")?.count ?? 0) / Math.max(1, distribution.bySentiment.reduce((a: number, b: any) => a + b.count, 0)) * 100) : 0, fullMark: 100 },
    { subject: "Ponctualite", value: Math.min(100, 100 - (taskStats?.overdueTasks ?? 0) * 10), fullMark: 100 },
    { subject: "Volume", value: Math.min(100, (weeklyReport?.totalCalls ?? 0) * 5), fullMark: 100 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={BarChart3} variant="cyan" size="md" /> Analyse & Rapports</h1>
          <p className="text-muted-foreground mt-1">Statistiques detaillees et performances du secretariat.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            onClick={requestAIAnalysis}
            disabled={aiLoading}
            className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg"
          >
            {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Analyse IA Gemini
          </Button>
          <Select value={period} onValueChange={(val: any) => setPeriod(val)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Periode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Aujourd'hui</SelectItem>
              <SelectItem value="week">Cette semaine</SelectItem>
              <SelectItem value="month">Ce mois</SelectItem>
              <SelectItem value="year">Cette annee</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-32">
          <img src={analyticsWorkImg} alt="Analyse des données" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-900/80 via-cyan-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Centre d'analyse intelligent</h3>
              <p className="text-white/80 text-sm mt-1">Rapports detailles, tendances et recommandations pilotes par l'IA Gemini.</p>
            </div>
          </div>
        </div>
      </Card>

      {(aiAnalysis || aiLoading || aiError) && (
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50/50 to-indigo-50/50 dark:from-violet-950/20 dark:to-indigo-950/20 dark:border-violet-800">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
                  <Brain className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">Analyse IA - Gemini</CardTitle>
                  <CardDescription>Insights generes par intelligence artificielle</CardDescription>
                </div>
              </div>
              {aiAnalysis?.scoreGlobal != null && (
                <div className="text-center">
                  <div className={`text-4xl font-black ${scoreColor(aiAnalysis.scoreGlobal)}`}>
                    {aiAnalysis.scoreGlobal}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium">Score global</div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {aiLoading && (
              <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
                <span>Gemini analyse vos données en profondeur...</span>
              </div>
            )}
            {aiError && (
              <div className="flex items-center gap-2 text-destructive py-4">
                <AlertTriangle className="h-5 w-5" />
                <span>{aiError}</span>
              </div>
            )}
            {aiAnalysis && !aiLoading && (
              <Tabs defaultValue="resume" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="resume">Resume</TabsTrigger>
                  <TabsTrigger value="forces">Forces & Attention</TabsTrigger>
                  <TabsTrigger value="tendances">Tendances</TabsTrigger>
                  <TabsTrigger value="actions">Actions</TabsTrigger>
                </TabsList>

                <TabsContent value="resume" className="mt-4">
                  <p className="text-sm leading-relaxed text-foreground/90">{aiAnalysis.resumeExecutif}</p>
                </TabsContent>

                <TabsContent value="forces" className="mt-4 space-y-4">
                  <div>
                    <h4 className="font-semibold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" /> Points forts
                    </h4>
                    <div className="grid gap-2">
                      {aiAnalysis.pointsForts.map((p, i) => (
                        <div key={i} className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                          <div className="font-medium text-sm text-emerald-800 dark:text-emerald-300">{p.titre}</div>
                          <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-1">{p.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <h4 className="font-semibold text-amber-700 dark:text-amber-400 mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" /> Points d'attention
                    </h4>
                    <div className="grid gap-2">
                      {aiAnalysis.pointsAttention.map((p, i) => (
                        <div key={i} className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                          <div className="font-medium text-sm text-amber-800 dark:text-amber-300">{p.titre}</div>
                          <div className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">{p.detail}</div>
                          <div className="text-xs text-amber-900 dark:text-amber-200 mt-2 font-medium flex items-center gap-1">
                            <Zap className="h-3 w-3" /> {p.recommandation}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="tendances" className="mt-4">
                  <div className="grid gap-3">
                    {aiAnalysis.tendances.map((t, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        <Activity className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium text-sm">{t.titre}</div>
                          <div className="text-xs text-muted-foreground mt-1">{t.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="actions" className="mt-4">
                  <div className="grid gap-3">
                    {aiAnalysis.recommandations.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                        <Badge variant={priorityColor(r.priorite)} className="mt-0.5 shrink-0 uppercase text-[10px]">
                          {r.priorite}
                        </Badge>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{r.action}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Target className="h-3 w-3" /> Impact : {r.impact}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Taux de reponse</CardDescription>
              <div className="p-2 rounded-lg bg-primary/10"><Target className="h-4 w-4 text-primary" /></div>
            </div>
            <CardTitle className="text-3xl">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : `${answerRate}%`}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={answerRate} className="h-1.5" />
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-emerald-500/10 to-transparent rounded-bl-full" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Total Repondus</CardDescription>
              <div className="p-2 rounded-lg bg-emerald-500/10"><PhoneIncoming className="h-4 w-4 text-emerald-600" /></div>
            </div>
            <CardTitle className="text-3xl text-emerald-600">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : answeredCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {totalCalls > 0 ? `${Math.round(answeredCount / totalCalls * 100)}% du total` : "Aucun appel"}
            </div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-destructive/10 to-transparent rounded-bl-full" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Total Manques</CardDescription>
              <div className="p-2 rounded-lg bg-destructive/10"><PhoneMissed className="h-4 w-4 text-destructive" /></div>
            </div>
            <CardTitle className="text-3xl text-destructive">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : missedCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {totalCalls > 0 ? `${Math.round(missedCount / totalCalls * 100)}% du total` : "Aucun appel"}
            </div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-bl-full" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Messages Vocaux</CardDescription>
              <div className="p-2 rounded-lg bg-amber-500/10"><Voicemail className="h-4 w-4 text-amber-600" /></div>
            </div>
            <CardTitle className="text-3xl text-amber-600">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : voicemailCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {totalCalls > 0 ? `${Math.round(voicemailCount / totalCalls * 100)}% du total` : "Aucun appel"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Volume horaire des appels</CardTitle>
                <CardDescription>Repartition des appels par heure (Aujourd'hui)</CardDescription>
              </div>
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {isHourlyLoading ? (
              <Skeleton className="w-full h-[300px]" />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={hourlyPerf?.hours || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="answeredGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142.1 76.2% 36.3%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(142.1 76.2% 36.3%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="missedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(0 84.2% 60.2%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(0 84.2% 60.2%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                      labelFormatter={(h) => `${h}h00`}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Area type="monotone" dataKey="answered" name="Repondus" stroke="hsl(142.1 76.2% 36.3%)" fillOpacity={1} fill="url(#answeredGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="missed" name="Manques" stroke="hsl(0 84.2% 60.2%)" fillOpacity={1} fill="url(#missedGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Volume de la periode</CardTitle>
                <CardDescription>Historique selon la periode selectionnee</CardDescription>
              </div>
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {isAnalyticsLoading ? (
              <Skeleton className="w-full h-[300px]" />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics?.dataPoints || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="answered" name="Repondus" stackId="a" fill="hsl(142.1 76.2% 36.3%)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="missed" name="Manques" stackId="a" fill="hsl(0 84.2% 60.2%)" />
                    <Bar dataKey="voicemail" name="Messagerie" stackId="a" fill="hsl(43 96% 56%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Sentiment des Appels</CardTitle>
            <CardDescription>Repartition par ressenti</CardDescription>
          </CardHeader>
          <CardContent>
            {isDistributionLoading ? (
              <Skeleton className="w-full h-[250px]" />
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={distribution?.bySentiment || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="count"
                      nameKey="sentiment"
                    >
                      {(distribution?.bySentiment || []).map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={SENTIMENT_COLORS[entry.sentiment] || COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: number) => [`${value} appels`]}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                    />
                    <Legend
                      iconType="circle"
                      layout="vertical"
                      verticalAlign="middle"
                      align="right"
                      wrapperStyle={{ fontSize: '12px' }}
                      formatter={(value) => <span className="capitalize">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Comparatif Semaine</CardTitle>
            <CardDescription>Evolution par rapport a la semaine passee</CardDescription>
          </CardHeader>
          <CardContent>
            {isWeeklyLoading ? (
              <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : weeklyReport ? (
              <div className="space-y-5 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Volume d'appels</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{weeklyReport.totalCalls}</span>
                    <Badge variant={weeklyReport.comparisonPrevWeek.callsDiff > 0 ? "default" : "destructive"} className="gap-1">
                      {weeklyReport.comparisonPrevWeek.callsDiff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {weeklyReport.comparisonPrevWeek.callsDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.callsDiff}%
                    </Badge>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Taux de reponse</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{weeklyReport.answerRate}%</span>
                    <Badge variant={weeklyReport.comparisonPrevWeek.answerRateDiff > 0 ? "default" : "destructive"} className="gap-1">
                      {weeklyReport.comparisonPrevWeek.answerRateDiff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {weeklyReport.comparisonPrevWeek.answerRateDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.answerRateDiff}%
                    </Badge>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Duree moyenne</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{Math.floor(weeklyReport.avgDuration / 60)}m {weeklyReport.avgDuration % 60}s</span>
                    <Badge variant={weeklyReport.comparisonPrevWeek.durationDiff > 0 ? "default" : "destructive"} className="gap-1">
                      {weeklyReport.comparisonPrevWeek.durationDiff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {weeklyReport.comparisonPrevWeek.durationDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.durationDiff}%
                    </Badge>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance des Taches</CardTitle>
            <CardDescription>Indicateurs d'efficacite</CardDescription>
          </CardHeader>
          <CardContent>
            {isTaskStatsLoading ? (
              <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : taskStats ? (
              <div className="space-y-5 mt-2">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Taux d'achevement</span>
                    <span className="font-bold">{taskStats.completionRate}%</span>
                  </div>
                  <Progress value={taskStats.completionRate} className="h-2" />
                </div>
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-lg text-center">
                    <span className="block text-xl font-bold text-emerald-600">{taskStats.completedTasks}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">Terminees</span>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/30 p-3 rounded-lg text-center">
                    <span className="block text-xl font-bold text-destructive">{taskStats.overdueTasks}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">En retard</span>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg text-center">
                    <span className="block text-xl font-bold text-amber-600">{taskStats.highPriorityPending}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">Urgentes</span>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FolderKanban className="w-4 h-4 text-indigo-500" />Performance Projets</CardTitle>
            <CardDescription>Suivi du portefeuille projets</CardDescription>
          </CardHeader>
          <CardContent>
            {!projetsStats ? (
              <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : projetsStats.total === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Aucun projet créé.</p>
            ) : (
              <div className="space-y-5 mt-2">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Avancement moyen</span>
                    <span className="font-bold">{projetsStats.avgProgress}%</span>
                  </div>
                  <Progress value={projetsStats.avgProgress} className="h-2" />
                </div>
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
                  <div className="bg-indigo-50 dark:bg-indigo-950/30 p-3 rounded-lg text-center">
                    <span className="block text-xl font-bold text-indigo-600">{projetsStats.active}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">En cours</span>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-lg text-center">
                    <span className="block text-xl font-bold text-emerald-600">{projetsStats.termine}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">Terminés</span>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${projetsStats.overdue > 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-slate-50 dark:bg-slate-900/30"}`}>
                    <span className={`block text-xl font-bold ${projetsStats.overdue > 0 ? "text-destructive" : "text-slate-600"}`}>{projetsStats.overdue}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">En retard</span>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg text-center">
                    <span className="block text-xl font-bold text-amber-600">{projetsStats.highPriority}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">Haute priorité</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Radar de Performance</CardTitle>
                <CardDescription>Vue multi-axes des indicateurs cles</CardDescription>
              </div>
              <Shield className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="Performance" dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Repartition des Appels</CardTitle>
                <CardDescription>Par statut et par direction</CardDescription>
              </div>
              <Phone className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {isDistributionLoading ? (
              <Skeleton className="w-full h-[300px]" />
            ) : (
              <div className="grid grid-cols-2 gap-6 h-[300px]">
                <div className="flex flex-col items-center justify-center">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Par Statut</h4>
                  <ResponsiveContainer width="100%" height="80%">
                    <PieChart>
                      <Pie
                        data={distribution?.byStatus || []}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        paddingAngle={3}
                        dataKey="count"
                        nameKey="status"
                      >
                        {(distribution?.byStatus || []).map((entry: any, index: number) => (
                          <Cell key={`stat-${index}`} fill={STATUS_COLORS[entry.status] || COLORS[index]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: number) => [`${value} appels`]}
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)', fontSize: '12px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex gap-3 text-[10px]">
                    {(distribution?.byStatus || []).map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] || COLORS[i] }} />
                        <span className="capitalize text-muted-foreground">{s.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Par Direction</h4>
                  <ResponsiveContainer width="100%" height="80%">
                    <PieChart>
                      <Pie
                        data={distribution?.byDirection || []}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        paddingAngle={3}
                        dataKey="count"
                        nameKey="direction"
                      >
                        {(distribution?.byDirection || []).map((_: any, index: number) => (
                          <Cell key={`dir-${index}`} fill={COLORS[index + 3] || COLORS[index]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: number) => [`${value} appels`]}
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)', fontSize: '12px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex gap-3 text-[10px]">
                    {(distribution?.byDirection || []).map((d: any, i: number) => (
                      <div key={i} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i + 3] || COLORS[i] }} />
                        <span className="capitalize text-muted-foreground">{d.direction}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <InlineSuggestMetricsCard />
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  note: "Notes internes",
  prospect_note: "Notes prospect",
  email_body: "Corps d'e-mail",
  call_note: "Notes d'appel",
  task_description: "Descriptions de tâche",
  message_content: "Messages",
  project_description: "Descriptions de projet",
  project_note: "Notes de projet",
};

function formatPct(rate: number): string {
  return `${Math.round((rate || 0) * 1000) / 10}%`;
}

function InlineSuggestMetricsCard() {
  const { data, isLoading } = useGetAiInlineSuggestMetrics(
    { days: 30 },
    { query: { queryKey: ["aiInlineSuggestMetrics", 30] } },
  );

  const totals = data?.totals ?? { shown: 0, accepted: 0, dismissed: 0, acceptanceRate: 0 };
  const byField = data?.byField ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Suggestions IA en ligne — taux d'acceptation (30 jours)
        </CardTitle>
        <CardDescription>
          Mesure de l'utilité des propositions ghost-text : combien sont affichées et combien sont acceptées par Tab.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Affichées</div>
                <div className="text-lg font-semibold">{totals.shown}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Acceptées</div>
                <div className="text-lg font-semibold text-primary">{totals.accepted}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Rejetées</div>
                <div className="text-lg font-semibold">{totals.dismissed}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Taux d'acceptation</div>
                <div className="text-lg font-semibold">{formatPct(totals.acceptanceRate)}</div>
              </div>
            </div>

            {byField.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Pas encore de suggestions affichées sur les 30 derniers jours.
              </div>
            ) : (
              <div className="space-y-2">
                {byField.map((row) => (
                  <div key={row.fieldType} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{FIELD_LABELS[row.fieldType] ?? row.fieldType}</span>
                      <span className="text-muted-foreground">
                        {row.accepted} / {row.shown} acceptées · {formatPct(row.acceptanceRate)}
                      </span>
                    </div>
                    <Progress value={Math.min(100, Math.round((row.acceptanceRate || 0) * 100))} className="h-2" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
