/**
 * Sauvegardes du client, pilotees par le client.
 *
 * L'onglet « Sauvegardes » appelait jusqu'ici `/api/workspace/backups*`, des
 * routes qui n'existaient pas: l'ecran etait une facade. Cette carte parle aux
 * vraies routes `/api/my-backups`, bornees a l'organisation connectee.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Database, Download, History, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface Backup {
  id: number;
  origin: "auto" | "manual";
  rowCount: number;
  sizeBytes: number;
  tableCounts: Record<string, number>;
  checksum: string;
  createdAt: string;
}

interface Coverage {
  tables: number;
  redactedColumns: string[];
  excludedTables: Record<string, string>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export function MyBackupsCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [retention, setRetention] = useState(14);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/my-backups`, { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setBackups(d.backups || []);
        setCoverage(d.coverage || null);
        setRetention(d.retention ?? 14);
      }
    } catch {
      toast({ title: t("myBackups.toast.loadFailed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => { load(); }, [load]);

  const createNow = async () => {
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/api/my-backups`, { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: t("myBackups.toast.created"), description: t("myBackups.toast.createdDesc", { rows: d.backup?.rowCount ?? 0 }) });
        await load();
      } else {
        toast({ title: t("myBackups.toast.createFailed"), description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("myBackups.toast.createFailed"), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const download = async (backup: Backup) => {
    setDownloadingId(backup.id);
    try {
      // On passe par fetch + blob plutot qu'un lien direct: la route exige la
      // session et renvoie du JSON en cas d'erreur, qu'il faut pouvoir afficher.
      const res = await fetch(`${BASE}/api/my-backups/${backup.id}/download`, { credentials: "include" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: t("myBackups.toast.downloadFailed"), description: d.error, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1]
        ?? `sauvegarde-${backup.id}.json.gz`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: t("myBackups.toast.downloadFailed"), variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  /**
   * Restauration en deux temps: on montre d'abord ce qui manque, et on ne
   * demande confirmation qu'ensuite. Personne ne doit lancer une restauration
   * sans savoir ce qu'elle va rendre.
   */
  const restore = async (backup: Backup) => {
    setRestoringId(backup.id);
    try {
      const previewRes = await fetch(`${BASE}/api/my-backups/${backup.id}/restore-preview`, { credentials: "include" });
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        toast({ title: t("myBackups.toast.restoreFailed"), description: preview.error, variant: "destructive" });
        return;
      }

      const total: number = preview.totalMissing ?? 0;
      if (total === 0) {
        toast({ title: t("myBackups.toast.nothingToRestore"), description: t("myBackups.toast.nothingToRestoreDesc") });
        return;
      }

      const detail = (preview.plan as Array<{ table: string; missing: number }>)
        .map((p) => `${p.table}: ${p.missing}`).join(", ");
      if (!(await confirmAction({
        title: t("myBackups.confirmRestore.title", { count: total }),
        description: `${t("myBackups.confirmRestore.description")}\n\n${detail}`,
        confirmLabel: t("myBackups.confirmRestore.confirm"),
      }))) return;

      const res = await fetch(`${BASE}/api/my-backups/${backup.id}/restore`, {
        method: "POST", credentials: "include",
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: t("myBackups.toast.restored"),
          description: t("myBackups.toast.restoredDesc", { rows: d.result?.restored ?? 0, failed: d.result?.failed ?? 0 }),
        });
      } else {
        toast({ title: t("myBackups.toast.restoreFailed"), description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("myBackups.toast.restoreFailed"), variant: "destructive" });
    } finally {
      setRestoringId(null);
    }
  };

  const remove = async (backup: Backup) => {
    if (!(await confirmAction({
      title: t("myBackups.confirmDelete.title"),
      description: t("myBackups.confirmDelete.description"),
      confirmLabel: t("myBackups.confirmDelete.confirm"),
      destructive: true,
    }))) return;
    const res = await fetch(`${BASE}/api/my-backups/${backup.id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: t("myBackups.toast.deleted") }); await load(); }
    else toast({ title: t("myBackups.toast.deleteFailed"), variant: "destructive" });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-emerald-600" />
              {t("myBackups.title")}
            </CardTitle>
            <CardDescription>{t("myBackups.subtitle", { retention })}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label={t("myBackups.refresh")}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={createNow} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              {t("myBackups.backupNow")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {coverage && (
          <p className="text-xs text-muted-foreground">
            {t("myBackups.coverage", { tables: coverage.tables })}{" "}
            {t("myBackups.redacted", { columns: coverage.redactedColumns.length })}
          </p>
        )}

        {loading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center" data-testid="my-backups-empty">
            {t("myBackups.empty")}
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {backups.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {format(new Date(b.createdAt), "dd MMM yyyy 'a' HH:mm", { locale: fr })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("myBackups.rowsAndSize", { rows: b.rowCount, size: formatSize(b.sizeBytes) })}
                  </p>
                </div>
                <Badge variant={b.origin === "manual" ? "default" : "secondary"} className="text-[10px]">
                  {b.origin === "manual" ? t("myBackups.originManual") : t("myBackups.originAuto")}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => download(b)}
                  disabled={downloadingId === b.id}
                  aria-label={t("myBackups.download")}
                  title={t("myBackups.download")}
                >
                  {downloadingId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => restore(b)}
                  disabled={restoringId === b.id}
                  aria-label={t("myBackups.restore")}
                  title={t("myBackups.restore")}
                >
                  {restoringId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-500"
                  onClick={() => remove(b)}
                  aria-label={t("myBackups.delete")}
                  title={t("myBackups.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
