/**
 * L'enregistrement vise par `?id=` dans l'adresse, affiche en tete de page.
 *
 * Le dossier de chantier, la comparaison par affaire et « Aujourd'hui » menent a
 * `/devis?id=12`, `/factures?id=7`... Ces pages sont des listes paginees : elles
 * ignoraient `?id=`, et la ligne visee pouvait ne pas figurer sur la page
 * affichee. Le lien « ouvre la source » menait donc a une liste ou la source
 * etait introuvable (revue du 30/09, domaine ekran-api).
 *
 * Ici on lit l'enregistrement par son numero et on le montre, quelle que soit
 * la page de la liste. Un numero inconnu le dit, au lieu de ne rien afficher.
 */
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

export type Ressource = "devis" | "facture" | "depense" | "document";

const CHEMIN: Record<Ressource, string> = {
  devis: "/devis",
  facture: "/factures-client",
  depense: "/depenses",
  document: "/documents",
};

type Ligne = Record<string, unknown>;

/** Le numero demande par l'adresse, ou null. */
export function idDansAdresse(recherche: string = typeof window === "undefined" ? "" : window.location.search): number | null {
  const brut = new URLSearchParams(recherche).get("id");
  if (!brut || !/^[0-9]+$/.test(brut)) return null;
  const n = Number(brut);
  return n > 0 ? n : null;
}

function montant(v: unknown, devise: unknown, lang: string): string | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return null;
  try { return new Intl.NumberFormat(lang, { style: "currency", currency: String(devise || "EUR") }).format(n); }
  catch { return `${n} ${String(devise ?? "")}`; }
}

/**
 * Sans `?id=`, rien : ni lecture, ni kanca. La plupart des visites de ces listes
 * n en ont pas, et la page ne doit pas dependre d un client de requetes pour
 * ne rien afficher.
 */
export function EnregistrementCible({ ressource }: { ressource: Ressource }) {
  const [id] = useState(() => idDansAdresse());
  if (id === null) return null;
  return <Cible ressource={ressource} id={id} />;
}

function Cible({ ressource, id }: { ressource: Ressource; id: number }) {
  const { t, lang } = useTranslation();
  const [ferme, setFerme] = useState(false);
  const q = useQuery<Ligne, Error & { statut?: number }>({
    queryKey: ["enregistrement-cible", ressource, id],
    enabled: !ferme,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`${API}/api${CHEMIN[ressource]}/${id}`, { credentials: "include" });
      if (!r.ok) { const e = new Error(`HTTP ${r.status}`) as Error & { statut?: number }; e.statut = r.status; throw e; }
      const j = await r.json();
      // Certaines routes enveloppent l'enregistrement ({ document: {...} }).
      return (j && typeof j === "object" && "document" in j ? (j as { document: Ligne }).document : j) as Ligne;
    },
  });
  if (ferme) return null;

  const fermer = (
    <button type="button" onClick={() => setFerme(true)} aria-label={t("enregistrementCible.fermer")} className="rounded p-1 hover:bg-muted">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  if (q.isPending) {
    return <div role="status" className="rounded-lg border p-3 text-sm text-muted-foreground" data-testid="cible-chargement">{t("enregistrementCible.chargement")}</div>;
  }
  if (q.isError) {
    const cle = q.error.statut === 404 ? "introuvable" : q.error.statut === 403 || q.error.statut === 401 ? "interdit" : "erreur";
    return (
      <div role="alert" className="flex items-start justify-between gap-2 rounded-lg border-l-4 border-l-red-600 bg-red-50 p-3 text-sm dark:bg-red-950/30" data-testid="cible-erreur">
        <span>{t(`enregistrementCible.${cle}`, { id: String(id) })}</span>{fermer}
      </div>
    );
  }
  const l = q.data;
  // Un statut connu est traduit ; un statut inconnu reste lisible tel quel.
  const libelleStatut = (code: string) => { const cle = `enregistrementCible.statuts.${code}`; const v = t(cle); return v === cle ? code : v; };
  const titre = String(l.reference ?? l.originalName ?? l.vendor ?? l.title ?? `#${id}`);
  const sousTitre = [l.title && l.title !== titre ? l.title : null, l.clientName ?? l.category ?? null].filter(Boolean).join(" · ");
  const somme = montant(l.totalAmount ?? l.amountTtc, l.currency, lang);
  return (
    <section
      aria-label={t("enregistrementCible.titre")}
      className="flex items-start justify-between gap-3 rounded-lg border-l-4 border-l-blue-700 bg-blue-50 p-3 dark:bg-blue-950/30"
      data-testid="cible-enregistrement"
      data-id={id}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{t("enregistrementCible.titre")}</p>
        <p className="truncate text-base font-semibold">{titre}</p>
        {sousTitre && <p className="truncate text-sm text-muted-foreground">{sousTitre}</p>}
        <p className="text-sm">
          {[l.status ? t("enregistrementCible.statut", { statut: libelleStatut(String(l.status)) }) : null, somme].filter(Boolean).join(" · ")}
        </p>
      </div>
      {fermer}
    </section>
  );
}
