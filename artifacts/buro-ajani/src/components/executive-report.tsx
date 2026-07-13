import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, BarChart, Bar, Cell, LineChart, Line, PieChart, Pie, Legend } from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, Phone, Users, CheckSquare,
  MessageSquare, Target, Calendar, BarChart3, FileText, Download, Printer,
  ArrowUpRight, ArrowDownRight, AlertCircle, Star, Zap, Activity, Shield,
  DollarSign, Eye, RefreshCw, Brain, FolderKanban,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ExecutiveData {
  period: { days: number; start: string; end: string };
  score: number;
  calls: { total: number; answered: number; missed: number; avgDuration: number; totalDuration: number; trend: number; responseRate: number; prevResponseRate: number };
  contacts: { total: number; newThisPeriod: number };
  tasks: { total: number; completed: number; inProgress: number; overdue: number; highPriority: number; completionRate: number; prevCompletionRate: number };
  messages: { total: number; unread: number };
  prospects: { total: number; won: number; lost: number; totalValue: number; wonValue: number; avgProbability: number; winRate: number; prevWinRate: number };
  events: { total: number; upcoming: number };
  projets?: { total: number; active: number; termine: number; overdue: number; avgProgress: number };
  insights: Array<{ type: string; severity: string; message: string; metric?: string }>;
  trends: { callTrend: number; taskTrend: number; prospectTrend: number; responseTrend: number };
}

interface TimelinePoint {
  date: string;
  calls: number;
  tasks: number;
  prospects: number;
  messages: number;
  events: number;
}

interface Reminder {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  time: string;
  actionUrl?: string;
}

export default function ExecutiveReport() {
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderCounts, setReminderCounts] = useState({ overdue: 0, upcoming: 0, urgentProspects: 0, missedCalls: 0 });
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [execRes, tlRes, remRes] = await Promise.all([
        fetch(`${API}/api/smart-reports/executive-summary?days=${period}`, { credentials: "include" }),
        fetch(`${API}/api/smart-reports/daily-timeline?days=${period}`, { credentials: "include" }),
        fetch(`${API}/api/smart-reports/reminders`, { credentials: "include" }),
      ]);

      if (execRes.ok) setData(await execRes.json());
      if (tlRes.ok) {
        const tl = await tlRes.json();
        setTimeline(tl.timeline || []);
      }
      if (remRes.ok) {
        const r = await remRes.json();
        setReminders(r.reminders || []);
        setReminderCounts(r.counts || { overdue: 0, upcoming: 0, urgentProspects: 0, missedCalls: 0 });
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [period]);

  const getScoreColor = (s: number) => s >= 75 ? "text-green-600" : s >= 50 ? "text-yellow-600" : s >= 25 ? "text-orange-600" : "text-red-600";
  const getScoreBg = (s: number) => s >= 75 ? "bg-green-500" : s >= 50 ? "bg-yellow-500" : s >= 25 ? "bg-orange-500" : "bg-red-500";
  const getSeverityColor = (s: string) => ({ critique: "bg-red-100 text-red-700 border-red-200", urgent: "bg-orange-100 text-orange-700 border-orange-200", alerte: "bg-yellow-100 text-yellow-700 border-yellow-200", positif: "bg-green-100 text-green-700 border-green-200", info: "bg-blue-100 text-blue-700 border-blue-200" }[s] || "bg-gray-100 text-gray-700");
  const getSeverityIcon = (s: string) => ({ critique: AlertCircle, urgent: AlertTriangle, alerte: Clock, positif: CheckCircle, info: Eye }[s] || Eye);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
        <Skeleton className="h-64" />
        <div className="grid grid-cols-2 gap-4"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      </div>
    );
  }

  if (!data) return <div className="text-center p-8 text-muted-foreground">Erreur de chargement</div>;

  const totalReminders = reminderCounts.overdue + reminderCounts.upcoming + reminderCounts.urgentProspects + reminderCounts.missedCalls;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-violet-500" />
            Rapport Executif Intelligent
          </h2>
          <p className="text-sm text-muted-foreground">
            Periode: {new Date(data.period.start).toLocaleDateString("fr-FR")} - {new Date(data.period.end).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 derniers jours</SelectItem>
              <SelectItem value="14">14 derniers jours</SelectItem>
              <SelectItem value="30">30 derniers jours</SelectItem>
              <SelectItem value="90">90 derniers jours</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchAll}><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <Card className="col-span-1 border-2 border-primary/20 relative overflow-hidden">
          <div className={`absolute top-0 left-0 right-0 h-1 ${getScoreBg(data.score)}`} />
          <CardContent className="p-4 text-center">
            <div className="text-xs text-muted-foreground font-medium mb-1">Score Global</div>
            <div className={`text-4xl font-bold ${getScoreColor(data.score)}`}>{data.score}</div>
            <div className="text-xs text-muted-foreground">/100</div>
            <Progress value={data.score} className="mt-2 h-1.5" />
          </CardContent>
        </Card>

        {[
          { label: "Appels", value: data.calls.total, icon: Phone, trend: data.trends.callTrend, sub: `${data.calls.responseRate}% reponse`, color: "text-blue-600" },
          { label: "Taches", value: data.tasks.total, icon: CheckSquare, trend: data.trends.taskTrend, sub: `${data.tasks.completionRate}% completees`, color: "text-green-600" },
          { label: "Prospects", value: data.prospects.total, icon: Target, trend: data.trends.prospectTrend, sub: `${data.prospects.winRate}% gagnes`, color: "text-purple-600" },
          { label: "Messages", value: data.messages.total, icon: MessageSquare, sub: `${data.messages.unread} non lus`, color: "text-orange-600" },
        ].map((kpi) => (
          <Card key={kpi.label} className="relative overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">{kpi.label}</span>
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              </div>
              <div className="text-2xl font-bold">{kpi.value}</div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">{kpi.sub}</span>
                {kpi.trend !== undefined && (
                  <Badge variant="outline" className={`text-[10px] px-1 ${kpi.trend >= 0 ? "text-green-600 border-green-200" : "text-red-600 border-red-200"}`}>
                    {kpi.trend >= 0 ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                    {Math.abs(kpi.trend)}%
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.insights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />Insights IA</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.insights.map((insight, i) => {
                const Icon = getSeverityIcon(insight.severity);
                return (
                  <div key={i} className={`flex items-start gap-2 p-2.5 rounded-lg border ${getSeverityColor(insight.severity)}`}>
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{insight.message}</p>
                    </div>
                    {insight.metric && <Badge variant="outline" className="text-[10px] shrink-0">{insight.metric}</Badge>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" />Activite Quotidienne</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip labelFormatter={(l) => new Date(l).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} />
                <Area type="monotone" dataKey="calls" name="Appels" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                <Area type="monotone" dataKey="tasks" name="Taches" stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} />
                <Area type="monotone" dataKey="prospects" name="Prospects" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.2} />
                <Area type="monotone" dataKey="messages" name="Messages" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-purple-500" />Pipeline CRM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600">{Number(data.prospects.wonValue).toLocaleString("fr-FR")}</div>
              <div className="text-xs text-muted-foreground">EUR gagnes</div>
            </div>
            <div className="space-y-2">
              {[
                { label: "Gagnes", value: data.prospects.won, color: "bg-green-500" },
                { label: "Perdus", value: data.prospects.lost, color: "bg-red-500" },
                { label: "En cours", value: data.prospects.total - data.prospects.won - data.prospects.lost, color: "bg-blue-500" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className={`h-2 w-2 rounded-full ${item.color}`} />
                    <span>{item.label}</span>
                  </div>
                  <span className="font-medium">{item.value}</span>
                </div>
              ))}
            </div>
            <div className="border-t pt-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Taux de conversion</span>
                <span className="font-bold text-purple-600">{data.prospects.winRate}%</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-muted-foreground">Valeur totale pipeline</span>
                <span className="font-medium">{Number(data.prospects.totalValue).toLocaleString("fr-FR")} EUR</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Phone className="h-4 w-4 text-blue-500" />Performance Appels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xl font-bold text-green-600">{data.calls.answered}</div>
                <div className="text-[10px] text-muted-foreground">Repondus</div>
              </div>
              <div>
                <div className="text-xl font-bold text-red-600">{data.calls.missed}</div>
                <div className="text-[10px] text-muted-foreground">Manques</div>
              </div>
              <div>
                <div className="text-xl font-bold text-blue-600">{Math.floor(data.calls.avgDuration / 60)}m{data.calls.avgDuration % 60}s</div>
                <div className="text-[10px] text-muted-foreground">Duree moy.</div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Taux de reponse</span>
                <span className="font-bold">{data.calls.responseRate}%</span>
              </div>
              <Progress value={data.calls.responseRate} className="h-2" />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Periode precedente: {data.calls.prevResponseRate}%</span>
                <span className={data.calls.responseRate >= data.calls.prevResponseRate ? "text-green-600" : "text-red-600"}>
                  {data.calls.responseRate >= data.calls.prevResponseRate ? "+" : ""}{data.calls.responseRate - data.calls.prevResponseRate}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><CheckSquare className="h-4 w-4 text-green-500" />Productivite Taches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-lg font-bold">{data.tasks.total}</div>
                <div className="text-[10px] text-muted-foreground">Total</div>
              </div>
              <div>
                <div className="text-lg font-bold text-green-600">{data.tasks.completed}</div>
                <div className="text-[10px] text-muted-foreground">Faites</div>
              </div>
              <div>
                <div className="text-lg font-bold text-blue-600">{data.tasks.inProgress}</div>
                <div className="text-[10px] text-muted-foreground">En cours</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-600">{data.tasks.overdue}</div>
                <div className="text-[10px] text-muted-foreground">En retard</div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Taux de completion</span>
                <span className="font-bold">{data.tasks.completionRate}%</span>
              </div>
              <Progress value={data.tasks.completionRate} className="h-2" />
            </div>
            {data.tasks.highPriority > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                <AlertTriangle className="h-3 w-3" />
                {data.tasks.highPriority} taches haute priorite
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.projets && data.projets.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><FolderKanban className="h-4 w-4 text-indigo-500" />Projets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-xl font-bold">{data.projets.total}</div>
                <div className="text-[10px] text-muted-foreground">Total</div>
              </div>
              <div>
                <div className="text-xl font-bold text-amber-600">{data.projets.active}</div>
                <div className="text-[10px] text-muted-foreground">Actifs</div>
              </div>
              <div>
                <div className="text-xl font-bold text-emerald-600">{data.projets.termine}</div>
                <div className="text-[10px] text-muted-foreground">Terminés</div>
              </div>
              <div>
                <div className={`text-xl font-bold ${data.projets.overdue > 0 ? "text-red-600" : "text-slate-600"}`}>{data.projets.overdue}</div>
                <div className="text-[10px] text-muted-foreground">En retard</div>
              </div>
            </div>
            {data.projets.avgProgress > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                  <span>Avancement moyen</span>
                  <span className="font-bold text-indigo-600">{data.projets.avgProgress}%</span>
                </div>
                <Progress value={data.projets.avgProgress} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {reminders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                Rappels & Alertes
                <Badge variant="secondary" className="text-[10px]">{totalReminders}</Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: "En retard", count: reminderCounts.overdue, icon: AlertCircle, color: "text-red-600 bg-red-50" },
                { label: "A venir", count: reminderCounts.upcoming, icon: Calendar, color: "text-blue-600 bg-blue-50" },
                { label: "Prospects urgents", count: reminderCounts.urgentProspects, icon: Target, color: "text-purple-600 bg-purple-50" },
                { label: "Appels manques", count: reminderCounts.missedCalls, icon: Phone, color: "text-orange-600 bg-orange-50" },
              ].map((c) => (
                <div key={c.label} className={`flex items-center gap-2 p-2 rounded-lg ${c.color}`}>
                  <c.icon className="h-4 w-4" />
                  <div>
                    <div className="text-lg font-bold">{c.count}</div>
                    <div className="text-[10px]">{c.label}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {reminders.slice(0, 8).map((r) => (
                <div key={r.id} className={`flex items-center gap-2 p-2 rounded text-xs border ${getSeverityColor(r.severity)}`}>
                  {r.type === "tache" && <CheckSquare className="h-3.5 w-3.5 shrink-0" />}
                  {r.type === "evenement" && <Calendar className="h-3.5 w-3.5 shrink-0" />}
                  {r.type === "prospect" && <Target className="h-3.5 w-3.5 shrink-0" />}
                  {r.type === "appel" && <Phone className="h-3.5 w-3.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{r.title}</span>
                    <span className="text-[10px] ml-2 opacity-75">{r.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-900 dark:to-blue-900/20">
        <CardContent className="p-4">
          <div className="grid grid-cols-4 gap-4 text-center text-xs">
            <div>
              <Users className="h-4 w-4 mx-auto mb-1 text-blue-600" />
              <div className="font-bold">{data.contacts.total}</div>
              <div className="text-muted-foreground">Contacts totaux</div>
              <div className="text-green-600 text-[10px]">+{data.contacts.newThisPeriod} nouveaux</div>
            </div>
            <div>
              <Calendar className="h-4 w-4 mx-auto mb-1 text-purple-600" />
              <div className="font-bold">{data.events.total}</div>
              <div className="text-muted-foreground">Evenements</div>
              <div className="text-blue-600 text-[10px]">{data.events.upcoming} a venir</div>
            </div>
            <div>
              <DollarSign className="h-4 w-4 mx-auto mb-1 text-green-600" />
              <div className="font-bold">{Number(data.prospects.totalValue).toLocaleString("fr-FR")}</div>
              <div className="text-muted-foreground">Pipeline total (EUR)</div>
            </div>
            <div>
              <Shield className="h-4 w-4 mx-auto mb-1 text-amber-600" />
              <div className="font-bold">{Math.floor(data.calls.totalDuration / 3600)}h{Math.floor((data.calls.totalDuration % 3600) / 60)}m</div>
              <div className="text-muted-foreground">Temps appels total</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
