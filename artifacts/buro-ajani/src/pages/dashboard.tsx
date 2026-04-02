import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Users, CheckSquare, MessageSquare, ArrowUpRight, ArrowDownRight, PhoneIncoming, PhoneOutgoing, PhoneMissed, Calendar as CalendarIcon, Clock } from "lucide-react";
import { useGetDashboardSummary, useGetRecentActivity, useGetTopContacts, useGetWeeklyReport, useGetHourlyPerformance, useGetTaskStats } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Bar, Cell } from "recharts";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({ query: { queryKey: ["dashboardSummary"] } });
  const { data: recentActivity, isLoading: isLoadingActivity } = useGetRecentActivity({ limit: 5 }, { query: { queryKey: ["recentActivity"] } });
  const { data: topContacts, isLoading: isLoadingContacts } = useGetTopContacts({ limit: 4 }, { query: { queryKey: ["topContacts"] } });
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-muted-foreground mt-1">Vue d'ensemble de l'activité du bureau aujourd'hui.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Appels Aujourd'hui</CardTitle>
            <Phone className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <>
                <div className="text-2xl font-bold">{summary?.totalCallsToday || 0}</div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {summary?.callsTrend && summary.callsTrend > 0 ? (
                    <span className="text-emerald-500 flex items-center"><ArrowUpRight className="w-3 h-3 mr-1" />{summary.callsTrend}%</span>
                  ) : (
                    <span className="text-destructive flex items-center"><ArrowDownRight className="w-3 h-3 mr-1" />{Math.abs(summary?.callsTrend || 0)}%</span>
                  )}
                  depuis hier
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contacts</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{summary?.totalContacts || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tâches en attente</CardTitle>
            <CheckSquare className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{summary?.pendingTasks || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Messages non lus</CardTitle>
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-20" /> : (
              <div className="text-2xl font-bold">{summary?.unreadMessages || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarIcon className="w-5 h-5 text-primary"/> Rapport de la semaine</CardTitle>
            <CardDescription>{weeklyReport?.weekLabel || 'Semaine en cours'}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingWeekly ? (
               <div className="space-y-4"><Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-full"/></div>
            ) : weeklyReport ? (
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Appels totaux</span>
                    <span className="font-bold">{weeklyReport.totalCalls}</span>
                  </div>
                  <div className="flex justify-between text-xs mb-3">
                    <span className="text-muted-foreground">Vs semaine préc.</span>
                    <span className={weeklyReport.comparisonPrevWeek.callsDiff > 0 ? "text-emerald-500" : "text-destructive"}>
                      {weeklyReport.comparisonPrevWeek.callsDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.callsDiff}%
                    </span>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Taux de réponse</span>
                    <span className="font-bold">{weeklyReport.answerRate}%</span>
                  </div>
                  <Progress value={weeklyReport.answerRate} className="h-2" />
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-muted-foreground">Vs semaine préc.</span>
                    <span className={weeklyReport.comparisonPrevWeek.answerRateDiff > 0 ? "text-emerald-500" : "text-destructive"}>
                      {weeklyReport.comparisonPrevWeek.answerRateDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.answerRateDiff}%
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-border grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground block">Heure de pointe</span>
                    <span className="text-lg font-bold block">{weeklyReport.peakHour}h00</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Jour de pointe</span>
                    <span className="text-lg font-bold block capitalize">{weeklyReport.peakDay}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5 text-primary"/> Performance Horaire (Aujourd'hui)</CardTitle>
            <CardDescription>Volume d'appels selon l'heure de la journée</CardDescription>
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
                      labelFormatter={(h) => `${h}h00 - ${h+1}h00`}
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
               <div className="h-[250px] flex items-center justify-center text-muted-foreground">Aucune donnée pour aujourd'hui</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>État des Tâches</CardTitle>
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
                     <span className="text-sm text-muted-foreground block">Taux d'achèvement</span>
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

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Contacts Fréquents</CardTitle>
            <CardDescription>Contacts avec le plus d'interactions.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingContacts ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {topContacts?.contacts?.map((contact) => (
                  <div key={contact.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center text-sm font-medium text-secondary">
                        {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium leading-none">{contact.firstName} {contact.lastName}</p>
                        <p className="text-xs text-muted-foreground mt-1">{contact.company || 'Indépendant'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{contact.totalCalls} appels</div>
                    </div>
                  </div>
                ))}
                {!topContacts?.contacts?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucun contact trouvé.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Activité Récente</CardTitle>
            <CardDescription>Derniers événements.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {recentActivity?.activities?.slice(0,4).map((activity) => (
                  <div key={activity.id} className="flex items-start gap-4">
                    <div className="bg-muted p-2 rounded-full mt-0.5">
                      {activity.type === 'appel' && <Phone className="w-4 h-4 text-primary" />}
                      {activity.type === 'contact' && <Users className="w-4 h-4 text-blue-500" />}
                      {activity.type === 'tache' && <CheckSquare className="w-4 h-4 text-emerald-500" />}
                      {activity.type === 'message' && <MessageSquare className="w-4 h-4 text-amber-500" />}
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{activity.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(activity.timestamp), "HH:mm", { locale: fr })}
                      </p>
                    </div>
                  </div>
                ))}
                {!recentActivity?.activities?.length && (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucune activité récente.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}