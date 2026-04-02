import { useState } from "react";
import { useGetCallAnalytics, useGetCallDistribution, useGetHourlyPerformance, useGetWeeklyReport, useGetTaskStats } from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export default function Analytics() {
  const [period, setPeriod] = useState<"today" | "week" | "month" | "year">("week");

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

  const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
  const SENTIMENT_COLORS = {
    'positif': 'hsl(142.1 76.2% 36.3%)', // emerald-600
    'neutre': 'hsl(215.4 16.3% 46.9%)', // muted-foreground
    'negatif': 'hsl(0 84.2% 60.2%)' // destructive
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analyse & Rapports</h1>
          <p className="text-muted-foreground mt-1">Statistiques détaillées et performances du secrétariat.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(val: any) => setPeriod(val)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Période" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Aujourd'hui</SelectItem>
              <SelectItem value="week">Cette semaine</SelectItem>
              <SelectItem value="month">Ce mois</SelectItem>
              <SelectItem value="year">Cette année</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Taux de réponse</CardDescription>
            <CardTitle className="text-3xl">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : `${analytics?.answerRate || 0}%`}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Répondus</CardDescription>
            <CardTitle className="text-3xl text-emerald-600">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : analytics?.totalAnswered || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Manqués</CardDescription>
            <CardTitle className="text-3xl text-destructive">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : analytics?.totalMissed || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Messages Vocaux</CardDescription>
            <CardTitle className="text-3xl text-amber-600">{isAnalyticsLoading ? <Skeleton className="h-9 w-20" /> : analytics?.totalVoicemail || 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Volume horaire des appels</CardTitle>
            <CardDescription>Répartition des appels par heure (Aujourd'hui)</CardDescription>
          </CardHeader>
          <CardContent>
            {isHourlyLoading ? (
               <Skeleton className="w-full h-[300px]" />
            ) : (
               <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyPerf?.hours || []} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                      labelFormatter={(h) => `${h}h00`}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="answered" name="Répondus" stackId="a" fill="hsl(142.1 76.2% 36.3%)" />
                    <Bar dataKey="missed" name="Manqués" stackId="a" fill="hsl(0 84.2% 60.2%)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Volume de la période</CardTitle>
            <CardDescription>Historique selon la période sélectionnée</CardDescription>
          </CardHeader>
          <CardContent>
            {isAnalyticsLoading ? (
              <Skeleton className="w-full h-[300px]" />
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics?.dataPoints || []} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="answered" name="Répondus" stackId="a" fill="hsl(var(--primary))" radius={[0, 0, 4, 4]} />
                    <Bar dataKey="missed" name="Manqués" stackId="a" fill="hsl(var(--destructive))" />
                    <Bar dataKey="voicemail" name="Messagerie" stackId="a" fill="hsl(var(--muted))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Sentiment des Appels</CardTitle>
            <CardDescription>Répartition par ressenti</CardDescription>
          </CardHeader>
          <CardContent>
            {isDistributionLoading ? (
              <Skeleton className="w-full h-[250px]" />
            ) : (
              <div className="h-[250px] w-full flex flex-col justify-center items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={distribution?.bySentiment || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="count"
                      nameKey="sentiment"
                    >
                      {(distribution?.bySentiment || []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={(SENTIMENT_COLORS as any)[entry.sentiment] || COLORS[index % COLORS.length]} />
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
            <CardDescription>Évolution par rapport à la semaine passée</CardDescription>
           </CardHeader>
           <CardContent>
              {isWeeklyLoading ? (
                 <div className="space-y-4"><Skeleton className="h-10 w-full"/><Skeleton className="h-10 w-full"/><Skeleton className="h-10 w-full"/></div>
              ) : weeklyReport ? (
                 <div className="space-y-6 mt-2">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                       <span className="text-muted-foreground text-sm">Volume d'appels</span>
                       <div className="flex items-center gap-3">
                          <span className="font-bold">{weeklyReport.totalCalls}</span>
                          <Badge variant={weeklyReport.comparisonPrevWeek.callsDiff > 0 ? "default" : "destructive"} className="w-16 justify-center">
                             {weeklyReport.comparisonPrevWeek.callsDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.callsDiff}%
                          </Badge>
                       </div>
                    </div>
                    <div className="flex items-center justify-between border-b border-border pb-3">
                       <span className="text-muted-foreground text-sm">Taux de réponse</span>
                       <div className="flex items-center gap-3">
                          <span className="font-bold">{weeklyReport.answerRate}%</span>
                          <Badge variant={weeklyReport.comparisonPrevWeek.answerRateDiff > 0 ? "default" : "destructive"} className="w-16 justify-center">
                             {weeklyReport.comparisonPrevWeek.answerRateDiff > 0 ? '+' : ''}{weeklyReport.comparisonPrevWeek.answerRateDiff}%
                          </Badge>
                       </div>
                    </div>
                    <div className="flex items-center justify-between">
                       <span className="text-muted-foreground text-sm">Durée moyenne</span>
                       <div className="flex items-center gap-3">
                          <span className="font-bold">{Math.floor(weeklyReport.avgDuration/60)}m {weeklyReport.avgDuration%60}s</span>
                          <Badge variant={weeklyReport.comparisonPrevWeek.durationDiff > 0 ? "default" : "destructive"} className="w-16 justify-center">
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
             <CardTitle>Performance des Tâches</CardTitle>
             <CardDescription>Indicateurs d'efficacité</CardDescription>
           </CardHeader>
           <CardContent>
             {isTaskStatsLoading ? (
                 <div className="space-y-4"><Skeleton className="h-10 w-full"/><Skeleton className="h-10 w-full"/></div>
             ) : taskStats ? (
                <div className="space-y-6 mt-2">
                   <div>
                     <div className="flex justify-between text-sm mb-2">
                        <span className="text-muted-foreground">Taux d'achèvement</span>
                        <span className="font-bold">{taskStats.completionRate}%</span>
                     </div>
                     <Progress value={taskStats.completionRate} className="h-2" />
                   </div>
                   
                   <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                      <div className="bg-muted/50 p-3 rounded-lg text-center">
                         <span className="block text-2xl font-bold text-emerald-600">{taskStats.completedTasks}</span>
                         <span className="block text-xs text-muted-foreground mt-1">Terminées</span>
                      </div>
                      <div className="bg-muted/50 p-3 rounded-lg text-center">
                         <span className="block text-2xl font-bold text-destructive">{taskStats.overdueTasks}</span>
                         <span className="block text-xs text-muted-foreground mt-1">En retard</span>
                      </div>
                   </div>
                   
                   <div className="flex justify-between items-center text-sm pt-2">
                      <span className="text-muted-foreground">Urgentes en attente</span>
                      <Badge variant="destructive">{taskStats.highPriorityPending}</Badge>
                   </div>
                </div>
             ) : null}
           </CardContent>
        </Card>
      </div>
    </div>
  );
}