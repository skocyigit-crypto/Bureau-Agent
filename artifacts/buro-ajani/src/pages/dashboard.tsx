import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Phone, Users, CheckSquare, MessageSquare, ArrowUpRight, ArrowDownRight, Clock, Plus, Activity, BarChart3, Send, LayoutDashboard, Shield, HardDriveDownload, Zap, UserCheck, Brain, TrendingUp, Lightbulb } from "lucide-react";
import { StaggerContainer, StaggerItem, PressableCard, SlideUp } from "@/components/premium-animations";
import { SmartPulsePanel } from "@/components/smart-pulse-panel";
import { Icon3D, type Icon3DVariant } from "@/components/icon-3d";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { AiRecognitionPanel } from "@/components/ai-recognition-panel";
import { AiDiscoveryPanel } from "@/components/ai-discovery-panel";
import { CentralIntelligence } from "@/components/central-intelligence";
import { EmailComposer } from "@/components/email-composer";
import { LiveActivityFeed } from "@/components/live-activity-feed";
import { SafeComponent, QueryErrorAlert } from "@/components/safe-component";
import officeTeamImg from "@/assets/images/office-team.png";
import { useGetDashboardSummary, useGetRecentActivity, useGetTopContacts, useGetWeeklyReport, useGetHourlyPerformance, useGetTaskStats } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Bar, Cell, LineChart, Line, Legend } from "recharts";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Link } from "wouter";
import { useWorkspaceUser } from "@/components/workspace-user";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useTeamStatus() {
  const [team, setTeam] = useState<{ id: number; name: string; role: string; status: string; lastSeen: string }[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const fetchTeam = async () => {
      try {
        const res = await fetch(`${API}/api/team-status`, { credentials: "include", signal: controller.signal });
        if (!mounted) return;
        if (res.ok) { const d = await res.json(); setTeam(d.members || []); setError(false); }
        else { console.error("[Dashboard] team-status HTTP error:", res.status); setError(true); }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (mounted) { console.error("[Dashboard] team-status fetch failed:", err); setError(true); }
      }
    };
    fetchTeam();
    const t = setInterval(fetchTeam, 30000);
    return () => { mounted = false; controller.abort(); clearInterval(t); };
  }, []);
  return { team, error };
}

function useWeekComparison() {
  const [data, setData] = useState<{ day: string; thisWeek: number; lastWeek: number }[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API}/api/dashboard/week-comparison`, { credentials: "include", signal: controller.signal });
        if (!mounted) return;
        if (res.ok) { const d = await res.json(); setData(d.comparison || []); setError(false); }
        else { console.error("[Dashboard] week-comparison HTTP error:", res.status); setError(true); }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (mounted) { console.error("[Dashboard] week-comparison fetch failed:", err); setError(true); }
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, []);
  return { data, error };
}

export default function Dashboard() {
  const { user } = useWorkspaceUser();
  const [isEmailComposerOpen, setIsEmailComposerOpen] = useState(false);
  const now = useLiveClock();
  const { team: teamMembers, error: teamError } = useTeamStatus();
  const { data: weekComparison, error: weekCompError } = useWeekComparison();
  const { data: summary, isLoading: isLoadingSummary, error: summaryError } = useGetDashboardSummary({ query: { queryKey: ["dashboardSummary"] } });
  const { data: recentActivity, isLoading: isLoadingActivity, error: activityError } = useGetRecentActivity({ limit: 6 }, { query: { queryKey: ["recentActivity"] } });
  const { data: topContacts, isLoading: isLoadingContacts, error: contactsError } = useGetTopContacts({ limit: 5 }, { query: { queryKey: ["topContacts"] } });
  const { data: weeklyReport, isLoading: isLoadingWeekly, error: weeklyError } = useGetWeeklyReport({ query: { queryKey: ["weeklyReport"] } });
  const { data: hourlyPerf, isLoading: isLoadingHourly, error: hourlyError } = useGetHourlyPerformance({ query: { queryKey: ["hourlyPerformance"] } });
  const { data: taskStats, isLoading: isLoadingTaskStats, error: taskStatsError } = useGetTaskStats({ query: { queryKey: ["taskStats"] } });

  const dashboardError = summaryError || activityError || contactsError || weeklyError || hourlyError || taskStatsError;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const getHeatmapColor = (total: number, max: number) => {
    if (total === 0) return "hsl(var(--muted))";
    const intensity = Math.max(0.2, total / max);
    return `hsl(var(--primary) / ${intensity})`;
  };

  const maxHourlyCalls = hourlyPerf?.hours?.reduce((max: number, h: any) => Math.max(max, h.total), 0) || 1;

  const kpiCards: { title: string; value: number; icon: typeof Phone; trend?: number; trendLabel?: string; href: string; variant: Icon3DVariant }[] = [
    {
      title: "Appels Aujourd'hui",
      value: summary?.totalCallsToday || 0,
      icon: Phone,
      trend: summary?.callsTrend,
      trendLabel: "depuis hier",
      href: "/appels",
      variant: "blue",
    },
    {
      title: "Contacts",
      value: summary?.totalContacts || 0,
      icon: Users,
      href: "/contacts",
      variant: "indigo",
    },
    {
      title: "Taches en attente",
      value: summary?.pendingTasks || 0,
      icon: CheckSquare,
      href: "/taches",
      variant: "emerald",
    },
    {
      title: "Messages non lus",
      value: summary?.unreadMessages || 0,
      icon: MessageSquare,
      href: "/messages",
      variant: "amber",
    },
  ];

  return (
    <div className="space-y-6">
      {dashboardError && <QueryErrorAlert error={dashboardError as Error} title="Impossible de charger le tableau de bord" />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={LayoutDashboard} variant="navy" size="md" /> Tableau de bord</h1>
          <p className="text-muted-foreground mt-1">Vue d'ensemble de l'activite du bureau aujourd'hui.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/appels">
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Appel
            </Button>
          </Link>
          <Link href="/taches">
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Tache
            </Button>
          </Link>
          <Button size="sm" onClick={() => setIsEmailComposerOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Send className="w-4 h-4 mr-2" />
            E-mail IA
          </Button>
          <Link href="/analyse">
            <Button size="sm" className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700">
              <BarChart3 className="w-4 h-4 mr-2" />
              Analyse
            </Button>
          </Link>
        </div>
      </div>

      <SlideUp>
      <Card className="overflow-hidden border-0 shadow-lg premium-shadow">
        <div className="relative h-40 md:h-48">
          <img src={officeTeamImg} alt="Equipe professionnelle au bureau" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#1a2744]/80 via-[#1a2744]/50 to-transparent" />
          <div className="absolute inset-0 flex items-center p-6 md:p-8">
            <div className="text-white">
              <h2 className="text-xl md:text-2xl font-bold">Bienvenue, {user.prenom || user.nom}</h2>
              <p className="text-white/80 text-sm mt-1">Votre bureau est operationnel. Consultez les indicateurs du jour.</p>
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-1.5 text-sm text-emerald-300">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Systeme actif
                </div>
                <div className="text-sm text-amber-300">{user.organisation || "Bureau"}</div>
              </div>
            </div>
          </div>
        </div>
      </Card>
      </SlideUp>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/30 dark:to-slate-900/10 border-slate-200/50 dark:border-slate-800/30">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Clock className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="text-3xl font-bold tabular-nums tracking-tight">
                {format(now, "HH:mm:ss")}
              </div>
              <div className="text-sm text-muted-foreground capitalize">
                {format(now, "EEEE d MMMM yyyy", { locale: fr })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 dark:from-indigo-950/30 dark:to-indigo-900/10 border-indigo-200/50 dark:border-indigo-800/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">Equipe</span>
              <Badge variant="secondary" className="text-xs">{teamMembers.length} membres</Badge>
            </div>
            {teamMembers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {teamMembers.slice(0, 6).map(m => (
                  <div key={m.id} className="flex items-center gap-1.5 text-xs">
                    <div className={`w-2 h-2 rounded-full ${m.status === "online" ? "bg-emerald-500 animate-pulse" : m.status === "busy" ? "bg-amber-500" : "bg-gray-300"}`} />
                    <span className="truncate max-w-[80px]">{m.name}</span>
                  </div>
                ))}
                {teamMembers.length > 6 && <span className="text-xs text-muted-foreground">+{teamMembers.length - 6}</span>}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <UserCheck className="w-3.5 h-3.5" />
                <span>{teamError ? "Erreur de chargement de l'equipe" : "Chargement de l'equipe..."}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-50 to-cyan-100/50 dark:from-cyan-950/30 dark:to-cyan-900/10 border-cyan-200/50 dark:border-cyan-800/30">
          <CardContent className="p-4">
            <div className="text-sm font-medium text-cyan-600 dark:text-cyan-400 mb-2">Cette semaine vs precedente</div>
            {weekComparison.length > 0 ? (
              <div className="h-[60px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekComparison} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <Line type="monotone" dataKey="thisWeek" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="lastWeek" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">{weekCompError ? "Erreur de chargement" : "Pas assez de donnees"}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <SafeComponent fallbackTitle="Intelligence Centrale">
        <CentralIntelligence />
      </SafeComponent>

      <StaggerContainer className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((kpi) => (
          <StaggerItem key={kpi.title}>
          <Link href={kpi.href}>
            <PressableCard className="rounded-xl border bg-card text-card-foreground premium-shadow-hover">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
                <Icon3D icon={kpi.icon} variant={kpi.variant} size="sm" animate />
              </CardHeader>
              <CardContent>
                {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
                  <>
                    <div className="text-2xl font-bold">{kpi.value}</div>
                    {kpi.trend !== undefined && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        {kpi.trend > 0 ? (
                          <span className="text-emerald-500 flex items-center"><ArrowUpRight className="w-3 h-3 mr-0.5" />{kpi.trend}%</span>
                        ) : kpi.trend < 0 ? (
                          <span className="text-destructive flex items-center"><ArrowDownRight className="w-3 h-3 mr-0.5" />{Math.abs(kpi.trend)}%</span>
                        ) : (
                          <span className="text-muted-foreground">0%</span>
                        )}
                        {kpi.trendLabel}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </PressableCard>
          </Link>
          </StaggerItem>
        ))}
      </StaggerContainer>

      <SafeComponent fallbackTitle="Pouls Intelligent">
        <SmartPulsePanel />
      </SafeComponent>

      <SafeComponent fallbackTitle="Reconnaissance IA">
        <AiRecognitionPanel />
      </SafeComponent>

      <SafeComponent fallbackTitle="Suggestions IA">
        <AiSuggestionsCard page="dashboard" title="Briefing IA du jour" />
      </SafeComponent>

      {weeklyReport && !isLoadingWeekly && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/10 border-blue-200/50 dark:border-blue-800/30">
            <CardContent className="p-4">
              <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">Taux de reponse</div>
              <div className="text-2xl font-bold mt-1">{weeklyReport.answerRate}%</div>
              <Progress value={weeklyReport.answerRate} className="h-1.5 mt-2" />
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/10 border-emerald-200/50 dark:border-emerald-800/30">
            <CardContent className="p-4">
              <div className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Duree moyenne</div>
              <div className="text-2xl font-bold mt-1">{formatDuration(weeklyReport.avgDuration)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {weeklyReport.comparisonPrevWeek.durationDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.durationDiff}% vs sem. prec.
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/10 border-amber-200/50 dark:border-amber-800/30">
            <CardContent className="p-4">
              <div className="text-sm text-amber-600 dark:text-amber-400 font-medium">Heure de pointe</div>
              <div className="text-2xl font-bold mt-1">{weeklyReport.peakHour}h00</div>
              <div className="text-xs text-muted-foreground mt-1 capitalize">Jour: {weeklyReport.peakDay}</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/10 border-purple-200/50 dark:border-purple-800/30">
            <CardContent className="p-4">
              <div className="text-sm text-purple-600 dark:text-purple-400 font-medium">Appels cette semaine</div>
              <div className="text-2xl font-bold mt-1">{weeklyReport.totalCalls}</div>
              <div className="text-xs mt-1">
                <span className={weeklyReport.comparisonPrevWeek.callsDiff > 0 ? "text-emerald-500" : "text-destructive"}>
                  {weeklyReport.comparisonPrevWeek.callsDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.callsDiff}%
                </span> vs sem. prec.
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Icon3D icon={Clock} variant="blue" size="xs" /> Performance Horaire (Aujourd'hui)</CardTitle>
            <CardDescription>Volume d'appels selon l'heure de la journee</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingHourly ? (
              <Skeleton className="h-[250px] w-full" />
            ) : hourlyPerf && hourlyPerf.hours.length > 0 ? (
              <div className="h-[250px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyPerf.hours} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip
                      cursor={{ fill: 'hsl(var(--muted)/0.5)' }}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                      labelFormatter={(h) => `${h}h00 - ${Number(h)+1}h00`}
                    />
                    <Bar dataKey="total" name="Appels totaux" radius={[4, 4, 0, 0]}>
                      {hourlyPerf.hours.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getHeatmapColor(entry.total, maxHourlyCalls)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">Aucune donnee pour aujourd'hui</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Icon3D icon={Activity} variant="emerald" size="xs" /> Etat des Taches</CardTitle>
            <CardDescription>Progression globale</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingTaskStats ? (
              <div className="space-y-4"><Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-full"/></div>
            ) : taskStats ? (
              <div className="space-y-6">
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <span className="text-3xl font-bold">{taskStats.completionRate}%</span>
                    <span className="text-sm text-muted-foreground block">Taux d'achevement</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-destructive">{taskStats.overdueTasks}</span>
                    <span className="text-sm text-muted-foreground block">En retard</span>
                  </div>
                </div>
                <Progress value={taskStats.completionRate} className="h-3" />
                
                <div className="space-y-3 pt-4 border-t border-border">
                  {taskStats.byPriority.map(p => (
                    <div key={p.priority} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${p.priority === 'haute' ? 'bg-destructive' : p.priority === 'moyenne' ? 'bg-amber-500' : 'bg-blue-500'}`}></div>
                        <span className="capitalize">{p.priority}</span>
                      </div>
                      <span className="font-medium">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Contacts Frequents</CardTitle>
              <CardDescription>Contacts avec le plus d'interactions.</CardDescription>
            </div>
            <Link href="/contacts">
              <Button variant="ghost" size="sm">Voir tous</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {isLoadingContacts ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (<Skeleton key={i} className="h-12 w-full" />))}
              </div>
            ) : (
              <div className="space-y-4">
                {topContacts?.contacts?.map((contact) => (
                  <Link key={contact.id} href={`/contacts/${contact.id}`}>
                    <div className="flex items-center justify-between hover:bg-muted/50 rounded-lg p-2 -mx-2 transition-colors cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                          {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium leading-none">{contact.firstName} {contact.lastName}</p>
                          <p className="text-xs text-muted-foreground mt-1">{contact.company || 'Independant'}</p>
                        </div>
                      </div>
                      <Badge variant="secondary">{contact.totalCalls} appels</Badge>
                    </div>
                  </Link>
                ))}
                {!topContacts?.contacts?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucun contact trouve.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Activite Recente</CardTitle>
              <CardDescription>Derniers evenements.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (<Skeleton key={i} className="h-12 w-full" />))}
              </div>
            ) : (
              <div className="space-y-4">
                {recentActivity?.activities?.slice(0,5).map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {activity.type === 'appel' && <Icon3D icon={Phone} variant="blue" size="xs" />}
                      {activity.type === 'contact' && <Icon3D icon={Users} variant="indigo" size="xs" />}
                      {activity.type === 'tache' && <Icon3D icon={CheckSquare} variant="emerald" size="xs" />}
                      {activity.type === 'message' && <Icon3D icon={MessageSquare} variant="amber" size="xs" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-none truncate">{activity.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(activity.timestamp), "HH:mm", { locale: fr })}
                      </p>
                    </div>
                  </div>
                ))}
                {!recentActivity?.activities?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucune activite recente.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <SafeComponent fallbackTitle="Activite en direct" compact>
        <LiveActivityFeed compact />
      </SafeComponent>

      <Card className="bg-gradient-to-r from-[#1a2744] to-[#2d3a54] text-white border-0 shadow-lg">
        <CardContent className="p-4 md:p-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/20">
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-white/60">Securite</p>
                <p className="font-semibold text-emerald-300">Protege</p>
                <p className="text-xs text-white/50">RGPD / ISO 27001</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/20">
                <HardDriveDownload className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-white/60">Sauvegarde auto</p>
                <p className="font-semibold text-blue-300">Active</p>
                <p className="text-xs text-white/50">Toutes les 2 minutes</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20">
                <Zap className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-white/60">Systeme IA</p>
                <p className="font-semibold text-amber-300">7 agents actifs</p>
                <p className="text-xs text-white/50">Surveillance continue</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <SafeComponent fallbackTitle="Analyse Predictive">
        <PredictiveAnalyticsWidget />
      </SafeComponent>

      <EmailComposer
        isOpen={isEmailComposerOpen}
        onClose={() => setIsEmailComposerOpen(false)}
      />
    </div>
  );
}

function PredictiveAnalyticsWidget() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch(`${API}/api/dashboard/predictions`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("Erreur predictions"); return r.json(); })
      .then(setData)
      .catch((err) => console.error("[Dashboard] predictions fetch failed:", err));
  }, []);

  if (!data?.predictions) return null;
  const p = data.predictions;

  const chartData = p.labels.map((label: string, i: number) => ({
    name: label,
    appels: p.trends.calls[i],
    taches: p.trends.tasks[i],
    contacts: p.trends.contacts[i],
  }));
  chartData.push({ name: "Prevu", appels: p.nextWeekCalls, taches: p.nextWeekTasks, contacts: p.nextWeekContacts });

  const euro = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);

  return (
    <Card className="bg-gradient-to-br from-violet-950 to-indigo-950 border-violet-800 text-white">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg"><Brain className="h-5 w-5 text-violet-400" /> Analyse Predictive IA</CardTitle>
        <CardDescription className="text-white/60">Previsions pour la semaine prochaine basees sur les tendances</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/10 rounded-lg p-3 text-center">
            <Phone className="h-4 w-4 mx-auto mb-1 text-blue-400" />
            <p className="text-xl font-bold">{p.nextWeekCalls}</p>
            <p className="text-[10px] text-white/60">Appels prevus</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3 text-center">
            <CheckSquare className="h-4 w-4 mx-auto mb-1 text-green-400" />
            <p className="text-xl font-bold">{p.nextWeekTasks}</p>
            <p className="text-[10px] text-white/60">Taches prevues</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3 text-center">
            <Users className="h-4 w-4 mx-auto mb-1 text-amber-400" />
            <p className="text-xl font-bold">{p.nextWeekContacts}</p>
            <p className="text-[10px] text-white/60">Contacts prevus</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3 text-center">
            <TrendingUp className="h-4 w-4 mx-auto mb-1 text-emerald-400" />
            <p className="text-xl font-bold">{euro(p.nextWeekRevenue)}</p>
            <p className="text-[10px] text-white/60">CA prevu</p>
          </div>
        </div>

        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" tick={{ fontSize: 11 }} />
              <YAxis stroke="rgba(255,255,255,0.5)" tick={{ fontSize: 11 }} />
              <RechartsTooltip contentStyle={{ background: "#1e1b4b", border: "1px solid #4338ca", borderRadius: 8, color: "#fff" }} />
              <Line type="monotone" dataKey="appels" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="taches" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="contacts" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {data.insights?.length > 0 && (
          <div className="space-y-1.5">
            {data.insights.map((insight: string, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-white/5 rounded-lg px-3 py-2">
                <Lightbulb className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                <span className="text-white/80">{insight}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
