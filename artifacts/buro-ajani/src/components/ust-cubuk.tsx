/**
 * Boutons de l'en-tete ajoutes par la refonte du menu (29/09).
 *
 *  - Compteur d'approbations : la file d'approbation etait une ligne au milieu
 *    d'un long menu, son badge se perdait. Il est maintenant dans l'en-tete, sur
 *    toutes les pages, en orange (une decision humaine attendue).
 *  - Commande vocale : le micro flottant recouvrait la barre laterale.
 *  - Action rapide : le « + » flottant, pose au meme endroit que le micro, et
 *    sans nom accessible.
 *  - Console plateforme : le super-administrateur y entre et en sort par ici ;
 *    ses outils ne sont plus dans le menu du bureau.
 */
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n";
import { basculerCommandeVocale, useCommandeVocale } from "@/lib/commande-vocale";
import { ArrowLeft, Building2, Inbox, Mic, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";

export function CompteurApprobations({ sayi }: { sayi: number }) {
  const { t } = useTranslation();
  const libelle = sayi > 0 ? t("header.approvalsWaiting", { count: sayi }) : t("header.approvalsNone");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="sm" className="relative gap-1.5 px-2">
          <Link href="/file-approbation" aria-label={libelle} data-testid="compteur-approbations">
            <Inbox className="w-5 h-5" aria-hidden="true" />
            {sayi > 0 && (
              <span aria-hidden="true" className="min-w-5 h-5 px-1 rounded-full bg-orange-400 text-slate-950 text-xs font-semibold inline-flex items-center justify-center">
                {sayi > 99 ? "99+" : sayi}
              </span>
            )}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{libelle}</TooltipContent>
    </Tooltip>
  );
}

export function BoutonCommandeVocale() {
  const { t } = useTranslation();
  const { disponible, ouverte, ecoute } = useCommandeVocale();
  if (!disponible) return null;
  const actif = ecoute === "commande" || ecoute === "traitement" || ecoute === "parole";
  const etat = ecoute === "veille" ? t("header.voiceWake") : actif ? t("header.voiceListening") : "";
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`gap-1.5 px-2 ${actif ? "text-blue-700 dark:text-blue-300" : ""}`}
      aria-expanded={ouverte}
      onClick={() => basculerCommandeVocale()}
      data-testid="bouton-commande-vocale"
    >
      <span className="relative inline-flex">
        <Mic className="w-5 h-5" aria-hidden="true" />
        {ecoute !== "arret" && (
          <span aria-hidden="true" className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-600 ${actif ? "animate-pulse" : ""}`} />
        )}
      </span>
      <span className="hidden lg:inline">{t("header.voiceCommand")}</span>
      <span className="sr-only lg:hidden">{t("header.voiceCommand")}</span>
      {etat && <span className="sr-only">{`, ${etat}`}</span>}
    </Button>
  );
}

export function BoutonActionRapide({ onOuvrir }: { onOuvrir: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={onOuvrir} aria-label={t("header.quickAction")} data-testid="bouton-action-rapide">
          <Plus className="w-5 h-5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("header.quickAction")} (Ctrl+Shift+A)</TooltipContent>
    </Tooltip>
  );
}

/**
 * Les outils d'appareil et de navigateur (reseau, batterie, plein ecran, mode
 * discret, impression, localisation, capacites, theme, export) etaient une
 * rangee d'une douzaine d'icones dans l'en-tete : a 1366 px elle poussait hors
 * de l'ecran la cloche et le profil. Ils sont regroupes derriere un bouton.
 */
export function MenuOutils({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Element | null;
      // Les menus ouverts depuis le panneau vivent dans un portail Radix : un
      // clic dedans n'est pas un clic dehors.
      if (racine.current?.contains(cible) || cible?.closest("[data-radix-popper-content-wrapper], [role=dialog]")) return;
      setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOuvert(false); bouton.current?.focus(); }
    };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => { document.removeEventListener("mousedown", dehors); document.removeEventListener("keydown", echap); };
  }, [ouvert]);
  return (
    <div ref={racine} className="relative">
      <Button
        ref={bouton}
        variant="ghost"
        size="icon"
        aria-label={t("header.tools")}
        aria-expanded={ouvert}
        aria-controls={id}
        onClick={() => setOuvert((o) => !o)}
        data-testid="menu-outils"
      >
        <SlidersHorizontal className="w-5 h-5" aria-hidden="true" />
      </Button>
      {ouvert && (
        <div
          id={id}
          role="group"
          aria-label={t("header.tools")}
          className="absolute right-0 top-full mt-2 z-50 w-max max-w-[calc(100vw-2rem)] rounded-lg border bg-popover text-popover-foreground shadow-lg p-2 flex flex-wrap items-center gap-1"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function PassageConsole({ enConsole }: { enConsole: boolean }) {
  const { t } = useTranslation();
  return enConsole ? (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <Link href="/" data-testid="passage-console">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t("header.backToOffice")}
      </Link>
    </Button>
  ) : (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <Link href="/admin" data-testid="passage-console">
        <Building2 className="w-4 h-4" aria-hidden="true" />
        <span className="hidden md:inline">{t("sidebar.groups.platformConsole")}</span>
        <span className="sr-only md:hidden">{t("sidebar.groups.platformConsole")}</span>
      </Link>
    </Button>
  );
}
