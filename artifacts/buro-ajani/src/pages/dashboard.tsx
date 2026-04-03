import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Phone, Users, CheckSquare, MessageSquare, ArrowUpRight, ArrowDownRight, PhoneIncoming, PhoneOutgoing, PhoneMissed, Calendar as CalendarIcon, Clock, Plus, TrendingUp, Activity, BarChart3 } from "lucide-react";
import { useGetDashboardSummary, useGetRecentActivity, useGetTopContacts, useGetWeeklyReport, useGetHourlyPerformance, useGetTaskStats } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Bar, Cell } from "recharts";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({ query: { queryKey: ["dashboardSummary"] } });
  const { data: recentActivity, isLoading: isLoadingActivity } = useGetRecentActivity({ limit: 6 }, { query: { queryKey: ["recentActivity"] } });
  const { data: topContacts, isLoading: isLoadingContacts } = useGetTopContacts({ limit: 5 }, { query: { queryKey: ["topContacts"] } });
  const { data: weeklyReport, isLoading: isLoadingWeekly } = useGetWeeklyReport({ query: { queryKey: ["weeklyReport"] } });
  const { data: hourlyPerf, isLoading: isLoadingHourly } = useGetHourlyPerformance({ query: { queryKey: ["hourlyPerformance"] } });
  const { data: taskStats, isLoading: isLoadingTaskStats } = useGetTaskStats({ query: { queryKey: ["taskStats"] } });

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

  const maxHourlyCalls = hourlyPerf?.hours.reduce((max, h) => Math.max(max, h.total), 0) || 1;

  const kpiCards = [
    {
      title: "Appels Aujourd'hui",
      value: summary?.totalCallsToday || 0,
      icon: Phone,
      trend: summary?.callsTrend,
      trendLabel: "depuis hier",
      href: "/appels",
    },
    {
      title: "Contacts",
      value: summary?.totalContacts || 0,
      icon: Users,
      href: "/contacts",
    },
    {
      title: "Taches en attente",
      value: summary?.pendingTasks || 0,
      icon: CheckSquare,
      href: "/taches",
    },
    {
      title: "Messages non lus",
      value: summary?.unreadMessages || 0,
      icon: MessageSquare,
      href: "/messages",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tableau de bord</h1>
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
          <Link href="/analyse">
            <Button size="sm" className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700">
              <BarChart3 className="w-4 h-4 mr-2" />
              Analyse
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((kpi) => (
          <Link key={kpi.title} href={kpi.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
                <kpi.icon className="w-4 h-4 text-muted-foreground" />
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
            </Card>
          </Link>
        ))}
      </div>

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
            <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5 text-primary"/> Performance Horaire (Aujourd'hui)</CardTitle>
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
            <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5 text-primary" />Etat des Taches</CardTitle>
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
                {topContacts?.contacts?.map((contact, idx) => (
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
                    <div className="bg-muted p-2 rounded-full mt-0.5 shrink-0">
                      {activity.type === 'appel' && <Phone className="w-4 h-4 text-primary" />}
                      {activity.type === 'contact' && <Users className="w-4 h-4 text-blue-500" />}
                      {activity.type === 'tache' && <CheckSquare className="w-4 h-4 text-emerald-500" />}
                      {activity.type === 'message' && <MessageSquare className="w-4 h-4 text-amber-500" />}
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
    </div>
  );
}
