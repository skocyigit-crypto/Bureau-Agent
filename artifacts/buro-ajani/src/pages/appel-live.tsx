/**
 * ECRAN D'UN APPEL EN DIRECT (/appels/live/:callSid).
 *
 * Trois colonnes : qui appelle et ce qu'on sait de lui | ce qui se dit, et ou
 * en est l'agent | ce que l'equipe peut faire (reprendre, transferer, rendez-vous
 * de decouverte, tache, note).
 *
 * Donnees : GET /api/appels-live/:callSid toutes les ~4 s (le SSE est propre a
 * une instance Cloud Run ; un tour traite par une autre instance n'y passerait
 * pas). La capacite de reprise vient du serveur, AVEC sa raison : sans
 * fournisseur telephonique, le bouton est desactive et dit pourquoi — jamais un
 * bouton qui semble marcher. Rien n'est invente : sans appel reel, rien ne
 * s'affiche comme « en direct ».
 */
import { EtatEcran, depuisReponse, type Etat } from "@/components/etat-ecran";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useParams } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

class ErreurHttp extends Error {
  constructor(public statut: number | null, public code: string | null = null, public raison: string | null = null) { super(code ?? ""); }
}

async function lire<T>(chemin: string): Promise<T> {
  let r: Response;
  try { r = await fetch(`${API}/api${chemin}`, { credentials: "include" }); } catch { throw new ErreurHttp(null); }
  if (!r.ok) throw new ErreurHttp(r.status);
  return r.json() as Promise<T>;
}
async function poster(chemin: string, corps: unknown) {
  let r: Response;
  try {
    r = await fetch(`${API}/api${chemin}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  } catch { throw new ErreurHttp(null); }
  const j = (await r.json().catch(() => ({}))) as { code?: string; raison?: string | null };
  if (!r.ok) throw new ErreurHttp(r.status, j.code ?? null, j.raison ?? null);
  return j;
}

type Detail = {
  callSid: string; status: string; enDirect: boolean; debut: string; derniereActivite: string;
  appelant: { nom: string | null; numero: string | null; contactId: number | null; appelsPrecedents: number; contexte: string };
  demande: string; tours: Array<{ role: "user" | "assistant"; texte: string }>; journal: string[]; etape: string | null;
  urgent: boolean; reprise: { statut: string | null; le: string | null; par: string | null };
};
type Cible = { id: string; libelle: string; numeroMasque: string };
type Capacite = { fournisseur: string | null; reprisePossible: boolean; raison: string | null; cibles: Cible[] };

function libelleCible(t: (k: string, v?: Record<string, unknown>) => string, c: Cible): string {
  if (c.id === "moi") return t("appelLive.targets.moi", { num: c.numeroMasque });
  if (c.id === "defaut") return t("appelLive.targets.defaut", { num: c.numeroMasque });
  return t("appelLive.targets.equipe", { nom: c.libelle, num: c.numeroMasque });
}

export function AppelLiveEcran({ callSid }: { callSid: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = `/appels-live/${encodeURIComponent(callSid)}`;
  const detail = useQuery<Detail, ErreurHttp>({
    queryKey: ["appel-live", callSid],
    queryFn: () => lire(base),
    refetchInterval: (q) => (q.state.data && !q.state.data.enDirect ? false : 4000),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const capacite = useQuery<Capacite, ErreurHttp>({ queryKey: ["appels-live-capacite"], queryFn: () => lire("/appels-live/capacite"), retry: false });

  if (detail.isPending || detail.isError) {
    const etat: Etat = detail.isPending ? "chargement" : depuisReponse(detail.error.statut);
    return (
      <div className="p-4">
        <Link href="/appels" className="text-sm underline">{t("appelLive.back")}</Link>
        {detail.isError && detail.error.statut === 404
          ? <p role="alert" className="mt-4" data-testid="appel-introuvable">{t("appelLive.notFound")}</p>
          : <EtatEcran etat={etat} onReessayer={() => detail.refetch()} />}
      </div>
    );
  }
  const d = detail.data;
  const rafraichir = () => { void qc.invalidateQueries({ queryKey: ["appel-live", callSid] }); void qc.invalidateQueries({ queryKey: ["appels-live"] }); };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/appels" className="text-sm underline">{t("appelLive.back")}</Link>
        <h1 className="text-xl font-semibold">{t("appelLive.title")}</h1>
        {d.enDirect && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-600 text-white px-2 py-0.5 text-xs font-semibold">
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-white animate-pulse motion-reduce:animate-none" />{t("appelLive.live")}
          </span>
        )}
        {d.urgent && <span className="rounded bg-orange-200 text-orange-900 px-2 py-0.5 text-xs font-semibold">{t("appelLive.urgent")}</span>}
      </div>
      {!d.enDirect && <p role="status" className="text-sm text-muted-foreground" data-testid="appel-termine">{t("appelLive.ended")}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <ColonneAppelant d={d} />
        <ColonneTranscription d={d} />
        <ColonneActions callSid={callSid} d={d} capacite={capacite.data ?? null} onFait={rafraichir} />
      </div>
    </div>
  );
}

function ColonneAppelant({ d }: { d: Detail }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="col-appelant" data-testid="colonne-appelant" className="rounded-lg border p-3 space-y-2">
      <h2 id="col-appelant" className="font-semibold">{t("appelLive.caller")}</h2>
      <p className="text-lg">{d.appelant.nom ?? t("appelLive.unknownCaller")}</p>
      {d.appelant.numero && <p className="text-sm tabular-nums">{d.appelant.numero}</p>}
      <p className="text-sm text-muted-foreground">{t("appelLive.previousCalls", { count: d.appelant.appelsPrecedents })}</p>
      {d.appelant.contactId != null && (
        <Link href={`/contacts/${d.appelant.contactId}`} className="text-sm underline">{t("appelLive.openContact")}</Link>
      )}
      {d.demande && (<><h3 className="text-sm font-semibold mt-2">{t("appelLive.request")}</h3><p className="text-sm">{d.demande}</p></>)}
      {d.appelant.contexte && (<><h3 className="text-sm font-semibold mt-2">{t("appelLive.context")}</h3><p className="text-sm whitespace-pre-line">{d.appelant.contexte}</p></>)}
    </section>
  );
}

function ColonneTranscription({ d }: { d: Detail }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="col-transcription" data-testid="colonne-transcription" className="rounded-lg border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="col-transcription" className="font-semibold">{t("appelLive.transcript")}</h2>
        {d.etape && (
          <span data-testid="etape-agent" className="rounded-full bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100 px-2 py-0.5 text-xs">
            {t("appelLive.step")} : {t(`appelLive.steps.${d.etape}`)}
          </span>
        )}
      </div>
      {d.tours.length === 0
        ? <p className="text-sm text-muted-foreground">{t("appelLive.emptyTranscript")}</p>
        : (
          <ol aria-live="polite" className="space-y-2" data-testid="transcription">
            {d.tours.map((tour, i) => (
              <li key={i} className={`rounded-md px-3 py-2 text-sm ${tour.role === "user" ? "bg-muted" : "bg-blue-50 dark:bg-blue-950"}`}>
                <span className="block text-xs font-semibold">{tour.role === "user" ? t("appelLive.roleUser") : t("appelLive.roleAssistant")}</span>
                {tour.texte}
              </li>
            ))}
          </ol>
        )}
      {d.journal.length > 0 && (
        <details>
          <summary className="text-sm font-semibold cursor-pointer">{t("appelLive.journal")}</summary>
          <ul className="mt-1 list-disc pl-5 text-sm">{d.journal.map((j, i) => <li key={i}>{j}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

function ColonneActions({ callSid, d, capacite, onFait }: { callSid: string; d: Detail; capacite: Capacite | null; onFait: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const base = `/appels-live/${encodeURIComponent(callSid)}`;
  const [cible, setCible] = useState("");
  const [titreTache, setTitreTache] = useState("");
  const [note, setNote] = useState("");
  const [debutRdv, setDebutRdv] = useState("");
  const [lieu, setLieu] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const raisonErreur = (e: unknown) => {
    const err = e as ErreurHttp;
    if (err.code) return t(`appelLive.reasons.${err.code}`, { raison: err.raison ?? "" });
    return t("appelLive.error");
  };
  const reprise = useMutation({
    mutationFn: (c: string) => poster(`${base}/devral`, { cible: c }) as Promise<{ cible?: Cible }>,
    onSuccess: (r) => { setMessage(t("appelLive.takeoverDone", { num: r.cible?.numeroMasque ?? "" })); onFait(); },
    onError: (e) => { setMessage(raisonErreur(e)); onFait(); },
  });
  const action = useMutation({
    mutationFn: ({ chemin, corps }: { chemin: string; corps: unknown }) => poster(`${base}/${chemin}`, corps),
    onSuccess: () => { setMessage(t("appelLive.saved")); onFait(); },
    onError: (e) => setMessage(raisonErreur(e)),
  });

  const cibles = capacite?.cibles ?? [];
  const dejaRepris = !!d.reprise.statut;
  // La raison du serveur d'abord ; sinon l'etat de l'appel.
  const raison = !capacite ? null
    : !capacite.reprisePossible ? t(`appelLive.reasons.${capacite.raison ?? "aucun_fournisseur"}`)
    : dejaRepris ? t("appelLive.reasons.deja_repris")
    : !d.enDirect ? t("appelLive.reasons.termine") : null;
  const repriseImpossible = !capacite || raison !== null || reprise.isPending;
  const cibleMoi = cibles.find((c) => c.id === "moi") ?? cibles[0];
  const cibleChoisie = cible || cibles.find((c) => c.id !== "moi")?.id || cibles[0]?.id || "";

  return (
    <section aria-labelledby="col-actions" data-testid="colonne-actions" className="rounded-lg border p-3 space-y-4">
      <h2 id="col-actions" className="font-semibold">{t("appelLive.actions")}</h2>

      <div className="space-y-2">
        <button
          type="button"
          className="w-full rounded-md bg-red-600 text-white px-3 py-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={repriseImpossible}
          aria-describedby={raison ? `${id}-raison` : undefined}
          onClick={() => cibleMoi && reprise.mutate(cibleMoi.id)}
          data-testid="bouton-devral"
        >
          {t("appelLive.takeover")}
        </button>
        {raison && <p id={`${id}-raison`} className="text-sm text-muted-foreground" data-testid="raison-reprise">{raison}</p>}
        {d.reprise.par && <p className="text-sm">{t("appelLive.takenOverBy", { name: d.reprise.par })}</p>}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label htmlFor={`${id}-cible`} className="text-xs block">{t("appelLive.target")}</label>
            <select id={`${id}-cible`} className="w-full rounded-md border bg-background px-2 py-1 text-sm" value={cibleChoisie} onChange={(e) => setCible(e.target.value)} disabled={repriseImpossible || cibles.length === 0}>
              {cibles.map((c) => <option key={c.id} value={c.id}>{libelleCible(t, c)}</option>)}
            </select>
          </div>
          <button type="button" className="rounded-md border px-3 py-1 text-sm disabled:opacity-50" disabled={repriseImpossible || !cibleChoisie} onClick={() => reprise.mutate(cibleChoisie)} data-testid="bouton-aktar">
            {t("appelLive.transfer")}
          </button>
        </div>
      </div>

      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (debutRdv) action.mutate({ chemin: "rdv-decouverte", corps: { debut: new Date(debutRdv).toISOString(), lieu } }); }}>
        <h3 className="text-sm font-semibold">{t("appelLive.discovery")}</h3>
        <label htmlFor={`${id}-rdv`} className="text-xs block">{t("appelLive.date")}</label>
        <input id={`${id}-rdv`} type="datetime-local" required className="w-full rounded-md border bg-background px-2 py-1 text-sm" value={debutRdv} onChange={(e) => setDebutRdv(e.target.value)} />
        <label htmlFor={`${id}-lieu`} className="text-xs block">{t("appelLive.location")}</label>
        <input id={`${id}-lieu`} className="w-full rounded-md border bg-background px-2 py-1 text-sm" value={lieu} onChange={(e) => setLieu(e.target.value)} />
        <button type="submit" className="rounded-md border px-3 py-1 text-sm" data-testid="bouton-rdv">{t("appelLive.create")}</button>
      </form>

      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (titreTache.trim()) action.mutate({ chemin: "tache", corps: { titre: titreTache.trim() } }); }}>
        <h3 className="text-sm font-semibold">{t("appelLive.task")}</h3>
        <label htmlFor={`${id}-tache`} className="text-xs block">{t("appelLive.taskTitle")}</label>
        <input id={`${id}-tache`} required className="w-full rounded-md border bg-background px-2 py-1 text-sm" value={titreTache} onChange={(e) => setTitreTache(e.target.value)} />
        <button type="submit" className="rounded-md border px-3 py-1 text-sm" data-testid="bouton-tache">{t("appelLive.create")}</button>
      </form>

      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (note.trim()) action.mutate({ chemin: "note", corps: { contenu: note.trim() } }); }}>
        <h3 className="text-sm font-semibold">{t("appelLive.note")}</h3>
        <label htmlFor={`${id}-note`} className="text-xs block">{t("appelLive.noteContent")}</label>
        <textarea id={`${id}-note`} required rows={3} className="w-full rounded-md border bg-background px-2 py-1 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="rounded-md border px-3 py-1 text-sm" data-testid="bouton-note">{t("appelLive.save")}</button>
      </form>

      {message && <p role="status" className="text-sm" data-testid="message-action">{message}</p>}
    </section>
  );
}

export default function AppelLivePage() {
  const params = useParams<{ callSid: string }>();
  return <AppelLiveEcran callSid={decodeURIComponent(params.callSid ?? "")} />;
}
