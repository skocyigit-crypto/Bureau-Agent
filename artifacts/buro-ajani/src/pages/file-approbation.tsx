import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Inbox, Sparkles, Check, X, RefreshCw, Clock, AlertCircle, CheckCircle2,
  Mail, MessageSquare, CheckSquare, UserPlus, Calendar, Bell, ShieldQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { confirmAction } from "@/hooks/use-confirm";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

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

const CATEGORY_META: Record<string, { icon: typeof Mail; label: string; color: string }> = {
  email: { icon: Mail, label: "E-mail", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" },
  sms: { icon: MessageSquare, label: "SMS", color: "text-violet-600 bg-violet-50 dark:bg-violet-950/40" },
  tache: { icon: CheckSquare, label: "Tâche", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
  rappel: { icon: Bell, label: "Rappel", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
  relance: { icon: RefreshCw, label: "Relance", color: "text-orange-600 bg-orange-50 dark:bg-orange-950/40" },
  contact: { icon: UserPlus, label: "Contact", color: "text-teal-600 bg-teal-50 dark:bg-teal-950/40" },
  autre: { icon: ShieldQuestion, label: "Action", color: "text-slate-600 bg-slate-100 dark:bg-slate-800/60" },
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

const PRIORITY_LABEL: Record<string, string> = { haute: "Haute", moyenne: "Moyenne", basse: "Basse" };
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
    throw new Error(body.error || `Erreur ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export default function FileApprobationPage() {
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
        title: "Analyse terminée",
        description: r.inserted > 0
          ? `${r.inserted} nouvelle(s) proposition(s) ajoutée(s).`
          : "Aucune nouvelle action à proposer pour le moment.",
      });
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: "Échec de l'analyse", description: e.message, variant: "destructive" }),
  });

  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>({});

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
      if (r.ok) toast({ title: "Action exécutée", description: "La proposition a été approuvée et exécutée." });
      else toast({ title: "Exécution échouée", description: r.error || "L'action n'a pas pu être exécutée.", variant: "destructive" });
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: (id: number) => api<{ ok: boolean }>(`/agent-queue/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Proposition rejetée" });
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const handleApprove = async (p: Proposal) => {
    // La confirmation reprend les valeurs FINALES (edition comprise), pour que
    // le dernier ecran avant execution montre exactement ce qui partira.
    const draft = drafts[p.id];
    const args = (p.args ?? {}) as Record<string, unknown>;
    const { danger, fields } = previewFieldsFor(p);
    const recap = fields
      .map((f) => {
        const v = draft?.[f.key] ?? String(args[f.key] ?? "");
        return v ? `${f.label} : ${v}` : null;
      })
      .filter(Boolean)
      .join("\n");
    const description = [danger, recap || p.summary, "L'action sera exécutée immédiatement."]
      .filter(Boolean)
      .join("\n\n");
    const ok = await confirmAction({
      title: p.toolName === "send_email" ? "Envoyer cet e-mail ?" : "Approuver cette action ?",
      description,
      confirmLabel: p.toolName === "send_email" ? "Envoyer" : "Approuver et exécuter",
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
            <h1 className="text-2xl font-semibold tracking-tight">File d'approbation</h1>
            <p className="text-muted-foreground text-sm mt-0.5 max-w-2xl">
              Votre secrétaire numérique analyse l'activité en continu et vous propose des actions.
              Rien n'est exécuté sans votre accord — validez ou rejetez d'un clic.
            </p>
          </div>
        </div>
        <Button
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          className="shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
        >
          {runNow.isPending
            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Analyse en cours…</>
            : <><Sparkles className="h-4 w-4 mr-2" />Lancer l'analyse</>}
        </Button>
      </div>

      {/* Onglets */}
      <div className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "en_attente"} onClick={() => setTab("en_attente")}>
          <Clock className="h-4 w-4 mr-1.5" />En attente
          {tab === "en_attente" && pendingCount > 0 && (
            <span className="ml-2 rounded-full bg-emerald-500 text-white text-xs px-1.5 py-0.5">{pendingCount}</span>
          )}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          <CheckCircle2 className="h-4 w-4 mr-1.5" />Historique
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
            <p className="text-sm text-muted-foreground">{(error as Error)?.message || "Erreur de chargement."}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>Réessayer</Button>
          </CardContent>
        </Card>
      ) : proposals.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="font-medium text-lg">
              {tab === "en_attente" ? "Tout est à jour" : "Aucun historique"}
            </h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
              {tab === "en_attente"
                ? "Aucune action en attente. L'agent vous proposera de nouvelles actions dès qu'il détectera quelque chose d'utile."
                : "Les actions approuvées ou rejetées apparaîtront ici."}
            </p>
            {tab === "en_attente" && (
              <Button variant="outline" className="mt-5" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                <Sparkles className="h-4 w-4 mr-2" />Lancer une analyse maintenant
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => {
            const meta = categoryMeta(p);
            const Icon = meta.icon;
            const isHistory = tab === "history";
            const busy = busyId === p.id;
            return (
              <Card key={p.id} className="overflow-hidden transition-shadow hover:shadow-md">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 shrink-0 ${meta.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium leading-tight">{p.title}</h3>
                        <Badge variant="secondary" className="text-xs">{meta.label}</Badge>
                        {p.priority && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_CLASS[p.priority] ?? PRIORITY_CLASS.moyenne}`}>
                            {PRIORITY_LABEL[p.priority] ?? p.priority}
                          </span>
                        )}
                        {typeof p.confidence === "number" && p.confidence > 0 && (
                          <span className="text-xs text-muted-foreground">Confiance {p.confidence}%</span>
                        )}
                        {isHistory && (
                          <StatusBadge status={p.status} />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap">{p.summary}</p>
                      {p.reason && (
                        <p className="text-xs text-muted-foreground/80 mt-2 italic">Pourquoi : {p.reason}</p>
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
                            <Check className="h-4 w-4 mr-1.5" />Approuver
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reject.mutate(p.id)}
                            disabled={busy}
                          >
                            <X className="h-4 w-4 mr-1.5" />Rejeter
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
            <p className="text-xs text-muted-foreground text-center">Mise à jour…</p>
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
interface PreviewField { key: string; label: string; kind: FieldKind }

const TOOL_PREVIEW: Record<string, { danger?: string; fields: PreviewField[] }> = {
  send_email: {
    fields: [
      { key: "to", label: "À", kind: "text" },
      { key: "subject", label: "Sujet", kind: "text" },
      { key: "body", label: "Message", kind: "textarea" },
    ],
  },
  send_sms: {
    fields: [
      { key: "to", label: "Numéro", kind: "text" },
      { key: "message", label: "Message", kind: "textarea" },
    ],
  },
  create_task: {
    fields: [
      { key: "title", label: "Titre", kind: "text" },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "dueDate", label: "Échéance", kind: "text" },
      { key: "priority", label: "Priorité", kind: "text" },
    ],
  },
  create_calendar_event: {
    fields: [
      { key: "title", label: "Titre", kind: "text" },
      { key: "startDate", label: "Début", kind: "text" },
      { key: "endDate", label: "Fin", kind: "text" },
      { key: "location", label: "Lieu", kind: "text" },
      { key: "description", label: "Description", kind: "textarea" },
    ],
  },
  cancel_calendar_event: {
    // Action destructive et visible par le client: on n'ouvre pas l'edition,
    // on met en garde. Le motif reste modifiable car il est journalise.
    danger: "Cette action annulera définitivement le rendez-vous. Le client peut en être informé.",
    fields: [
      { key: "id", label: "Rendez-vous n°", kind: "readonly" },
      { key: "motif", label: "Motif", kind: "text" },
    ],
  },
  reschedule_calendar_event: {
    danger: "Cette action déplacera un rendez-vous existant.",
    fields: [
      { key: "id", label: "Rendez-vous n°", kind: "readonly" },
      { key: "startDate", label: "Nouveau début", kind: "text" },
      { key: "endDate", label: "Nouvelle fin", kind: "text" },
    ],
  },
  create_contact: {
    fields: [
      { key: "nom", label: "Nom", kind: "text" },
      { key: "email", label: "E-mail", kind: "text" },
      { key: "telephone", label: "Téléphone", kind: "text" },
    ],
  },
};

/** Champs affichables pour un outil, avec repli generique sur les args bruts. */
function previewFieldsFor(proposal: Proposal): { danger?: string; fields: PreviewField[] } {
  const known = TOOL_PREVIEW[proposal.toolName];
  if (known) return known;
  const args = (proposal.args ?? {}) as Record<string, unknown>;
  return {
    fields: Object.keys(args).map((key) => ({
      key,
      label: key,
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
  const { danger, fields } = previewFieldsFor(proposal);
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
      {danger && (
        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {danger}
        </p>
      )}
      {fields.map((f) => {
        const v = valueOf(f.key);
        if (f.kind === "readonly") {
          if (!v) return null;
          return (
            <div key={f.key} className="grid sm:grid-cols-[80px_1fr] gap-2">
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <p className="text-sm whitespace-pre-wrap break-words">{v}</p>
            </div>
          );
        }
        if (f.kind === "textarea") {
          return (
            <div key={f.key} className="grid sm:grid-cols-[80px_1fr] gap-2">
              <Label className="text-xs text-muted-foreground pt-2">{f.label}</Label>
              <Textarea value={v} onChange={(e) => set(f.key, e.target.value)} rows={5} className="text-sm" />
            </div>
          );
        }
        return (
          <div key={f.key} className="grid sm:grid-cols-[80px_1fr] items-center gap-2">
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            <Input value={v} onChange={(e) => set(f.key, e.target.value)} className="h-8 text-sm" />
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    executee: { label: "Exécutée", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
    rejetee: { label: "Rejetée", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
    echouee: { label: "Échouée", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
    expiree: { label: "Expirée", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  };
  const m = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <span className={`text-xs px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}
