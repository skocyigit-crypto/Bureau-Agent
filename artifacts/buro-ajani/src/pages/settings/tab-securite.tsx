import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield, ShieldCheck, ShieldAlert, ShieldBan, Lock, Clock,
  KeyRound, Fingerprint, ScanSearch, Ban, Server, UserCog,
  TriangleAlert, CircleAlert, FileText, RefreshCw, AlertTriangle, Loader2,
  Zap, Bug, Crosshair, Activity, Eye, Globe, Bomb, Network,
  TrendingUp, Radio
} from "lucide-react";
import securityServerImg from "@/assets/images/security-server.png";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

const SECURITY_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/security";

function SecurityMonitorPanel() {
  const [stats, setStats] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const fetchSecurityData = useCallback(async () => {
    try {
      const res = await fetch(`${SECURITY_API}/dashboard`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setEvents(data.recentEvents || []);
        setBlacklist(data.blacklistedIps || []);
      } else {
        console.error("[Securite] dashboard HTTP error:", res.status);
      }
    } catch (err) { console.error("[Securite] dashboard fetch failed:", err); } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchSecurityData(); }, [fetchSecurityData]);

  const handleUnblock = async (ip: string) => {
    try {
      const res = await fetch(`${SECURITY_API}/blacklist/${ip}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "IP debloquee", description: `L'adresse ${ip} a ete retiree de la liste noire.` });
        fetchSecurityData();
      } else {
        toast({ title: "Erreur", description: "Impossible de debloquer cette IP.", variant: "destructive" });
      }
    } catch { toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" }); }
  };

  const handleRefresh = () => { setRefreshing(true); fetchSecurityData(); };

  const severityColor = (s: string) =>
    s === "critical" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
    s === "warning" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";

  const levelLabel = stats?.blacklistedIps > 0 || (stats?.critical || 0) > 0 ? "Eleve" :
                     (stats?.warning || 0) > 5 ? "Modere" : "Normal";
  const levelColor = levelLabel === "Eleve" ? "text-red-600" : levelLabel === "Modere" ? "text-amber-600" : "text-emerald-600";

  if (loading) {
    return (
      <Card className="border-blue-200 dark:border-blue-900/50">
        <CardContent className="p-8 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">Chargement du moniteur de securite...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 dark:border-blue-900/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="w-5 h-5 text-blue-600" />
              Moniteur de Securite en Temps Reel
            </CardTitle>
            <CardDescription>Surveillance des menaces, detection de virus et protection des données clients.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${levelColor === "text-emerald-600" ? "bg-emerald-100 text-emerald-700" : levelColor === "text-amber-600" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"} border-0`}>
              Niveau: {levelLabel}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.totalEvents || 0}</div>
              <p className="text-xs text-muted-foreground">Evenements totaux</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.critical || 0}</div>
              <p className="text-xs text-muted-foreground">Critiques</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{stats.warning || 0}</div>
              <p className="text-xs text-muted-foreground">Avertissements</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-slate-600">{stats.blacklistedIps || 0}</div>
              <p className="text-xs text-muted-foreground">IP bloquees</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 border rounded-lg p-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium">Antivirus Fichiers</p>
              <p className="text-xs text-muted-foreground">Scanner de signatures actif</p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 border-0 text-[10px]">Actif</Badge>
          </div>
          <div className="flex items-center gap-3 border rounded-lg p-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Shield className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium">Detection XSS/SQL</p>
              <p className="text-xs text-muted-foreground">Protection injection active</p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 border-0 text-[10px]">Actif</Badge>
          </div>
          <div className="flex items-center gap-3 border rounded-lg p-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Ban className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium">IP Kara Liste</p>
              <p className="text-xs text-muted-foreground">Blocage automatique</p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 border-0 text-[10px]">Actif</Badge>
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Derniers evenements de securite
            </h4>
            <Badge variant="outline" className="text-[10px]">{events.length} recents</Badge>
          </div>
          {events.length === 0 ? (
            <div className="border rounded-lg p-4 text-center">
              <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Aucune menace detectee. Tout est securise.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {events.slice(0, 10).map((ev: any, i: number) => (
                <div key={i} className="flex items-center gap-2 border rounded p-2 text-xs">
                  <Badge className={`${severityColor(ev.severity)} border-0 text-[9px] shrink-0`}>
                    {ev.severity === "critical" ? "CRITIQUE" : ev.severity === "warning" ? "ALERTE" : "INFO"}
                  </Badge>
                  <span className="text-muted-foreground shrink-0">{new Date(ev.timestamp).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</span>
                  <span className="truncate">{ev.details}</span>
                  <span className="ml-auto text-muted-foreground shrink-0">{ev.ip}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {blacklist.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                <Ban className="w-4 h-4 text-red-500" />
                Adresses IP bloquees
              </h4>
              <div className="space-y-1.5">
                {blacklist.map((entry: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 border border-red-200 dark:border-red-900/50 rounded p-2 text-xs">
                    <Badge className="bg-red-100 text-red-700 border-0 text-[9px]">
                      {entry.permanent ? "PERMANENT" : "TEMPORAIRE"}
                    </Badge>
                    <span className="font-mono">{entry.ip}</span>
                    <span className="text-muted-foreground">{entry.count} tentatives</span>
                    {!entry.permanent && <span className="text-muted-foreground">jusqu'a {new Date(entry.until).toLocaleString("fr-FR")}</span>}
                    <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => handleUnblock(entry.ip)}>
                      Debloquer
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="font-semibold text-xs text-blue-800 dark:text-blue-300">Protection Multi-Couches Active</h4>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                Vos donnees client sont protegees par 9 couches de securite :
                chiffrement AES-256-GCM, scanner antivirus de fichiers, detection XSS/injection SQL,
                protection CSRF, limitation de debit, liste noire IP automatique,
                en-tetes de securite (Helmet/CSP/HSTS), isolation multi-tenant et journalisation d'audit.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Guardian WAF Paneli ───────────────────────────────────────────────────────

const GUARDIAN_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  attack_tool:       { label: "Outil attaque",   icon: Bug,       color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  honeypot:          { label: "Honeypot",         icon: Crosshair, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  suspicious_path:   { label: "Chemin suspect",   icon: Eye,       color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  json_bomb:         { label: "JSON bombe",        icon: Bomb,      color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  http_anomaly:      { label: "Anomalie HTTP",     icon: Globe,     color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  behavioral_anomaly:{ label: "Comportement",      icon: Activity,  color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  behavioral_block:  { label: "Bloc comport.",     icon: Network,   color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

function GuardianWafPanel() {
  const [stats, setStats] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [bannedIps, setBannedIps] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<"events" | "banned" | "profiles">("events");
  const { toast } = useToast();

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [statsRes, eventsRes, bannedRes, profilesRes] = await Promise.all([
        fetch(`${SECURITY_API}/guardian/stats`, { credentials: "include" }),
        fetch(`${SECURITY_API}/guardian/events?limit=50`, { credentials: "include" }),
        fetch(`${SECURITY_API}/guardian/banned`, { credentials: "include" }),
        fetch(`${SECURITY_API}/guardian/profiles`, { credentials: "include" }),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (eventsRes.ok) setEvents((await eventsRes.json()).events || []);
      if (bannedRes.ok) setBannedIps((await bannedRes.json()).bannedIps || []);
      if (profilesRes.ok) setProfiles((await profilesRes.json()).profiles || []);
    } catch { /* silently ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 8 s x 4 endpoints = 1 800 requetes/heure, de loin le sondage le plus lourd
  // de l'application. Porte a 20 s et suspendu quand l'onglet est masque: cet
  // ecran laisse ouvert en arriere-plan maintenait a lui seul une instance
  // Cloud Run eveillee en permanence. 20 s reste largement assez reactif pour
  // un tableau de bord de securite, et le bouton de rafraichissement manuel
  // couvre le besoin d'immediat.
  useVisibleInterval(() => { void fetchAll(true); }, autoRefresh ? 20000 : null, { runOnMount: false });

  const handleUnban = async (ip: string) => {
    try {
      const res = await fetch(`${SECURITY_API}/guardian/banned/${encodeURIComponent(ip)}`, {
        method: "DELETE", credentials: "include",
      });
      if (res.ok) {
        toast({ title: "IP debloquee", description: `${ip} retiree du Guardian.` });
        fetchAll();
      } else {
        toast({ title: "Erreur", description: "Impossible de debloquer.", variant: "destructive" });
      }
    } catch { toast({ title: "Erreur reseau", variant: "destructive" } as any); }
  };

  const typeConf = (type: string) =>
    GUARDIAN_TYPE_CONFIG[type] ?? { label: type, icon: Shield, color: "bg-slate-100 text-slate-700" };

  const sevColor = (s: string) =>
    s === "critical" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
    s === "warning"  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "short" });
    } catch { return iso; }
  };

  const uptimeLabel = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  if (loading) {
    return (
      <Card className="border-purple-200 dark:border-purple-900/50">
        <CardContent className="p-8 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
          <span className="text-sm text-muted-foreground">Chargement Guardian WAF...</span>
        </CardContent>
      </Card>
    );
  }

  const blockRate = stats && stats.totalInspected > 0
    ? ((stats.totalBlocked / stats.totalInspected) * 100).toFixed(2)
    : "0.00";

  return (
    <Card className="border-purple-200 dark:border-purple-900/50">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-600" />
              Guardian WAF — Pare-feu Applicatif
            </CardTitle>
            <CardDescription>
              Inspection en temps reel de chaque requete entrante. Outils d'attaque, honeypots, comportements suspects, bombes JSON.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Radio className={`w-3 h-3 ${autoRefresh ? "text-emerald-500 animate-pulse" : "text-slate-400"}`} />
              <span className="text-[10px] text-muted-foreground">Auto</span>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-75" />
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchAll()} disabled={refreshing}>
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stat kartları */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="border rounded-lg p-3 text-center bg-slate-50 dark:bg-slate-900/30">
              <div className="text-xl font-bold text-slate-700 dark:text-slate-300">{(stats.totalInspected ?? 0).toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Requetes inspectees</p>
            </div>
            <div className="border border-red-200 rounded-lg p-3 text-center bg-red-50 dark:bg-red-950/20">
              <div className="text-xl font-bold text-red-600">{(stats.totalBlocked ?? 0).toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Bloquees ({blockRate}%)</p>
            </div>
            <div className="border border-purple-200 rounded-lg p-3 text-center bg-purple-50 dark:bg-purple-950/20">
              <div className="text-xl font-bold text-purple-600">{(stats.bannedIpsActive ?? 0).toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">IP bannis actifs</p>
            </div>
            <div className="border border-emerald-200 rounded-lg p-3 text-center bg-emerald-50 dark:bg-emerald-950/20">
              <div className="text-xl font-bold text-emerald-600">{uptimeLabel(stats.uptime ?? 0)}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Uptime Guardian</p>
            </div>
          </div>
        )}

        {/* Detay istatistikleri */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: "Outils d'attaque",    value: stats.attackToolsDetected ?? 0, icon: Bug,      color: "text-red-600" },
              { label: "Honeypots declenches", value: stats.honeypotTriggered ?? 0,  icon: Crosshair, color: "text-purple-600" },
              { label: "Chemins suspects",     value: stats.suspiciousPaths ?? 0,    icon: Eye,       color: "text-amber-600" },
              { label: "Bombes JSON",          value: stats.jsonBombsBlocked ?? 0,   icon: Bomb,      color: "text-orange-600" },
              { label: "Anomalies HTTP",       value: stats.httpAnomalies ?? 0,      icon: Globe,     color: "text-yellow-600" },
              { label: "Blocs comportementaux",value: stats.behavioralBlocks ?? 0,   icon: Activity,  color: "text-blue-600" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="flex items-center gap-2 border rounded-lg p-2.5">
                <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                <div className="min-w-0">
                  <div className={`text-sm font-bold ${color}`}>{value.toLocaleString()}</div>
                  <p className="text-[10px] text-muted-foreground truncate">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Activite recente */}
        {stats && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground border rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-900/30">
            <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {stats.eventsLast5min ?? 0} ev/5min</span>
            <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {stats.eventsLast60min ?? 0} ev/1h</span>
            <span className="flex items-center gap-1"><ShieldBan className="w-3 h-3" /> {stats.permanentBans ?? 0} bans permanents</span>
            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {stats.autobanCount ?? 0} bans auto</span>
          </div>
        )}

        <Separator />

        {/* Tabs: evenements / bans / profils */}
        <div className="flex gap-1 border rounded-lg p-1 bg-muted/30 w-fit">
          {([
            { key: "events",   label: "Evenements", count: events.length },
            { key: "banned",   label: "IP Bannis",  count: bannedIps.length },
            { key: "profiles", label: "Profils",    count: profiles.length },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${activeTab === tab.key ? "bg-white dark:bg-slate-800 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {tab.label}
              {tab.count > 0 && (
                <Badge className="ml-1 h-4 px-1 text-[9px] bg-purple-100 text-purple-700 border-0">{tab.count}</Badge>
              )}
            </button>
          ))}
        </div>

        {/* Evenements */}
        {activeTab === "events" && (
          <div>
            {events.length === 0 ? (
              <div className="border rounded-lg p-6 text-center">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucun evenement Guardian detecte.</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {events.map((ev: any, i: number) => {
                  const tc = typeConf(ev.type);
                  const TypeIcon = tc.icon;
                  return (
                    <div key={i} className={`flex items-start gap-2 rounded-lg p-2 text-xs border ${ev.blocked ? "border-red-200 dark:border-red-900/40 bg-red-50/30 dark:bg-red-950/10" : "border-border"}`}>
                      <Badge className={`${tc.color} border-0 text-[9px] shrink-0 mt-0.5 flex items-center gap-0.5`}>
                        <TypeIcon className="w-2.5 h-2.5" />
                        {tc.label}
                      </Badge>
                      <Badge className={`${sevColor(ev.severity)} border-0 text-[9px] shrink-0 mt-0.5`}>
                        {ev.severity === "critical" ? "CRITIQUE" : ev.severity === "warning" ? "ALERTE" : "INFO"}
                      </Badge>
                      <span className="truncate flex-1 text-muted-foreground">{ev.details}</span>
                      <span className="font-mono shrink-0 text-muted-foreground">{ev.ip}</span>
                      <span className="text-[9px] text-muted-foreground shrink-0">{formatTime(ev.timestamp)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* IP Bannis */}
        {activeTab === "banned" && (
          <div>
            {bannedIps.length === 0 ? (
              <div className="border rounded-lg p-6 text-center">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucune IP bannie par le Guardian.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {bannedIps.map((entry: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 border border-red-200 dark:border-red-900/50 rounded-lg p-2.5 text-xs bg-red-50/30 dark:bg-red-950/10">
                    <Badge className={`border-0 text-[9px] ${entry.permanent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {entry.permanent ? "PERMANENT" : "TEMPORAIRE"}
                    </Badge>
                    <span className="font-mono font-medium">{entry.ip}</span>
                    <span className="text-muted-foreground">{entry.count} infraction{entry.count > 1 ? "s" : ""}</span>
                    {entry.reasons?.[0] && (
                      <span className="text-muted-foreground truncate hidden sm:block">{entry.reasons[0]}</span>
                    )}
                    {!entry.permanent && (
                      <span className="text-muted-foreground shrink-0 hidden md:block">jusqu'a {formatTime(entry.until)}</span>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      className="ml-auto h-6 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                      onClick={() => handleUnban(entry.ip)}
                    >
                      Debloquer
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Profils de menace */}
        {activeTab === "profiles" && (
          <div>
            {profiles.length === 0 ? (
              <div className="border rounded-lg p-6 text-center">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucun profil de menace actif.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {profiles.map((p: any, i: number) => {
                  const scoreColor = p.threatScore >= 60 ? "text-red-600" : p.threatScore >= 30 ? "text-amber-600" : "text-blue-600";
                  const scoreBg = p.threatScore >= 60 ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900/50" : p.threatScore >= 30 ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50" : "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/50";
                  return (
                    <div key={i} className={`border rounded-lg p-2.5 text-xs ${scoreBg}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-medium">{p.ip}</span>
                        <Badge className={`border-0 text-[9px] font-bold ${p.threatScore >= 60 ? "bg-red-100 text-red-700" : p.threatScore >= 30 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                          Score: {p.threatScore}
                        </Badge>
                        <span className="text-muted-foreground">{p.requests} req</span>
                        <span className="text-muted-foreground">{p.uniquePaths} chemins</span>
                        <span className={`font-medium ml-auto ${scoreColor}`}>
                          {p.threatScore >= 60 ? "CRITIQUE" : p.threatScore >= 30 ? "SUSPECT" : "SURVEILLE"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Legende des protections */}
        <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/50 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <Zap className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="font-semibold text-xs text-purple-800 dark:text-purple-300">Guardian WAF — 8 couches de detection</h4>
              <p className="text-[11px] text-purple-600 dark:text-purple-400 mt-0.5">
                Outils d'attaque (sqlmap, nikto, burpsuite, nmap...) · Honeypots (50+ chemins pieges) ·
                URL suspects (traversal, shells PHP...) · Bombes JSON · Anomalies HTTP ·
                Profilage comportemental · Ban automatique escalade · 35+ signatures d'outils malveillants
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TabSecurite() {
  const { toast } = useToast();
  const [zeroTrustMode, setZeroTrustMode] = useState(true);
  const [forceReauth, setForceReauth] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");

  const handleSecurityAction = (action: string) => {
    toast({ title: "Action de securite", description: action });
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-36">
          <img src={securityServerImg} alt="Infrastructure de securite" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/80 via-emerald-800/60 to-transparent" />
          <div className="absolute inset-0 flex flex-col sm:flex-row items-start sm:items-center justify-center sm:justify-between gap-2 px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-300" /> Infrastructure securisee</h3>
              <p className="text-white/80 text-sm mt-1">Protection multi-couches, chiffrement de bout en bout, conformite RGPD</p>
            </div>
            <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30 shrink-0">
              Toutes les protections actives
            </Badge>
          </div>
        </div>
      </Card>

      <Card className="border-emerald-200 dark:border-emerald-900/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-600" />
                Securite de l'application
              </CardTitle>
              <CardDescription>Protection multi-couches active en permanence.</CardDescription>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">
              <ShieldCheck className="w-3 h-3 mr-1" />
              Toutes les protections actives
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>HTTPS force</Label>
              <p className="text-xs text-muted-foreground">Toutes les connexions utilisent le chiffrement TLS 1.3</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Protection CSRF</Label>
              <p className="text-xs text-muted-foreground">Protection contre les attaques Cross-Site Request Forgery</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Limitation de debit (Rate Limiting)</Label>
              <p className="text-xs text-muted-foreground">100 requetes/min standard, 20/min pour l'IA, 200/min pour les lectures</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>En-tetes de securite (Helmet)</Label>
              <p className="text-xs text-muted-foreground">CSP, X-Frame-Options, HSTS et autres en-tetes de securite</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Protection HPP</Label>
              <p className="text-xs text-muted-foreground">Protection contre la pollution des parametres HTTP</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>CORS configure</Label>
              <p className="text-xs text-muted-foreground">Origines autorisees controlees par variable d'environnement</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Limite de taille du corps</Label>
              <p className="text-xs text-muted-foreground">Maximum 1 Mo par requete</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <ShieldAlert className="w-5 h-5" />
            Mode Zero Trust
          </CardTitle>
          <CardDescription>Architecture de securite ou aucun utilisateur, appareil ou reseau n'est considere comme fiable par defaut.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-semibold text-sm text-red-800 dark:text-red-300">Principe : ne jamais faire confiance, toujours verifier</h4>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Chaque requete est authentifiee, autorisee et chiffree independamment de sa source.
                  Les sessions sont limitees dans le temps et les privileges sont accorde au minimum necessaire.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <ShieldBan className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>Mode Zero Trust actif</Label>
                <p className="text-xs text-muted-foreground">Verifier chaque acces, meme depuis le reseau interne</p>
              </div>
            </div>
            <Switch checked={zeroTrustMode} onCheckedChange={setZeroTrustMode} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <KeyRound className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>Re-authentification obligatoire</Label>
                <p className="text-xs text-muted-foreground">Exiger une re-authentification pour les actions sensibles (suppression, export, admin)</p>
              </div>
            </div>
            <Switch checked={forceReauth} onCheckedChange={setForceReauth} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>Expiration de session</Label>
                <p className="text-xs text-muted-foreground">Delai d'inactivite avant deconnexion automatique</p>
              </div>
            </div>
            <Select value={sessionTimeout} onValueChange={setSessionTimeout}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">1 heure</SelectItem>
                <SelectItem value="120">2 heures</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <Fingerprint className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>Authentification multi-facteurs (MFA)</Label>
                <p className="text-xs text-muted-foreground">Exiger un second facteur d'authentification pour tous les utilisateurs</p>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <Server className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>Micro-segmentation reseau</Label>
                <p className="text-xs text-muted-foreground">Isoler chaque service pour limiter la propagation en cas de compromission</p>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
          </div>
        </CardContent>
      </Card>

      <SecurityMonitorPanel />

      <GuardianWafPanel />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="w-5 h-5" />
            Roles et permissions
          </CardTitle>
          <CardDescription>Gestion des niveaux d'accès par role.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { badge: "Super Admin", color: "bg-red-100 text-red-700", level: "Niveau 4", title: "Acces total", desc: "Seul role autorise a telecharger des fichiers externes, modifier les parametres de securite, gerer les utilisateurs et acceder aux journaux d'audit. Peut lever les restrictions temporairement." },
              { badge: "Administrateur", color: "bg-amber-100 text-amber-700", level: "Niveau 3", title: "Gestion avancee", desc: "Gestion des contacts, taches et rapports. Pas d'accès aux telechargements externes ni aux parametres de securite critiques. Peut consulter les alertes de securite." },
              { badge: "Agent", color: "bg-blue-100 text-blue-700", level: "Niveau 2", title: "Operations courantes", desc: "Gestion des appels, consultation des contacts et taches. Aucun acces aux fichiers externes, aux exports de donnees ni aux parametres systeme." },
              { badge: "Lecture seule", color: "bg-gray-100 text-gray-700", level: "Niveau 1", title: "Consultation uniquement", desc: "Consultation des tableaux de bord et rapports uniquement. Aucune modification, aucun telechargement, aucun export. Acces le plus restreint." },
            ].map((role) => (
              <div key={role.badge} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge className={`${role.color} border-0`}>{role.badge}</Badge>
                    <span className="text-sm font-medium">{role.title}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{role.level}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{role.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conformite RGPD</CardTitle>
          <CardDescription>Parametres de conformite au Reglement General sur la Protection des Donnees.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Chiffrement des données au repos", desc: "Les donnees sensibles sont chiffrees dans la base de donnees (AES-256)" },
            { label: "Journal d'audit", desc: "Enregistrer toutes les actions des utilisateurs avec horodatage et adresse IP" },
            { label: "Droit a l'oubli", desc: "Permettre la suppression complete des données d'un contact" },
            { label: "Export des données personnelles", desc: "Permettre l'export des données au format standard (RGPD Art. 20)" },
            { label: "Conservation limitee des données", desc: "Suppression automatique des données au-dela de la duree legale de conservation" },
            { label: "Consentement explicite", desc: "Recueillir et enregistrer le consentement avant tout traitement de donnees" },
          ].map((item, i) => (
            <div key={item.label}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex items-center justify-between">
                <div>
                  <Label>{item.label}</Label>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CircleAlert className="w-5 h-5 text-amber-500" />
            Actions de securite
          </CardTitle>
          <CardDescription>Operations manuelles de securite reservees au Super Administrateur.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1" onClick={() => handleSecurityAction("Lancement de l'audit de securite complet...")}>
              <div className="flex items-center gap-2 text-sm font-medium"><ScanSearch className="w-4 h-4" /> Audit de securite complet</div>
              <p className="text-[10px] text-muted-foreground text-left">Analyser toutes les configurations et detecter les vulnerabilites</p>
            </Button>
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1" onClick={() => handleSecurityAction("Export du journal d'audit en cours...")}>
              <div className="flex items-center gap-2 text-sm font-medium"><FileText className="w-4 h-4" /> Exporter le journal d'audit</div>
              <p className="text-[10px] text-muted-foreground text-left">Telecharger le journal complet des actions (reserve super admin)</p>
            </Button>
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleSecurityAction("Revocation de toutes les sessions actives...")}>
              <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400"><ShieldBan className="w-4 h-4" /> Revoquer toutes les sessions</div>
              <p className="text-[10px] text-muted-foreground text-left">Deconnecter immediatement tous les utilisateurs actifs</p>
            </Button>
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleSecurityAction("Verrouillage d'urgence active. Seul le super admin peut deverrouiller.")}>
              <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400"><Lock className="w-4 h-4" /> Verrouillage d'urgence</div>
              <p className="text-[10px] text-muted-foreground text-left">Bloquer tout acces sauf super admin en cas d'incident critique</p>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
