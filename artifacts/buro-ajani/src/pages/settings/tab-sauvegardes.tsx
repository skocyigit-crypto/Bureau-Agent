import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
Calendar,
CheckCircle2,
Clock,
Cloud,
Download,
ExternalLink,Eye,
FolderOpen,
HardDrive,
History,
Loader2,
Lock,
PenTool,
RefreshCw,
RotateCcw,
Save,
Server,
Settings,
Shield,
XCircle,
Zap
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const WORKSPACE_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/workspace";
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

export function TabSauvegardes() {
  const { toast } = useToast();
  const { t } = useTranslation();

  const [, setBackups] = useState<any[]>([]);
  const [backupStats, setBackupStats] = useState<any>(null);
  const [backupConfigs, setBackupConfigs] = useState<any[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [, setNextBackupMs] = useState(0);

  const [driveBackupRunning, setDriveBackupRunning] = useState(false);
  const [driveBackupStatus, setDriveBackupStatus] = useState<any>(null);
  const [driveBackupHistory, setDriveBackupHistory] = useState<any[]>([]);
  const [driveBackupStats, setDriveBackupStats] = useState<any>(null);
  const [driveBackupFiles, setDriveBackupFiles] = useState<any[]>([]);
  const [driveFilesLoading, setDriveFilesLoading] = useState(false);
  const [driveConfig, setDriveConfig] = useState<any>(null);
  const [driveConfigSaving, setDriveConfigSaving] = useState(false);
  const [driveConfigEditing, setDriveConfigEditing] = useState(false);
  const [driveConfigForm, setDriveConfigForm] = useState({ enabled: "true", intervalMinutes: 360, retentionDays: 90, encryptionEnabled: "true" });
  const [verifyingFileId, setVerifyingFileId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [restoringFileId, setRestoringFileId] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [exportingLocal, setExportingLocal] = useState(false);
  const [dataProtectionStatus, setDataProtectionStatus] = useState<any>(null);
  const [dataProtectionLoading, setDataProtectionLoading] = useState(false);

  const fetchBackups = useCallback(async () => {
    setLoadingBackups(true);
    try {
      const [backupsRes, configRes, latestRes] = await Promise.all([
        fetch(`${WORKSPACE_API}/backups?limit=30`),
        fetch(`${WORKSPACE_API}/backups/config`),
        fetch(`${WORKSPACE_API}/backups/latest`),
      ]);
      if (backupsRes.ok) {
        const data = await backupsRes.json();
        setBackups(data.backups || []);
        setBackupStats(data.stats || null);
      }
      if (configRes.ok) {
        const data = await configRes.json();
        setBackupConfigs(data.configs || []);
      }
      if (latestRes.ok) {
        const data = await latestRes.json();
        setNextBackupMs(data.nextBackupMs || 0);
      }
    } catch (err) {
      console.error("Fetch backups error:", err);
    } finally {
      setLoadingBackups(false);
    }
  }, []);

  const handleManualBackup = async () => {
    setBackupRunning(true);
    try {
      const res = await fetch(`${WORKSPACE_API}/backups/manual`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        toast({ title: t("settingsSauvegardes.toasts.backupDone"), description: data.message });
        await fetchBackups();
      } else {
        toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.backupFailed"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.connectionError"), variant: "destructive" });
    } finally {
      setBackupRunning(false);
    }
  };

  const fetchDriveBackupStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/status`, { credentials: "include" });
      if (res.ok) setDriveBackupStatus(await res.json());
    } catch (err) { console.error("[Sauvegardes] fetchDriveBackupStatus failed:", err); }
  }, []);

  const fetchDriveBackupHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/history`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDriveBackupHistory(data.backups || []);
        setDriveBackupStats(data.stats || null);
      }
    } catch (err) { console.error("[Sauvegardes] fetchDriveBackupHistory failed:", err); }
  }, []);

  const fetchDriveFiles = async () => {
    setDriveFilesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/files`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDriveBackupFiles(data.files || []);
      }
    } catch (err) { console.error("[Sauvegardes] fetchDriveFiles failed:", err); } finally {
      setDriveFilesLoading(false);
    }
  };

  const handleDriveBackup = async () => {
    setDriveBackupRunning(true);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/run`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("settingsSauvegardes.toasts.driveSuccess"), description: t("settingsSauvegardes.toasts.driveSuccessDesc", { fileName: data.fileName, size: (data.fileSize / 1024).toFixed(1), duration: data.duration }) });
        fetchDriveBackupHistory();
        fetchDriveBackupStatus();
        fetchDriveFiles();
      } else {
        toast({ title: t("settingsSauvegardes.toasts.driveError"), description: data.error || data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.driveConnectionError"), variant: "destructive" });
    } finally {
      setDriveBackupRunning(false);
    }
  };

  const fetchDriveConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/config`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDriveConfig(data);
        setDriveConfigForm({
          enabled: data.enabled || "true",
          intervalMinutes: data.intervalMinutes || 360,
          retentionDays: data.retentionDays || 90,
          encryptionEnabled: data.encryptionEnabled || "true",
        });
      }
    } catch (err) { console.error("[Sauvegardes] fetchDriveConfig failed:", err); }
  }, []);

  const saveDriveConfig = async () => {
    setDriveConfigSaving(true);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(driveConfigForm),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("settingsSauvegardes.toasts.configSaved"), description: t("settingsSauvegardes.toasts.configSavedDesc") });
        setDriveConfig(data.config);
        setDriveConfigEditing(false);
      } else {
        toast({ title: t("settingsSauvegardes.common.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.configSaveFailed"), variant: "destructive" });
    } finally {
      setDriveConfigSaving(false);
    }
  };

  const fetchDataProtectionStatus = useCallback(async () => {
    setDataProtectionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/data-protection/status`, { credentials: "include" });
      if (res.ok) setDataProtectionStatus(await res.json());
    } catch (err) { console.error("[Sauvegardes] fetchDataProtection failed:", err); } finally {
      setDataProtectionLoading(false);
    }
  }, []);

  const handleVerifyBackup = async (fileId: string) => {
    setVerifyingFileId(fileId);
    setVerifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/verify/${fileId}`, { method: "POST", credentials: "include" });
      if (!res.ok) { toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.verifyFailed"), variant: "destructive" }); return; }
      const data = await res.json();
      setVerifyResult(data);
      if (data.valid) {
        toast({ title: t("settingsSauvegardes.driveBackup.verify.success"), description: t("settingsSauvegardes.toasts.verifySuccessDesc", { tables: data.details.tablesCount, records: data.details.totalRecords }) });
      } else {
        toast({ title: t("settingsSauvegardes.toasts.verifyKo"), description: data.error || t("settingsSauvegardes.toasts.fileCorrupted"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.verifyFileFailed"), variant: "destructive" });
    } finally {
      setVerifyingFileId(null);
    }
  };

  const handleDryRunRestore = async (fileId: string) => {
    setRestoringFileId(fileId);
    setRestoreResult(null);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/restore/${fileId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun: true }),
      });
      if (!res.ok) { toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.simulationFailed"), variant: "destructive" }); return; }
      const data = await res.json();
      setRestoreResult(data);
      toast({ title: t("settingsSauvegardes.toasts.simulationDone"), description: t("settingsSauvegardes.toasts.simulationDoneDesc", { count: data.totalRestored }) });
    } catch {
      toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.simulationFailedDesc"), variant: "destructive" });
    } finally {
      setRestoringFileId(null);
    }
  };

  const handleFullRestore = async (fileId: string) => {
    if (!(await confirmAction({ title: t("settingsSauvegardes.confirm.title"), description: t("settingsSauvegardes.confirm.description"), confirmLabel: t("settingsSauvegardes.common.restore"), destructive: true }))) return;
    setRestoringFileId(fileId);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/restore/${fileId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun: false, clearBeforeRestore: false }),
      });
      if (!res.ok) { toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.restoreFailed"), variant: "destructive" }); return; }
      const data = await res.json();
      if (data.success) {
        toast({ title: t("settingsSauvegardes.driveBackup.restore.done"), description: t("settingsSauvegardes.toasts.restoreDoneDesc", { count: data.totalRestored }) });
        setRestoreResult(data);
      } else {
        toast({ title: t("settingsSauvegardes.common.error"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.restoreError"), variant: "destructive" });
    } finally {
      setRestoringFileId(null);
    }
  };

  const handleExportLocal = async () => {
    setExportingLocal(true);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/export-local`, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition");
        const match = disposition?.match(/filename="(.+)"/);
        const fileName = match?.[1] || `backup_local_${new Date().toISOString().slice(0,10)}.json`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast({ title: t("settingsSauvegardes.toasts.exportDone"), description: t("settingsSauvegardes.toasts.exportDoneDesc", { fileName }) });
      } else {
        toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.exportFailed"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSauvegardes.common.error"), description: t("settingsSauvegardes.toasts.exportError"), variant: "destructive" });
    } finally {
      setExportingLocal(false);
    }
  };

  useEffect(() => {
    fetchBackups();
    fetchDriveBackupStatus();
    fetchDriveBackupHistory();
    fetchDriveConfig();
    fetchDataProtectionStatus();
    const interval = setInterval(fetchBackups, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchBackups, fetchDriveBackupStatus, fetchDriveBackupHistory, fetchDriveConfig, fetchDataProtectionStatus]);

  return (
    <div className="space-y-6">
      {dataProtectionStatus?.globalHealth && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${
                  !dataProtectionStatus.globalHealth.backupConfigured || !dataProtectionStatus.globalHealth.lastBackup
                    ? "bg-red-100 dark:bg-red-900/30"
                    : dataProtectionStatus.globalHealth.failedBackups24h > 0
                      ? "bg-amber-100 dark:bg-amber-900/30"
                      : "bg-emerald-100 dark:bg-emerald-900/30"
                }`}>
                  <Shield className={`w-5 h-5 ${
                    !dataProtectionStatus.globalHealth.backupConfigured || !dataProtectionStatus.globalHealth.lastBackup
                      ? "text-red-600"
                      : dataProtectionStatus.globalHealth.failedBackups24h > 0
                        ? "text-amber-600"
                        : "text-emerald-600"
                  }`} />
                </div>
                <div>
                  <CardTitle className="text-lg">{t("settingsSauvegardes.dataProtection.title")}</CardTitle>
                  <CardDescription>{t("settingsSauvegardes.dataProtection.description")}</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={fetchDataProtectionStatus} disabled={dataProtectionLoading} className="h-7 text-xs gap-1">
                  {dataProtectionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {t("settingsSauvegardes.common.refresh")}
                </Button>
                <Badge className={`text-xs gap-1 border-0 ${
                  !dataProtectionStatus.globalHealth.backupConfigured || !dataProtectionStatus.globalHealth.lastBackup
                    ? "bg-red-100 text-red-700"
                    : dataProtectionStatus.globalHealth.failedBackups24h > 0
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                }`}>
                  <div className={`w-2 h-2 rounded-full animate-pulse ${
                    !dataProtectionStatus.globalHealth.backupConfigured || !dataProtectionStatus.globalHealth.lastBackup
                      ? "bg-red-500"
                      : dataProtectionStatus.globalHealth.failedBackups24h > 0
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`} />
                  {!dataProtectionStatus.globalHealth.backupConfigured || !dataProtectionStatus.globalHealth.lastBackup
                    ? t("settingsSauvegardes.dataProtection.statusCritical")
                    : dataProtectionStatus.globalHealth.failedBackups24h > 0
                      ? t("settingsSauvegardes.dataProtection.statusWarning")
                      : t("settingsSauvegardes.dataProtection.statusProtected")}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className="text-xl font-bold text-blue-700">{dataProtectionStatus.globalHealth.totalRecords?.toLocaleString("fr-FR") || 0}</p>
                <p className="text-[10px] text-muted-foreground">{t("settingsSauvegardes.dataProtection.protectedRecords")}</p>
              </div>
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className="text-xl font-bold text-emerald-700">
                  {dataProtectionStatus.globalHealth.lastBackup
                    ? new Date(dataProtectionStatus.globalHealth.lastBackup).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : t("settingsSauvegardes.common.never")}
                </p>
                <p className="text-[10px] text-muted-foreground">{t("settingsSauvegardes.dataProtection.lastBackup")}</p>
              </div>
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className={`text-xl font-bold ${dataProtectionStatus.globalHealth.backupConfigured ? "text-emerald-700" : "text-red-700"}`}>
                  {dataProtectionStatus.globalHealth.backupConfigured ? t("settingsSauvegardes.common.yes") : t("settingsSauvegardes.common.no")}
                </p>
                <p className="text-[10px] text-muted-foreground">{t("settingsSauvegardes.dataProtection.backupConfigured")}</p>
              </div>
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className={`text-xl font-bold ${dataProtectionStatus.globalHealth.failedBackups24h > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {dataProtectionStatus.globalHealth.failedBackups24h}
                </p>
                <p className="text-[10px] text-muted-foreground">{t("settingsSauvegardes.dataProtection.failures24h")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>
                {t("settingsSauvegardes.dataProtection.lastCheckLabel")}: {dataProtectionStatus.lastCheck
                  ? new Date(dataProtectionStatus.lastCheck).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : t("settingsSauvegardes.common.pending")
                }
                {dataProtectionStatus.nextCheck && ` | ${t("settingsSauvegardes.dataProtection.next")}: ${new Date(dataProtectionStatus.nextCheck).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-emerald-200 dark:border-emerald-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                <Save className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-lg">{t("settingsSauvegardes.autoBackup.title")}</CardTitle>
                <CardDescription>{t("settingsSauvegardes.autoBackup.description")}</CardDescription>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {t("settingsSauvegardes.common.active")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{backupStats?.total || 0}</p>
              <p className="text-[10px] text-blue-600">{t("settingsSauvegardes.autoBackup.totalBackups")}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">{backupStats?.termine || 0}</p>
              <p className="text-[10px] text-emerald-600">{t("settingsSauvegardes.common.successful")}</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-red-700">{backupStats?.erreur || 0}</p>
              <p className="text-[10px] text-red-600">{t("settingsSauvegardes.common.errors")}</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-purple-700">{backupStats?.today || 0}</p>
              <p className="text-[10px] text-purple-600">{t("settingsSauvegardes.common.today")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleManualBackup} disabled={backupRunning} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {backupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {backupRunning ? t("settingsSauvegardes.autoBackup.running") : t("settingsSauvegardes.autoBackup.backupNow")}
            </Button>
            <Button variant="outline" onClick={fetchBackups} disabled={loadingBackups} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${loadingBackups ? "animate-spin" : ""}`} />
              {t("settingsSauvegardes.common.refresh")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cloud className="w-4 h-4 text-blue-600" />
            {t("settingsSauvegardes.destinations.title")}
          </CardTitle>
          <CardDescription>{t("settingsSauvegardes.destinations.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { platform: "local", name: t("settingsSauvegardes.destinations.serverLocal"), icon: Server, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-900/30", path: "/secure/backups/local", desc: t("settingsSauvegardes.destinations.serverLocalDesc") },
              { platform: "google", name: "Google Drive", icon: Cloud, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30", path: "Google Drive > Ajant Bureau > Sauvegardes", desc: t("settingsSauvegardes.destinations.driveDesc") },
              { platform: "microsoft", name: "Microsoft OneDrive", icon: HardDrive, color: "text-[#0078D4]", bg: "bg-blue-50 dark:bg-blue-900/20", path: "OneDrive > Ajant Bureau > Backups", desc: t("settingsSauvegardes.destinations.oneDriveDesc") },
              { platform: "apple", name: "iCloud Drive", icon: Cloud, color: "text-gray-700", bg: "bg-gray-100 dark:bg-gray-900/30", path: "iCloud Drive > Ajant Bureau > Sauvegardes", desc: t("settingsSauvegardes.destinations.icloudDesc") },
            ].map((dest) => {
              const config = backupConfigs.find((c: any) => c.platform === dest.platform);
              const platformStat = backupStats?.platforms?.find((p: any) => p.platform === dest.platform);
              const isEnabled = config?.enabled === "true" || !config;
              return (
                <div key={dest.platform} className={`rounded-lg border p-4 ${isEnabled ? "border-emerald-200 dark:border-emerald-800" : "border-border opacity-60"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${dest.bg}`}>
                        <dest.icon className={`w-4 h-4 ${dest.color}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{dest.name}</p>
                        <p className="text-[10px] text-muted-foreground">{dest.desc}</p>
                      </div>
                    </div>
                    <Badge variant={isEnabled ? "default" : "secondary"} className={isEnabled ? "bg-emerald-100 text-emerald-700 border-0 text-[10px]" : "text-[10px]"}>
                      {isEnabled ? t("settingsSauvegardes.common.active") : t("settingsSauvegardes.common.inactive")}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <FolderOpen className="w-3 h-3" />
                      <span className="truncate">{dest.path}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Lock className="w-3 h-3" />
                      <span>{t("settingsSauvegardes.destinations.encryptionAes")}</span>
                    </div>
                    {platformStat && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>{t("settingsSauvegardes.destinations.backups", { count: platformStat.count })} - {t("settingsSauvegardes.common.last")}: {new Date(platformStat.lastBackup).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-900/30">
                <Cloud className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-lg">{t("settingsSauvegardes.driveBackup.title")}</CardTitle>
                <CardDescription>{t("settingsSauvegardes.driveBackup.description")}</CardDescription>
              </div>
            </div>
            <Badge className={driveBackupStatus?.configured
              ? "bg-emerald-100 text-emerald-700 border-0 text-xs gap-1"
              : "bg-gray-100 text-gray-600 border-0 text-xs"
            }>
              {driveBackupStatus?.configured ? (
                <><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> {t("settingsSauvegardes.common.active")}</>
              ) : t("settingsSauvegardes.driveBackup.notConfigured")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{driveBackupStats?.total || 0}</p>
              <p className="text-[10px] text-blue-600">{t("settingsSauvegardes.driveBackup.driveBackups")}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">{driveBackupStats?.success || 0}</p>
              <p className="text-[10px] text-emerald-600">{t("settingsSauvegardes.common.successful")}</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-red-700">{driveBackupStats?.errors || 0}</p>
              <p className="text-[10px] text-red-600">{t("settingsSauvegardes.common.errors")}</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-purple-700">
                {driveBackupStats?.totalSizeBytes ? `${(driveBackupStats.totalSizeBytes / 1024 / 1024).toFixed(1)} Mo` : "0"}
              </p>
              <p className="text-[10px] text-purple-600">{t("settingsSauvegardes.driveBackup.totalSize")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleDriveBackup} disabled={driveBackupRunning} className="gap-2 bg-blue-600 hover:bg-blue-700">
              {driveBackupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
              {driveBackupRunning ? t("settingsSauvegardes.driveBackup.uploading") : t("settingsSauvegardes.driveBackup.backupToDrive")}
            </Button>
            <Button variant="outline" onClick={() => { fetchDriveBackupHistory(); fetchDriveBackupStatus(); }} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              {t("settingsSauvegardes.common.refresh")}
            </Button>
            <Button variant="outline" onClick={fetchDriveFiles} disabled={driveFilesLoading} className="gap-2">
              {driveFilesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
              {t("settingsSauvegardes.driveBackup.viewFiles")}
            </Button>
          </div>

          {driveBackupStatus?.lastSuccessfulBackup && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-emerald-700">{t("settingsSauvegardes.driveBackup.lastSuccessful")}</p>
                  <p className="text-[10px] text-emerald-600">
                    {new Date(driveBackupStatus.lastSuccessfulBackup.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" | "}
                    {((driveBackupStatus.lastSuccessfulBackup.sizeBytes || 0) / 1024).toFixed(1)} Ko
                    {" | "}
                    {t("settingsSauvegardes.destinations.encryptionAes")}
                    {" | "}
                    SHA-256: {driveBackupStatus.lastSuccessfulBackup.encryptionHash?.substring(0, 12)}...
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="p-4 rounded-xl bg-muted/20 border space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-600" />
                <p className="text-sm font-semibold">{t("settingsSauvegardes.driveBackup.config.title")}</p>
              </div>
              {!driveConfigEditing ? (
                <Button variant="outline" size="sm" onClick={() => setDriveConfigEditing(true)} className="gap-1.5 h-7 text-xs">
                  <PenTool className="w-3 h-3" /> {t("settingsSauvegardes.common.edit")}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setDriveConfigEditing(false); if (driveConfig) setDriveConfigForm({ enabled: driveConfig.enabled, intervalMinutes: driveConfig.intervalMinutes, retentionDays: driveConfig.retentionDays, encryptionEnabled: driveConfig.encryptionEnabled }); }} className="h-7 text-xs">
                    {t("settingsSauvegardes.common.cancel")}
                  </Button>
                  <Button size="sm" onClick={saveDriveConfig} disabled={driveConfigSaving} className="gap-1.5 h-7 text-xs bg-blue-600 hover:bg-blue-700">
                    {driveConfigSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {t("settingsSauvegardes.common.save")}
                  </Button>
                </div>
              )}
            </div>

            {driveConfigEditing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium">{t("settingsSauvegardes.autoBackup.title")}</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.enabled} onChange={e => setDriveConfigForm(f => ({ ...f, enabled: e.target.value }))}>
                    <option value="true">{t("settingsSauvegardes.driveBackup.config.enabledOption")}</option>
                    <option value="false">{t("settingsSauvegardes.driveBackup.config.disabledOption")}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">{t("settingsSauvegardes.driveBackup.config.frequencyMinutes")}</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.intervalMinutes} onChange={e => setDriveConfigForm(f => ({ ...f, intervalMinutes: Number(e.target.value) }))}>
                    <option value={60}>{t("settingsSauvegardes.driveBackup.config.freqHourly")}</option>
                    <option value={120}>{t("settingsSauvegardes.driveBackup.config.freq2h")}</option>
                    <option value={180}>{t("settingsSauvegardes.driveBackup.config.freq3h")}</option>
                    <option value={360}>{t("settingsSauvegardes.driveBackup.config.freq6h")}</option>
                    <option value={720}>{t("settingsSauvegardes.driveBackup.config.freq12h")}</option>
                    <option value={1440}>{t("settingsSauvegardes.driveBackup.config.freqDaily")}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">{t("settingsSauvegardes.driveBackup.config.retentionDaysLabel")}</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.retentionDays} onChange={e => setDriveConfigForm(f => ({ ...f, retentionDays: Number(e.target.value) }))}>
                    <option value={7}>{t("settingsSauvegardes.common.daysCount", { count: 7 })}</option>
                    <option value={14}>{t("settingsSauvegardes.common.daysCount", { count: 14 })}</option>
                    <option value={30}>{t("settingsSauvegardes.common.daysCount", { count: 30 })}</option>
                    <option value={60}>{t("settingsSauvegardes.common.daysCount", { count: 60 })}</option>
                    <option value={90}>{t("settingsSauvegardes.common.daysCount", { count: 90 })}</option>
                    <option value={180}>{t("settingsSauvegardes.common.daysCount", { count: 180 })}</option>
                    <option value={365}>{t("settingsSauvegardes.driveBackup.config.retention365")}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">{t("settingsSauvegardes.common.encryption")}</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.encryptionEnabled} onChange={e => setDriveConfigForm(f => ({ ...f, encryptionEnabled: e.target.value }))}>
                    <option value="true">{t("settingsSauvegardes.driveBackup.config.aesRecommended")}</option>
                    <option value="false">{t("settingsSauvegardes.common.disabled")}</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3 h-3 text-blue-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">{t("settingsSauvegardes.common.status")}</p>
                  </div>
                  <p className="text-xs font-medium">{driveConfig?.enabled === "true" ? t("settingsSauvegardes.common.enabledShort") : t("settingsSauvegardes.common.disabled")}</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-emerald-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">{t("settingsSauvegardes.common.frequency")}</p>
                  </div>
                  <p className="text-xs font-medium">
                    {driveConfig?.intervalMinutes ? (driveConfig.intervalMinutes >= 60 ? `${driveConfig.intervalMinutes / 60}h` : `${driveConfig.intervalMinutes} min`) : "6h"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Calendar className="w-3 h-3 text-amber-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">{t("settingsSauvegardes.common.retention")}</p>
                  </div>
                  <p className="text-xs font-medium">{t("settingsSauvegardes.common.daysCount", { count: driveConfig?.retentionDays || 90 })}</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Lock className="w-3 h-3 text-purple-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">{t("settingsSauvegardes.common.encryption")}</p>
                  </div>
                  <p className="text-xs font-medium">{driveConfig?.encryptionEnabled === "true" ? "AES-256-GCM" : t("settingsSauvegardes.common.disabled")}</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportLocal} disabled={exportingLocal} className="gap-1.5 h-7 text-xs">
              {exportingLocal ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {t("settingsSauvegardes.driveBackup.exportLocal")}
            </Button>
          </div>

          {driveBackupFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                {t("settingsSauvegardes.driveBackup.filesTitle", { count: driveBackupFiles.length })}
              </p>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {driveBackupFiles.map((file: any) => (
                  <div key={file.id} className="p-3 rounded-lg bg-muted/20 border border-border/30 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-100 shrink-0">
                        <Cloud className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{file.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(file.createdTime).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {file.size && ` | ${(Number(file.size) / 1024).toFixed(1)} Ko`}
                        </p>
                      </div>
                      {file.webViewLink && (
                        <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 ml-11">
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1" disabled={verifyingFileId === file.id} onClick={() => handleVerifyBackup(file.id)}>
                        {verifyingFileId === file.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                        {t("settingsSauvegardes.common.verify")}
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1" disabled={restoringFileId === file.id} onClick={() => handleDryRunRestore(file.id)}>
                        {restoringFileId === file.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                        {t("settingsSauvegardes.common.simulate")}
                      </Button>
                      <Button size="sm" variant="default" className="h-6 text-[10px] px-2 gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={restoringFileId === file.id} onClick={() => handleFullRestore(file.id)}>
                        <RotateCcw className="w-3 h-3" />
                        {t("settingsSauvegardes.common.restore")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {verifyResult && verifyResult.valid && verifyResult.details && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 space-y-2">
                  <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t("settingsSauvegardes.driveBackup.verify.success")}
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded"><span className="text-muted-foreground">{t("settingsSauvegardes.driveBackup.verify.tables")}:</span><span className="font-semibold ml-1">{verifyResult.details.tablesCount}</span></div>
                    <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded"><span className="text-muted-foreground">{t("settingsSauvegardes.driveBackup.verify.records")}:</span><span className="font-semibold ml-1">{verifyResult.details.totalRecords}</span></div>
                    <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded"><span className="text-muted-foreground">{t("settingsSauvegardes.common.encryption")}:</span><span className="font-semibold ml-1">{verifyResult.details.encryption}</span></div>
                  </div>
                  <div className="space-y-0.5 max-h-[150px] overflow-y-auto">
                    {verifyResult.details.tableDetails?.map((t: any) => (
                      <div key={t.name} className="flex justify-between text-[10px] px-1">
                        <span className="text-muted-foreground">{t.name}</span>
                        <span className="font-mono">{t.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {restoreResult && restoreResult.restoredTables && (
                <div className={`p-3 rounded-lg border space-y-2 ${restoreResult.dryRun ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200/50" : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50"}`}>
                  <p className={`text-xs font-semibold flex items-center gap-1.5 ${restoreResult.dryRun ? "text-amber-700" : "text-emerald-700"}`}>
                    {restoreResult.dryRun ? <Eye className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {restoreResult.dryRun ? t("settingsSauvegardes.driveBackup.restore.simulation") : t("settingsSauvegardes.driveBackup.restore.done")} — {t("settingsSauvegardes.driveBackup.restore.recordsCount", { count: restoreResult.totalRestored })}
                  </p>
                  <div className="space-y-0.5 max-h-[150px] overflow-y-auto">
                    {restoreResult.restoredTables.filter((t: any) => t.inserted > 0 || t.errors > 0).map((t: any) => (
                      <div key={t.name} className="flex items-center justify-between text-[10px] px-1">
                        <span className="text-muted-foreground">{t.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-mono">+{t.inserted}</span>
                          {t.errors > 0 && <span className="text-red-600 font-mono">!{t.errors}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {restoreResult.warnings?.length > 0 && (
                    <div className="text-[10px] text-amber-700 space-y-0.5">
                      {restoreResult.warnings.map((w: string, i: number) => (
                        <p key={i}>{w}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {driveBackupHistory.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-blue-600" />
                {t("settingsSauvegardes.driveBackup.history.title", { count: driveBackupHistory.length })}
              </p>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {driveBackupHistory.slice(0, 10).map((b: any) => {
                  const summary = b.dataSummary as any;
                  return (
                    <div key={b.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 border border-border/30">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${b.status === "termine" ? "bg-emerald-100" : "bg-red-100"}`}>
                        {b.status === "termine" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium">{summary?.fileName || t("settingsSauvegardes.driveBackup.history.defaultName")}</p>
                          <Badge className="text-[8px] h-4 px-1.5 border-0 bg-blue-100 text-blue-700">Google Drive</Badge>
                          {b.duration && <span className="text-[9px] text-muted-foreground">{b.duration}ms</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(b.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {b.sizeBytes && <span className="text-[9px] text-muted-foreground">{(b.sizeBytes / 1024).toFixed(1)} Ko</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
