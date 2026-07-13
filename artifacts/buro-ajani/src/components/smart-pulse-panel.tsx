import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Activity, AlertTriangle, ShieldAlert, Flame,
  FileWarning, TrendingUp, TrendingDown, Heart, Zap, Eye,
  ChevronRight, RefreshCw, Shield, Phone, CheckSquare,
  MessageSquare, BarChart3, Clock
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip as RechartsTooltip, CartesianGrid
} from "recharts";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SmartPulseData {
  timestamp: string;
  healthScore: number;
  riskLevel: string;
  metrics: {
    todayCalls: number;
    weekCalls: number;
    prevWeekCalls: number;
    weekGrowth: number;
    todayMissed: number;
    weekMissed: number;
    missedRate: number;
    todayTasks: number;
    overdueTasks: number;
    completedTasks: number;
    todayMessages: number;
    unreadMessages: number;
    peakHour: number;
  };
  anomalies: Array<{
    type: string;
    severity: "critique" | "alerte" | "attention" | "info";
    title: string;
    description: string;
    metric?: number;
  }>;
  recommendations: string[];
  hourlyDistribution: number[];
}

interface AnomalyAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  action?: string;
  timestamp: string;
}

const SEVERITY_CONFIG = {
  critique: { color: "bg-red-500", textColor: "text-red-500", bgColor: "bg-red-500/10", borderColor: "border-red-500/30", icon: Flame, label: "Critique" },
  alerte: { color: "bg-amber-500", textColor: "text-amber-500", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30", icon: AlertTriangle, label: "Alerte" },
  attention: { color: "bg-blue-500", textColor: "text-blue-500", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/30", icon: Eye, label: "Attention" },
  info: { color: "bg-emerald-500", textColor: "text-emerald-500", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", icon: TrendingUp, label: "Info" },
};

function HealthGauge({ score, riskLevel }: { score: number; riskLevel: string }) {
  const circumference = 2 * Math.PI * 54;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const glowColor = score >= 80 ? "0 0 20px rgba(34,197,94,0.3)" : score >= 50 ? "0 0 20px rgba(245,158,11,0.3)" : "0 0 20px rgba(239,68,68,0.4)";

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative" style={{ filter: `drop-shadow(${glowColor})` }}>
        <svg width="140" height="140" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
          <circle
            cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="8"
            strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black tabular-nums" style={{ color }}>{score}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">sante</span>
        </div>
      </div>
      <Badge
        variant="outline"
        className={`mt-2 text-xs font-semibold ${
          riskLevel === "faible" ? "border-emerald-500/50 text-emerald-500" :
          riskLevel === "moyen" ? "border-amber-500/50 text-amber-500" :
          "border-red-500/50 text-red-500"
        }`}
      >
        {riskLevel === "faible" ? "Risque faible" : riskLevel === "moyen" ? "Risque moyen" : "Risque eleve"}
      </Badge>
    </div>
  );
}

function MiniMetric({ icon: Icon, label, value, suffix, color }: { icon: any; label: string; value: number | string; suffix?: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/30 transition-colors">
      <div className={`p-1.5 rounded-md ${color}`}>
        <Icon className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground truncate">{label}</div>
        <div className="text-sm font-bold tabular-nums">{value}{suffix}</div>
      </div>
    </div>
  );
}

export function SmartPulsePanel() {
  const [pulse, setPulse] = useState<SmartPulseData | null>(null);
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllAnomalies, setShowAllAnomalies] = useState(false);
  const [alertSummary, setAlertSummary] = useState({ critical: 0, warning: 0, total: 0 });

  const fetchData = useCallback(async () => {
    try {
      const [pulseRes, alertRes] = await Promise.all([
        fetch(`${API}/api/dashboard/smart-pulse`, { credentials: "include" }),
        fetch(`${API}/api/dashboard/anomaly-stream`, { credentials: "include" }),
      ]);
      if (pulseRes.ok) setPulse(await pulseRes.json());
      if (alertRes.ok) {
        const ad = await alertRes.json();
        setAlerts(ad.alerts || []);
        setAlertSummary(ad.summary || { critical: 0, warning: 0, total: 0 });
      }
    } catch (err) {
      console.error("[SmartPulse] fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-xl bg-gradient-to-br from-slate-900 to-slate-800">
        <CardContent className="p-8 flex items-center justify-center">
          <div className="flex items-center gap-3 text-white/60">
            <Activity className="w-5 h-5 animate-pulse" />
            <span className="text-sm">Analyse intelligente en cours...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!pulse) return null;

  const hourlyData = pulse.hourlyDistribution.map((v, i) => ({ hour: `${i}h`, calls: v }));
  const visibleAnomalies = showAllAnomalies ? pulse.anomalies : pulse.anomalies.slice(0, 3);
  const hasCritical = pulse.anomalies.some(a => a.severity === "critique");

  return (
    <div className="space-y-4">
      <Card className={`border-0 shadow-xl overflow-hidden ${hasCritical ? "ring-1 ring-red-500/30" : ""}`}>
        <div className="bg-gradient-to-br from-slate-900 via-[#1a2744] to-slate-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${hasCritical ? "bg-red-500/20 animate-pulse" : "bg-emerald-500/20"}`}>
                  <ShieldAlert className={`w-5 h-5 ${hasCritical ? "text-red-400" : "text-emerald-400"}`} />
                </div>
                <div>
                  <CardTitle className="text-white text-lg">Radar Intelligent</CardTitle>
                  <p className="text-xs text-white/50 mt-0.5">Surveillance temps reel - Mise a jour chaque minute</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {alertSummary.critical > 0 && (
                  <Badge variant="destructive" className="animate-pulse text-xs">
                    {alertSummary.critical} critique{alertSummary.critical > 1 ? "s" : ""}
                  </Badge>
                )}
                {alertSummary.warning > 0 && (
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                    {alertSummary.warning} alerte{alertSummary.warning > 1 ? "s" : ""}
                  </Badge>
                )}
                <Button variant="ghost" size="icon" onClick={handleRefresh} className="text-white/60 hover:text-white hover:bg-white/10 h-8 w-8">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-2 pb-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-3 flex flex-col items-center justify-center">
                <HealthGauge score={pulse.healthScore} riskLevel={pulse.riskLevel} />
              </div>

              <div className="lg:col-span-5">
                <div className="grid grid-cols-2 gap-1">
                  <MiniMetric icon={Phone} label="Appels aujourd'hui" value={pulse.metrics.todayCalls} color="bg-blue-600" />
                  <MiniMetric icon={Phone} label="Manques" value={pulse.metrics.todayMissed} suffix={pulse.metrics.missedRate > 0 ? ` (${pulse.metrics.missedRate}%)` : ""} color="bg-red-600" />
                  <MiniMetric icon={CheckSquare} label="Taches en retard" value={pulse.metrics.overdueTasks} color="bg-amber-600" />
                  <MiniMetric icon={CheckSquare} label="Terminees cette sem." value={pulse.metrics.completedTasks} color="bg-emerald-600" />
                  <MiniMetric icon={MessageSquare} label="Non lus" value={pulse.metrics.unreadMessages} color="bg-purple-600" />
                </div>
              </div>

              <div className="lg:col-span-4">
                <div className="text-xs text-white/50 mb-2 flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" /> Distribution horaire des appels
                </div>
                <div className="h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hourlyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pulseGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="hour" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} interval={3} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} />
                      <RechartsTooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12, color: "#fff" }}
                        labelStyle={{ color: "#94a3b8" }}
                      />
                      <Area type="monotone" dataKey="calls" stroke="#3b82f6" fill="url(#pulseGradient)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {pulse.metrics.peakHour >= 0 && (
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-white/40">
                    <Clock className="w-3 h-3" />
                    Heure de pointe: <span className="text-white/70 font-semibold">{pulse.metrics.peakHour}h00</span>
                  </div>
                )}
              </div>
            </div>

            {pulse.metrics.weekGrowth !== 0 && (
              <div className={`mt-4 flex items-center gap-2 p-2.5 rounded-lg ${pulse.metrics.weekGrowth > 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                {pulse.metrics.weekGrowth > 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-400" />
                )}
                <span className={`text-xs font-medium ${pulse.metrics.weekGrowth > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {pulse.metrics.weekGrowth > 0 ? "+" : ""}{pulse.metrics.weekGrowth}% d'activite par rapport a la semaine derniere
                  ({pulse.metrics.weekCalls} vs {pulse.metrics.prevWeekCalls} appels)
                </span>
              </div>
            )}
          </CardContent>
        </div>
      </Card>

      {(pulse.anomalies.length > 0 || alerts.length > 0) && (
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Alertes & Anomalies
                <Badge variant="secondary" className="text-xs">{pulse.anomalies.length + alerts.length}</Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {alerts.map((alert) => {
              const config = SEVERITY_CONFIG[alert.severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.info;
              const SevIcon = config.icon;
              return (
                <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-xl border ${config.bgColor} ${config.borderColor} transition-all hover:shadow-md`}>
                  <div className={`p-1.5 rounded-lg ${config.color}`}>
                    <SevIcon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{alert.title}</span>
                      <Badge variant="outline" className={`text-[10px] ${config.textColor} border-current/30`}>{config.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                    {alert.action && (
                      <div className="flex items-center gap-1 mt-1.5 text-xs font-medium text-primary">
                        <Zap className="w-3 h-3" /> {alert.action}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {visibleAnomalies.map((anomaly, i) => {
              const config = SEVERITY_CONFIG[anomaly.severity] || SEVERITY_CONFIG.info;
              const SevIcon = config.icon;
              return (
                <div key={`anomaly-${i}`} className={`flex items-start gap-3 p-3 rounded-xl border ${config.bgColor} ${config.borderColor} transition-all hover:shadow-md`}>
                  <div className={`p-1.5 rounded-lg ${config.color}`}>
                    <SevIcon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{anomaly.title}</span>
                      <Badge variant="outline" className={`text-[10px] ${config.textColor} border-current/30`}>{config.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{anomaly.description}</p>
                  </div>
                  {anomaly.metric !== undefined && (
                    <div className={`text-lg font-black tabular-nums ${config.textColor}`}>{anomaly.metric}</div>
                  )}
                </div>
              );
            })}

            {pulse.anomalies.length > 3 && (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowAllAnomalies(!showAllAnomalies)}>
                {showAllAnomalies ? "Voir moins" : `Voir les ${pulse.anomalies.length - 3} autres`}
                <ChevronRight className={`w-3 h-3 ml-1 transition-transform ${showAllAnomalies ? "rotate-90" : ""}`} />
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {pulse.recommendations.length > 0 && (
        <Card className="border-0 shadow-lg bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-500" />
              Recommandations IA
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              {pulse.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-white/5 transition-colors">
                  <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-indigo-500">{i + 1}</span>
                  </div>
                  <p className="text-sm text-foreground/80">{rec}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
