/**
 * LE PLANNING EN TROIS VUES (plan du 29/09, section 7).
 * Donnees : GET /api/planning/{rendez-vous,equipe,travaux} (services/planning.ts).
 *
 * Une visite de devis et trois semaines de gros oeuvre ne sont pas le meme
 * objet : trois onglets, trois questions.
 *   - Rendez-vous : qui je vois et quand (creneaux sans chantier).
 *   - Plan d'equipe : qui fait quoi, et qui est pris deux fois (rouge).
 *   - Plan de travaux : les taches des chantiers, ce qu'elles attendent, et ce
 *     qui GLISSE quand l'une prend du retard (orange : une decision humaine
 *     est attendue — le glissement est propose, jamais ecrit).
 */
import { EtatEcran, depuisReponse, type Etat } from "@/components/etat-ecran";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
const JOUR = 86_400_000;

class ErreurHttp extends Error { constructor(public statut: number | null, m = "") { super(m); } }

async function lire<T>(chemin: string): Promise<T> {
  let r: Response;
  try { r = await fetch(`${API}/api${chemin}`, { credentials: "include" }); } catch { throw new ErreurHttp(null); }
  if (!r.ok) throw new ErreurHttp(r.status);
  return r.json() as Promise<T>;
}
async function ecrire(chemin: string, methode: "POST" | "DELETE", corps?: unknown) {
  const r = await fetch(`${API}/api${chemin}`, { method: methode, credentials: "include", headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErreurHttp(r.status, (j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j;
}

type RendezVous = { id: number; titre: string; type: string; debut: string; fin: string; lieu: string | null; contact: string | null };
type LigneEquipe = { personne: string; taches: Array<{ id: number; titre: string; debut: string | null; fin: string | null; projetId: number | null; chantier: string | null }>; conflits: Array<[number, number]> };
type TacheTravaux = { id: number; titre: string; statut: string; projetId: number | null; chantier: string | null; responsable: string | null; debut: string | null; fin: string | null; attend: Array<{ lienId: number; tacheId: number }>; glissementJours: number; debutAuPlusTot: string | null; causes: number[] };

function debutSemaine(d = new Date()): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const jour = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - jour * JOUR);
}

function useFormats() {
  const { lang } = useTranslation();
  return {
    jour: (iso: string) => new Intl.DateTimeFormat(lang, { weekday: "short", day: "2-digit", month: "short" }).format(new Date(iso)),
    heure: (iso: string) => new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)),
    date: (iso: string | null) => (iso ? new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short" }).format(new Date(iso)) : "—"),
  };
}

function Etat_({ q }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => void } }) {
  let etat: Etat | null = null;
  if (q.isPending) etat = "chargement";
  else if (q.isError) etat = depuisReponse((q.error as ErreurHttp).statut);
  return etat ? <EtatEcran etat={etat} onReessayer={() => q.refetch()} /> : null;
}

function VueRendezVous({ du, au }: { du: Date; au: Date }) {
  const { t } = useTranslation();
  const f = useFormats();
  const q = useQuery<{ rendezVous: RendezVous[] }, ErreurHttp>({
    queryKey: ["planning-rdv", du.toISOString()],
    queryFn: () => lire(`/planning/rendez-vous?du=${du.toISOString()}&au=${au.toISOString()}`),
  });
  const e = <Etat_ q={q} />;
  if (!q.data) return e;
  if (q.data.rendezVous.length === 0) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="rdv-vide">{t("planning.vide.rdv")}</p>;
  return (
    <ul className="divide-y rounded-lg border" data-testid="liste-rdv">
      {q.data.rendezVous.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
          <span><span className="font-medium">{r.titre}</span>{r.contact ? <span className="text-muted-foreground"> · {r.contact}</span> : null}{r.lieu ? <span className="text-muted-foreground"> · {r.lieu}</span> : null}</span>
          <span className="tabular-nums text-muted-foreground">{f.jour(r.debut)} {f.heure(r.debut)}–{f.heure(r.fin)}</span>
        </li>
      ))}
    </ul>
  );
}

function VueEquipe({ du, au }: { du: Date; au: Date }) {
  const { t } = useTranslation();
  const f = useFormats();
  const q = useQuery<{ equipe: LigneEquipe[] }, ErreurHttp>({
    queryKey: ["planning-equipe", du.toISOString()],
    queryFn: () => lire(`/planning/equipe?du=${du.toISOString()}&au=${au.toISOString()}`),
  });
  const e = <Etat_ q={q} />;
  if (!q.data) return e;
  if (q.data.equipe.length === 0) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="equipe-vide">{t("planning.vide.equipe")}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="liste-equipe">
      {q.data.equipe.map((p) => {
        const enConflit = new Set(p.conflits.flat());
        return (
          <section key={p.personne} className="rounded-lg border bg-card p-3" aria-label={p.personne} data-testid={`personne-${p.personne}`}>
            <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
              <span>{p.personne}</span>
              {p.conflits.length > 0 && <span className="text-xs font-medium text-red-700 dark:text-red-400" data-testid="conflit">{t("planning.conflits", { count: p.conflits.length })}</span>}
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              {p.taches.map((x) => (
                <li key={x.id} className={`rounded-r-md border-l-4 px-2 py-1 text-sm ${enConflit.has(x.id) ? "border-l-red-600 bg-red-50 dark:bg-red-950/30" : "border-l-blue-600"}`}>
                  <span className="font-medium">{x.titre}</span>
                  {x.chantier && x.projetId ? <> · <Link href={`/projets/${x.projetId}`} className="text-blue-700 hover:underline dark:text-blue-300">{x.chantier}</Link></> : null}
                  <span className="text-muted-foreground"> · {f.date(x.debut)} → {f.date(x.fin)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Ajouter une tache de chantier, avec ses dates : sans elle, le plan de travaux restait vide. */
function NouvelleTache({ onFini }: { onFini: () => void }) {
  const { t } = useTranslation();
  const ids = { chantier: useId(), titre: useId(), resp: useId(), debut: useId(), fin: useId() };
  const projets = useQuery<{ projets: Array<{ id: number; title: string; status: string }> }, ErreurHttp>({
    queryKey: ["planning-projets"], queryFn: () => lire("/projets?limit=200"),
  });
  const [v, setV] = useState({ projetId: "", titre: "", responsable: "", debut: "", fin: "" });
  const [erreur, setErreur] = useState<string | null>(null);
  const envoi = useMutation({
    mutationFn: () => ecrire("/planning/taches", "POST", {
      projetId: Number(v.projetId), titre: v.titre, responsable: v.responsable || null,
      debut: v.debut ? new Date(`${v.debut}T08:00:00`).toISOString() : null,
      fin: v.fin ? new Date(`${v.fin}T17:00:00`).toISOString() : null,
    }),
    onSuccess: () => { setV({ ...v, titre: "", debut: "", fin: "" }); onFini(); },
    onError: (e: Error) => setErreur(e.message),
  });
  const actifs = (projets.data?.projets ?? []).filter((p) => p.status !== "annule" && p.status !== "termine");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setErreur(null); envoi.mutate(); }}
      className="grid grid-cols-1 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-6"
      aria-label={t("planning.nouvelle.titre")}
      data-testid="form-tache"
    >
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={ids.chantier} className="text-xs font-medium">{t("planning.col.chantier")}</label>
        <select id={ids.chantier} required value={v.projetId} onChange={(e) => setV({ ...v, projetId: e.target.value })} className="rounded border bg-background px-2 py-1 text-sm">
          <option value="">—</option>
          {actifs.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={ids.titre} className="text-xs font-medium">{t("planning.col.tache")}</label>
        <input id={ids.titre} required value={v.titre} onChange={(e) => setV({ ...v, titre: e.target.value })} className="rounded border bg-background px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={ids.resp} className="text-xs font-medium">{t("planning.col.responsable")}</label>
        <input id={ids.resp} value={v.responsable} onChange={(e) => setV({ ...v, responsable: e.target.value })} className="rounded border bg-background px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={ids.debut} className="text-xs font-medium">{t("planning.nouvelle.debut")}</label>
        <input id={ids.debut} type="date" value={v.debut} onChange={(e) => setV({ ...v, debut: e.target.value })} className="rounded border bg-background px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor={ids.fin} className="text-xs font-medium">{t("planning.nouvelle.fin")}</label>
        <input id={ids.fin} type="date" value={v.fin} onChange={(e) => setV({ ...v, fin: e.target.value })} className="rounded border bg-background px-2 py-1 text-sm" />
      </div>
      <div className="flex items-end sm:col-span-2">
        <button type="submit" disabled={envoi.isPending} className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">{t("planning.nouvelle.ajouter")}</button>
      </div>
      {erreur && <p role="alert" className="text-sm text-red-700 sm:col-span-6">{erreur}</p>}
    </form>
  );
}

function VueTravaux() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const idSel = useId();
  const q = useQuery<{ taches: TacheTravaux[]; boucle: number[] | null }, ErreurHttp>({ queryKey: ["planning-travaux"], queryFn: () => lire("/planning/travaux") });
  const rafraichir = () => qc.invalidateQueries({ queryKey: ["planning-travaux"] });
  const lier = useMutation({ mutationFn: ({ id, dependDe }: { id: number; dependDe: number }) => ecrire(`/planning/taches/${id}/attend`, "POST", { dependDe }), onSuccess: rafraichir, onError: (e: Error) => setErreur(e.message) });
  const dater = useMutation({ mutationFn: ({ id, champ, valeur }: { id: number; champ: "debut" | "fin"; valeur: string }) => ecrire(`/planning/taches/${id}/dates`, "POST", { [champ]: valeur ? new Date(`${valeur}T08:00:00`).toISOString() : null }), onSuccess: rafraichir, onError: (e: Error) => setErreur(e.message) });
  const delier = useMutation({ mutationFn: (lienId: number) => ecrire(`/planning/liens/${lienId}`, "DELETE"), onSuccess: rafraichir, onError: (e: Error) => setErreur(e.message) });

  const parId = useMemo(() => new Map((q.data?.taches ?? []).map((x) => [x.id, x])), [q.data]);
  const e = <Etat_ q={q} />;
  if (!q.data) return e;
  const formulaire = <NouvelleTache onFini={rafraichir} />;
  if (q.data.taches.length === 0) return <div className="flex flex-col gap-3">{formulaire}<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="travaux-vide">{t("planning.vide.travaux")}</p></div>;
  const glissees = q.data.taches.filter((x) => x.glissementJours > 0);

  return (
    <div className="flex flex-col gap-3">
      {formulaire}
      {glissees.length > 0 && (
        <p role="status" className="rounded-md border-l-4 border-l-orange-400 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-200" data-testid="alerte-glissement">
          {t("planning.glissementResume", { count: glissees.length })}
        </p>
      )}
      {q.data.boucle && <p role="alert" className="text-sm text-red-700">{t("planning.boucle")}</p>}
      {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{erreur}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">{t("planning.onglet.travaux")}</caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {["tache", "chantier", "responsable", "dates", "attend", "glissement"].map((c) => <th key={c} scope="col" className="px-3 py-2 font-medium">{t(`planning.col.${c}`)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.data.taches.map((x) => (
              <tr key={x.id} data-testid={`tache-${x.id}`} className={x.glissementJours > 0 ? "bg-orange-50/60 dark:bg-orange-950/20" : undefined}>
                <th scope="row" className="px-3 py-2 text-left font-medium">{x.titre}</th>
                <td className="px-3 py-2">{x.projetId ? <Link href={`/projets/${x.projetId}`} className="text-blue-700 hover:underline dark:text-blue-300">{x.chantier}</Link> : "—"}</td>
                <td className="px-3 py-2">{x.responsable ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input type="date" aria-label={t("planning.debutDe", { tache: x.titre })} defaultValue={x.debut ? x.debut.slice(0, 10) : ""} onChange={(ev) => { setErreur(null); dater.mutate({ id: x.id, champ: "debut", valeur: ev.target.value }); }} className="rounded border bg-background px-1 py-0.5 text-xs" data-testid={`debut-${x.id}`} />
                    <span aria-hidden="true">→</span>
                    <input type="date" aria-label={t("planning.finDe", { tache: x.titre })} defaultValue={x.fin ? x.fin.slice(0, 10) : ""} onChange={(ev) => { setErreur(null); dater.mutate({ id: x.id, champ: "fin", valeur: ev.target.value }); }} className="rounded border bg-background px-1 py-0.5 text-xs" data-testid={`fin-${x.id}`} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {x.attend.map((a) => (
                      <span key={a.lienId} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                        <Link2 className="h-3 w-3" aria-hidden="true" />{parId.get(a.tacheId)?.titre ?? `#${a.tacheId}`}
                        <button type="button" onClick={() => delier.mutate(a.lienId)} aria-label={t("planning.retirerLien", { tache: parId.get(a.tacheId)?.titre ?? "" })} className="rounded hover:bg-muted"><X className="h-3 w-3" aria-hidden="true" /></button>
                      </span>
                    ))}
                    <label className="sr-only" htmlFor={`${idSel}-${x.id}`}>{t("planning.ajouterLien", { tache: x.titre })}</label>
                    <select
                      id={`${idSel}-${x.id}`}
                      value=""
                      onChange={(ev) => { setErreur(null); if (ev.target.value) lier.mutate({ id: x.id, dependDe: Number(ev.target.value) }); }}
                      className="rounded border bg-background px-1 py-0.5 text-xs"
                      data-testid={`lier-${x.id}`}
                    >
                      <option value="">{t("planning.attendre")}</option>
                      {q.data!.taches.filter((o) => o.id !== x.id && o.projetId === x.projetId && !x.attend.some((a) => a.tacheId === o.id)).map((o) => <option key={o.id} value={o.id}>{o.titre}</option>)}
                    </select>
                  </div>
                </td>
                <td className="px-3 py-2">
                  {x.glissementJours > 0
                    ? <span className="font-semibold text-orange-800 dark:text-orange-300" data-testid={`glisse-${x.id}`}>{t("planning.glisse", { count: x.glissementJours })}<span className="block text-xs font-normal text-muted-foreground">{t("planning.cause", { taches: x.causes.map((c) => parId.get(c)?.titre ?? `#${c}`).join(", ") })}</span></span>
                    : <span className="text-muted-foreground">{t("planning.tient")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("planning.notePropose")}</p>
    </div>
  );
}

export default function PlanningPage() {
  const { t } = useTranslation();
  const [semaine, setSemaine] = useState(() => debutSemaine());
  const du = semaine;
  const au = new Date(semaine.getTime() + 7 * JOUR);
  const f = useFormats();
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6" data-testid="planning">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("planning.titre")}</h1>
          <p className="text-sm text-muted-foreground">{t("planning.sousTitre")}</p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label={t("planning.semaine")}>
          <button type="button" className="rounded-md border px-2 py-1 text-sm hover:bg-muted" onClick={() => setSemaine(new Date(semaine.getTime() - 7 * JOUR))}>{t("planning.precedente")}</button>
          <span className="text-sm tabular-nums" data-testid="semaine">{f.date(du.toISOString())} – {f.date(new Date(au.getTime() - JOUR).toISOString())}</span>
          <button type="button" className="rounded-md border px-2 py-1 text-sm hover:bg-muted" onClick={() => setSemaine(new Date(semaine.getTime() + 7 * JOUR))}>{t("planning.suivante")}</button>
        </div>
      </header>
      <Tabs defaultValue="rdv" className="flex flex-col gap-3">
        <TabsList className="h-auto flex-wrap justify-start" aria-label={t("planning.titre")}>
          <TabsTrigger value="rdv" data-testid="onglet-rdv">{t("planning.onglet.rdv")}</TabsTrigger>
          <TabsTrigger value="equipe" data-testid="onglet-equipe">{t("planning.onglet.equipe")}</TabsTrigger>
          <TabsTrigger value="travaux" data-testid="onglet-travaux">{t("planning.onglet.travaux")}</TabsTrigger>
        </TabsList>
        <TabsContent value="rdv"><VueRendezVous du={du} au={au} /></TabsContent>
        <TabsContent value="equipe"><VueEquipe du={du} au={au} /></TabsContent>
        <TabsContent value="travaux"><VueTravaux /></TabsContent>
      </Tabs>
    </main>
  );
}
