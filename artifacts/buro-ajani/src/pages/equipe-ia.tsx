import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users2, Sparkles, Play, Loader2, RefreshCw, Target, Check, X, Inbox,
  AlertCircle, AlertTriangle, Lightbulb, CheckCircle2, Clock,
  Phone, Users, ClipboardList, Mail, Shield, TrendingUp, Brain,
  Receipt, Package, UserCog, Mail as MailIcon, MessageSquare, CheckSquare,
  Bell, UserPlus, ShieldQuestion,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { confirmAction } from "@/hooks/use-confirm";
import { useWorkspaceUser } from "@/components/workspace-user";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Erreur ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const AGENT_ICONS: Record<string, typeof Brain> = {
  phone: Phone, users: Users, clipboard: ClipboardList, mail: Mail,
  clock: Clock, shield: Shield, "trending-up": TrendingUp, brain: Brain,
  receipt: Receipt, package: Package, "user-cog": UserCog,
};

interface AgentDef {
  id: string;
  name: string;
  icon: string;
  domain: string;
  persona: string;
  tagline: string;
}

interface AgentReport {
  agentId: string;
  score: number;
  summary: string;
  errorsFound: number;
  warningsFound: number;
  suggestionsCount: number;
  reportDate: string;
  createdAt: string;
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
  status: string;
  createdAt: string;
}

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-destructive";
}

function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={3} className="text-muted/30" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className={scoreColor(score)} style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-bold ${scoreColor(score)}`}>{score}</span>
      </div>
    </div>
  );
}

function summaryText(raw: string | undefined): string {
  if (!raw) return "";
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try { return JSON.parse(raw).summary || raw; } catch { return raw; }
  }
  return raw;
}

export default function EquipeIaPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAtLeast } = useWorkspaceUser();
  const canRun = isAtLeast("administrateur");

  const [goals, setGoals] = useState<Record<string, string>>({});
  const [runningId, setRunningId] = useState<string | null>(null);

  const { data: config, isLoading: cfgLoading } = useQuery({
    queryKey: ["ai-agents-config"],
    queryFn: () => api<{ agents: AgentDef[] }>("/ai/agents/config"),
  });

  const { data: latest } = useQuery({
    queryKey: ["ai-agents-latest"],
    queryFn: () => api<Record<string, AgentReport>>("/ai/agents/latest"),
    refetchInterval: 30_000,
  });

  const { data: queue, isLoading: queueLoading } = useQuery({
    queryKey: ["agent-queue", "en_attente"],
    queryFn: () => api<{ proposals: Proposal[] }>("/agent-queue?status=en_attente&limit=100"),
    refetchInterval: 60_000,
  });

  const agents = config?.agents ?? [];
  const pending = (queue?.proposals ?? []).filter(p => p.status === "en_attente");

  const runAgent = useMutation({
    mutationFn: (v: { agentId: string; goal: string }) =>
      api<AgentReport>(`/ai/agents/run/${v.agentId}`, {
        method: "POST",
        body: JSON.stringify(v.goal ? { goal: v.goal } : {}),
      }),
    onSuccess: (_r, v) => {
      const a = agents.find(x => x.id === v.agentId);
      toast({ title: `${a?.persona ?? "Agent"} a terminé`, description: "Le rapport a été mis à jour." });
      qc.invalidateQueries({ queryKey: ["ai-agents-latest"] });
    },
    onError: (e: Error) =>
      toast({ title: "Échec de l'exécution", description: e.message, variant: "destructive" }),
    onSettled: () => setRunningId(null),
  });

  const runAll = useMutation({
    mutationFn: () => api<{ status: string; totalAgents: number }>("/ai/agents/run", { method: "POST" }),
    onSuccess: (r) => {
      toast({
        title: "Analyse de l'équipe lancée",
        description: `${r.totalAgents ?? 10} agents travaillent en arrière-plan. Les rapports se mettront à jour automatiquement.`,
      });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["ai-agents-latest"] }), 8000);
    },
    onError: (e: Error) =>
      toast({ title: "Échec", description: e.message, variant: "destructive" }),
  });

  const queueRunNow = useMutation({
    mutationFn: () => api<{ inserted: number }>("/agent-queue/run-now", { method: "POST" }),
    onSuccess: (r) => {
      toast({
        title: "Analyse terminée",
        description: r.inserted > 0 ? `${r.inserted} nouvelle(s) proposition(s).` : "Aucune nouvelle action à proposer.",
      });
      qc.invalidateQueries({ queryKey: ["agent-queue"] });
    },
    onError: (e: Error) => toast({ title: "Échec de l'analyse", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: (id: number) => api<{ ok: boolean; error?: string }>(`/agent-queue/${id}/approve`, { method: "POST" }),
    onSuccess: (r) => {
      if (r.ok) toast({ title: "Action exécutée", description: "La proposition a été approuvée et exécutée." });
      else toast({ title: "Exécution échouée", description: r.error || "Action impossible.", variant: "destructive" });
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

  const handleRun = (agentId: string) => {
    if (!canRun) return;
    setRunningId(agentId);
    runAgent.mutate({ agentId, goal: (goals[agentId] || "").trim() });
  };

  const handleApprove = async (p: Proposal) => {
    const ok = await confirmAction({
      title: "Approuver cette action ?",
      description: `${p.summary}\n\nL'action sera exécutée immédiatement.`,
      confirmLabel: "Approuver et exécuter",
    });
    if (ok) approve.mutate(p.id);
  };

  const busyQueueId = approve.isPending ? approve.variables : reject.isPending ? reject.variables : null;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 p-2.5 text-white shadow-lg shadow-indigo-500/20">
            <Users2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Équipe IA</h1>
            <p className="text-muted-foreground text-sm mt-0.5 max-w-2xl">
              Votre équipe d'agents intelligents. Donnez un objectif à chacun, lancez-le quand vous
              voulez, et validez toutes leurs propositions au même endroit — rien ne s'exécute sans vous.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 border-indigo-200 text-indigo-700 dark:border-indigo-900 dark:text-indigo-300">
                <Brain className="h-3.5 w-3.5" />
                Conseil IA · Gemini + GPT + Claude
              </Badge>
              <span className="text-xs text-muted-foreground">
                Chaque agent consulte plusieurs IA de pointe puis apprend de vos décisions.
              </span>
            </div>
          </div>
        </div>
        {canRun && (
          <Button
            onClick={() => runAll.mutate()}
            disabled={runAll.isPending}
            className="shrink-0 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700"
          >
            {runAll.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Lancement…</>
              : <><Sparkles className="h-4 w-4 mr-2" />Faire travailler toute l'équipe</>}
          </Button>
        )}
      </div>

      {/* Résumé */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={Users2} label="Agents" value={agents.length || "—"} tint="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40" />
        <StatCard icon={Inbox} label="En attente d'approbation" value={pending.length} tint="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" />
        <StatCard icon={CheckCircle2} label="Rapports disponibles" value={latest ? Object.keys(latest).filter(k => k !== "super_agent").length : 0} tint="text-violet-600 bg-violet-50 dark:bg-violet-950/40" />
      </div>

      {/* Grille des agents */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Vos agents</h2>
        {cfgLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-60 w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => {
              const report = latest?.[agent.id];
              const Icon = AGENT_ICONS[agent.icon] || Brain;
              const isRunning = runningId === agent.id && runAgent.isPending;
              const [persona, ...roleParts] = agent.name.split(" · ");
              const role = roleParts.join(" · ");
              return (
                <Card key={agent.id} className="flex flex-col">
                  <CardContent className="p-4 flex flex-col gap-3 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm leading-tight truncate">{persona}</p>
                          <p className="text-xs text-muted-foreground truncate">{role}</p>
                        </div>
                      </div>
                      {report ? <ScoreRing score={report.score} /> : (
                        <Badge variant="outline" className="text-[10px] shrink-0">Jamais lancé</Badge>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground italic line-clamp-2">{agent.tagline}</p>

                    {report && (
                      <>
                        <p className="text-xs text-foreground line-clamp-2">{summaryText(report.summary)}</p>
                        <div className="flex flex-wrap items-center gap-3 text-[11px]">
                          {report.errorsFound > 0 && (
                            <span className="flex items-center gap-1 text-destructive"><AlertCircle className="w-3 h-3" />{report.errorsFound}</span>
                          )}
                          {report.warningsFound > 0 && (
                            <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="w-3 h-3" />{report.warningsFound}</span>
                          )}
                          {report.suggestionsCount > 0 && (
                            <span className="flex items-center gap-1 text-blue-600"><Lightbulb className="w-3 h-3" />{report.suggestionsCount}</span>
                          )}
                          {report.errorsFound === 0 && report.warningsFound === 0 && (
                            <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3 h-3" />RAS</span>
                          )}
                          <span className="text-muted-foreground ml-auto">{report.reportDate}</span>
                        </div>
                      </>
                    )}

                    <div className="mt-auto space-y-2 pt-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <Target className="w-3.5 h-3.5" /> Objectif pour cette exécution (optionnel)
                      </div>
                      <Textarea
                        value={goals[agent.id] || ""}
                        onChange={(e) => setGoals(g => ({ ...g, [agent.id]: e.target.value }))}
                        placeholder={`Ex : ${exampleGoal(agent.id)}`}
                        rows={2}
                        maxLength={500}
                        disabled={!canRun || isRunning}
                        className="text-xs resize-none"
                      />
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!canRun || isRunning}
                        onClick={() => handleRun(agent.id)}
                      >
                        {isRunning
                          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />En cours…</>
                          : <><Play className="w-3.5 h-3.5 mr-1.5" />Lancer maintenant</>}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {!canRun && (
          <p className="text-xs text-muted-foreground">
            Seuls les administrateurs peuvent lancer les agents. Vous pouvez consulter leurs rapports.
          </p>
        )}
      </section>

      {/* File d'approbation unifiée */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Inbox className="w-4 h-4" /> À approuver
            {pending.length > 0 && (
              <span className="rounded-full bg-emerald-500 text-white text-[11px] px-1.5 py-0.5">{pending.length}</span>
            )}
          </h2>
          {canRun && (
            <Button variant="outline" size="sm" onClick={() => queueRunNow.mutate()} disabled={queueRunNow.isPending}>
              {queueRunNow.isPending
                ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Analyse…</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Chercher des actions</>}
            </Button>
          )}
        </div>

        {queueLoading ? (
          <div className="space-y-3">{[0, 1].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
        ) : pending.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 w-14 h-14 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h3 className="font-medium">Tout est à jour</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
                Aucune action en attente. Vos agents vous proposeront de nouvelles actions dès qu'ils détecteront quelque chose d'utile.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pending.map((p) => {
              const meta = categoryMeta(p);
              const Icon = meta.icon;
              const busy = busyQueueId === p.id;
              return (
                <Card key={p.id} className="overflow-hidden transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`rounded-lg p-2 shrink-0 ${meta.color}`}><Icon className="h-5 w-5" /></div>
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
                        </div>
                        <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap">{p.summary}</p>
                        {p.reason && <p className="text-xs text-muted-foreground/80 mt-2 italic">Pourquoi : {p.reason}</p>}
                        {canRun && (
                          <div className="flex items-center gap-2 mt-4">
                            <Button size="sm" onClick={() => handleApprove(p)} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                              <Check className="h-4 w-4 mr-1.5" />Approuver
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reject.mutate(p.id)} disabled={busy}>
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
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tint }: { icon: typeof Brain; label: string; value: number | string; tint: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`rounded-lg p-2 ${tint}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const CATEGORY_META: Record<string, { icon: typeof MailIcon; label: string; color: string }> = {
  email: { icon: MailIcon, label: "E-mail", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/40" },
  sms: { icon: MessageSquare, label: "SMS", color: "text-violet-600 bg-violet-50 dark:bg-violet-950/40" },
  tache: { icon: CheckSquare, label: "Tâche", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40" },
  rappel: { icon: Bell, label: "Rappel", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/40" },
  relance: { icon: RefreshCw, label: "Relance", color: "text-orange-600 bg-orange-50 dark:bg-orange-950/40" },
  contact: { icon: UserPlus, label: "Contact", color: "text-teal-600 bg-teal-50 dark:bg-teal-950/40" },
  autre: { icon: ShieldQuestion, label: "Action", color: "text-slate-600 bg-slate-100 dark:bg-slate-800/60" },
};

const TOOL_FALLBACK_CATEGORY: Record<string, string> = {
  send_email: "email", send_sms: "sms", create_task: "tache",
  create_calendar_event: "rappel", create_contact: "contact",
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

function exampleGoal(agentId: string): string {
  switch (agentId) {
    case "agent_appels": return "rappeler les appels manqués d'aujourd'hui";
    case "agent_contacts": return "relancer les clients inactifs depuis 30 jours";
    case "agent_taches": return "prioriser les tâches en retard de cette semaine";
    case "agent_messages": return "repérer les messages sans réponse";
    case "agent_pointage": return "vérifier les anomalies de pointage";
    case "agent_facturation": return "lister les factures impayées à relancer";
    case "agent_stock": return "alerter sur les stocks bientôt épuisés";
    case "agent_rh": return "contrôler la conformité des comptes employés";
    case "agent_securite": return "auditer les accès sensibles récents";
    case "agent_performance": return "comparer les KPIs à la semaine dernière";
    default: return "concentre-toi sur le plus urgent";
  }
}
