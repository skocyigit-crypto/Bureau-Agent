import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useMutation,useQuery,useQueryClient } from "@tanstack/react-query";
import {
AlertCircle,
Bell,
Check,
CheckCircle2,
CheckSquare,
Clock,
Inbox,
Mail,MessageSquare,
RefreshCw,
ShieldQuestion,
Sparkles,
UserPlus,
X
} from "lucide-react";
import { useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** Doit rester aligne sur BULK_MAX cote serveur (routes/agent-queue.ts). */
const BULK_MAX = 25;

interface QueueStats {
  pending: number;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  oldestPendingAgeDays: number | null;
  last30d: { approved: number; rejected: number; expired: number; approvalRate: number | null };
}

interface BulkResult {
  requested: number;
  succeeded: number;
  failed: number;
}

interface Proposal {
  id: number;
  toolName: string;
  title: string;
  summary: string;
  reason: string;
  category: string;
  priority: string;
  confidence: number;
  sourceType: string;
  status: string;
  result: unknown;
  args: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
}

const CATEGORY_META: Record<string, { icon: typeof Mail; labelKey: string; color: string }> = {
  email: { icon: Mail, labelKey: "fileApprobation.category.email", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" },
  sms: { icon: MessageSquare, labelKey: "fileApprobation.category.sms", color: "text-violet-600 bg-violet-50 dark:bg-violet-950/40" },
  tache: { icon: CheckSquare, labelKey: "fileApprobation.category.tache", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
  rappel: { icon: Bell, labelKey: "fileApprobation.category.rappel", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
  relance: { icon: RefreshCw, labelKey: "fileApprobation.category.relance", color: "text-orange-700 bg-orange-50 dark:bg-orange-950/40" },
  contact: { icon: UserPlus, labelKey: "fileApprobation.category.contact", color: "text-teal-600 bg-teal-50 dark:bg-teal-950/40" },
  autre: { icon: ShieldQuestion, labelKey: "fileApprobation.category.autre", color: "text-slate-600 bg-slate-100 dark:bg-slate-800/60" },
};

const TOOL_FALLBACK_CATEGORY: Record<string, string> = {
  send_email: "email",
  send_sms: "sms",
  create_task: "tache",
  create_calendar_event: "rappel",
  create_contact: "contact",
};

function categoryMeta(p: Proposal) {
  const key = CATEGORY_META[p.category] ? p.category : (TOOL_FALLBACK_CATEGORY[p.toolName] ?? "autre");
  return CATEGORY_META[key] ?? CATEGORY_META.autre;
}

const PRIORITY_LABEL: Record<string, string> = { haute: "fileApprobation.priority.haute", moyenne: "fileApprobation.priority.moyenne", basse: "fileApprobation.priority.basse" };
const PRIORITY_CLASS: Record<string, string> = {
  haute: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  moyenne: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  basse: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export default function FileApprobationPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"en_attente" | "history">("en_attente");

  const statusParam = tab === "en_attente" ? "en_attente" : "all";
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["agent-queue", statusParam],
    queryFn: () => api<{ proposals: Proposal[] }>(`/agent-queue?status=${statusParam}&limit=100`),
    refetchInterval: 60_000,
  });

  const proposals = (data?.proposals ?? []).filter(p =>
    tab === "en_attente" ? p.status === "en_attente" : p.status !== "en_attente",
  );

  const runNow = useMutation({
    mutationFn: () => api<{ inserted: number; generated: number }>("/agent-queue/run-now", { method: "POST" }),
    onSuccess: (r) => {
      toast({
        title: t("fileApprobation.toast.analysisDone"),
        description: r.inserted > 0
          ? t("fileApprobation.toast.analysisAdded", { count: r.inserted })
          : t("fileApprobation.toast.analysisNone"),
      });
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: t("fileApprobation.toast.analysisError"), description: e.message, variant: "destructive" }),
  });

  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>({});

  /**
   * Tableau de bord de supervision. Le compteur seul ne dit pas s'il faut s'y
   * mettre maintenant: l'age de la plus vieille proposition (une file qu'on ne
   * vide jamais finit par expirer en silence) et le taux d'approbation sur 30
   * jours (l'agent propose-t-il des choses utiles ?) changent la conduite.
   */
  const { data: stats } = useQuery({
    queryKey: ["agent-queue", "stats"],
    queryFn: () => api<QueueStats>("/agent-queue/stats"),
    refetchInterval: 60_000,
  });

  /**
   * Selection explicite pour la decision groupee. Deliberement PAS de "tout
   * approuver": la regle d'or veut que l'humain ait vu ce qu'il valide. Cocher
   * reste un geste par proposition, seul le clic final est mutualise — ce qui
   * rend supportable une file de dix relances du meme genre.
   */
  const [selected, setSelected] = useState<number[]>([]);
  const toggleSelected = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const bulk = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api<BulkResult>("/agent-queue/bulk-decide", {
        method: "POST",
        body: JSON.stringify({ ids: selected, decision }),
      }),
    onSuccess: (r) => {
      toast({
        title: r.failed === 0 ? t("fileApprobation.toast.decisionsSaved") : t("fileApprobation.toast.decisionsPartial"),
        description: r.failed > 0
          ? t("fileApprobation.toast.bulkDonePartial", { succeeded: r.succeeded, failed: r.failed })
          : t("fileApprobation.toast.bulkDone", { succeeded: r.succeeded }),
        variant: r.failed > 0 ? "destructive" : undefined,
      });
      setSelected([]);
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: t("fileApprobation.toast.error"), description: e.message, variant: "destructive" }),
  });

  const handleBulk = async (decision: "approve" | "reject") => {
    // Le serveur borne le lot (chaque approbation declenche un effet reel et
    // le tout s'execute dans la requete). On le dit ici plutot que de laisser
    // partir un appel qui reviendrait en 400.
    if (selected.length > BULK_MAX) {
      toast({
        title: t("fileApprobation.toast.selectionTooLarge"),
        description: t("fileApprobation.toast.selectionTooLargeDesc", { max: BULK_MAX }),
        variant: "destructive",
      });
      return;
    }
    const ok = await confirmAction({
      title: decision === "approve"
        ? t("fileApprobation.confirm.approveTitle", { count: selected.length })
        : t("fileApprobation.confirm.rejectTitle", { count: selected.length }),
      description: decision === "approve"
        ? t("fileApprobation.confirm.approveDesc")
        : t("fileApprobation.confirm.rejectDesc"),
      confirmLabel: decision === "approve" ? t("fileApprobation.confirm.approveConfirm") : t("fileApprobation.confirm.rejectConfirm"),
    });
    if (ok) bulk.mutate(decision);
  };

  const approve = useMutation({
    mutationFn: async (p: Proposal) => {
      const edited = drafts[p.id];
      if (edited && Object.keys(edited).length > 0) {
        // Fusion avec les args d'origine: l'apercu n'expose qu'une partie des
        // champs (et uniquement en texte), les autres — dont les identifiants
        // numeriques — doivent repartir intacts, sinon validateArgs rejette.
        await api(`/agent-queue/${p.id}/args`, {
          method: "PATCH",
          body: JSON.stringify({ args: { ...(p.args as Record<string, unknown>), ...edited } }),
        });
      }
      return api<{ ok: boolean; status: string; error?: string }>(`/agent-queue/${p.id}/approve`, { method: "POST" });
    },
    onSuccess: (r) => {
      if (r.ok) toast({ title: t("fileApprobation.toast.actionExecuted"), description: t("fileApprobation.toast.actionExecutedDesc") });
      else toast({ title: t("fileApprobation.toast.executionFailed"), description: r.error || t("fileApprobation.toast.executionFailedDesc"), variant: "destructive" });
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: t("fileApprobation.toast.error"), description: e.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: (id: number) => api<{ ok: boolean }>(`/agent-queue/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: t("fileApprobation.toast.proposalRejected") });
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: t("fileApprobation.toast.error"), description: e.message, variant: "destructive" }),
  });

  const handleApprove = async (p: Proposal) => {
    // La confirmation reprend les valeurs FINALES (edition comprise), pour que
    // le dernier ecran avant execution montre exactement ce qui partira.
    const draft = drafts[p.id];
    const args = (p.args ?? {}) as Record<string, unknown>;
    const { dangerKey, fields } = previewFieldsFor(p);
    const recap = fields
      .map((f) => {
        const v = draft?.[f.key] ?? String(args[f.key] ?? "");
        return v ? `${t(f.labelKey)} : ${v}` : null;
      })
      .filter(Boolean)
      .join("\n");
    const description = [dangerKey ? t(dangerKey) : "", recap || p.summary, t("fileApprobation.confirm.executeImmediately")]
      .filter(Boolean)
      .join("\n\n");
    const ok = await confirmAction({
      title: p.toolName === "send_email" ? t("fileApprobation.confirm.sendEmailTitle") : t("fileApprobation.confirm.approveActionTitle"),
      description,
      confirmLabel: p.toolName === "send_email" ? t("fileApprobation.confirm.sendEmailConfirm") : t("fileApprobation.confirm.approveConfirm"),
    });
    if (ok) approve.mutate(p);
  };

  const pendingCount = proposals.length;
  const busyId = approve.isPending ? approve.variables?.id : reject.isPending ? reject.variables : null;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 text-white shadow-lg shadow-emerald-500/20">
            <Inbox className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("fileApprobation.title")}</h1>
            <p className="text-muted-foreground text-sm mt-0.5 max-w-2xl">
              {t("fileApprobation.subtitle")}
            </p>
          </div>
        </div>
        <Button
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          className="shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
        >
          {runNow.isPending
            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />{t("fileApprobation.analyzing")}</>
            : <><Sparkles className="h-4 w-4 mr-2" />{t("fileApprobation.runAnalysis")}</>}
        </Button>
      </div>

      {/* Bandeau de supervision */}
      {stats && (stats.pending > 0 || stats.last30d.approvalRate !== null) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <span>
            <strong>{stats.pending}</strong> {t("fileApprobation.pending")}
            {(stats.byPriority.haute ?? 0) + (stats.byPriority.urgente ?? 0) > 0 && (
              <span className="text-red-600 dark:text-red-400">
                {t("fileApprobation.priorityCount", { count: (stats.byPriority.haute ?? 0) + (stats.byPriority.urgente ?? 0) })}
              </span>
            )}
          </span>
          {/* Une file qui stagne finit par expirer d'elle-meme (14 jours): on
              le dit avant, pas apres. */}
          {stats.oldestPendingAgeDays !== null && stats.oldestPendingAgeDays >= 3 && (
            <span className="text-amber-600 dark:text-amber-400">
              {t("fileApprobation.oldestWaiting", { count: stats.oldestPendingAgeDays })}
            </span>
          )}
          {stats.last30d.approvalRate !== null && (
            <span className="text-muted-foreground">
              {t("fileApprobation.approvalRate", { rate: stats.last30d.approvalRate })}
              {" "}{t("fileApprobation.approvalRateDetail", { approved: stats.last30d.approved, rejected: stats.last30d.rejected })}
            </span>
          )}
          {stats.last30d.expired > 0 && (
            <span className="text-muted-foreground">{t("fileApprobation.expiredCount", { count: stats.last30d.expired })}</span>
          )}
        </div>
      )}

      {/* Onglets */}
      <div className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "en_attente"} onClick={() => setTab("en_attente")}>
          <Clock className="h-4 w-4 mr-1.5" />{t("fileApprobation.tabPending")}
          {tab === "en_attente" && pendingCount > 0 && (
            <span className="ml-2 rounded-full bg-emerald-500 text-white text-xs px-1.5 py-0.5">{pendingCount}</span>
          )}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          <CheckCircle2 className="h-4 w-4 mr-1.5" />{t("fileApprobation.tabHistory")}
        </TabButton>
      </div>

      {/* Contenu */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{(error as Error)?.message || t("fileApprobation.loadError")}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>{t("fileApprobation.retry")}</Button>
          </CardContent>
        </Card>
      ) : proposals.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="font-medium text-lg">
              {tab === "en_attente" ? t("fileApprobation.emptyPendingTitle") : t("fileApprobation.emptyHistoryTitle")}
            </h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
              {tab === "en_attente"
                ? t("fileApprobation.emptyPendingDesc")
                : t("fileApprobation.emptyHistoryDesc")}
            </p>
            {tab === "en_attente" && (
              <Button variant="outline" className="mt-5" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                <Sparkles className="h-4 w-4 mr-2" />{t("fileApprobation.runNow")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Barre de decision groupee: n'apparait qu'une fois une selection
              faite, pour ne jamais suggerer un "tout approuver" aveugle. */}
          {tab === "en_attente" && selected.length > 0 && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-background/95 px-4 py-2.5 shadow-sm backdrop-blur">
              <span className="text-sm font-medium">{t("fileApprobation.selectedCount", { count: selected.length })}</span>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={bulk.isPending}
                onClick={() => handleBulk("approve")}
              >
                <Check className="h-4 w-4 mr-1.5" />{t("fileApprobation.approve")}
              </Button>
              <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => handleBulk("reject")}>
                <X className="h-4 w-4 mr-1.5" />{t("fileApprobation.reject")}
              </Button>
              <Button size="sm" variant="ghost" disabled={bulk.isPending} onClick={() => setSelected([])}>
                {t("fileApprobation.cancelSelection")}
              </Button>
              {bulk.isPending && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          )}
          {proposals.map((p) => {
            const meta = categoryMeta(p);
            const Icon = meta.icon;
            const isHistory = tab === "history";
            const busy = busyId === p.id;
            return (
              <Card key={p.id} className="overflow-hidden transition-shadow hover:shadow-md">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    {!isHistory && (
                      <input
                        type="checkbox"
                        className="mt-3 h-4 w-4 shrink-0 accent-emerald-600"
                        checked={selected.includes(p.id)}
                        onChange={() => toggleSelected(p.id)}
                        aria-label={t("fileApprobation.selectAria", { title: p.title })}
                      />
                    )}
                    <div className={`rounded-lg p-2 shrink-0 ${meta.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium leading-tight">{p.title}</h3>
                        <Badge variant="secondary" className="text-xs">{t(meta.labelKey)}</Badge>
                        {p.priority && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_CLASS[p.priority] ?? PRIORITY_CLASS.moyenne}`}>
                            {PRIORITY_LABEL[p.priority] ? t(PRIORITY_LABEL[p.priority]) : p.priority}
                          </span>
                        )}
                        {typeof p.confidence === "number" && p.confidence > 0 && (
                          <span className="text-xs text-muted-foreground">{t("fileApprobation.confidence", { count: p.confidence })}</span>
                        )}
                        {isHistory && (
                          <StatusBadge status={p.status} />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap">{p.summary}</p>
                      {p.reason && (
                        <p className="text-xs text-muted-foreground/80 mt-2 italic">{t("fileApprobation.why", { reason: p.reason })}</p>
                      )}

                      {!isHistory && (
                        <ActionPreview
                          proposal={p}
                          value={drafts[p.id]}
                          onChange={(v) => setDrafts((d) => ({ ...d, [p.id]: v }))}
                        />
                      )}

                      {!isHistory && (
                        <div className="flex items-center gap-2 mt-4">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(p)}
                            disabled={busy}
                            className="bg-emerald-600 hover:bg-emerald-700"
                          >
                            <Check className="h-4 w-4 mr-1.5" />{t("fileApprobation.approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reject.mutate(p.id)}
                            disabled={busy}
                          >
                            <X className="h-4 w-4 mr-1.5" />{t("fileApprobation.reject")}
                          </Button>
                          {busy && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {isFetching && !isLoading && (
            <p className="text-xs text-muted-foreground text-center">{t("fileApprobation.updating")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Apercu de ce qu'une proposition fera REELLEMENT si on l'approuve.
 *
 * Auparavant seul "send_email" avait un apercu: toutes les autres propositions
 * (SMS, creation de RDV, annulation, tache...) n'affichaient que title/summary,
 * donc le contenu exact envoye ou la ligne modifiee n'etait jamais visible
 * avant le clic. Ce composant couvre tous les outils: chaque champ declare
 * ci-dessous est affiche et modifiable, et tout champ non declare est rendu en
 * lecture seule par le repli generique — une nouvelle proposition d'un outil
 * inconnu reste donc lisible au lieu d'etre invisible.
 */
type FieldKind = "text" | "textarea" | "readonly";
interface PreviewField { key: string; labelKey: string; kind: FieldKind }

const TOOL_PREVIEW: Record<string, { dangerKey?: string; fields: PreviewField[] }> = {
  send_email: {
    fields: [
      { key: "to", labelKey: "fileApprobation.field.to", kind: "text" },
      { key: "subject", labelKey: "fileApprobation.field.subject", kind: "text" },
      { key: "body", labelKey: "fileApprobation.field.body", kind: "textarea" },
    ],
  },
  send_sms: {
    fields: [
      { key: "to", labelKey: "fileApprobation.field.smsNumber", kind: "text" },
      { key: "message", labelKey: "fileApprobation.field.message", kind: "textarea" },
    ],
  },
  create_task: {
    fields: [
      { key: "title", labelKey: "fileApprobation.field.title", kind: "text" },
      { key: "description", labelKey: "fileApprobation.field.description", kind: "textarea" },
      { key: "dueDate", labelKey: "fileApprobation.field.dueDate", kind: "text" },
      { key: "priority", labelKey: "fileApprobation.field.priority", kind: "text" },
    ],
  },
  create_calendar_event: {
    fields: [
      { key: "title", labelKey: "fileApprobation.field.title", kind: "text" },
      { key: "startDate", labelKey: "fileApprobation.field.startDate", kind: "text" },
      { key: "endDate", labelKey: "fileApprobation.field.endDate", kind: "text" },
      { key: "location", labelKey: "fileApprobation.field.location", kind: "text" },
      { key: "description", labelKey: "fileApprobation.field.description", kind: "textarea" },
    ],
  },
  cancel_calendar_event: {
    // Action destructive et visible par le client: on n'ouvre pas l'edition,
    // on met en garde. Le motif reste modifiable car il est journalise.
    dangerKey: "fileApprobation.danger.cancelEvent",
    fields: [
      { key: "id", labelKey: "fileApprobation.field.apptId", kind: "readonly" },
      { key: "motif", labelKey: "fileApprobation.field.motif", kind: "text" },
    ],
  },
  reschedule_calendar_event: {
    dangerKey: "fileApprobation.danger.rescheduleEvent",
    fields: [
      { key: "id", labelKey: "fileApprobation.field.apptId", kind: "readonly" },
      { key: "startDate", labelKey: "fileApprobation.field.newStart", kind: "text" },
      { key: "endDate", labelKey: "fileApprobation.field.newEnd", kind: "text" },
    ],
  },
  create_contact: {
    fields: [
      { key: "nom", labelKey: "fileApprobation.field.nom", kind: "text" },
      { key: "email", labelKey: "fileApprobation.field.email", kind: "text" },
      { key: "telephone", labelKey: "fileApprobation.field.telephone", kind: "text" },
    ],
  },
};

/** Champs affichables pour un outil, avec repli generique sur les args bruts. */
function previewFieldsFor(proposal: Proposal): { dangerKey?: string; fields: PreviewField[] } {
  const known = TOOL_PREVIEW[proposal.toolName];
  if (known) return known;
  const args = (proposal.args ?? {}) as Record<string, unknown>;
  return {
    fields: Object.keys(args).map((key) => ({
      key,
      labelKey: key,
      // Un outil inconnu ne doit pas etre modifiable a l'aveugle: on montre,
      // on ne laisse pas editer sans savoir ce que le champ represente.
      kind: String(args[key] ?? "").length > 120 ? "readonly" : "readonly",
    })),
  };
}

function ActionPreview({
  proposal,
  value,
  onChange,
}: {
  proposal: Proposal;
  value: Record<string, string> | undefined;
  onChange: (v: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const { dangerKey, fields } = previewFieldsFor(proposal);
  const args = (proposal.args ?? {}) as Record<string, unknown>;
  if (fields.length === 0) return null;

  const valueOf = (key: string) => value?.[key] ?? String(args[key] ?? "");
  const set = (key: string, v: string) => {
    const base: Record<string, string> = {};
    for (const f of fields) base[f.key] = valueOf(f.key);
    onChange({ ...base, [key]: v });
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      {dangerKey && (
        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {t(dangerKey)}
        </p>
      )}
      {fields.map((f) => {
        const v = valueOf(f.key);
        if (f.kind === "readonly") {
          if (!v) return null;
          return (
            <div key={f.key} className="grid sm:grid-cols-[80px_1fr] gap-2">
              <Label className="text-xs text-muted-foreground">{t(f.labelKey)}</Label>
              <p className="text-sm whitespace-pre-wrap break-words">{v}</p>
            </div>
          );
        }
        if (f.kind === "textarea") {
          return (
            <div key={f.key} className="grid sm:grid-cols-[80px_1fr] gap-2">
              <Label className="text-xs text-muted-foreground pt-2">{t(f.labelKey)}</Label>
              <Textarea aria-label={t(f.labelKey)} value={v} onChange={(e) => set(f.key, e.target.value)} rows={5} className="text-sm" />
            </div>
          );
        }
        return (
          <div key={f.key} className="grid sm:grid-cols-[80px_1fr] items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t(f.labelKey)}</Label>
            <Input aria-label={t(f.labelKey)} value={v} onChange={(e) => set(f.key, e.target.value)} className="h-8 text-sm" />
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { labelKey: string; cls: string }> = {
    executee: { labelKey: "fileApprobation.status.executee", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
    rejetee: { labelKey: "fileApprobation.status.rejetee", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
    echouee: { labelKey: "fileApprobation.status.echouee", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
    expiree: { labelKey: "fileApprobation.status.expiree", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  };
  const m = map[status];
  return <span className={`text-xs px-1.5 py-0.5 rounded ${m?.cls ?? "bg-slate-100 text-slate-600"}`}>{m ? t(m.labelKey) : status}</span>;
}
