/**
 * Ajan Bureau : quatre onglets — Agents / Flux / Travaux / Test et publication.
 *
 *  - Agents : les six profils metier (GET /api/ajans/profils), chacun avec ses
 *    outils et leur palier, ses sources, la regle de passage a un humain et
 *    son etat publie dans l'organisation. Les listes viennent du module que
 *    le serveur APPLIQUE (services/profils-agents.ts), pas d'une copie.
 *  - Flux et Travaux renvoient aux ecrans existants (studio de flux, travaux
 *    des agents) plutot que de les dupliquer.
 *  - Test et publication : essai a blanc sur un exemple (aucun effet de bord
 *    cote serveur), puis publication par un responsable. Le bouton est
 *    desactive pour les autres roles ; le serveur refuse de toute facon.
 *
 * Les onglets sont des boutons role="tab" : flèches gauche/droite pour
 * passer de l'un a l'autre, comme le veut le motif ARIA.
 */
import { useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionAnnonce } from "@/components/region-annonce";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useTranslation } from "@/i18n";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type Palier = "lecture" | "interne" | "externe" | "destructif";

export interface ProfilAgent {
  id: string;
  nom: string;
  mission: string;
  sources: { baseConnaissances: string[] | null; donnees: string[] };
  transfertHumain: { conditions: string[]; cible: "responsable" | "utilisateur" };
  exemple: string;
  reserveResponsables: boolean;
  outils: Array<{ nom: string; palier: Palier }>;
  active: boolean;
  publieLe: string | null;
  dernierEssai: number | null;
}

interface ActionEssai {
  outil: string;
  palier: Palier | null;
  statut: "simulee" | "approbation" | "refusee";
  resume?: string;
  raison?: string;
}

const PALIER_CLASSE: Record<Palier, string> = {
  lecture: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  interne: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  externe: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  destructif: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
};

const ONGLETS = ["agents", "flows", "runs", "test"] as const;
type Onglet = (typeof ONGLETS)[number];

async function lireJson(r: Response) {
  const corps = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((corps as { error?: string }).error || `HTTP ${r.status}`);
  return corps;
}

export default function AjanBureauPage() {
  const { t } = useTranslation();
  const { user } = useWorkspaceUser();
  const estResponsable = user?.role === "administrateur" || user?.role === "super_admin";
  const [onglet, setOnglet] = useState<Onglet>("agents");

  const profils = useQuery({
    queryKey: ["ajans-profils"],
    queryFn: async () => (await lireJson(await fetch(`${BASE}/api/ajans/profils`, { credentials: "include" }))) as { profils: ProfilAgent[] },
  });

  const auClavier = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = ONGLETS.indexOf(onglet);
    const pas = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!pas) return;
    e.preventDefault();
    const suivant = ONGLETS[(i + pas + ONGLETS.length) % ONGLETS.length]!;
    setOnglet(suivant);
    document.getElementById(`onglet-${suivant}`)?.focus();
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" aria-hidden="true" /> {t("agentBureau.title")}
        </h1>
        <p className="text-muted-foreground mt-1">{t("agentBureau.subtitle")}</p>
      </div>

      <div role="tablist" aria-label={t("agentBureau.tabsLabel")} className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 w-fit">
        {ONGLETS.map((o) => (
          <button
            key={o}
            id={`onglet-${o}`}
            type="button"
            role="tab"
            aria-selected={onglet === o}
            aria-controls={`panneau-${o}`}
            tabIndex={onglet === o ? 0 : -1}
            onClick={() => setOnglet(o)}
            onKeyDown={auClavier}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${onglet === o ? "bg-background text-foreground shadow" : "text-muted-foreground"}`}
          >
            {t(`agentBureau.tabs.${o}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panneau-${onglet}`} aria-labelledby={`onglet-${onglet}`}>
        {onglet === "agents" && <OngletAgents etat={profils} />}
        {onglet === "flows" && (
          <section className="space-y-3">
            <p>{t("agentBureau.flowsIntro")}</p>
            {estResponsable ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><Link href="/studio-flux">{t("agentBureau.openFlows")}</Link></Button>
                <Button asChild variant="outline"><Link href="/automatisations">{t("agentBureau.openAutomations")}</Link></Button>
              </div>
            ) : (
              <p className="text-muted-foreground">{t("agentBureau.flowsAdminOnly")}</p>
            )}
          </section>
        )}
        {onglet === "runs" && (
          <section className="space-y-3">
            <p>{t("agentBureau.runsIntro")}</p>
            <Button asChild variant="outline"><Link href="/bureau-taches">{t("agentBureau.openRuns")}</Link></Button>
          </section>
        )}
        {onglet === "test" && <OngletTest profils={profils.data?.profils ?? []} estResponsable={estResponsable} />}
      </div>
    </div>
  );
}

function OngletAgents({ etat }: { etat: { data?: { profils: ProfilAgent[] }; isLoading: boolean; isError: boolean } }) {
  const { t } = useTranslation();
  if (etat.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}
      </div>
    );
  }
  if (etat.isError) return <p role="alert" className="text-destructive">{t("agentBureau.error")}</p>;
  return (
    <ul className="grid gap-4 md:grid-cols-2" aria-label={t("agentBureau.tabs.agents")}>
      {(etat.data?.profils ?? []).map((p) => (
        <li key={p.id}>
          <Card className="h-full" data-testid={`profil-${p.id}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg"><h2>{p.nom}</h2></CardTitle>
              <p className="text-sm text-muted-foreground">{p.mission}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant={p.active ? "default" : "outline"}>{p.active ? t("agentBureau.active") : t("agentBureau.inactive")}</Badge>
                {p.reserveResponsables && <Badge variant="outline">{t("agentBureau.reservedManagers")}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <section>
                <h3 className="font-semibold mb-1">{t("agentBureau.tools")}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {p.outils.map((o) => (
                    <li key={o.nom}>
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${PALIER_CLASSE[o.palier]}`}>
                        {o.nom}
                        <span className="sr-only">, </span>
                        <span className="opacity-80">({t(`agentsCatalogue.tier.${o.palier}`)})</span>
                        {(o.palier === "externe" || o.palier === "destructif") && (
                          <ShieldCheck className="h-3 w-3" aria-label={t("agentsCatalogue.needsApproval")} />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="font-semibold mb-1 flex items-center gap-1">
                  <UserRound className="h-4 w-4" aria-hidden="true" /> {t("agentBureau.handoff")} ({t(`agentBureau.handoffTo.${p.transfertHumain.cible}`)})
                </h3>
                <ul className="list-disc ps-5">
                  {p.transfertHumain.conditions.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </section>
              <section>
                <h3 className="font-semibold mb-1">{t("agentBureau.sources")}</h3>
                <p>
                  {t("agentBureau.knowledgeBase")} : {p.sources.baseConnaissances?.length ? p.sources.baseConnaissances.join(", ") : t("agentBureau.none")}
                </p>
                <p className="text-muted-foreground">{p.sources.donnees.join(" · ")}</p>
              </section>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function OngletTest({ profils, estResponsable }: { profils: ProfilAgent[]; estResponsable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [choix, setChoix] = useState<string>("");
  const profil = profils.find((p) => p.id === choix) ?? profils[0];
  const [entrees, setEntrees] = useState<Record<string, string>>({});
  const entree = profil ? (entrees[profil.id] ?? profil.exemple) : "";
  const [essaisReussis, setEssaisReussis] = useState<Record<string, true>>({});
  const [annonce, setAnnonce] = useState("");

  const essai = useMutation({
    mutationFn: async (v: { id: string; entree: string }) =>
      (await lireJson(await fetch(`${BASE}/api/ajans/profils/${v.id}/essai`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entree: v.entree }),
      }))) as { runId: number; actions: ActionEssai[]; reponse: string },
    onSuccess: (r, v) => {
      setEssaisReussis((s) => ({ ...s, [v.id]: true }));
      setAnnonce(t("agentBureau.test.done", { count: r.actions.length }));
    },
    onError: (e: Error) => setAnnonce(e.message),
  });

  const publication = useMutation({
    mutationFn: async (v: { id: string; action: "publier" | "desactiver" }) =>
      lireJson(await fetch(`${BASE}/api/ajans/profils/${v.id}/${v.action}`, { method: "POST", credentials: "include" })),
    onSuccess: (_r, v) => {
      setAnnonce(v.action === "publier" ? t("agentBureau.test.published") : t("agentBureau.test.disabled"));
      qc.invalidateQueries({ queryKey: ["ajans-profils"] });
    },
    onError: (e: Error) => setAnnonce(e.message),
  });

  if (!profil) return null;
  const essaiFait = Boolean(essaisReussis[profil.id] || profil.dernierEssai);
  const resultat = essai.data && essai.variables?.id === profil.id ? essai.data : null;

  return (
    <section className="space-y-4 max-w-3xl">
      <RegionAnnonce message={annonce} />
      <p>{t("agentBureau.test.intro")}</p>
      <div className="space-y-1">
        <label htmlFor="essai-profil" className="text-sm font-medium">{t("agentBureau.test.profile")}</label>
        <select
          id="essai-profil"
          className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={profil.id}
          onChange={(e) => setChoix(e.target.value)}
        >
          {profils.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="essai-entree" className="text-sm font-medium">{t("agentBureau.test.sample")}</label>
        <textarea
          id="essai-entree"
          className="block w-full min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
          value={entree}
          maxLength={4000}
          onChange={(e) => setEntrees((s) => ({ ...s, [profil.id]: e.target.value }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => essai.mutate({ id: profil.id, entree })} disabled={essai.isPending || !entree.trim()}>
          {essai.isPending ? t("agentBureau.test.running") : t("agentBureau.test.run")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => publication.mutate({ id: profil.id, action: "publier" })}
          disabled={!estResponsable || !essaiFait || publication.isPending}
          aria-describedby="essai-publication-aide"
        >
          {t("agentBureau.test.publish")}
        </Button>
        {profil.active && (
          <Button variant="outline" onClick={() => publication.mutate({ id: profil.id, action: "desactiver" })} disabled={!estResponsable || publication.isPending}>
            {t("agentBureau.test.disable")}
          </Button>
        )}
        <Badge variant={profil.active ? "default" : "outline"}>{profil.active ? t("agentBureau.active") : t("agentBureau.inactive")}</Badge>
      </div>
      <p id="essai-publication-aide" className="text-xs text-muted-foreground">
        {!estResponsable ? t("agentBureau.test.managersOnly") : !essaiFait ? t("agentBureau.test.publishHint") : ""}
      </p>
      {essai.isError && essai.variables?.id === profil.id && <p role="alert" className="text-destructive">{essai.error.message}</p>}
      {publication.isError && <p role="alert" className="text-destructive">{publication.error.message}</p>}

      {resultat && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base"><h2>{t("agentBureau.test.actions")}</h2></CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {resultat.actions.length === 0 ? (
              <p className="text-muted-foreground">{t("agentBureau.test.noActions")}</p>
            ) : (
              <ol className="space-y-2" aria-label={t("agentBureau.test.actions")}>
                {resultat.actions.map((a, i) => (
                  <li key={i} data-testid="action-essai" className="rounded border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code>{a.outil}</code>
                      {a.palier && <span className={`rounded px-2 py-0.5 text-xs ${PALIER_CLASSE[a.palier]}`}>{t(`agentsCatalogue.tier.${a.palier}`)}</span>}
                      <Badge variant={a.statut === "refusee" ? "destructive" : "outline"}>{t(`agentBureau.test.status.${a.statut}`)}</Badge>
                    </div>
                    {(a.resume || a.raison) && <p className="mt-1 text-muted-foreground">{a.resume ?? a.raison}</p>}
                  </li>
                ))}
              </ol>
            )}
            {resultat.reponse && (
              <div>
                <h3 className="font-semibold">{t("agentBureau.test.answer")}</h3>
                <p>{resultat.reponse}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
