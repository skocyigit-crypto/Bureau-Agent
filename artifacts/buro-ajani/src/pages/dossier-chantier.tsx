/**
 * LE DOSSIER D'UN CHANTIER (plan du 29/09, section 6 — et section 8 pour les
 * montants). Donnees : GET /api/projets/:id/dossier (services/dossier-chantier.ts).
 *
 * « Her chantier kendi dosyası olmalı. » Avant cet ecran, un chantier etait une
 * carte dans une liste : pas d'URL a lui, pas de depenses, pas de factures, pas
 * d'appels — rien de ce qui s'y rattache n'etait rattachable.
 *
 * Trois regles tenues ici :
 *  - chaque montant ouvre les lignes qui le composent. Un total sans ses
 *    justificatifs est une affirmation ; avec, c'est une addition qu'on refait ;
 *  - les avenants se voient A PART, avec leur etat. Un supplement en attente
 *    d'accord est orange (decision humaine attendue) et ne compte pas dans
 *    l'engage : le plan interdit qu'un travail supplementaire se fonde dans le
 *    marche sans devis ni accord ;
 *  - un onglet vide dit qu'il est vide ; un echec de lecture dit que rien n'a
 *    ete lu. Les deux ne se confondent jamais (components/etat-ecran.tsx).
 */
import { EtatEcran, depuisReponse, type Etat } from "@/components/etat-ecran";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ChevronDown, FilePlus2, NotebookPen, Plus, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link, useRoute } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---- Contrat de GET /api/projets/:id/dossier -------------------------------

export type Source = { tur: string; id: number; baslik: string; detay: string | null; tutar: number; zaman: string | null; href: string };
export type Montant = { toplam: number; adet: number; kaynaklar: Source[]; fazlasi: boolean };
export type Montants = {
  devise: string;
  teklif: Montant; ekIsler: Montant; onayliIs: number;
  gider: Montant; faturalanan: Montant; tahsilEdilen: Montant;
  marj: number; faturalanmayan: number; tahsilEdilmeyen: number;
  asim: boolean; butcePrevision: number | null;
};
export type Avenant = { id: number; devisId: number; reference: string; motif: string; statut: string; tutar: number; zaman: string | null };
export type Dossier = {
  projet: {
    id: number; baslik: string; aciklama: string | null; durum: string; oncelik: string;
    musteri: string | null; adres: string | null; sorumlu: string | null;
    baslangic: string | null; bitis: string | null; gercekBitis: string | null;
    kabul: string | null; kabulCekinceli: boolean; cekinceler: string | null;
    ilerleme: number; devisId: number | null; prospectId: number | null; contactId: number | null;
  };
  montants: Montants;
  onglets: {
    ekip: { isim: string; rol: string | null; gorevAdedi: number }[];
    planning: { id: number; baslik: string; tur: string; baslangic: string; bitis: string; durum: string | null }[];
    gorevler: { id: number; baslik: string; durum: string; sorumlu: string | null; vade: string | null }[];
    gunluk: { id: number; jour: string; meteo: string | null; effectif: number | null; travaux: string; incidents: string | null; brouillon: boolean; yazan: string | null; fotoAdedi: number }[];
    belgeler: { id: number; isim: string; tur: string; boyut: number; kategori: string | null; zaman: string | null }[];
    gorusmeler: { id: number; kisi: string | null; numara: string; yon: string; durum: string; sure: number; not: string | null; zaman: string | null }[];
    avenantlar: Avenant[];
  };
};

/** Remplace a l'affichage par le libelle traduit de l'etat hors ligne. */
const HORS_LIGNE = "__hors_ligne__";

class ErreurHttp extends Error {
  constructor(public statut: number | null, message: string) { super(message); }
}

async function lire<T>(chemin: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API}/api${chemin}`, { credentials: "include" });
  } catch {
    throw new ErreurHttp(null, "reseau");
  }
  if (!r.ok) throw new ErreurHttp(r.status, `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function ecrire<T>(chemin: string, corps: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API}/api${chemin}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  } catch {
    // Le message brut du navigateur (« Failed to fetch ») n'est ni traduit ni utile.
    throw new ErreurHttp(null, HORS_LIGNE);
  }
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErreurHttp(r.status, (json as { error?: string }).error ?? `HTTP ${r.status}`);
  return json as T;
}

// ---- Petits utilitaires d'affichage -----------------------------------------

/** Une devise saisie librement peut ne pas etre un code ISO : on affiche le nombre plutot que de faire tomber l'ecran. */
export function argentSur(lang: string, n: number, devise: string): string {
  try { return new Intl.NumberFormat(lang, { style: "currency", currency: devise, maximumFractionDigits: 0 }).format(n); }
  catch { return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(n)} ${devise}`; }
}

function useFormat() {
  const { lang } = useTranslation();
  return {
    argent: (n: number, devise: string) => argentSur(lang, n, devise),
    date: (iso: string | null) => (iso ? new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—"),
    jour: (j: string) => new Intl.DateTimeFormat(lang, { weekday: "short", day: "2-digit", month: "short" }).format(new Date(`${j}T12:00:00`)),
    heure: (iso: string) => new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)),
  };
}

/** Couleurs de la charte : bleu = en cours, orange = attend une decision, rouge = erreur/depassement, vert = reellement termine. */
const TON_AVENANT: Record<string, string> = {
  brouillon: "border-l-orange-400",
  envoye: "border-l-orange-400",
  accepte: "border-l-emerald-600",
  refuse: "border-l-slate-300",
  expire: "border-l-slate-300",
};

// ---- Un montant qui ouvre ses lignes ----------------------------------------

function CarteMontant({ cle, montant, devise, ton = "neutre" }: {
  cle: string; montant: Montant; devise: string; ton?: "neutre" | "acil";
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const [ouvert, setOuvert] = useState(false);
  const id = useId();
  return (
    <div className={`rounded-lg border bg-card ${ton === "acil" ? "border-red-600" : ""}`} data-testid={`montant-${cle}`}>
      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={id}
        onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-start justify-between gap-2 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        <span>
          <span className="block text-xs font-medium text-muted-foreground">{t(`dossierChantier.montant.${cle}`)}</span>
          <span className={`block text-lg font-semibold tabular-nums ${ton === "acil" ? "text-red-700 dark:text-red-400" : ""}`}>
            {f.argent(montant.toplam, devise)}
          </span>
          <span className="block text-xs text-muted-foreground">{t("dossierChantier.lignes", { count: montant.adet })}</span>
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 transition-transform ${ouvert ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {ouvert && (
        <div id={id} className="border-t px-3 py-2">
          {montant.kaynaklar.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(`dossierChantier.aucuneSource.${cle}`)}</p>
          ) : (
            <ul className="divide-y">
              {montant.kaynaklar.map((k) => (
                <li key={`${k.tur}-${k.id}`}>
                  <Link href={k.href} className="flex items-baseline justify-between gap-2 py-1.5 text-sm hover:underline">
                    <span className="truncate">
                      <span className="font-medium">{k.baslik}</span>
                      {k.detay && <span className="text-muted-foreground"> · {k.detay}</span>}
                      {k.zaman && <span className="text-muted-foreground"> · {f.date(k.zaman)}</span>}
                    </span>
                    <span className="tabular-nums shrink-0">{f.argent(k.tutar, devise)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {montant.fazlasi && <p className="pt-1 text-xs text-muted-foreground">{t("dossierChantier.sourcesTronquees")}</p>}
        </div>
      )}
    </div>
  );
}

function BandeauMontants({ m }: { m: Montants }) {
  const { t } = useTranslation();
  const f = useFormat();
  return (
    <section aria-labelledby="titre-montants" className="flex flex-col gap-3">
      <h2 id="titre-montants" className="text-base font-semibold">{t("dossierChantier.titreMontants")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <CarteMontant cle="teklif" montant={m.teklif} devise={m.devise} />
        <CarteMontant cle="ekIsler" montant={m.ekIsler} devise={m.devise} />
        <CarteMontant cle="gider" montant={m.gider} devise={m.devise} ton={m.asim ? "acil" : "neutre"} />
        <CarteMontant cle="faturalanan" montant={m.faturalanan} devise={m.devise} />
        <CarteMontant cle="tahsilEdilen" montant={m.tahsilEdilen} devise={m.devise} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted-foreground">{t("dossierChantier.onayliIs")}</dt><dd className="font-semibold tabular-nums">{f.argent(m.onayliIs, m.devise)}</dd></div>
        <div><dt className="text-muted-foreground">{t("dossierChantier.marj")}</dt><dd className={`font-semibold tabular-nums ${m.marj < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{f.argent(m.marj, m.devise)}</dd></div>
        <div><dt className="text-muted-foreground">{t("dossierChantier.faturalanmayan")}</dt><dd className="font-semibold tabular-nums">{f.argent(m.faturalanmayan, m.devise)}</dd></div>
        <div><dt className="text-muted-foreground">{t("dossierChantier.tahsilEdilmeyen")}</dt><dd className="font-semibold tabular-nums">{f.argent(m.tahsilEdilmeyen, m.devise)}</dd></div>
      </dl>
      {m.asim && (
        <p role="alert" className="rounded-md border-l-4 border-l-red-600 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid="alerte-depassement">
          {t("dossierChantier.depassement", { montant: f.argent(m.gider.toplam - m.onayliIs, m.devise) })}
        </p>
      )}
      {m.onayliIs === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="sans-engage">{t("dossierChantier.sansEngage")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("dossierChantier.noteMarge")}</p>
    </section>
  );
}

// ---- Avenants ---------------------------------------------------------------

type LigneSaisie = { description: string; quantity: string; unitPrice: string; taxRate: string };
const LIGNE_VIDE: LigneSaisie = { description: "", quantity: "1", unitPrice: "", taxRate: "20" };

function FormulaireAvenant({ projetId, onFini }: { projetId: number; onFini: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [titre, setTitre] = useState("");
  const [motif, setMotif] = useState("");
  const [lignes, setLignes] = useState<LigneSaisie[]>([{ ...LIGNE_VIDE }]);
  const [erreur, setErreur] = useState<string | null>(null);
  const idTitre = useId(); const idMotif = useId();

  const envoi = useMutation({
    mutationFn: () => ecrire(`/projets/${projetId}/avenant`, {
      title: titre, motif,
      items: lignes.filter((l) => l.description.trim()).map((l) => {
        const q = Number(l.quantity.replace(",", ".")) || 0;
        const pu = Number(l.unitPrice.replace(",", ".")) || 0;
        return { description: l.description.trim(), quantity: q, unitPrice: pu, taxRate: Number(l.taxRate) || 0, total: q * pu };
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dossier-chantier", projetId] }); onFini(); },
    onError: (e: Error) => setErreur(e.message === HORS_LIGNE ? t("etatEcran.hors_ligne.titre") : e.message),
  });

  function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    envoi.mutate();
  }

  return (
    <form onSubmit={soumettre} className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="titre-form-avenant" data-testid="form-avenant">
      <h3 id="titre-form-avenant" className="text-base font-semibold">{t("dossierChantier.avenant.nouveau")}</h3>
      <p className="text-sm text-muted-foreground">{t("dossierChantier.avenant.explication")}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={idTitre} className="text-sm font-medium">{t("dossierChantier.avenant.titre")}</label>
        <input id={idTitre} required value={titre} onChange={(e) => setTitre(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={idMotif} className="text-sm font-medium">{t("dossierChantier.avenant.motif")}</label>
        <textarea id={idMotif} required value={motif} onChange={(e) => setMotif(e.target.value)} rows={2} className="rounded-md border bg-background px-3 py-2 text-sm" aria-describedby={`${idMotif}-aide`} />
        <p id={`${idMotif}-aide`} className="text-xs text-muted-foreground">{t("dossierChantier.avenant.motifAide")}</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("dossierChantier.avenant.lignes")}</legend>
        {lignes.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2" data-testid={`ligne-avenant-${i}`}>
            <input aria-label={t("dossierChantier.avenant.designation", { n: i + 1 })} value={l.description} onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className="col-span-12 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-6" />
            <input aria-label={t("dossierChantier.avenant.quantite", { n: i + 1 })} inputMode="decimal" value={l.quantity} onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="col-span-3 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-2" />
            <input aria-label={t("dossierChantier.avenant.prixUnitaire", { n: i + 1 })} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} className="col-span-5 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-2" />
            <input aria-label={t("dossierChantier.avenant.tva", { n: i + 1 })} inputMode="decimal" value={l.taxRate} onChange={(e) => setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, taxRate: e.target.value } : x)))} className="col-span-3 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-1" />
            <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} aria-label={t("dossierChantier.avenant.retirerLigne", { n: i + 1 })} className="col-span-1 inline-flex items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40" disabled={lignes.length === 1}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setLignes((ls) => [...ls, { ...LIGNE_VIDE }])} className="inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-sm hover:bg-muted">
          <Plus className="h-4 w-4" aria-hidden="true" /> {t("dossierChantier.avenant.ajouterLigne")}
        </button>
      </fieldset>
      {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{erreur}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={envoi.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {t("dossierChantier.avenant.creer")}
        </button>
        <button type="button" onClick={onFini} className="rounded-md border px-3 py-1.5 text-sm">{t("dossierChantier.annuler")}</button>
      </div>
    </form>
  );
}

function ListeAvenants({ avenants, devise }: { avenants: Avenant[]; devise: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (avenants.length === 0) return <p className="text-sm text-muted-foreground">{t("dossierChantier.avenant.aucun")}</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="liste-avenants">
      {avenants.map((a) => (
        <li key={a.id}>
          <Link href={`/devis?id=${a.devisId}`} className={`block rounded-r-md border-l-4 ${TON_AVENANT[a.statut] ?? "border-l-slate-300"} bg-card px-3 py-2 hover:bg-muted/60`} data-testid={`avenant-${a.id}`} data-statut={a.statut}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{a.reference}</span>
              <span className="text-sm tabular-nums">{f.argent(a.tutar, devise)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(`dossierChantier.avenant.statut.${a.statut}`)} · {a.motif}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---- Journal ----------------------------------------------------------------

function aujourdhui(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function FormulaireJournal({ projetId }: { projetId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [jour, setJour] = useState(aujourdhui());
  const [travaux, setTravaux] = useState("");
  const [meteo, setMeteo] = useState("");
  const [effectif, setEffectif] = useState("");
  const [incidents, setIncidents] = useState("");
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const ids = { jour: useId(), travaux: useId(), meteo: useId(), effectif: useId(), incidents: useId() };

  const envoi = useMutation({
    mutationFn: () => ecrire(`/projets/${projetId}/journal`, {
      jour, travaux, meteo: meteo || null, effectif: effectif === "" ? null : effectif, incidents: incidents || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dossier-chantier", projetId] });
      setAnnonce(t("dossierChantier.journal.enregistre"));
      setTravaux(""); setIncidents("");
    },
    onError: (e: Error) => setErreur(e.message === HORS_LIGNE ? t("etatEcran.hors_ligne.titre") : e.message),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setErreur(null); setAnnonce(null); envoi.mutate(); }}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      aria-labelledby="titre-form-journal"
      data-testid="form-journal"
    >
      <h3 id="titre-form-journal" className="text-base font-semibold">{t("dossierChantier.journal.nouvelle")}</h3>
      <p className="text-xs text-muted-foreground">{t("dossierChantier.journal.memeJour")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.jour} className="text-sm font-medium">{t("dossierChantier.journal.jour")}</label>
          <input id={ids.jour} type="date" required value={jour} onChange={(e) => setJour(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.meteo} className="text-sm font-medium">{t("dossierChantier.journal.meteo")}</label>
          <input id={ids.meteo} value={meteo} onChange={(e) => setMeteo(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.effectif} className="text-sm font-medium">{t("dossierChantier.journal.effectif")}</label>
          <input id={ids.effectif} inputMode="numeric" value={effectif} onChange={(e) => setEffectif(e.target.value.replace(/[^0-9]/g, ""))} className="rounded-md border bg-background px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.travaux} className="text-sm font-medium">{t("dossierChantier.journal.travaux")}</label>
        <textarea id={ids.travaux} required rows={3} value={travaux} onChange={(e) => setTravaux(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.incidents} className="text-sm font-medium">{t("dossierChantier.journal.incidents")}</label>
        <textarea id={ids.incidents} rows={2} value={incidents} onChange={(e) => setIncidents(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" />
      </div>
      {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{erreur}</p>}
      <p role="status" className="text-sm text-muted-foreground">{annonce}</p>
      <button type="submit" disabled={envoi.isPending} className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {t("dossierChantier.journal.enregistrer")}
      </button>
    </form>
  );
}

// ---- Onglets ----------------------------------------------------------------

function Vide({ cle }: { cle: string }) {
  const { t } = useTranslation();
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid={`vide-${cle}`}>{t(`dossierChantier.vide.${cle}`)}</p>;
}

const ONGLETS = ["ozet", "planning", "ekip", "gunluk", "belgeler", "giderler", "faturalar", "gorusmeler"] as const;

function Contenu({ d }: { d: Dossier }) {
  const { t } = useTranslation();
  const f = useFormat();
  const [formAvenant, setFormAvenant] = useState(false);
  const { projet, montants: m, onglets: o } = d;
  const enAttente = o.avenantlar.filter((a) => a.statut === "brouillon" || a.statut === "envoye");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href="/projets" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("dossierChantier.retourListe")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="titre-chantier">{projet.baslik}</h1>
            <p className="text-sm text-muted-foreground">
              {[projet.musteri, projet.adres, projet.sorumlu ? `${t("dossierChantier.sorumlu")} : ${projet.sorumlu}` : null].filter(Boolean).join(" · ")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(`dossierChantier.durum.${projet.durum}`)}{projet.baslangic || projet.bitis ? ` · ${f.date(projet.baslangic)} → ${f.date(projet.bitis)}` : ""}
            </p>
          </div>
          <button type="button" onClick={() => setFormAvenant(true)} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted" data-testid="ouvrir-avenant">
            <FilePlus2 className="h-4 w-4" aria-hidden="true" /> {t("dossierChantier.avenant.ouvrir")}
          </button>
        </div>
        {enAttente.length > 0 && (
          <p className="rounded-md border-l-4 border-l-orange-400 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-200" data-testid="avenants-en-attente">
            {t("dossierChantier.avenant.enAttente", { count: enAttente.length })}
          </p>
        )}
      </header>

      {formAvenant && <FormulaireAvenant projetId={projet.id} onFini={() => setFormAvenant(false)} />}

      <BandeauMontants m={m} />

      <Tabs defaultValue="ozet" className="flex flex-col gap-3">
        <TabsList className="h-auto flex-wrap justify-start" aria-label={t("dossierChantier.onglets")}>
          {ONGLETS.map((cle) => (
            <TabsTrigger key={cle} value={cle} data-testid={`onglet-${cle}`}>{t(`dossierChantier.onglet.${cle}`)}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ozet" className="flex flex-col gap-4">
          <section aria-labelledby="titre-avenants" className="flex flex-col gap-2">
            <h2 id="titre-avenants" className="text-base font-semibold">{t("dossierChantier.avenant.titreListe")}</h2>
            <ListeAvenants avenants={o.avenantlar} devise={m.devise} />
          </section>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("dossierChantier.kabul")}</dt><dd>{projet.kabul ? f.date(projet.kabul) : t("dossierChantier.kabulYok")}{projet.kabulCekinceli ? ` · ${t("dossierChantier.cekinceli")}` : ""}</dd></div>
            {projet.cekinceler && <div><dt className="text-muted-foreground">{t("dossierChantier.cekinceler")}</dt><dd>{projet.cekinceler}</dd></div>}
            {projet.devisId && <div><dt className="text-muted-foreground">{t("dossierChantier.devisInitial")}</dt><dd><Link href={`/devis?id=${projet.devisId}`} className="text-blue-700 hover:underline dark:text-blue-300">#{projet.devisId}</Link></dd></div>}
            {projet.aciklama && <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("dossierChantier.aciklama")}</dt><dd>{projet.aciklama}</dd></div>}
          </dl>
        </TabsContent>

        <TabsContent value="planning" className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t("dossierChantier.planning.creneaux")}</h2>
            {o.planning.length === 0 ? <Vide cle="planning" /> : (
              <ul className="divide-y rounded-lg border">
                {o.planning.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm">
                    <span><CalendarDays className="mr-1 inline h-4 w-4 text-muted-foreground" aria-hidden="true" />{c.baslik}</span>
                    <span className="tabular-nums text-muted-foreground">{f.heure(c.baslangic)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t("dossierChantier.planning.taches")}</h2>
            {o.gorevler.length === 0 ? <Vide cle="gorevler" /> : (
              <ul className="divide-y rounded-lg border">
                {o.gorevler.map((g) => (
                  <li key={g.id}>
                    <Link href={`/taches?id=${g.id}`} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                      <span>{g.baslik}{g.sorumlu ? <span className="text-muted-foreground"> · {g.sorumlu}</span> : null}</span>
                      <span className="text-muted-foreground">{g.vade ? f.date(g.vade) : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="ekip">
          {o.ekip.length === 0 ? <Vide cle="ekip" /> : (
            <ul className="divide-y rounded-lg border" data-testid="liste-ekip">
              {o.ekip.map((e) => (
                <li key={e.isim} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm">
                  <span>{e.isim}{e.rol ? <span className="text-muted-foreground"> · {t(`dossierChantier.rol.${e.rol}`)}</span> : null}</span>
                  <span className="text-muted-foreground">{t("dossierChantier.gorevAdedi", { count: e.gorevAdedi })}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="gunluk" className="flex flex-col gap-4">
          <FormulaireJournal projetId={projet.id} />
          {o.gunluk.length === 0 ? <Vide cle="gunluk" /> : (
            <ol className="flex flex-col gap-2" data-testid="liste-journal">
              {o.gunluk.map((n) => (
                <li key={n.id} className={`rounded-r-md border-l-4 ${n.brouillon ? "border-l-orange-400" : "border-l-slate-300"} bg-card px-3 py-2`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium"><NotebookPen className="mr-1 inline h-4 w-4 text-muted-foreground" aria-hidden="true" />{f.jour(n.jour)}</span>
                    <span className="text-xs text-muted-foreground">
                      {[n.meteo, n.effectif != null ? t("dossierChantier.journal.personnes", { count: n.effectif }) : null, n.yazan, n.fotoAdedi ? t("dossierChantier.journal.photos", { count: n.fotoAdedi }) : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <p className="whitespace-pre-line text-sm">{n.travaux}</p>
                  {n.incidents && <p className="text-sm text-red-700 dark:text-red-400">{t("dossierChantier.journal.incidentsCourts")} : {n.incidents}</p>}
                  {n.brouillon && <p className="text-xs text-orange-800 dark:text-orange-300">{t("dossierChantier.journal.brouillon")}</p>}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="belgeler">
          {o.belgeler.length === 0 ? <Vide cle="belgeler" /> : (
            <ul className="divide-y rounded-lg border">
              {o.belgeler.map((b) => (
                <li key={b.id}>
                  <Link href={`/documents?id=${b.id}`} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                    <span className="truncate">{b.isim}</span>
                    <span className="text-muted-foreground">{f.date(b.zaman)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="giderler">
          <CarteMontant cle="gider" montant={m.gider} devise={m.devise} ton={m.asim ? "acil" : "neutre"} />
        </TabsContent>

        <TabsContent value="faturalar" className="flex flex-col gap-3">
          <CarteMontant cle="faturalanan" montant={m.faturalanan} devise={m.devise} />
          <CarteMontant cle="tahsilEdilen" montant={m.tahsilEdilen} devise={m.devise} />
        </TabsContent>

        <TabsContent value="gorusmeler">
          {o.gorusmeler.length === 0 ? <Vide cle="gorusmeler" /> : (
            <ul className="divide-y rounded-lg border">
              {o.gorusmeler.map((c) => (
                <li key={c.id}>
                  <Link href={`/appels/${c.id}`} className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-muted/50">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{c.kisi ?? c.numara}</span>
                      <span className="text-muted-foreground">{c.zaman ? f.heure(c.zaman) : "—"}</span>
                    </span>
                    {c.not && <span className="truncate text-muted-foreground">{c.not}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DossierChantierPage() {
  const { t } = useTranslation();
  const [, params] = useRoute("/projets/:id");
  const id = Number.parseInt(params?.id ?? "", 10);
  const valide = Number.isFinite(id) && id > 0;

  const q = useQuery<Dossier, ErreurHttp>({
    queryKey: ["dossier-chantier", id],
    queryFn: () => lire<Dossier>(`/projets/${id}/dossier`),
    enabled: valide,
    retry: (n, e) => n < 1 && e.statut === null,
  });

  let etat: Etat | null = null;
  if (!valide) etat = "introuvable";
  else if (q.isPending) etat = "chargement";
  else if (q.isError) etat = depuisReponse(q.error.statut);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6" data-testid="dossier-chantier">
      {etat ? (
        <EtatEcran etat={etat} onReessayer={() => q.refetch()} retour={{ href: "/projets", libelle: t("dossierChantier.retourListe") }} />
      ) : (
        <Contenu d={q.data!} />
      )}
    </main>
  );
}
