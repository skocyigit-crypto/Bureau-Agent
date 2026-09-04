import securityServerImg from "@/assets/images/security-server.webp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { useTranslation } from "@/i18n";
import {
Activity,
AlertTriangle,
Ban,
Bomb,
Bug,
CircleAlert,
Clock,
Crosshair,
Eye,
FileText,
Fingerprint,
Globe,
KeyRound,
Loader2,
Lock,
Network,
Radio,
RefreshCw,
ScanSearch,
Shield,
ShieldAlert,ShieldBan,
ShieldCheck,
TrendingUp,
TriangleAlert,
UserCog,
Zap
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const SECURITY_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/security";
const AUTH_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/auth";

/**
 * Securite du compte : changement de mot de passe et authentification a deux
 * facteurs.
 *
 * Les routes correspondantes (/auth/change-password, /auth/mfa/setup, /enable,
 * /disable, /status) etaient completes cote serveur — generation du QR code
 * TOTP, verification, journalisation d'audit, limitation de debit — mais
 * AUCUNE page ne les appelait. Un utilisateur ne pouvait donc ni changer son
 * mot de passe, ni activer la double authentification, pendant que cet ecran
 * affichait un badge "MFA : Actif" ecrit en dur, sans rapport avec l'etat reel
 * du compte.
 */
function AccountSecurityPanel() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [mfa, setMfa] = useState<{ mfaActif: boolean; setupInProgress: boolean } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [setupData, setSetupData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const loadMfaStatus = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_API}/mfa/status`, { credentials: "include" });
      if (res.ok) setMfa(await res.json());
    } catch {
      /* l'etat reste inconnu: on n'affiche alors aucune affirmation */
    }
  }, []);

  useEffect(() => { loadMfaStatus(); }, [loadMfaStatus]);

  async function post(path: string, body: unknown) {
    const res = await fetch(`${AUTH_API}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`);
    return data;
  }

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({ title: t("settingsSecurite.account.passwordMismatch"), variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      await post("/change-password", { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast({ title: t("settingsSecurite.account.passwordChanged") });
    } catch (e: any) {
      toast({ title: t("settingsSecurite.account.changeFailed"), description: e?.message, variant: "destructive" });
    } finally { setChangingPassword(false); }
  };

  const startMfaSetup = async () => {
    setMfaBusy(true);
    try {
      const data: any = await post("/mfa/setup", {});
      setSetupData({ qrDataUrl: data.qrDataUrl, secret: data.secret });
    } catch (e: any) {
      toast({ title: t("settingsSecurite.account.setupFailed"), description: e?.message, variant: "destructive" });
    } finally { setMfaBusy(false); }
  };

  const confirmMfa = async () => {
    setMfaBusy(true);
    try {
      await post("/mfa/enable", { totpCode });
      setSetupData(null); setTotpCode("");
      await loadMfaStatus();
      toast({ title: t("settingsSecurite.account.twoFactorEnabled") });
    } catch (e: any) {
      toast({ title: t("settingsSecurite.account.codeRejected"), description: e?.message, variant: "destructive" });
    } finally { setMfaBusy(false); }
  };

  const disableMfa = async () => {
    setMfaBusy(true);
    try {
      await post("/mfa/disable", { password: disablePassword, totpCode });
      setDisablePassword(""); setTotpCode("");
      await loadMfaStatus();
      toast({ title: t("settingsSecurite.account.twoFactorDisabled") });
    } catch (e: any) {
      toast({ title: t("settingsSecurite.account.disableFailed"), description: e?.message, variant: "destructive" });
    } finally { setMfaBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="w-5 h-5 text-blue-500" />
          {t("settingsSecurite.account.title")}
        </CardTitle>
        <CardDescription>{t("settingsSecurite.account.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-semibold">{t("settingsSecurite.account.changePassword")}</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input aria-label={t("settingsSecurite.account.currentPassword")} type="password" placeholder={t("settingsSecurite.account.currentPassword")} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            <Input aria-label={t("settingsSecurite.account.newPassword")} type="password" placeholder={t("settingsSecurite.account.newPassword")} value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
            <Input aria-label={t("settingsSecurite.account.confirm")} type="password" placeholder={t("settingsSecurite.account.confirm")} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <Button
            size="sm"
            onClick={handleChangePassword}
            disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
          >
            {changingPassword && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            {t("settingsSecurite.account.submitPassword")}
          </Button>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Fingerprint className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <Label className="text-sm font-semibold">{t("settingsSecurite.account.twoFactor")}</Label>
                <p className="text-xs text-muted-foreground">{t("settingsSecurite.account.twoFactorDesc")}</p>
              </div>
            </div>
            {mfa && (
              <Badge className={mfa.mfaActif ? "bg-emerald-100 text-emerald-700 border-0" : "bg-gray-100 text-gray-600 border-0"}>
                {mfa.mfaActif ? t("settingsSecurite.account.enabled") : t("settingsSecurite.account.disabled")}
              </Badge>
            )}
          </div>

          {mfa && !mfa.mfaActif && !setupData && (
            <Button size="sm" variant="outline" onClick={startMfaSetup} disabled={mfaBusy}>
              {mfaBusy && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t("settingsSecurite.account.enable2fa")}
            </Button>
          )}

          {setupData && (
            <div className="rounded-md border p-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("settingsSecurite.account.setupInstructions")}
              </p>
              <img src={setupData.qrDataUrl} alt={t("settingsSecurite.account.qrAlt")} className="w-40 h-40 border rounded bg-white p-1" />
              <p className="text-[11px] text-muted-foreground break-all">
                {t("settingsSecurite.account.manualKey")} <code>{setupData.secret}</code>
              </p>
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t("settingsSecurite.account.totpLabel")}
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  className="w-32"
                />
                <Button size="sm" onClick={confirmMfa} disabled={mfaBusy || totpCode.length < 6}>
                  {mfaBusy && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  {t("settingsSecurite.account.confirmBtn")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setSetupData(null); setTotpCode(""); }}>
                  {t("settingsSecurite.account.cancel")}
                </Button>
              </div>
            </div>
          )}

          {mfa?.mfaActif && (
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {t("settingsSecurite.account.disableInstructions")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label={t("settingsSecurite.account.password")} type="password" placeholder={t("settingsSecurite.account.password")} value={disablePassword} onChange={e => setDisablePassword(e.target.value)} className="w-48" autoComplete="current-password" />
                <Input
                  aria-label={t("settingsSecurite.account.totpLabel")}
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  className="w-32"
                />
                <Button size="sm" variant="destructive" onClick={disableMfa} disabled={mfaBusy || !disablePassword || totpCode.length < 6}>
                  {mfaBusy && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                  {t("settingsSecurite.account.disableBtn")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityMonitorPanel() {
  const [stats, setStats] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

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
        toast({ title: t("settingsSecurite.monitor.ipUnblocked"), description: t("settingsSecurite.monitor.ipUnblockedDesc", { ip }) });
        fetchSecurityData();
      } else {
        toast({ title: t("settingsSecurite.monitor.error"), description: t("settingsSecurite.monitor.unblockFailed"), variant: "destructive" });
      }
    } catch { toast({ title: t("settingsSecurite.monitor.error"), description: t("settingsSecurite.monitor.networkError"), variant: "destructive" }); }
  };

  const handleRefresh = () => { setRefreshing(true); fetchSecurityData(); };

  const severityColor = (s: string) =>
    s === "critical" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
    s === "warning" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";

  const levelKey = stats?.blacklistedIps > 0 || (stats?.critical || 0) > 0 ? "high" :
                     (stats?.warning || 0) > 5 ? "medium" : "normal";
  const levelLabel = levelKey === "high" ? t("settingsSecurite.monitor.levelHigh") : levelKey === "medium" ? t("settingsSecurite.monitor.levelMedium") : t("settingsSecurite.monitor.levelNormal");
  const levelColor = levelKey === "high" ? "text-red-600" : levelKey === "medium" ? "text-amber-600" : "text-emerald-600";

  if (loading) {
    return (
      <Card className="border-blue-200 dark:border-blue-900/50">
        <CardContent className="p-8 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">{t("settingsSecurite.monitor.loading")}</span>
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
              {t("settingsSecurite.monitor.title")}
            </CardTitle>
            <CardDescription>{t("settingsSecurite.monitor.description")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${levelColor === "text-emerald-600" ? "bg-emerald-100 text-emerald-700" : levelColor === "text-amber-600" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"} border-0`}>
              {t("settingsSecurite.monitor.level", { level: levelLabel })}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              {t("settingsSecurite.monitor.refresh")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.totalEvents || 0}</div>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.monitor.totalEvents")}</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.critical || 0}</div>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.monitor.critical")}</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{stats.warning || 0}</div>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.monitor.warnings")}</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-slate-600">{stats.blacklistedIps || 0}</div>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.monitor.blockedIps")}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="flex items-center gap-3 border rounded-lg p-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("settingsSecurite.monitor.antivirus")}</p>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.monitor.antivirusDesc")}</p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 border-0 text-[10px]">{t("settingsSecurite.monitor.active")}</Badge>
          </div>
          <div className="flex items-center gap-3 border rounded-lg p-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Shield className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("settingsSecurite.monitor.xssSql")}</p>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.monitor.xssSqlDesc")}</p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 border-0 text-[10px]">{t("settingsSecurite.monitor.active")}</Badge>
          </div>
          <div className="flex items-center gap-3 border rounded-lg p-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Ban className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("settingsSecurite.monitor.ipBlacklist")}</p>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.monitor.ipBlacklistDesc")}</p>
            </div>
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 border-0 text-[10px]">{t("settingsSecurite.monitor.active")}</Badge>
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              {t("settingsSecurite.monitor.recentEvents")}
            </h4>
            <Badge variant="outline" className="text-[10px]">{t("settingsSecurite.monitor.recentCount", { count: events.length })}</Badge>
          </div>
          {events.length === 0 ? (
            <div className="border rounded-lg p-4 text-center">
              <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("settingsSecurite.monitor.noThreats")}</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {events.slice(0, 10).map((ev: any, i: number) => (
                <div key={i} className="flex items-center gap-2 border rounded p-2 text-xs">
                  <Badge className={`${severityColor(ev.severity)} border-0 text-[9px] shrink-0`}>
                    {ev.severity === "critical" ? t("settingsSecurite.monitor.sevCritical") : ev.severity === "warning" ? t("settingsSecurite.monitor.sevWarning") : t("settingsSecurite.monitor.sevInfo")}
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
                {t("settingsSecurite.monitor.blockedIpsTitle")}
              </h4>
              <div className="space-y-1.5">
                {blacklist.map((entry: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 border border-red-200 dark:border-red-900/50 rounded p-2 text-xs">
                    <Badge className="bg-red-100 text-red-700 border-0 text-[9px]">
                      {entry.permanent ? t("settingsSecurite.monitor.permanent") : t("settingsSecurite.monitor.temporary")}
                    </Badge>
                    <span className="font-mono">{entry.ip}</span>
                    <span className="text-muted-foreground">{t("settingsSecurite.monitor.attempts", { count: entry.count })}</span>
                    {!entry.permanent && <span className="text-muted-foreground">{t("settingsSecurite.monitor.until", { date: new Date(entry.until).toLocaleString("fr-FR") })}</span>}
                    <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => handleUnblock(entry.ip)}>
                      {t("settingsSecurite.monitor.unblock")}
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
              <h4 className="font-semibold text-xs text-blue-800 dark:text-blue-300">{t("settingsSecurite.monitor.multiLayerTitle")}</h4>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                {t("settingsSecurite.monitor.multiLayerDesc")}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Guardian WAF Paneli ───────────────────────────────────────────────────────

const GUARDIAN_TYPE_CONFIG: Record<string, { labelKey: string; icon: React.ElementType; color: string }> = {
  attack_tool:       { labelKey: "typeAttackTool",        icon: Bug,       color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  honeypot:          { labelKey: "typeHoneypot",          icon: Crosshair, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  suspicious_path:   { labelKey: "typeSuspiciousPath",    icon: Eye,       color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  json_bomb:         { labelKey: "typeJsonBomb",          icon: Bomb,      color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  http_anomaly:      { labelKey: "typeHttpAnomaly",       icon: Globe,     color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  behavioral_anomaly:{ labelKey: "typeBehavioralAnomaly", icon: Activity,  color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  behavioral_block:  { labelKey: "typeBehavioralBlock",   icon: Network,   color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
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
  const { t } = useTranslation();

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
        toast({ title: t("settingsSecurite.guardian.ipUnblocked"), description: t("settingsSecurite.guardian.ipUnblockedDesc", { ip }) });
        fetchAll();
      } else {
        toast({ title: t("settingsSecurite.guardian.error"), description: t("settingsSecurite.guardian.unblockFailed"), variant: "destructive" });
      }
    } catch { toast({ title: t("settingsSecurite.guardian.networkError"), variant: "destructive" } as any); }
  };

  const typeConf = (type: string) =>
    GUARDIAN_TYPE_CONFIG[type] ?? { labelKey: null, icon: Shield, color: "bg-slate-100 text-slate-700" };

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
          <span className="text-sm text-muted-foreground">{t("settingsSecurite.guardian.loading")}</span>
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
              {t("settingsSecurite.guardian.title")}
            </CardTitle>
            <CardDescription>
              {t("settingsSecurite.guardian.description")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Radio className={`w-3 h-3 ${autoRefresh ? "text-emerald-500 animate-pulse" : "text-slate-400"}`} />
              <span className="text-[10px] text-muted-foreground">{t("settingsSecurite.guardian.auto")}</span>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-75" />
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchAll()} disabled={refreshing}>
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              {t("settingsSecurite.guardian.refresh")}
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
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("settingsSecurite.guardian.requestsInspected")}</p>
            </div>
            <div className="border border-red-200 rounded-lg p-3 text-center bg-red-50 dark:bg-red-950/20">
              <div className="text-xl font-bold text-red-600">{(stats.totalBlocked ?? 0).toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("settingsSecurite.guardian.blocked", { rate: blockRate })}</p>
            </div>
            <div className="border border-purple-200 rounded-lg p-3 text-center bg-purple-50 dark:bg-purple-950/20">
              <div className="text-xl font-bold text-purple-600">{(stats.bannedIpsActive ?? 0).toLocaleString()}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("settingsSecurite.guardian.activeBannedIps")}</p>
            </div>
            <div className="border border-emerald-200 rounded-lg p-3 text-center bg-emerald-50 dark:bg-emerald-950/20">
              <div className="text-xl font-bold text-emerald-600">{uptimeLabel(stats.uptime ?? 0)}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("settingsSecurite.guardian.uptime")}</p>
            </div>
          </div>
        )}

        {/* Detay istatistikleri */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { labelKey: "attackTools",      value: stats.attackToolsDetected ?? 0, icon: Bug,      color: "text-red-600" },
              { labelKey: "honeypotsTriggered", value: stats.honeypotTriggered ?? 0,  icon: Crosshair, color: "text-purple-600" },
              { labelKey: "suspiciousPaths",  value: stats.suspiciousPaths ?? 0,    icon: Eye,       color: "text-amber-600" },
              { labelKey: "jsonBombs",        value: stats.jsonBombsBlocked ?? 0,   icon: Bomb,      color: "text-orange-600" },
              { labelKey: "httpAnomalies",    value: stats.httpAnomalies ?? 0,      icon: Globe,     color: "text-yellow-600" },
              { labelKey: "behavioralBlocks", value: stats.behavioralBlocks ?? 0,   icon: Activity,  color: "text-blue-600" },
            ].map(({ labelKey, value, icon: Icon, color }) => (
              <div key={labelKey} className="flex items-center gap-2 border rounded-lg p-2.5">
                <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                <div className="min-w-0">
                  <div className={`text-sm font-bold ${color}`}>{value.toLocaleString()}</div>
                  <p className="text-[10px] text-muted-foreground truncate">{t(`settingsSecurite.guardian.${labelKey}`)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Activite recente */}
        {stats && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground border rounded-lg px-3 py-2 bg-slate-50 dark:bg-slate-900/30">
            <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {t("settingsSecurite.guardian.eventsPer5min", { count: stats.eventsLast5min ?? 0 })}</span>
            <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {t("settingsSecurite.guardian.eventsPer1h", { count: stats.eventsLast60min ?? 0 })}</span>
            <span className="flex items-center gap-1"><ShieldBan className="w-3 h-3" /> {t("settingsSecurite.guardian.permanentBans", { count: stats.permanentBans ?? 0 })}</span>
            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {t("settingsSecurite.guardian.autoBans", { count: stats.autobanCount ?? 0 })}</span>
          </div>
        )}

        <Separator />

        {/* Tabs: evenements / bans / profils */}
        <div className="flex gap-1 border rounded-lg p-1 bg-muted/30 w-fit">
          {([
            { key: "events",   labelKey: "tabEvents",   count: events.length },
            { key: "banned",   labelKey: "tabBanned",   count: bannedIps.length },
            { key: "profiles", labelKey: "tabProfiles", count: profiles.length },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${activeTab === tab.key ? "bg-white dark:bg-slate-800 shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(`settingsSecurite.guardian.${tab.labelKey}`)}
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
                <p className="text-sm text-muted-foreground">{t("settingsSecurite.guardian.noEvents")}</p>
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
                        {tc.labelKey ? t(`settingsSecurite.guardian.${tc.labelKey}`) : ev.type}
                      </Badge>
                      <Badge className={`${sevColor(ev.severity)} border-0 text-[9px] shrink-0 mt-0.5`}>
                        {ev.severity === "critical" ? t("settingsSecurite.guardian.sevCritical") : ev.severity === "warning" ? t("settingsSecurite.guardian.sevWarning") : t("settingsSecurite.guardian.sevInfo")}
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
                <p className="text-sm text-muted-foreground">{t("settingsSecurite.guardian.noBannedIps")}</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {bannedIps.map((entry: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 border border-red-200 dark:border-red-900/50 rounded-lg p-2.5 text-xs bg-red-50/30 dark:bg-red-950/10">
                    <Badge className={`border-0 text-[9px] ${entry.permanent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {entry.permanent ? t("settingsSecurite.guardian.permanent") : t("settingsSecurite.guardian.temporary")}
                    </Badge>
                    <span className="font-mono font-medium">{entry.ip}</span>
                    <span className="text-muted-foreground">{entry.count > 1 ? t("settingsSecurite.guardian.infractionOther", { count: entry.count }) : t("settingsSecurite.guardian.infractionOne", { count: entry.count })}</span>
                    {entry.reasons?.[0] && (
                      <span className="text-muted-foreground truncate hidden sm:block">{entry.reasons[0]}</span>
                    )}
                    {!entry.permanent && (
                      <span className="text-muted-foreground shrink-0 hidden md:block">{t("settingsSecurite.guardian.until", { date: formatTime(entry.until) })}</span>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      className="ml-auto h-6 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                      onClick={() => handleUnban(entry.ip)}
                    >
                      {t("settingsSecurite.guardian.unblock")}
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
                <p className="text-sm text-muted-foreground">{t("settingsSecurite.guardian.noProfiles")}</p>
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
                          {t("settingsSecurite.guardian.score", { score: p.threatScore })}
                        </Badge>
                        <span className="text-muted-foreground">{t("settingsSecurite.guardian.requests", { count: p.requests })}</span>
                        <span className="text-muted-foreground">{t("settingsSecurite.guardian.paths", { count: p.uniquePaths })}</span>
                        <span className={`font-medium ml-auto ${scoreColor}`}>
                          {p.threatScore >= 60 ? t("settingsSecurite.guardian.profileCritical") : p.threatScore >= 30 ? t("settingsSecurite.guardian.profileSuspect") : t("settingsSecurite.guardian.profileMonitored")}
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
              <h4 className="font-semibold text-xs text-purple-800 dark:text-purple-300">{t("settingsSecurite.guardian.legendTitle")}</h4>
              <p className="text-[11px] text-purple-600 dark:text-purple-400 mt-0.5">
                {t("settingsSecurite.guardian.legendDesc")}
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
  const { t } = useTranslation();
  const [zeroTrustMode, setZeroTrustMode] = useState(true);
  const [forceReauth, setForceReauth] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");

  const handleSecurityAction = (action: string) => {
    toast({ title: t("settingsSecurite.app.securityAction"), description: action });
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-36">
          <img src={securityServerImg} alt={t("settingsSecurite.app.heroImgAlt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/80 via-emerald-800/60 to-transparent" />
          <div className="absolute inset-0 flex flex-col sm:flex-row items-start sm:items-center justify-center sm:justify-between gap-2 px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-300" /> {t("settingsSecurite.app.heroTitle")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("settingsSecurite.app.heroSubtitle")}</p>
            </div>
            <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30 shrink-0">
              {t("settingsSecurite.app.allProtectionsActive")}
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
                {t("settingsSecurite.app.appSecTitle")}
              </CardTitle>
              <CardDescription>{t("settingsSecurite.app.appSecDesc")}</CardDescription>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">
              <ShieldCheck className="w-3 h-3 mr-1" />
              {t("settingsSecurite.app.allProtectionsActive")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsSecurite.app.httpsForced")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.httpsForcedDesc")}</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{t("settingsSecurite.app.active")}</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsSecurite.app.csrf")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.csrfDesc")}</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{t("settingsSecurite.app.active")}</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsSecurite.app.rateLimit")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.rateLimitDesc")}</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{t("settingsSecurite.app.active")}</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsSecurite.app.helmet")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.helmetDesc")}</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{t("settingsSecurite.app.active")}</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsSecurite.app.hpp")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.hppDesc")}</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{t("settingsSecurite.app.active")}</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsSecurite.app.cors")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.corsDesc")}</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{t("settingsSecurite.app.active")}</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsSecurite.app.bodyLimit")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.bodyLimitDesc")}</p>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{t("settingsSecurite.app.active")}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <ShieldAlert className="w-5 h-5" />
            {t("settingsSecurite.app.zeroTrustTitle")}
          </CardTitle>
          <CardDescription>{t("settingsSecurite.app.zeroTrustDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-semibold text-sm text-red-800 dark:text-red-300">{t("settingsSecurite.app.zeroTrustPrinciple")}</h4>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  {t("settingsSecurite.app.zeroTrustPrincipleDesc")}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <ShieldBan className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>{t("settingsSecurite.app.zeroTrustActive")}</Label>
                <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.zeroTrustActiveDesc")}</p>
              </div>
            </div>
            <Switch checked={zeroTrustMode} onCheckedChange={setZeroTrustMode} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <KeyRound className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>{t("settingsSecurite.app.reauth")}</Label>
                <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.reauthDesc")}</p>
              </div>
            </div>
            <Switch checked={forceReauth} onCheckedChange={setForceReauth} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>{t("settingsSecurite.app.sessionExpiry")}</Label>
                <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.sessionExpiryDesc")}</p>
              </div>
            </div>
            <Select value={sessionTimeout} onValueChange={setSessionTimeout}>
              <SelectTrigger aria-label={t("settingsSecurite.app.sessionExpiry")} className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">{t("settingsSecurite.app.min15")}</SelectItem>
                <SelectItem value="30">{t("settingsSecurite.app.min30")}</SelectItem>
                <SelectItem value="60">{t("settingsSecurite.app.hour1")}</SelectItem>
                <SelectItem value="120">{t("settingsSecurite.app.hour2")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          {/* Le badge "MFA : Actif" etait ecrit en dur et n'avait aucun rapport
              avec l'etat reel du compte — il s'affichait "Actif" y compris pour
              un utilisateur sans double authentification. Le vrai reglage, avec
              son etat effectif, se trouve dans la carte "Sécurité de mon
              compte" ci-dessous. La ligne "micro-segmentation reseau" a ete
              retiree: rien de tel n'est en place, l'annoncer etait faux. */}
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <Fingerprint className="w-4 h-4 text-red-500 mt-0.5" />
              <div>
                <Label>{t("settingsSecurite.app.mfa")}</Label>
                <p className="text-xs text-muted-foreground">{t("settingsSecurite.app.mfaDesc")}</p>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">{t("settingsSecurite.app.perUser")}</Badge>
          </div>
        </CardContent>
      </Card>

      <AccountSecurityPanel />

      <SecurityMonitorPanel />

      <GuardianWafPanel />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="w-5 h-5" />
            {t("settingsSecurite.app.rolesTitle")}
          </CardTitle>
          <CardDescription>{t("settingsSecurite.app.rolesDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { key: "SuperAdmin", color: "bg-red-100 text-red-700", level: "level4" },
              { key: "Admin", color: "bg-amber-100 text-amber-700", level: "level3" },
              { key: "Agent", color: "bg-blue-100 text-blue-700", level: "level2" },
              { key: "Readonly", color: "bg-gray-100 text-gray-700", level: "level1" },
            ].map((role) => (
              <div key={role.key} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge className={`${role.color} border-0`}>{t(`settingsSecurite.app.role${role.key}`)}</Badge>
                    <span className="text-sm font-medium">{t(`settingsSecurite.app.role${role.key}Title`)}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{t(`settingsSecurite.app.${role.level}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t(`settingsSecurite.app.role${role.key}Desc`)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settingsSecurite.app.rgpdTitle")}</CardTitle>
          <CardDescription>{t("settingsSecurite.app.rgpdDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: "Encryption" },
            { key: "AuditLog" },
            { key: "RightErasure" },
            { key: "Export" },
            { key: "Retention" },
            { key: "Consent" },
          ].map((item, i) => (
            <div key={item.key}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex items-center justify-between">
                <div>
                  <Label>{t(`settingsSecurite.app.rgpd${item.key}`)}</Label>
                  <p className="text-xs text-muted-foreground">{t(`settingsSecurite.app.rgpd${item.key}Desc`)}</p>
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
            {t("settingsSecurite.app.actionsTitle")}
          </CardTitle>
          <CardDescription>{t("settingsSecurite.app.actionsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1" onClick={() => handleSecurityAction(t("settingsSecurite.app.auditFullToast"))}>
              <div className="flex items-center gap-2 text-sm font-medium"><ScanSearch className="w-4 h-4" /> {t("settingsSecurite.app.auditFull")}</div>
              <p className="text-[10px] text-muted-foreground text-left">{t("settingsSecurite.app.auditFullDesc")}</p>
            </Button>
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1" onClick={() => handleSecurityAction(t("settingsSecurite.app.exportAuditToast"))}>
              <div className="flex items-center gap-2 text-sm font-medium"><FileText className="w-4 h-4" /> {t("settingsSecurite.app.exportAudit")}</div>
              <p className="text-[10px] text-muted-foreground text-left">{t("settingsSecurite.app.exportAuditDesc")}</p>
            </Button>
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleSecurityAction(t("settingsSecurite.app.revokeSessionsToast"))}>
              <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400"><ShieldBan className="w-4 h-4" /> {t("settingsSecurite.app.revokeSessions")}</div>
              <p className="text-[10px] text-muted-foreground text-left">{t("settingsSecurite.app.revokeSessionsDesc")}</p>
            </Button>
            <Button variant="outline" className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleSecurityAction(t("settingsSecurite.app.emergencyLockToast"))}>
              <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400"><Lock className="w-4 h-4" /> {t("settingsSecurite.app.emergencyLock")}</div>
              <p className="text-[10px] text-muted-foreground text-left">{t("settingsSecurite.app.emergencyLockDesc")}</p>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
