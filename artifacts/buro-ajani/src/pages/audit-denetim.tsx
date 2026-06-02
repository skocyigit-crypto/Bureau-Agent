import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ScanSearch, Sparkles, RefreshCw, AlertCircle, CheckCircle2, Lightbulb,
  AlertTriangle, Archive, Eye, Inbox, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface Finding {
  id: number;
  kind: "eksik" | "yenilik" | string;
  area: string;
  severity: string;
  title: string;
  detail: string;
  suggestion: string;
  actionable: boolean;
  linkedProposalId: number | null;
  status: string;
  createdAt: string;
}

interface Summary {
  total: number; eksik: number; yenilik: number; actionable: number; critique: number; haute: number;
}

const AREA_LABEL: Record<string, string> = {
  sante: "Santé app", donnees: "Données", securite: "Sécurité",
  usage: "Usage", fonctionnalite: "Fonctionnalité", general: "Général",
};

const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  critique: { label: "Critique", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
  haute: { label: "Haute", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300" },
  moyenne: { label: "Moyenne", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  basse: { label: "Basse", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
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

export default function AuditDenetimPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"eksik" | "yenilik">("eksik");

  const summary = useQuery({
    queryKey: ["app-audit", "summary"],
    queryFn: () => api<Summary>("/app-audit/summary"),
    refetchInterval: 120_000,
  });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["app-audit", "findings", tab],
    queryFn: () => api<{ findings: Finding[] }>(`/app-audit/findings?kind=${tab}&status=active&limit=100`),
    refetchInterval: 120_000,
  });

  const findings = data?.findings ?? [];

  const runNow = useMutation({
    mutationFn: () => api<{ inserted: number; proposalsCreated: number }>("/app-audit/run-now", { method: "POST" }),
    onSuccess: (r) => {
      toast({
        title: "Audit terminé",
        description: r.inserted > 0
          ? `${r.inserted} constat(s) ajouté(s)${r.proposalsCreated > 0 ? `, dont ${r.proposalsCreated} en file d'approbation.` : "."}`
          : "Aucun nouveau constat pour le moment.",
      });
      qc.invalidateQueries({ queryKey: ["app-audit"] });
    },
    onError: (e: Error) => toast({ title: "Échec de l'audit", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api<{ ok: boolean }>(`/app-audit/findings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-audit"] }),
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const s = summary.data;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 p-2.5 text-white shadow-lg shadow-indigo-500/20">
            <ScanSearch className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Auto-audit</h1>
            <p className="text-muted-foreground text-sm mt-0.5 max-w-2xl">
              Un agent inspecte votre application en continu : il repère les lacunes (eksik) et
              propose des améliorations (yenilik). Les actions traitables arrivent dans votre
              file d'approbation — rien n'est appliqué sans votre accord.
            </p>
          </div>
        </div>
        <Button
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          className="shrink-0 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700"
        >
          {runNow.isPending
            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Audit en cours…</>
            : <><Sparkles className="h-4 w-4 mr-2" />Lancer un audit</>}
        </Button>
      </div>

      {/* Résumé */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Lacunes" value={s?.eksik ?? 0} icon={AlertTriangle} color="text-orange-600" />
        <StatCard label="Idées" value={s?.yenilik ?? 0} icon={Lightbulb} color="text-violet-600" />
        <StatCard label="Actionnables" value={s?.actionable ?? 0} icon={Inbox} color="text-emerald-600" />
        <StatCard label="Critiques/Hautes" value={(s?.critique ?? 0) + (s?.haute ?? 0)} icon={AlertCircle} color="text-red-600" />
      </div>

      {/* Onglets */}
      <div className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "eksik"} onClick={() => setTab("eksik")}>
          <AlertTriangle className="h-4 w-4 mr-1.5" />Lacunes
          {(s?.eksik ?? 0) > 0 && <span className="ml-2 rounded-full bg-orange-500 text-white text-xs px-1.5 py-0.5">{s?.eksik}</span>}
        </TabButton>
        <TabButton active={tab === "yenilik"} onClick={() => setTab("yenilik")}>
          <Lightbulb className="h-4 w-4 mr-1.5" />Idées
          {(s?.yenilik ?? 0) > 0 && <span className="ml-2 rounded-full bg-violet-500 text-white text-xs px-1.5 py-0.5">{s?.yenilik}</span>}
        </TabButton>
      </div>

      {/* Contenu */}
      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
      ) : isError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{(error as Error)?.message || "Erreur de chargement."}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>Réessayer</Button>
          </CardContent>
        </Card>
      ) : findings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="rounded-full bg-indigo-50 dark:bg-indigo-950/40 w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-indigo-500" />
            </div>
            <h3 className="font-medium text-lg">{tab === "eksik" ? "Aucune lacune détectée" : "Aucune idée pour le moment"}</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
              L'agent vous signalera de nouveaux constats dès qu'il détectera quelque chose d'utile.
            </p>
            <Button variant="outline" className="mt-5" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
              <Sparkles className="h-4 w-4 mr-2" />Lancer un audit maintenant
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => {
            const sev = SEVERITY_META[f.severity] ?? SEVERITY_META.moyenne;
            const Icon = tab === "eksik" ? AlertTriangle : Lightbulb;
            const busy = setStatus.isPending && setStatus.variables?.id === f.id;
            return (
              <Card key={f.id} className="overflow-hidden transition-shadow hover:shadow-md">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 shrink-0 ${tab === "eksik" ? "text-orange-600 bg-orange-50 dark:bg-orange-950/40" : "text-violet-600 bg-violet-50 dark:bg-violet-950/40"}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium leading-tight">{f.title}</h3>
                        <Badge variant="secondary" className="text-xs">{AREA_LABEL[f.area] ?? f.area}</Badge>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${sev.cls}`}>{sev.label}</span>
                        {f.status === "vu" && <span className="text-xs text-muted-foreground">• vu</span>}
                      </div>
                      {f.detail && <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap">{f.detail}</p>}
                      {f.suggestion && (
                        <p className="text-sm text-foreground/80 mt-2"><span className="font-medium">Recommandation : </span>{f.suggestion}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 mt-4">
                        {f.actionable && f.linkedProposalId && (
                          <Link href="/file-approbation">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                              <Inbox className="h-4 w-4 mr-1.5" />Voir dans la file
                              <ArrowRight className="h-3.5 w-3.5 ml-1" />
                            </Button>
                          </Link>
                        )}
                        {f.status !== "vu" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus.mutate({ id: f.id, status: "vu" })}>
                            <Eye className="h-4 w-4 mr-1.5" />Marquer comme vu
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus.mutate({ id: f.id, status: "archive" })}>
                          <Archive className="h-4 w-4 mr-1.5" />Archiver
                        </Button>
                        {busy && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {isFetching && !isLoading && <p className="text-xs text-muted-foreground text-center">Mise à jour…</p>}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Inbox; color: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`h-5 w-5 ${color}`} />
        <div>
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
