import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, PlayCircle, PauseCircle, Clock, CheckCircle, AlertTriangle, Activity,
  BarChart3, RefreshCw, Settings2, Bot, CalendarClock, Mail, Phone, Users,
  FileText, TrendingUp, Loader2, ChevronRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const TYPE_ICONS: Record<string, any> = {
  "Taches en retard": FileText,
  "Rappels calendrier": CalendarClock,
  "Messages non lus": Mail,
  "Contacts inactifs": Users,
  "Appels manques": Phone,
};

const TYPE_COLORS: Record<string, string> = {
  "Taches en retard": "text-red-500 bg-red-500/10",
  "Rappels calendrier": "text-blue-500 bg-blue-500/10",
  "Messages non lus": "text-purple-500 bg-purple-500/10",
  "Contacts inactifs": "text-amber-500 bg-amber-500/10",
  "Appels manques": "text-green-500 bg-green-500/10",
};

export default function AutomationsPage() {
  const { toast } = useToast();
  const [rules, setRules] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    setLoading(true);
    try {
      const [rulesRes, logsRes] = await Promise.all([
        fetch(`${baseUrl}/api/automations`, { credentials: "include" }),
        fetch(`${baseUrl}/api/automations/logs?limit=100`, { credentials: "include" }),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data.rules);
      } else {
        toast({ title: "Erreur", description: "Impossible de charger les regles", variant: "destructive" });
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs);
        setStats(data.stats);
      } else {
        toast({ title: "Erreur", description: "Impossible de charger les journaux", variant: "destructive" });
      }
    } catch (err) {
      console.error("[Automations] fetch failed:", err);
      toast({ title: "Erreur", description: "Impossible de charger les automatisations", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  function timeAgo(date: string | null): string {
    if (!date) return "Jamais";
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "A l'instant";
    if (mins < 60) return `Il y a ${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Il y a ${hours}h`;
    return `Il y a ${Math.floor(hours / 24)}j`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const builtInRules = rules.filter(r => r.builtIn);
  const customRules = rules.filter(r => !r.builtIn);
  const successRate = stats ? (stats.totalToday > 0 ? Math.round((stats.successToday / stats.totalToday) * 100) : 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white">
              <Zap className="w-6 h-6" />
            </div>
            Automatisations
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Moteur d'automatisation intelligent - surveillance et actions automatiques
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" /> Actualiser
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-green-500/10 text-green-500">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.totalToday || 0}</p>
                <p className="text-xs text-muted-foreground">Executions aujourd'hui</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{successRate}%</p>
                <p className="text-xs text-muted-foreground">Taux de reussite</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.itemsToday || 0}</p>
                <p className="text-xs text-muted-foreground">Elements traites</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.errorToday || 0}</p>
                <p className="text-xs text-muted-foreground">Erreurs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="regles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="regles" className="gap-1.5">
            <Settings2 className="w-4 h-4" /> Regles actives
          </TabsTrigger>
          <TabsTrigger value="journal" className="gap-1.5">
            <BarChart3 className="w-4 h-4" /> Journal d'execution
          </TabsTrigger>
        </TabsList>

        <TabsContent value="regles" className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Bot className="w-4 h-4" /> Automatisations systeme (integrees)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {builtInRules.map(rule => {
              const Icon = TYPE_ICONS[rule.name] || Zap;
              const colorClass = TYPE_COLORS[rule.name] || "text-gray-500 bg-gray-500/10";
              return (
                <Card key={rule.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${colorClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-sm">{rule.name}</h4>
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                            <PlayCircle className="w-2.5 h-2.5 mr-0.5" /> Actif
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{rule.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Chaque minute
                          </span>
                          <Badge variant="secondary" className="text-[10px]">Systeme</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {customRules.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-6 flex items-center gap-2">
                <Settings2 className="w-4 h-4" /> Regles personnalisees
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customRules.map(rule => (
                  <Card key={rule.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl ${rule.enabled ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-500"}`}>
                          <Zap className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-sm">{rule.name}</h4>
                            <Badge variant="outline" className={`text-[10px] ${rule.enabled ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-gray-500/10 text-gray-500 border-gray-500/30"}`}>
                              {rule.enabled ? <><PlayCircle className="w-2.5 h-2.5 mr-0.5" /> Actif</> : <><PauseCircle className="w-2.5 h-2.5 mr-0.5" /> Inactif</>}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{rule.description}</p>
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {rule.schedule || "Manuel"}
                            </span>
                            <span>{rule.runCount} exec.</span>
                            {rule.lastRun && <span>{timeAgo(rule.lastRun)}</span>}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="journal" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Historique des executions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Aucune execution enregistree
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map(log => (
                    <div key={log.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/40 transition-colors border-b last:border-b-0">
                      <div className={`p-1.5 rounded-lg ${log.status === "success" ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                        {log.status === "success" ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{log.ruleName}</span>
                          <Badge variant="outline" className={`text-[10px] ${log.status === "success" ? "text-green-600" : "text-red-600"}`}>
                            {log.status === "success" ? "Reussi" : "Erreur"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                          <span>{log.itemsProcessed} element(s)</span>
                          {log.duration !== null && <span>{log.duration}ms</span>}
                          <span>{timeAgo(log.createdAt)}</span>
                        </div>
                      </div>
                      {log.error && (
                        <span className="text-[10px] text-red-500 max-w-[200px] truncate">{log.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
