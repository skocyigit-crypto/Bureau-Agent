/**
 * Les quatre etats d'un ecran qui ne peut pas (encore) montrer ses donnees
 * (plan du 29/09, section 12) : chargement, connexion perdue, pas le droit,
 * enregistrement introuvable.
 *
 * Pourquoi un composant : chaque page improvisait le sien, et la plupart n'en
 * avaient qu'un — le squelette de chargement. Une erreur reseau, un 403 et un
 * 404 finissaient donc tous dans le meme ecran vide, ou pire, dans un tableau
 * vide qui dit « aucun resultat » alors que rien n'a ete lu. Un utilisateur qui
 * voit « aucune facture » sur un chantier en conclut qu'il n'y en a pas.
 *
 * `depuisReponse` fait le tri a partir du statut HTTP, pour qu'un appelant ne
 * puisse pas confondre « pas trouve » et « pas autorise ».
 */
import { useTranslation } from "@/i18n";
import { Loader2, Lock, SearchX, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";

export type Etat = "chargement" | "hors_ligne" | "interdit" | "introuvable";

const ICONE: Record<Etat, LucideIcon> = {
  chargement: Loader2,
  hors_ligne: WifiOff,
  interdit: Lock,
  introuvable: SearchX,
};

/**
 * L'etat qui correspond a une reponse en echec, ou a une erreur reseau
 * (`statut` absent). Un 5xx est rendu comme une connexion perdue : dans les
 * deux cas, la donnee n'a pas ete lue et reessayer peut suffire.
 */
export function depuisReponse(statut: number | null | undefined): Exclude<Etat, "chargement"> {
  if (statut === 401 || statut === 403) return "interdit";
  if (statut === 404) return "introuvable";
  return "hors_ligne";
}

export function EtatEcran({ etat, onReessayer, retour }: {
  etat: Etat;
  /** Offert seulement quand reessayer peut changer quelque chose. */
  onReessayer?: () => void;
  /** Ou revenir quand l'enregistrement n'existe pas. */
  retour?: { href: string; libelle: string };
}) {
  const { t } = useTranslation();
  const Icone = ICONE[etat];
  const chargement = etat === "chargement";
  return (
    <div
      role={chargement ? "status" : "alert"}
      aria-live={chargement ? "polite" : "assertive"}
      data-etat={etat}
      data-testid={`etat-ecran-${etat}`}
      className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center"
    >
      <Icone className={`h-8 w-8 text-muted-foreground ${chargement ? "animate-spin" : ""}`} aria-hidden="true" />
      <p className="text-base font-medium">{t(`etatEcran.${etat}.titre`)}</p>
      {!chargement && <p className="max-w-md text-sm text-muted-foreground">{t(`etatEcran.${etat}.detay`)}</p>}
      <div className="flex gap-2">
        {onReessayer && (etat === "hors_ligne") && (
          <button
            type="button"
            onClick={onReessayer}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("etatEcran.reessayer")}
          </button>
        )}
        {retour && etat === "introuvable" && (
          <Link href={retour.href} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            {retour.libelle}
          </Link>
        )}
      </div>
    </div>
  );
}
