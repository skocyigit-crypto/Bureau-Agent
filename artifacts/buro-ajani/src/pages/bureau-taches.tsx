/**
 * Bureau des taches : ce que font les agents — en cours, en attente d'une
 * approbation, terminees, en erreur — et, pour chaque execution, le suivi :
 * etapes, cause d'echec, jetons et cout. Les responsables voient en plus le
 * cout par agent sur 30 jours face au quota mensuel.
 *
 * « Nouvelle demande » soumet un message a l'orchestrateur
 * (classificateur → agent specialiste → approbation) : c'est le chemin que
 * prend une demande entrante, et le moyen de l'essayer sur des donnees de
 * demonstration.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { RegionAnnonce } from "@/components/region-annonce";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const STATUTS = ["en_cours", "en_attente", "terminee", "echouee"] as const;
type Statut = (typeof STATUTS)[number];
const CANAUX = ["formulaire", "email", "whatsapp", "telephone", "demo"] as const;

interface Etape {
  id: number; position: number; kind: string; name: string; status: string;
  inputTokens: number; outputTokens: number; costUsd: number; durationMs: number; error: string | null;
}
interface Execution {
  id: number; agentId: string; trigger: string; status: Statut;
  input: { canal?: string; sujet?: string; expediteur?: string | null; extrait?: string };
  output: { type?: string; resume?: string; brouillon?: string } | null;
  error: string | null; costUsd: number; inputTokens: number; outputTokens: number;
  startedAt: string; finishedAt: string | null;
  specialiste?: string | null; coutTotalUsd?: number;
}
interface Detail {
  execution: Execution & { etapes: Etape[] };
  enfants: Array<Execution & { etapes: Etape[] }>;
  approbations: Array<{ id: number; toolName: string; title: string; status: string }>;
  coutTotalUsd: number;
}
interface Couts {
  jours: number;
  parAgent: Array<{ agentId: string; executions: number; inputTokens: number; outputTokens: number; coutUsd: number; limiteParExecutionUsd: number | null }>;
  totalUsd: number;
  quotaMensuel: { used: { costUsd: number; calls: number }; limits: { maxCostUsdPerMonth: number; maxCallsPerMonth: number }; percentCost: number };
}

const STATUT_CLASSE: Record<Statut, string> = {
  en_cours: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  en_attente: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  terminee: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  echouee: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
};

async function api<T>(chemin: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${chemin}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    const corps = await r.json().catch(() => ({}));
    throw new Error(corps.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

const usd = (n: number) => `${n.toFixed(4)} $`;

export default function BureauTachesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useWorkspaceUser();
  const estResponsable = user?.role === "administrateur" || user?.role === "super_admin";
  // « Aujourd hui » mene ici avec ?statut=echouee : l onglet doit suivre le lien,
  // sinon l execution en erreur s ouvre dans l onglet des attentes.
  const [onglet, setOnglet] = useState<Statut>(() => {
    const s = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("statut");
    return (STATUTS as readonly string[]).includes(s ?? "") ? (s as Statut) : "en_attente";
  });
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [form, setForm] = useState({ canal: "formulaire" as (typeof CANAUX)[number], nom: "", email: "", sujet: "", contenu: "" });
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  const liste = useQuery({
    queryKey: ["ajans-executions", onglet],
    queryFn: () => api<{ executions: Execution[]; compteurs: Record<Statut, number> }>(`/ajans/executions?statut=${onglet}&limit=100`),
    refetchInterval: 30_000,
  });
  const detail = useQuery({
    queryKey: ["ajans-execution", ouverte],
    queryFn: () => api<Detail>(`/ajans/executions/${ouverte}`),
    enabled: ouverte != null,
  });
  const couts = useQuery({
    queryKey: ["ajans-couts"],
    queryFn: () => api<Couts>("/ajans/couts?jours=30"),
    enabled: estResponsable,
  });

  const soumettre = useMutation({
    mutationFn: () => api<{ runId: number; statut: Statut; type: string | null; agent: string | null; actionsEnAttente: number; actionsExecutees: number; actionsRefusees: number; erreur: string | null }>(
      "/ajans/demandes",
      {
        method: "POST",
        body: JSON.stringify({
          canal: form.canal,
          expediteur: { nom: form.nom || null, email: form.email || null },
          sujet: form.sujet || null,
          contenu: form.contenu,
        }),
      },
    ),
    onSuccess: (r) => {
      setErreurForm(null);
      setForm((f) => ({ ...f, contenu: "", sujet: "" }));
      setAnnonce(r.erreur
        ? t("bureauTaches.announce.failed", { raison: r.erreur })
        : t("bureauTaches.announce.done", { statut: t(`bureauTaches.status.${r.statut}`), attente: r.actionsEnAttente, executees: r.actionsExecutees }));
      setOnglet(r.statut);
      setOuverte(r.runId);
      void qc.invalidateQueries({ queryKey: ["ajans-executions"] });
      void qc.invalidateQueries({ queryKey: ["ajans-couts"] });
    },
    onError: (e: Error) => {
      setErreurForm(e.message);
      setAnnonce(t("bureauTaches.announce.failed", { raison: e.message }));
    },
  });

  const choisirOnglet = (s: Statut) => {
    setOnglet(s);
    setAnnonce(t("bureauTaches.announce.tab", { statut: t(`bureauTaches.status.${s}`), count: liste.data?.compteurs?.[s] ?? 0 }));
  };

  const etapes = (titre: string, ex: Execution & { etapes: Etape[] }) => (
    <section className="space-y-2" aria-label={titre}>
      <h3 className="font-semibold">{titre}</h3>
      <ol className="space-y-1 text-sm">
        {ex.etapes.map((e) => (
          <li key={e.id} className="rounded border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{e.position}.</span>
              <span className="font-medium">{t(`bureauTaches.kind.${e.kind}`)}</span>
              <span>{e.name}</span>
              <Badge variant="outline">{t(`bureauTaches.stepStatus.${e.status}`)}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                {e.durationMs} ms · {e.inputTokens + e.outputTokens} {t("bureauTaches.tokens")} · {usd(e.costUsd)}
              </span>
            </div>
            {e.error && <p className="text-destructive mt-1">{e.error}</p>}
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" aria-hidden="true" /> {t("bureauTaches.title")}
        </h1>
        <p className="text-muted-foreground mt-1">{t("bureauTaches.subtitle")}</p>
      </div>
      <RegionAnnonce message={annonce} />

      <Card>
        <CardHeader className="pb-3"><CardTitle><h2 className="text-lg">{t("bureauTaches.newRequest")}</h2></CardTitle></CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); if (form.contenu.trim()) soumettre.mutate(); }}
          >
            <div className="space-y-1">
              <Label htmlFor="demande-canal">{t("bureauTaches.form.channel")}</Label>
              <select
                id="demande-canal"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.canal}
                onChange={(e) => setForm({ ...form, canal: e.target.value as (typeof CANAUX)[number] })}
              >
                {CANAUX.map((c) => <option key={c} value={c}>{t(`bureauTaches.channel.${c}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="demande-sujet">{t("bureauTaches.form.subject")}</Label>
              <Input id="demande-sujet" value={form.sujet} maxLength={300} onChange={(e) => setForm({ ...form, sujet: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="demande-nom">{t("bureauTaches.form.senderName")}</Label>
              <Input id="demande-nom" value={form.nom} maxLength={120} autoComplete="off" onChange={(e) => setForm({ ...form, nom: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="demande-email">{t("bureauTaches.form.senderEmail")}</Label>
              <Input id="demande-email" type="email" value={form.email} maxLength={200} autoComplete="off" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="demande-contenu">{t("bureauTaches.form.content")}</Label>
              <Textarea
                id="demande-contenu"
                value={form.contenu}
                rows={4}
                maxLength={8000}
                required
                aria-required="true"
                aria-invalid={erreurForm ? "true" : undefined}
                aria-describedby={erreurForm ? "demande-erreur" : "demande-aide"}
                onChange={(e) => setForm({ ...form, contenu: e.target.value })}
              />
              <p id="demande-aide" className="text-xs text-muted-foreground">{t("bureauTaches.form.help")}</p>
              {erreurForm && <p id="demande-erreur" role="alert" className="text-sm text-destructive">{erreurForm}</p>}
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={soumettre.isPending || !form.contenu.trim()} aria-busy={soumettre.isPending}>
                {soumettre.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4 mr-2" aria-hidden="true" />}
                {soumettre.isPending ? t("bureauTaches.form.sending") : t("bureauTaches.form.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="bureau-liste-titre" className="space-y-3">
        <h2 id="bureau-liste-titre" className="text-lg font-semibold">{t("bureauTaches.runs")}</h2>
        <div role="group" aria-label={t("bureauTaches.filterLabel")} className="flex flex-wrap gap-2">
          {STATUTS.map((s) => (
            <Button key={s} type="button" size="sm" variant={onglet === s ? "default" : "outline"} aria-pressed={onglet === s} onClick={() => choisirOnglet(s)}>
              {t(`bureauTaches.status.${s}`)} ({liste.data?.compteurs?.[s] ?? 0})
            </Button>
          ))}
        </div>
        {liste.isLoading && <Skeleton className="h-32" aria-hidden="true" />}
        {liste.isError && <p role="alert" className="text-destructive">{t("bureauTaches.error")}</p>}
        {liste.data && liste.data.executions.length === 0 && (
          <p className="text-muted-foreground">{t("bureauTaches.empty")}</p>
        )}
        {liste.data && liste.data.executions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("bureauTaches.tableCaption", { statut: t(`bureauTaches.status.${onglet}`) })}</caption>
              <thead>
                <tr className="text-left border-b">
                  <th scope="col" className="py-2 pr-3">{t("bureauTaches.col.date")}</th>
                  <th scope="col" className="py-2 pr-3">{t("bureauTaches.col.request")}</th>
                  <th scope="col" className="py-2 pr-3">{t("bureauTaches.col.agent")}</th>
                  <th scope="col" className="py-2 pr-3">{t("bureauTaches.col.status")}</th>
                  <th scope="col" className="py-2 pr-3">{t("bureauTaches.col.cost")}</th>
                  <th scope="col" className="py-2"><span className="sr-only">{t("bureauTaches.col.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {liste.data.executions.map((ex) => (
                  <tr key={ex.id} className="border-b align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(ex.startedAt).toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{ex.input.sujet || t("bureauTaches.noSubject")}</div>
                      <div className="text-xs text-muted-foreground">{t(`bureauTaches.channel.${ex.input.canal ?? "formulaire"}`)} · {ex.input.expediteur ?? "—"}</div>
                      {ex.error && <div className="text-xs text-destructive mt-1">{ex.error}</div>}
                    </td>
                    <td className="py-2 pr-3">{ex.specialiste ?? ex.agentId}</td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs ${STATUT_CLASSE[ex.status]}`}>{t(`bureauTaches.status.${ex.status}`)}</span></td>
                    <td className="py-2 pr-3 whitespace-nowrap">{usd(ex.coutTotalUsd ?? ex.costUsd)}</td>
                    <td className="py-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setOuverte(ex.id)}
                        aria-label={t("bureauTaches.openDetail", { sujet: ex.input.sujet || `#${ex.id}` })}>
                        {t("bureauTaches.detail")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {estResponsable && couts.data && (
        <section aria-labelledby="bureau-couts-titre" className="space-y-2">
          <h2 id="bureau-couts-titre" className="text-lg font-semibold">{t("bureauTaches.costsTitle", { jours: couts.data.jours })}</h2>
          <p className="text-sm">
            {t("bureauTaches.costsTotal", { total: usd(couts.data.totalUsd) })}
            {" · "}
            {t("bureauTaches.quota", {
              used: couts.data.quotaMensuel.used.costUsd.toFixed(2),
              max: couts.data.quotaMensuel.limits.maxCostUsdPerMonth,
              pct: Math.round(couts.data.quotaMensuel.percentCost),
            })}
          </p>
          <table className="w-full text-sm">
            <caption className="sr-only">{t("bureauTaches.costsCaption")}</caption>
            <thead>
              <tr className="text-left border-b">
                <th scope="col" className="py-1 pr-3">{t("bureauTaches.col.agent")}</th>
                <th scope="col" className="py-1 pr-3">{t("bureauTaches.col.runs")}</th>
                <th scope="col" className="py-1 pr-3">{t("bureauTaches.tokens")}</th>
                <th scope="col" className="py-1 pr-3">{t("bureauTaches.col.cost")}</th>
                <th scope="col" className="py-1">{t("bureauTaches.col.limit")}</th>
              </tr>
            </thead>
            <tbody>
              {couts.data.parAgent.map((p) => (
                <tr key={p.agentId} className="border-b">
                  <td className="py-1 pr-3">{p.agentId}</td>
                  <td className="py-1 pr-3">{p.executions}</td>
                  <td className="py-1 pr-3">{p.inputTokens + p.outputTokens}</td>
                  <td className="py-1 pr-3">{usd(p.coutUsd)}</td>
                  <td className="py-1">{p.limiteParExecutionUsd != null ? `${p.limiteParExecutionUsd} $ / ${t("bureauTaches.perRun")}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Dialog open={ouverte != null} onOpenChange={(o) => { if (!o) setOuverte(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("bureauTaches.detailTitle", { id: ouverte ?? "" })}</DialogTitle>
            <DialogDescription>{t("bureauTaches.detailDescription")}</DialogDescription>
          </DialogHeader>
          {detail.isLoading && <p role="status">{t("bureauTaches.loading")}</p>}
          {detail.isError && <p role="alert" className="text-destructive">{t("bureauTaches.error")}</p>}
          {detail.data && (
            <div className="space-y-5">
              <p className="text-sm">
                <span className={`rounded px-2 py-0.5 text-xs ${STATUT_CLASSE[detail.data.execution.status]}`}>{t(`bureauTaches.status.${detail.data.execution.status}`)}</span>
                {" · "}{t("bureauTaches.totalCost", { cout: usd(detail.data.coutTotalUsd) })}
              </p>
              {detail.data.execution.error && <p role="alert" className="text-destructive text-sm">{detail.data.execution.error}</p>}
              {etapes(t("bureauTaches.stepsOf", { agent: detail.data.execution.agentId }), detail.data.execution)}
              {detail.data.enfants.map((c) => (
                <div key={c.id}>
                  {etapes(t("bureauTaches.stepsOf", { agent: c.agentId }), c)}
                  {c.output?.brouillon && (
                    <section className="mt-3" aria-label={t("bureauTaches.draft")}>
                      <h3 className="font-semibold">{t("bureauTaches.draft")}</h3>
                      <p className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">{c.output.brouillon}</p>
                    </section>
                  )}
                </div>
              ))}
              {detail.data.approbations.length > 0 && (
                <section>
                  <h3 className="font-semibold">{t("bureauTaches.approvals")}</h3>
                  <ul className="text-sm space-y-1">
                    {detail.data.approbations.map((a) => (
                      <li key={a.id}>{a.title} — {t(`bureauTaches.proposalStatus.${a.status}`)}</li>
                    ))}
                  </ul>
                  <Link href="/file-approbation" className="text-sm text-primary underline">{t("bureauTaches.goToApprovals")}</Link>
                </section>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
