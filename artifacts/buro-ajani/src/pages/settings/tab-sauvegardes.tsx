import { useState, useEffect, useCallback } from "react";
import {
  Save, Cloud, Server, HardDrive, Shield, Clock,
  RefreshCw, CheckCircle2, XCircle, FolderOpen, Lock,
  Loader2, Download, History, ExternalLink, Eye, RotateCcw,
  Settings, PenTool, Zap, Calendar
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const WORKSPACE_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/workspace";
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

export function TabSauvegardes() {
  const { toast } = useToast();

  const [backups, setBackups] = useState<any[]>([]);
  const [backupStats, setBackupStats] = useState<any>(null);
  const [backupConfigs, setBackupConfigs] = useState<any[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [nextBackupMs, setNextBackupMs] = useState(0);

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
        toast({ title: "Sauvegarde terminee", description: data.message });
        await fetchBackups();
      } else {
        toast({ title: "Erreur", description: "Impossible d'effectuer la sauvegarde.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur de connexion.", variant: "destructive" });
    } finally {
      setBackupRunning(false);
    }
  };

  const fetchDriveBackupStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/status`, { credentials: "include" });
      if (res.ok) setDriveBackupStatus(await res.json());
    } catch {}
  }, []);

  const fetchDriveBackupHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/history`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDriveBackupHistory(data.backups || []);
        setDriveBackupStats(data.stats || null);
      }
    } catch {}
  }, []);

  const fetchDriveFiles = async () => {
    setDriveFilesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/files`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDriveBackupFiles(data.files || []);
      }
    } catch {} finally {
      setDriveFilesLoading(false);
    }
  };

  const handleDriveBackup = async () => {
    setDriveBackupRunning(true);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/run`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Sauvegarde Google Drive reussie", description: `${data.fileName} (${(data.fileSize / 1024).toFixed(1)} Ko) uploade en ${data.duration}ms` });
        fetchDriveBackupHistory();
        fetchDriveBackupStatus();
        fetchDriveFiles();
      } else {
        toast({ title: "Erreur Google Drive", description: data.error || data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur de connexion au service Google Drive.", variant: "destructive" });
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
    } catch {}
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
        toast({ title: "Configuration sauvegardee", description: "Les parametres de sauvegarde Google Drive ont ete mis a jour." });
        setDriveConfig(data.config);
        setDriveConfigEditing(false);
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de sauvegarder la configuration.", variant: "destructive" });
    } finally {
      setDriveConfigSaving(false);
    }
  };

  const fetchDataProtectionStatus = useCallback(async () => {
    setDataProtectionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/data-protection/status`, { credentials: "include" });
      if (res.ok) setDataProtectionStatus(await res.json());
    } catch {} finally {
      setDataProtectionLoading(false);
    }
  }, []);

  const handleVerifyBackup = async (fileId: string) => {
    setVerifyingFileId(fileId);
    setVerifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/verify/${fileId}`, { method: "POST", credentials: "include" });
      const data = await res.json();
      setVerifyResult(data);
      if (data.valid) {
        toast({ title: "Verification reussie", description: `${data.details.tablesCount} tables, ${data.details.totalRecords} enregistrements. Integrite: OK` });
      } else {
        toast({ title: "Verification echouee", description: data.error || "Fichier corrompu.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de verifier le fichier.", variant: "destructive" });
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
      const data = await res.json();
      setRestoreResult(data);
      toast({ title: "Simulation terminee", description: `${data.totalRestored} enregistrements seraient restaures.` });
    } catch {
      toast({ title: "Erreur", description: "Impossible de simuler la restauration.", variant: "destructive" });
    } finally {
      setRestoringFileId(null);
    }
  };

  const handleFullRestore = async (fileId: string) => {
    if (!confirm("ATTENTION: Cette operation va restaurer les donnees depuis la sauvegarde. Les enregistrements existants seront preserves (pas de suppression). Continuer ?")) return;
    setRestoringFileId(fileId);
    try {
      const res = await fetch(`${API_BASE}/google-drive-backup/restore/${fileId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun: false, clearBeforeRestore: false }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Restauration terminee", description: `${data.totalRestored} enregistrements restaures avec succes.` });
        setRestoreResult(data);
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur de restauration.", variant: "destructive" });
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
        toast({ title: "Export termine", description: `Fichier ${fileName} telecharge.` });
      } else {
        toast({ title: "Erreur", description: "Impossible d'exporter.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur d'export.", variant: "destructive" });
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
    const interval = setInterval(fetchBackups, 30000);
    return () => clearInterval(interval);
  }, [fetchBackups, fetchDriveBackupStatus, fetchDriveBackupHistory, fetchDriveConfig, fetchDataProtectionStatus]);

  return (
    <div className="space-y-6">
      {dataProtectionStatus && (
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
                  <CardTitle className="text-lg">Protection des donnees</CardTitle>
                  <CardDescription>Surveillance automatique de la securite et de l'integrite de vos donnees (toutes les 6h).</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={fetchDataProtectionStatus} disabled={dataProtectionLoading} className="h-7 text-xs gap-1">
                  {dataProtectionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Actualiser
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
                    ? "Critique"
                    : dataProtectionStatus.globalHealth.failedBackups24h > 0
                      ? "Attention"
                      : "Protege"}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className="text-xl font-bold text-blue-700">{dataProtectionStatus.globalHealth.totalRecords?.toLocaleString("fr-FR") || 0}</p>
                <p className="text-[10px] text-muted-foreground">Enregistrements proteges</p>
              </div>
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className="text-xl font-bold text-emerald-700">
                  {dataProtectionStatus.globalHealth.lastBackup
                    ? new Date(dataProtectionStatus.globalHealth.lastBackup).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : "Jamais"}
                </p>
                <p className="text-[10px] text-muted-foreground">Derniere sauvegarde</p>
              </div>
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className={`text-xl font-bold ${dataProtectionStatus.globalHealth.backupConfigured ? "text-emerald-700" : "text-red-700"}`}>
                  {dataProtectionStatus.globalHealth.backupConfigured ? "Oui" : "Non"}
                </p>
                <p className="text-[10px] text-muted-foreground">Sauvegarde configuree</p>
              </div>
              <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 text-center border border-border/30">
                <p className={`text-xl font-bold ${dataProtectionStatus.globalHealth.failedBackups24h > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {dataProtectionStatus.globalHealth.failedBackups24h}
                </p>
                <p className="text-[10px] text-muted-foreground">Echecs (24h)</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>
                Derniere verification: {dataProtectionStatus.lastCheck
                  ? new Date(dataProtectionStatus.lastCheck).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : "En attente..."
                }
                {dataProtectionStatus.nextCheck && ` | Prochaine: ${new Date(dataProtectionStatus.nextCheck).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
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
                <CardTitle className="text-lg">Sauvegarde automatique</CardTitle>
                <CardDescription>Toutes les 2 minutes, vos donnees sont sauvegardees et synchronisees de maniere securisee.</CardDescription>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Actif
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{backupStats?.total || 0}</p>
              <p className="text-[10px] text-blue-600">Sauvegardes totales</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">{backupStats?.termine || 0}</p>
              <p className="text-[10px] text-emerald-600">Reussies</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-red-700">{backupStats?.erreur || 0}</p>
              <p className="text-[10px] text-red-600">Erreurs</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-purple-700">{backupStats?.today || 0}</p>
              <p className="text-[10px] text-purple-600">Aujourd'hui</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleManualBackup} disabled={backupRunning} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {backupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {backupRunning ? "Sauvegarde en cours..." : "Sauvegarder maintenant"}
            </Button>
            <Button variant="outline" onClick={fetchBackups} disabled={loadingBackups} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${loadingBackups ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cloud className="w-4 h-4 text-blue-600" />
            Destinations de sauvegarde
          </CardTitle>
          <CardDescription>Vos donnees sont sauvegardees simultanement sur toutes les plateformes connectees.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { platform: "local", name: "Serveur local", icon: Server, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-900/30", path: "/secure/backups/local", desc: "Stockage chiffre AES-256 sur serveur principal" },
              { platform: "google", name: "Google Drive", icon: Cloud, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30", path: "Google Drive > Agent de Bureau > Sauvegardes", desc: "Synchronisation automatique avec Google Workspace" },
              { platform: "microsoft", name: "Microsoft OneDrive", icon: HardDrive, color: "text-[#0078D4]", bg: "bg-blue-50 dark:bg-blue-900/20", path: "OneDrive > Agent de Bureau > Backups", desc: "Sauvegarde vers Microsoft 365 OneDrive" },
              { platform: "apple", name: "iCloud Drive", icon: Cloud, color: "text-gray-700", bg: "bg-gray-100 dark:bg-gray-900/30", path: "iCloud Drive > Agent de Bureau > Sauvegardes", desc: "Synchronisation avec l'ecosysteme Apple" },
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
                      {isEnabled ? "Actif" : "Inactif"}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <FolderOpen className="w-3 h-3" />
                      <span className="truncate">{dest.path}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Lock className="w-3 h-3" />
                      <span>Chiffrement AES-256-GCM</span>
                    </div>
                    {platformStat && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>{platformStat.count} sauvegardes - Derniere: {new Date(platformStat.lastBackup).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
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
                <CardTitle className="text-lg">Sauvegarde Google Drive</CardTitle>
                <CardDescription>Sauvegarde chiffree AES-256-GCM vers Google Drive. Automatique toutes les 6 heures.</CardDescription>
              </div>
            </div>
            <Badge className={driveBackupStatus?.configured
              ? "bg-emerald-100 text-emerald-700 border-0 text-xs gap-1"
              : "bg-gray-100 text-gray-600 border-0 text-xs"
            }>
              {driveBackupStatus?.configured ? (
                <><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Actif</>
              ) : "Non configure"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{driveBackupStats?.total || 0}</p>
              <p className="text-[10px] text-blue-600">Sauvegardes Drive</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-emerald-700">{driveBackupStats?.success || 0}</p>
              <p className="text-[10px] text-emerald-600">Reussies</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-red-700">{driveBackupStats?.errors || 0}</p>
              <p className="text-[10px] text-red-600">Erreurs</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-purple-700">
                {driveBackupStats?.totalSizeBytes ? `${(driveBackupStats.totalSizeBytes / 1024 / 1024).toFixed(1)} Mo` : "0"}
              </p>
              <p className="text-[10px] text-purple-600">Taille totale</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleDriveBackup} disabled={driveBackupRunning} className="gap-2 bg-blue-600 hover:bg-blue-700">
              {driveBackupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
              {driveBackupRunning ? "Upload en cours..." : "Sauvegarder vers Google Drive"}
            </Button>
            <Button variant="outline" onClick={() => { fetchDriveBackupHistory(); fetchDriveBackupStatus(); }} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Actualiser
            </Button>
            <Button variant="outline" onClick={fetchDriveFiles} disabled={driveFilesLoading} className="gap-2">
              {driveFilesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
              Voir les fichiers Drive
            </Button>
          </div>

          {driveBackupStatus?.lastSuccessfulBackup && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-emerald-700">Derniere sauvegarde reussie</p>
                  <p className="text-[10px] text-emerald-600">
                    {new Date(driveBackupStatus.lastSuccessfulBackup.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" | "}
                    {((driveBackupStatus.lastSuccessfulBackup.sizeBytes || 0) / 1024).toFixed(1)} Ko
                    {" | "}
                    Chiffrement AES-256-GCM
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
                <p className="text-sm font-semibold">Configuration</p>
              </div>
              {!driveConfigEditing ? (
                <Button variant="outline" size="sm" onClick={() => setDriveConfigEditing(true)} className="gap-1.5 h-7 text-xs">
                  <PenTool className="w-3 h-3" /> Modifier
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setDriveConfigEditing(false); if (driveConfig) setDriveConfigForm({ enabled: driveConfig.enabled, intervalMinutes: driveConfig.intervalMinutes, retentionDays: driveConfig.retentionDays, encryptionEnabled: driveConfig.encryptionEnabled }); }} className="h-7 text-xs">
                    Annuler
                  </Button>
                  <Button size="sm" onClick={saveDriveConfig} disabled={driveConfigSaving} className="gap-1.5 h-7 text-xs bg-blue-600 hover:bg-blue-700">
                    {driveConfigSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Enregistrer
                  </Button>
                </div>
              )}
            </div>

            {driveConfigEditing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium">Sauvegarde automatique</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.enabled} onChange={e => setDriveConfigForm(f => ({ ...f, enabled: e.target.value }))}>
                    <option value="true">Activee</option>
                    <option value="false">Desactivee</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">Frequence (minutes)</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.intervalMinutes} onChange={e => setDriveConfigForm(f => ({ ...f, intervalMinutes: Number(e.target.value) }))}>
                    <option value={60}>Toutes les heures (60 min)</option>
                    <option value={120}>Toutes les 2 heures</option>
                    <option value={180}>Toutes les 3 heures</option>
                    <option value={360}>Toutes les 6 heures</option>
                    <option value={720}>Toutes les 12 heures</option>
                    <option value={1440}>Une fois par jour</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">Retention (jours)</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.retentionDays} onChange={e => setDriveConfigForm(f => ({ ...f, retentionDays: Number(e.target.value) }))}>
                    <option value={7}>7 jours</option>
                    <option value={14}>14 jours</option>
                    <option value={30}>30 jours</option>
                    <option value={60}>60 jours</option>
                    <option value={90}>90 jours</option>
                    <option value={180}>180 jours</option>
                    <option value={365}>365 jours (1 an)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">Chiffrement</label>
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={driveConfigForm.encryptionEnabled} onChange={e => setDriveConfigForm(f => ({ ...f, encryptionEnabled: e.target.value }))}>
                    <option value="true">AES-256-GCM (recommande)</option>
                    <option value="false">Desactive</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3 h-3 text-blue-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">Statut</p>
                  </div>
                  <p className="text-xs font-medium">{driveConfig?.enabled === "true" ? "Active" : "Desactive"}</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-emerald-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">Frequence</p>
                  </div>
                  <p className="text-xs font-medium">
                    {driveConfig?.intervalMinutes ? (driveConfig.intervalMinutes >= 60 ? `${driveConfig.intervalMinutes / 60}h` : `${driveConfig.intervalMinutes} min`) : "6h"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Calendar className="w-3 h-3 text-amber-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">Retention</p>
                  </div>
                  <p className="text-xs font-medium">{driveConfig?.retentionDays || 90} jours</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Lock className="w-3 h-3 text-purple-600" />
                    <p className="text-[10px] font-semibold text-muted-foreground">Chiffrement</p>
                  </div>
                  <p className="text-xs font-medium">{driveConfig?.encryptionEnabled === "true" ? "AES-256-GCM" : "Desactive"}</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportLocal} disabled={exportingLocal} className="gap-1.5 h-7 text-xs">
              {exportingLocal ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Export JSON local
            </Button>
          </div>

          {driveBackupFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
                Fichiers sur Google Drive ({driveBackupFiles.length})
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
                        Verifier
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1" disabled={restoringFileId === file.id} onClick={() => handleDryRunRestore(file.id)}>
                        {restoringFileId === file.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                        Simuler
                      </Button>
                      <Button size="sm" variant="default" className="h-6 text-[10px] px-2 gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={restoringFileId === file.id} onClick={() => handleFullRestore(file.id)}>
                        <RotateCcw className="w-3 h-3" />
                        Restaurer
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {verifyResult && verifyResult.valid && verifyResult.details && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 space-y-2">
                  <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Verification reussie
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded"><span className="text-muted-foreground">Tables:</span><span className="font-semibold ml-1">{verifyResult.details.tablesCount}</span></div>
                    <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded"><span className="text-muted-foreground">Enregistrements:</span><span className="font-semibold ml-1">{verifyResult.details.totalRecords}</span></div>
                    <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded"><span className="text-muted-foreground">Chiffrement:</span><span className="font-semibold ml-1">{verifyResult.details.encryption}</span></div>
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
                    {restoreResult.dryRun ? "Simulation de restauration" : "Restauration terminee"} — {restoreResult.totalRestored} enregistrements
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
                Historique Drive ({driveBackupHistory.length})
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
                          <p className="text-xs font-medium">{summary?.fileName || "Sauvegarde Drive"}</p>
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
