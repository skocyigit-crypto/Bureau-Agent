import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

/**
 * Panneau de sante technique (super-admin).
 *
 * Complement des ecrans metier: ici on regarde l'infrastructure — base,
 * services externes, configuration, taches planifiees, taux d'erreurs. Ce sont
 * les pannes qui rendent l'application inutilisable sans qu'aucun indicateur
 * metier ne bouge.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface HealthCheck {
  id?: number;
  agent: string;
  check: string;
  status: "ok" | "degrade" | "echec" | "inconnu";
  severity: string;
  summary: string;
  remediation: string;
  durationMs: number;
  metrics: Record<string, unknown>;
  createdAt?: string;
}

interface AgentInfo { id: string; name: string; domain: string }

const STATUS_META: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "OK", cls: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", Icon: CheckCircle2 },
  degrade: { label: "Degrade", cls: "text-amber-600 bg-amber-500/10 border-amber-500/30", Icon: AlertTriangle },
  echec: { label: "En panne", cls: "text-red-600 bg-red-500/10 border-red-500/30", Icon: XCircle },
  inconnu: { label: "Inconnu", cls: "text-slate-500 bg-slate-500/10 border-slate-500/30", Icon: HelpCircle },
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { credentials: "include", ...init });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Erreur serveur");
  return res.json();
}

export default function SanteTechniquePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const { data: agentsData } = useQuery({
    queryKey: ["health-agents", "list"],
    queryFn: () => api<{ agents: AgentInfo[] }>("/health-agents"),
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["health-agents", "latest"],
    queryFn: () => api<{ checks: HealthCheck[] }>("/health-agents/latest"),
  });

  const run = useMutation({
    mutationFn: () => api<{ worst: string; total: number; ok: number; degraded: number; failed: number; startedAt: string }>(
      "/health-agents/run",
      { method: "POST" },
    ),
    onSuccess: (r) => {
      setLastRunAt(r.startedAt);
      toast({
        title: r.worst === "ok" ? "Tout est sain" : "Anomalies detectees",
        description: `${r.ok} OK · ${r.degraded} degrade(s) · ${r.failed} en panne, sur ${r.total} verifications.`,
        variant: r.worst === "ok" ? undefined : "destructive",
      });
      qc.invalidateQueries({ queryKey: ["health-agents", "latest"] });
    },
    onError: (e: Error) => toast({ title: "Echec", description: e.message, variant: "destructive" }),
  });

  const checks = data?.checks ?? [];
  const agents = agentsData?.agents ?? [];

  // Regroupement par agent: chacun rend compte de son propre domaine.
  const byAgent = agents.map((a) => ({
    agent: a,
    checks: checks.filter((c) => c.agent === a.id),
  })).filter((g) => g.checks.length > 0 || agents.length > 0);

  const counts = {
    ok: checks.filter((c) => c.status === "ok").length,
    degrade: checks.filter((c) => c.status === "degrade").length,
    echec: checks.filter((c) => c.status === "echec").length,
  };
  const worst = counts.echec > 0 ? "echec" : counts.degrade > 0 ? "degrade" : "ok";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 p-2.5 text-white shadow-lg shadow-sky-500/20">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sante technique</h1>
            <p className="text-muted-foreground text-sm mt-0.5 max-w-2xl">
              Chaque agent controle son propre domaine : base de donnees, services externes,
              configuration, taches planifiees, erreurs, ressources. Verification automatique
              toutes les 15 minutes.
            </p>
          </div>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending} className="shrink-0">
          {run.isPending
            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Verification…</>
            : <><RefreshCw className="h-4 w-4 mr-2" />Verifier maintenant</>}
        </Button>
      </div>

      {/* Bandeau de synthese */}
      {checks.length > 0 && (
        <div className={`rounded-xl border p-4 flex items-center gap-3 ${STATUS_META[worst].cls}`}>
          {(() => { const I = STATUS_META[worst].Icon; return <I className="h-6 w-6 shrink-0" />; })()}
          <div className="text-sm">
            <p className="font-semibold">
              {worst === "ok" ? "Tous les controles sont au vert." : worst === "degrade" ? "Des points d'attention sont detectes." : "Une ou plusieurs pannes sont en cours."}
            </p>
            <p className="opacity-80">
              {counts.ok} OK · {counts.degrade} degrade(s) · {counts.echec} en panne
              {lastRunAt && ` · derniere verification a ${new Date(lastRunAt).toLocaleTimeString("fr-FR")}`}
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>
      ) : isError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{(error as Error)?.message}</p>
          </CardContent>
        </Card>
      ) : checks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-medium text-lg">Aucune verification enregistree</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Lancez une verification, ou attendez le prochain cycle automatique.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {byAgent.map(({ agent, checks: agentChecks }) => {
            const agentWorst = agentChecks.some((c) => c.status === "echec")
              ? "echec"
              : agentChecks.some((c) => c.status === "degrade") ? "degrade" : "ok";
            const meta = STATUS_META[agentWorst];
            return (
              <Card key={agent.id} className="overflow-hidden">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        {agent.name}
                        <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{agent.domain}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {agentChecks.map((c, i) => {
                      const m = STATUS_META[c.status] ?? STATUS_META.inconnu;
                      const I = m.Icon;
                      return (
                        <div key={`${c.check}-${i}`} className="flex items-start gap-2.5 rounded-lg border border-border p-3">
                          <I className={`h-4 w-4 mt-0.5 shrink-0 ${m.cls.split(" ")[0]}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <code className="text-[11px] text-muted-foreground font-mono">{c.check}</code>
                              {c.status !== "ok" && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c.severity}</span>
                              )}
                            </div>
                            <p className="text-sm mt-1">{c.summary}</p>
                            {c.remediation && (
                              <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
                                <Wrench className="h-3 w-3 mt-0.5 shrink-0" />
                                {c.remediation}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
