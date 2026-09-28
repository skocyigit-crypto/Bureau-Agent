/**
 * Studio de flux : une automatisation dessinee — declencheur → agent →
 * condition → approbation → action — dans DEUX vues du meme flux :
 *
 *   - un canevas (React Flow) : glisser les etapes, les relier ;
 *   - une liste ordonnee, modifiable entierement au clavier avec des controles
 *     natifs (listes deroulantes, champs, boutons), qui porte tout ce que le
 *     canevas porte. Ce n'est pas une vue « de secours » : c'est la vue de
 *     reference, et chaque changement y est annonce (region aria-live).
 *
 * Le serveur valide le flux (un declencheur, pas de boucle, branches oui/non,
 * agents reserves aux demandes entrantes...) ; ses erreurs reviennent par
 * etape, s'affichent a cote d'elle et sont annoncees.
 */
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionAnnonce } from "@/components/region-annonce";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background, Controls, ReactFlow, applyNodeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from "@xyflow/react";
import { Loader2, Plus, Save, Trash2, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const TYPES_ETAPE = ["agent", "condition", "approbation", "action"] as const;
const AGENTS = ["classificateur", "agent-support", "agent-vente"] as const;
const OPERATEURS = ["egal", "different", "contient", "superieur", "inferieur", "vide", "non_vide"] as const;
const ACTIONS = ["send_notification", "create_task", "send_sms", "send_email"] as const;
const PARAMS_ACTION: Record<(typeof ACTIONS)[number], string[]> = {
  send_notification: ["title", "message"],
  create_task: ["title", "description", "priority"],
  send_sms: ["to", "message"],
  send_email: ["to", "subject", "body"],
};
const CHAMPS_SUGGERES = [
  "agent.type", "agent.confiance", "element.canal", "element.sujet", "element.contenu", "element.email",
  "element.priority", "element.title", "element.status", "element.phoneNumber",
];
const DEMANDE = "nouvelle_demande";

type Noeud =
  | { id: string; type: "declencheur"; position?: { x: number; y: number } }
  | { id: string; type: "agent"; agent: (typeof AGENTS)[number]; position?: { x: number; y: number } }
  | { id: string; type: "condition"; champ: string; operateur: (typeof OPERATEURS)[number]; valeur?: string | number; position?: { x: number; y: number } }
  | { id: string; type: "approbation"; position?: { x: number; y: number } }
  | { id: string; type: "action"; action: { type: (typeof ACTIONS)[number]; params?: Record<string, string | number | boolean> }; position?: { x: number; y: number } };
type Lien = { de: string; vers: string; branche?: "oui" | "non" };
export type Flux = { noeuds: Noeud[]; liens: Lien[] };
type ErreurFlux = { noeud?: string; message: string };
interface Regle { id: number; name: string; trigger: string; enabled: boolean; builtIn?: boolean; flux?: Flux }

class ErreurValidation extends Error {
  constructor(message: string, public erreurs: ErreurFlux[]) { super(message); }
}

async function api<T>(chemin: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${chemin}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const corps = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErreurValidation(corps.error || `HTTP ${r.status}`, Array.isArray(corps.erreurs) ? corps.erreurs : []);
  return corps as T;
}

/** Ordre de lecture : topologique quand c'est possible, sinon l'ordre de saisie. */
function ordreLecture(flux: Flux): Noeud[] {
  const entrants = new Map(flux.noeuds.map((n) => [n.id, 0]));
  for (const l of flux.liens) entrants.set(l.vers, (entrants.get(l.vers) ?? 0) + 1);
  const file = flux.noeuds.filter((n) => n.type === "declencheur" || (entrants.get(n.id) ?? 0) === 0).map((n) => n.id);
  const vu = new Set<string>();
  const ordre: string[] = [];
  while (file.length) {
    const id = file.shift()!;
    if (vu.has(id)) continue;
    vu.add(id);
    ordre.push(id);
    for (const l of flux.liens.filter((x) => x.de === id)) {
      const reste = (entrants.get(l.vers) ?? 0) - 1;
      entrants.set(l.vers, reste);
      if (reste <= 0) file.push(l.vers);
    }
  }
  const parId = new Map(flux.noeuds.map((n) => [n.id, n]));
  return [...ordre.map((id) => parId.get(id)!), ...flux.noeuds.filter((n) => !vu.has(n.id))];
}

function nouvelId(flux: Flux, type: string): string {
  let i = 1;
  while (flux.noeuds.some((n) => n.id === `${type}-${i}`)) i++;
  return `${type}-${i}`;
}

function etapeParDefaut(type: (typeof TYPES_ETAPE)[number], id: string, y: number): Noeud {
  const position = { x: 0, y };
  switch (type) {
    case "agent": return { id, type, agent: "classificateur", position };
    case "condition": return { id, type, champ: "agent.type", operateur: "egal", valeur: "", position };
    case "approbation": return { id, type, position };
    case "action": return { id, type, action: { type: "send_notification", params: { title: "", message: "" } }, position };
  }
}

export default function StudioFluxPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [choix, setChoix] = useState<string>("");
  const [flux, setFlux] = useState<Flux | null>(null);
  const [nom, setNom] = useState("");
  const [typeAjout, setTypeAjout] = useState<(typeof TYPES_ETAPE)[number]>("action");
  const [erreurs, setErreurs] = useState<ErreurFlux[]>([]);
  const [annonce, setAnnonce] = useState({ message: "", urgent: false });
  const dire = (message: string, urgent = false) => setAnnonce({ message, urgent });

  const regles = useQuery({
    queryKey: ["automations-studio"],
    queryFn: () => api<{ rules: Regle[] }>("/automations"),
  });
  const modele = useQuery({
    queryKey: ["automations-modele-demande"],
    queryFn: () => api<{ flux: Flux }>("/automations/flux/modele-demande"),
  });
  const personnalisees = useMemo(() => (regles.data?.rules ?? []).filter((r) => !r.builtIn && r.id > 0), [regles.data]);
  const regleChoisie = personnalisees.find((r) => String(r.id) === choix) ?? null;
  const declencheur = choix === "nouvelle" ? DEMANDE : regleChoisie?.trigger ?? "";

  const charger = (valeur: string) => {
    setChoix(valeur);
    setErreurs([]);
    if (valeur === "nouvelle") {
      const f = modele.data?.flux ?? null;
      setFlux(f ? JSON.parse(JSON.stringify(f)) as Flux : null);
      setNom(t("studioFlux.nomParDefaut"));
      if (f) dire(t("studioFlux.annonce.chargee", { n: f.noeuds.length }));
      return;
    }
    const r = personnalisees.find((x) => String(x.id) === valeur);
    setFlux(r?.flux ? JSON.parse(JSON.stringify(r.flux)) as Flux : null);
    if (r?.flux) dire(t("studioFlux.annonce.chargee", { n: r.flux.noeuds.length }));
  };

  // Premiere automatisation choisie d'office quand la liste arrive.
  useEffect(() => {
    if (!choix && personnalisees.length) charger(String(personnalisees[0]!.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personnalisees.length]);

  const enregistrer = useMutation({
    mutationFn: async () => {
      if (!flux) throw new Error("flux absent");
      if (choix === "nouvelle") {
        return api<Regle>("/automations", {
          method: "POST",
          body: JSON.stringify({ name: nom.trim() || t("studioFlux.nomParDefaut"), type: "custom", trigger: DEMANDE, flow: flux }),
        });
      }
      return api<Regle>(`/automations/${choix}`, { method: "PATCH", body: JSON.stringify({ flow: flux }) });
    },
    onSuccess: (r) => {
      setErreurs([]);
      dire(t("studioFlux.annonce.enregistre"));
      void qc.invalidateQueries({ queryKey: ["automations-studio"] });
      if (choix === "nouvelle" && r?.id) setChoix(String(r.id));
    },
    onError: (e: Error) => {
      if (e instanceof ErreurValidation && e.erreurs.length) {
        setErreurs(e.erreurs);
        dire(t("studioFlux.annonce.invalide", { count: e.erreurs.length }), true);
      } else {
        dire(t("studioFlux.annonce.erreur", { raison: e.message }), true);
      }
    },
  });

  // ── Modifications du flux (communes aux deux vues) ──────────────────────
  const maj = (f: (x: Flux) => Flux) => setFlux((x) => (x ? f(x) : x));
  const modifierNoeud = (id: string, patch: Partial<Noeud>) =>
    maj((x) => ({ ...x, noeuds: x.noeuds.map((n) => (n.id === id ? ({ ...n, ...patch } as Noeud) : n)) }));
  const ajouterEtape = () => {
    if (!flux) return;
    const id = nouvelId(flux, typeAjout);
    maj((x) => ({ ...x, noeuds: [...x.noeuds, etapeParDefaut(typeAjout, id, x.noeuds.length * 120)] }));
    dire(t("studioFlux.annonce.ajoutee", { type: t(`studioFlux.types.${typeAjout}`) }));
  };
  const supprimerEtape = (id: string) => {
    maj((x) => ({ noeuds: x.noeuds.filter((n) => n.id !== id), liens: x.liens.filter((l) => l.de !== id && l.vers !== id) }));
    dire(t("studioFlux.annonce.supprimee"));
  };
  /** Pose (ou retire, avec vers = "") le lien sortant d'une etape pour une branche donnee. */
  const poserSuite = (de: string, vers: string, branche?: "oui" | "non", ancien?: string) => {
    maj((x) => {
      let liens = x.liens.filter((l) => !(l.de === de && (branche ? l.branche === branche : l.vers === ancien)));
      if (vers && vers !== de && !liens.some((l) => l.de === de && l.vers === vers)) liens = [...liens, { de, vers, ...(branche ? { branche } : {}) }];
      return { ...x, liens };
    });
    dire(vers ? t("studioFlux.annonce.lien") : t("studioFlux.annonce.lienRetire"));
  };

  // ── Canevas ─────────────────────────────────────────────────────────────
  const libelle = (n: Noeud): string => {
    switch (n.type) {
      case "declencheur": return t("studioFlux.types.declencheur");
      case "agent": return `${t("studioFlux.types.agent")} : ${t(`studioFlux.agents.${n.agent}`)}`;
      case "condition": return `${n.champ} ${t(`studioFlux.operateurs.${n.operateur}`)} ${n.valeur ?? ""}`.trim();
      case "approbation": return t("studioFlux.types.approbation");
      case "action": return t(`studioFlux.actions.${n.action.type}`);
    }
  };
  const noeudsRf: Node[] = (flux?.noeuds ?? []).map((n, i) => ({
    id: n.id, position: n.position ?? { x: 0, y: i * 120 }, data: { label: libelle(n) },
    deletable: n.type !== "declencheur",
    className: erreurs.some((e) => e.noeud === n.id) ? "!border-red-500 !border-2" : undefined,
  }));
  const liensRf: Edge[] = (flux?.liens ?? []).map((l) => ({
    id: `${l.de}>${l.vers}`, source: l.de, target: l.vers,
    label: l.branche ? t(`studioFlux.${l.branche === "oui" ? "siOui" : "siNon"}`) : undefined,
  }));
  const surNoeuds = (changes: NodeChange[]) => {
    const suppr = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
    maj((x) => {
      const deplaces = applyNodeChanges(changes.filter((c) => c.type === "position"), noeudsRf);
      const pos = new Map(deplaces.map((n) => [n.id, n.position]));
      return {
        noeuds: x.noeuds.filter((n) => n.type === "declencheur" || !suppr.includes(n.id)).map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })),
        liens: x.liens.filter((l) => !suppr.includes(l.de) && !suppr.includes(l.vers)),
      };
    });
    if (suppr.length) dire(t("studioFlux.annonce.supprimee"));
  };
  const surLiens = (changes: EdgeChange[]) => {
    const suppr = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
    if (!suppr.length) return;
    maj((x) => ({ ...x, liens: x.liens.filter((l) => !suppr.includes(`${l.de}>${l.vers}`)) }));
    dire(t("studioFlux.annonce.lienRetire"));
  };
  const surConnexion = (c: Connection) => {
    if (!flux || !c.source || !c.target || c.source === c.target) return;
    const source = flux.noeuds.find((n) => n.id === c.source);
    if (source?.type === "condition") {
      const aOui = flux.liens.some((l) => l.de === c.source && l.branche === "oui");
      poserSuite(c.source, c.target, aOui ? "non" : "oui");
    } else {
      poserSuite(c.source, c.target);
    }
  };

  // ── Rendu ───────────────────────────────────────────────────────────────
  const ordre = flux ? ordreLecture(flux) : [];
  const erreursDe = (id?: string) => erreurs.filter((e) => e.noeud === id);
  const cibles = (de: string) => ordre.filter((n) => n.id !== de && n.type !== "declencheur");

  return (
    <div className="space-y-4 p-4 md:p-6">
      <RegionAnnonce message={annonce.message} urgent={annonce.urgent} />
      <div className="flex items-center gap-2">
        <Workflow className="h-5 w-5 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t("studioFlux.title")}</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">{t("studioFlux.subtitle")}</p>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="studio-regle">{t("studioFlux.regle")}</Label>
            <select
              id="studio-regle" value={choix} onChange={(e) => charger(e.target.value)}
              className="flex h-9 min-w-64 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="" disabled>{t("studioFlux.choisir")}</option>
              {personnalisees.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
              <option value="nouvelle">{t("studioFlux.nouvelleDemande")}</option>
            </select>
          </div>
          {choix === "nouvelle" && (
            <div className="space-y-1">
              <Label htmlFor="studio-nom">{t("studioFlux.nomNouveau")}</Label>
              <Input id="studio-nom" value={nom} onChange={(e) => setNom(e.target.value)} className="w-64" />
            </div>
          )}
          <Button onClick={() => enregistrer.mutate()} disabled={!flux || enregistrer.isPending}>
            {enregistrer.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : <Save className="h-4 w-4 mr-2" aria-hidden="true" />}
            {enregistrer.isPending ? t("studioFlux.enregistrement") : t("studioFlux.enregistrer")}
          </Button>
        </CardContent>
      </Card>

      {regles.isLoading && <Skeleton className="h-64 w-full" />}
      {!regles.isLoading && !personnalisees.length && choix !== "nouvelle" && (
        <p className="text-sm text-muted-foreground">{t("studioFlux.aucune")}</p>
      )}

      {erreurs.some((e) => !e.noeud) && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-medium">{t("studioFlux.erreurGlobale")}</p>
          <ul className="list-disc pl-5">{erreurs.filter((e) => !e.noeud).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </div>
      )}

      {flux && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("studioFlux.canvas")}</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">{t("studioFlux.canvasAide")}</p>
              <div className="h-[520px] rounded-md border" role="region" aria-label={t("studioFlux.canvas")}>
                <ReactFlow
                  nodes={noeudsRf} edges={liensRf}
                  onNodesChange={surNoeuds} onEdgesChange={surLiens} onConnect={surConnexion}
                  fitView deleteKeyCode={["Delete", "Backspace"]}
                >
                  <Background />
                  <Controls />
                </ReactFlow>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base" id="studio-liste-titre">{t("studioFlux.liste")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <ol className="space-y-3" aria-labelledby="studio-liste-titre">
                {ordre.map((n, i) => {
                  const titreId = `etape-${n.id}-titre`;
                  const errId = `etape-${n.id}-erreurs`;
                  const errs = erreursDe(n.id);
                  const sortants = flux.liens.filter((l) => l.de === n.id);
                  return (
                    <li key={n.id} aria-labelledby={titreId} aria-describedby={errs.length ? errId : undefined}
                      className={`rounded-md border p-3 space-y-2 ${errs.length ? "border-red-400" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 id={titreId} className="text-sm font-medium">{t("studioFlux.etape", { n: i + 1, type: t(`studioFlux.types.${n.type}`) })}</h3>
                        {n.type !== "declencheur" && (
                          <Button variant="ghost" size="sm" onClick={() => supprimerEtape(n.id)} aria-label={`${t("studioFlux.supprimer")} — ${t("studioFlux.etape", { n: i + 1, type: t(`studioFlux.types.${n.type}`) })}`}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>

                      {n.type === "declencheur" && (
                        <p className="text-xs text-muted-foreground">{t(declencheur === DEMANDE ? "studioFlux.declencheurDemande" : "studioFlux.declencheurRegle")}</p>
                      )}
                      {n.type === "approbation" && <p className="text-xs text-muted-foreground">{t("studioFlux.approbationInfo")}</p>}
                      {n.type === "agent" && (
                        <div className="space-y-1">
                          <Label htmlFor={`${n.id}-agent`} className="text-xs">{t("studioFlux.agentChoisi")}</Label>
                          <select id={`${n.id}-agent`} value={n.agent} onChange={(e) => modifierNoeud(n.id, { agent: e.target.value as (typeof AGENTS)[number] })}
                            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                            {AGENTS.map((a) => <option key={a} value={a}>{t(`studioFlux.agents.${a}`)}</option>)}
                          </select>
                        </div>
                      )}
                      {n.type === "condition" && (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label htmlFor={`${n.id}-champ`} className="text-xs">{t("studioFlux.champ")}</Label>
                            <Input id={`${n.id}-champ`} list="studio-champs" value={n.champ} onChange={(e) => modifierNoeud(n.id, { champ: e.target.value })} className="h-8" />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`${n.id}-op`} className="text-xs">{t("studioFlux.operateur")}</Label>
                            <select id={`${n.id}-op`} value={n.operateur} onChange={(e) => modifierNoeud(n.id, { operateur: e.target.value as (typeof OPERATEURS)[number] })}
                              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                              {OPERATEURS.map((o) => <option key={o} value={o}>{t(`studioFlux.operateurs.${o}`)}</option>)}
                            </select>
                          </div>
                          {n.operateur !== "vide" && n.operateur !== "non_vide" && (
                            <div className="space-y-1">
                              <Label htmlFor={`${n.id}-valeur`} className="text-xs">{t("studioFlux.valeur")}</Label>
                              <Input id={`${n.id}-valeur`} value={String(n.valeur ?? "")} onChange={(e) => modifierNoeud(n.id, { valeur: e.target.value })} className="h-8" />
                            </div>
                          )}
                        </div>
                      )}
                      {n.type === "action" && (
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label htmlFor={`${n.id}-action`} className="text-xs">{t("studioFlux.actionChoisie")}</Label>
                            <select id={`${n.id}-action`} value={n.action.type}
                              onChange={(e) => modifierNoeud(n.id, { action: { type: e.target.value as (typeof ACTIONS)[number], params: {} } })}
                              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                              {ACTIONS.map((a) => <option key={a} value={a}>{t(`studioFlux.actions.${a}`)}</option>)}
                            </select>
                          </div>
                          {PARAMS_ACTION[n.action.type].map((p) => (
                            <div key={p} className="space-y-1">
                              <Label htmlFor={`${n.id}-${p}`} className="text-xs">{t(`studioFlux.param.${p}`)}</Label>
                              {p === "priority" ? (
                                <select id={`${n.id}-${p}`} value={String(n.action.params?.[p] ?? "moyenne")}
                                  onChange={(e) => modifierNoeud(n.id, { action: { ...n.action, params: { ...n.action.params, [p]: e.target.value } } })}
                                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                                  {["haute", "moyenne", "basse"].map((v) => <option key={v} value={v}>{t(`studioFlux.priorites.${v}`)}</option>)}
                                </select>
                              ) : (
                                <Input id={`${n.id}-${p}`} value={String(n.action.params?.[p] ?? "")} className="h-8"
                                  onChange={(e) => modifierNoeud(n.id, { action: { ...n.action, params: { ...n.action.params, [p]: e.target.value } } })} />
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Suites : ce qui vient apres cette etape */}
                      {n.type === "condition" ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(["oui", "non"] as const).map((b) => {
                            const actuel = sortants.find((l) => l.branche === b)?.vers ?? "";
                            return (
                              <div key={b} className="space-y-1">
                                <Label htmlFor={`${n.id}-${b}`} className="text-xs">{t(b === "oui" ? "studioFlux.siOui" : "studioFlux.siNon")}</Label>
                                <select id={`${n.id}-${b}`} value={actuel} onChange={(e) => poserSuite(n.id, e.target.value, b)}
                                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                                  <option value="">{t("studioFlux.fin")}</option>
                                  {cibles(n.id).map((c) => <option key={c.id} value={c.id}>{libelle(c)} ({c.id})</option>)}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {[...sortants, { de: n.id, vers: "" } as Lien].map((l, k) => (
                            <div key={`${l.vers}-${k}`} className="space-y-1">
                              <Label htmlFor={`${n.id}-suite-${k}`} className="text-xs">{k === 0 ? t("studioFlux.ensuite") : t("studioFlux.ajouterSuite")}</Label>
                              <select id={`${n.id}-suite-${k}`} value={l.vers} onChange={(e) => poserSuite(n.id, e.target.value, undefined, l.vers || undefined)}
                                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                                <option value="">{t("studioFlux.fin")}</option>
                                {cibles(n.id).map((c) => <option key={c.id} value={c.id}>{libelle(c)} ({c.id})</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}

                      {errs.length > 0 && (
                        <ul id={errId} className="list-disc pl-5 text-xs text-red-700 dark:text-red-300">
                          {errs.map((e, k) => <li key={k}>{e.message}</li>)}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>

              <datalist id="studio-champs">{CHAMPS_SUGGERES.map((c) => <option key={c} value={c} />)}</datalist>

              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="space-y-1">
                  <Label htmlFor="studio-type-ajout" className="text-xs">{t("studioFlux.typeAjout")}</Label>
                  <select id="studio-type-ajout" value={typeAjout} onChange={(e) => setTypeAjout(e.target.value as (typeof TYPES_ETAPE)[number])}
                    className="flex h-9 rounded-md border border-input bg-background px-2 text-sm">
                    {TYPES_ETAPE.map((ty) => <option key={ty} value={ty}>{t(`studioFlux.types.${ty}`)}</option>)}
                  </select>
                </div>
                <Button variant="outline" onClick={ajouterEtape}>
                  <Plus className="h-4 w-4 mr-1" aria-hidden="true" />{t("studioFlux.ajouter")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
