import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface TrashEntry {
  id: number;
  tableName: string;
  rowId: number;
  label: string | null;
  deletedByName: string | null;
  deletedAt: string;
}

/**
 * La corbeille.
 *
 * Ouverte a tout le monde, sans garde de role, et c'est le point: la
 * restauration de sauvegarde existante est reservee aux administrateurs, alors
 * que celui qui supprime par erreur est le plus souvent un utilisateur
 * ordinaire. Une protection qu'il faut demander a quelqu'un d'autre arrive
 * toujours trop tard.
 */
export default function CorbeillePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/trash`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setRetentionDays(data.retentionDays ?? null);
      }
    } catch {
      toast({ title: t("corbeille.loadFailed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => { load(); }, [load]);

  const restore = async (entry: TrashEntry) => {
    setRestoringId(entry.id);
    try {
      const res = await fetch(`${BASE}/api/trash/${entry.id}/restore`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: t("corbeille.restored"), description: entry.label || undefined });
        load();
      } else {
        // Le serveur explique le cas le plus courant — un parent lui-meme
        // supprime — et dit quoi faire. Le relayer vaut mieux qu'un
        // « erreur » generique qui laisse l'utilisateur sans issue.
        toast({ title: t("corbeille.restoreFailed"), description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("corbeille.restoreFailed"), variant: "destructive" });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trash2 className="h-6 w-6" aria-hidden="true" /> {t("corbeille.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {retentionDays != null
            ? t("corbeille.subtitle", { days: retentionDays })
            : t("corbeille.subtitleGeneric")}
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Trash2 className="h-10 w-10 mx-auto mb-2 opacity-30" aria-hidden="true" />
            <p>{t("corbeille.empty")}</p>
            <p className="text-xs mt-1">{t("corbeille.emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="divide-y">
            {entries.map(entry => (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {entry.label || t("corbeille.unnamed", { id: entry.rowId })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(entry.deletedAt), "dd MMM yyyy HH:mm", { locale: fr })}
                    {entry.deletedByName ? ` · ${entry.deletedByName}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] hidden md:inline-flex">
                  {t(`corbeille.tables.${entry.tableName}`, { defaultValue: entry.tableName })}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 shrink-0"
                  disabled={restoringId === entry.id}
                  onClick={() => restore(entry)}
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  {t("corbeille.restore")}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
