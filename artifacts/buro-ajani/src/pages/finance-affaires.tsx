/**
 * LA COMPARAISON PAR AFFAIRE (plan du 29/09, section 8).
 * Donnees : GET /api/finance/affaires (services/dossier-chantier.ts).
 *
 * Une ligne par chantier : prix accepte, avenants accordes, depense reelle,
 * facture, encaisse — cote a cote. C'est le seul ecran d'ou l'on voit qu'un
 * chantier termine n'a jamais ete facture, ou qu'un autre coute plus qu'il ne
 * rapporte : aucun ecran ne mettait ces chiffres ensemble.
 *
 * Le tableau ne porte pas les justificatifs (illisibles sur une liste) : chaque
 * ligne mene au dossier du chantier, ou chaque montant ouvre ses lignes. C'est
 * la regle du plan : « Her finans rakamından kaynak kayda gidilebilmeli. »
 */
import { EtatEcran, depuisReponse, type Etat } from "@/components/etat-ecran";
import { argentSur } from "@/pages/dossier-chantier";
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

export type LigneComparaison = {
  id: number; baslik: string; durum: string; musteri: string | null; devise: string;
  teklif: number; ekIsler: number; onayliIs: number; gider: number; faturalanan: number; tahsilEdilen: number;
  marj: number; faturalanmayan: number; tahsilEdilmeyen: number; asim: boolean;
};

class ErreurHttp extends Error {
  constructor(public statut: number | null) { super(`HTTP ${statut}`); }
}

async function lire(): Promise<{ lignes: LigneComparaison[] }> {
  let r: Response;
  try { r = await fetch(`${API}/api/finance/affaires`, { credentials: "include" }); }
  catch { throw new ErreurHttp(null); }
  if (!r.ok) throw new ErreurHttp(r.status);
  return r.json();
}

type Filtre = "tous" | "asim" | "faturalanmayan" | "tahsilEdilmeyen";
const COLONNES = ["teklif", "ekIsler", "gider", "faturalanan", "tahsilEdilen", "marj"] as const;

export default function FinanceAffairesPage() {
  const { t, lang } = useTranslation();
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const q = useQuery<{ lignes: LigneComparaison[] }, ErreurHttp>({ queryKey: ["finance-affaires"], queryFn: lire, retry: (n, e) => n < 1 && e.statut === null });

  const argent = (n: number, devise: string) => argentSur(lang, n, devise);

  const lignes = useMemo(() => {
    const toutes = q.data?.lignes ?? [];
    switch (filtre) {
      case "asim": return toutes.filter((l) => l.asim);
      // « Reste a facturer » n'a de sens que sur un chantier dont un prix a ete accepte.
      case "faturalanmayan": return toutes.filter((l) => l.onayliIs > 0 && l.faturalanmayan > 0);
      case "tahsilEdilmeyen": return toutes.filter((l) => l.tahsilEdilmeyen > 0);
      default: return toutes;
    }
  }, [q.data, filtre]);

  let etat: Etat | null = null;
  if (q.isPending) etat = "chargement";
  else if (q.isError) etat = depuisReponse(q.error.statut);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6" data-testid="finance-affaires">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("financeAffaires.titre")}</h1>
        <p className="text-sm text-muted-foreground">{t("financeAffaires.sousTitre")}</p>
      </header>

      {etat ? <EtatEcran etat={etat} onReessayer={() => q.refetch()} /> : (
        <>
          <div role="group" aria-label={t("financeAffaires.filtres")} className="flex flex-wrap gap-2">
            {(["tous", "asim", "faturalanmayan", "tahsilEdilmeyen"] as Filtre[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filtre === f}
                onClick={() => setFiltre(f)}
                data-testid={`filtre-${f}`}
                className={`rounded-full border px-3 py-1 text-sm ${filtre === f ? "border-blue-700 bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200" : "hover:bg-muted"}`}
              >
                {t(`financeAffaires.filtre.${f}`)}
              </button>
            ))}
          </div>
          <p role="status" className="text-sm text-muted-foreground">{t("financeAffaires.compte", { count: lignes.length })}</p>

          {lignes.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="finance-vide">
              {t(`financeAffaires.vide.${filtre}`)}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[56rem] text-sm">
                <caption className="sr-only">{t("financeAffaires.titre")}</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">{t("financeAffaires.col.chantier")}</th>
                    {COLONNES.map((c) => (
                      <th key={c} scope="col" className="px-3 py-2 text-right font-medium">{t(`financeAffaires.col.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lignes.map((l) => (
                    <tr key={l.id} data-testid={`affaire-${l.id}`} className={l.asim ? "bg-red-50/60 dark:bg-red-950/20" : undefined}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <Link href={`/projets/${l.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">{l.baslik}</Link>
                        {l.musteri && <span className="block text-xs text-muted-foreground">{l.musteri}</span>}
                        {l.onayliIs === 0 && <span className="block text-xs text-muted-foreground">{t("financeAffaires.sansEngage")}</span>}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{argent(l.teklif, l.devise)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{argent(l.ekIsler, l.devise)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.asim ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>
                        {argent(l.gider, l.devise)}
                        {l.asim && <span className="sr-only"> — {t("financeAffaires.depasse")}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {argent(l.faturalanan, l.devise)}
                        {l.onayliIs > 0 && l.faturalanmayan > 0 && <span className="block text-xs text-muted-foreground">{t("financeAffaires.reste", { montant: argent(l.faturalanmayan, l.devise) })}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {argent(l.tahsilEdilen, l.devise)}
                        {l.tahsilEdilmeyen > 0 && <span className="block text-xs text-muted-foreground">{t("financeAffaires.reste", { montant: argent(l.tahsilEdilmeyen, l.devise) })}</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.marj < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{argent(l.marj, l.devise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("financeAffaires.note")}</p>
        </>
      )}
    </main>
  );
}
