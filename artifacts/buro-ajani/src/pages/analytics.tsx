import { useState } from "react";
import { useGetCallAnalytics, useGetCallDistribution } from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function Analytics() {
  const [period, setPeriod] = useState<"today" | "week" | "month" | "year">("week");

  const { data: analytics, isLoading: isAnalyticsLoading } = useGetCallAnalytics(
    { period },
    { query: { queryKey: ["callAnalytics", period] } }
  );

  const { data: distribution, isLoading: isDistributionLoading } = useGetCallDistribution(
    { query: { queryKey: ["callDistribution"] } }
  );

  const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analyse des Appels</h1>
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Volume d'appels ({period === 'today' ? 'Heures' : 'Jours'})</CardTitle>
            <CardDescription>Répartition des appels répondus, manqués et messagerie sur la période.</CardDescription>
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
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
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

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Distribution par Statut</CardTitle>
            <CardDescription>Aperçu global de l'état des appels.</CardDescription>
          </CardHeader>
          <CardContent>
            {isDistributionLoading ? (
              <Skeleton className="w-full h-[300px]" />
            ) : (
              <div className="h-[300px] w-full flex flex-col justify-center items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={distribution?.byStatus || []}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="count"
                      nameKey="status"
                    >
                      {(distribution?.byStatus || []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      formatter={(value: number, name: string, props: any) => [`${value} appels`, name]}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: 'var(--radius)' }}
                    />
                    <Legend 
                      iconType="circle" 
                      layout="vertical" 
                      verticalAlign="middle" 
                      align="right"
                      wrapperStyle={{ fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}