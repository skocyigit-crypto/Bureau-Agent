/**
 * Pieces de la barre laterale et des onglets de section, alimentees par le
 * plan de `lib/gezinti.ts`.
 *
 * Couleurs (charte du 29/09) : bleu pour la section active, orange pour ce qui
 * attend une decision humaine (approbations), rien d'autre. Les icones du menu
 * sont sobres et de meme poids — plus une couleur vive par ligne.
 */
import {
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { triggerHaptic } from "@/hooks/use-device-environment";
import { useTranslation } from "@/i18n";
import type { Entree, Page, Rozet } from "@/lib/gezinti";
import { ArrowLeft, ChevronDown, Settings } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "wouter";

export type Ici = { entree: Entree; page: Page } | null;

/** Le texte lu apres le nom de l'entree : « 3 nouveaux », « 21 en attente d'approbation ». */
function annonceCompteur(t: (k: string, o?: Record<string, unknown>) => string, rozet: Rozet, n: number): string {
  return rozet === "approbation" ? t("header.approvalsWaiting", { count: n }) : t("sidebar.newItems", { count: n });
}

export function EntreeMenu({ entree, ici, compteur }: { entree: Entree; ici: Ici; compteur: number }) {
  const { t } = useTranslation();
  const nom = t(`sidebar.items.${entree.cle}`);
  const Icone = entree.icone;
  const active = ici?.entree === entree;
  // « page » seulement sur la page d'arrivee ; sur un onglet de l'entree,
  // l'entree est l'element courant d'un ensemble, pas la page elle-meme.
  const courant = active ? (ici?.page === entree.pages[0] ? "page" : "true") : undefined;
  const orange = entree.rozet === "approbation";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={nom}
        className="data-[active=true]:bg-blue-600 data-[active=true]:text-white data-[active=true]:hover:bg-blue-600 data-[active=true]:hover:text-white"
      >
        <Link href={entree.pages[0].href} aria-current={courant} onClick={() => triggerHaptic("light")}>
          <Icone aria-hidden="true" />
          <span>{nom}</span>
          {compteur > 0 && entree.rozet && <span className="sr-only">{`, ${annonceCompteur(t, entree.rozet, compteur)}`}</span>}
        </Link>
      </SidebarMenuButton>
      {compteur > 0 && (
        <SidebarMenuBadge
          aria-hidden="true"
          data-testid={`sidebar-badge-${entree.cle}`}
          className={orange ? "bg-orange-400 text-slate-950" : "bg-blue-600 text-white"}
        >
          {compteur > 99 ? "99+" : compteur}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

/**
 * Reglages du bureau, fixes en bas de la barre laterale et repliables : ouverts
 * d'office quand on est sur l'une de leurs pages. Barre laterale reduite aux
 * icones, le bouton la redeploie avant d'ouvrir la liste.
 */
export function ReglagesBureau({ entrees, ici, compteurs }: { entrees: Entree[]; ici: Ici; compteurs: Record<Rozet, number> }) {
  const { t } = useTranslation();
  const { state, setOpen: deployer, isMobile } = useSidebar();
  const dedans = !!ici && entrees.includes(ici.entree);
  const [ouvert, setOuvert] = useState(dedans);
  const idListe = useId();
  useEffect(() => { if (dedans) setOuvert(true); }, [dedans]);
  if (entrees.length === 0) return null;
  const reduit = state === "collapsed" && !isMobile;
  return (
    <div className="border-t border-sidebar-border px-2 pt-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t("sidebar.groups.officeSettings")}
            aria-expanded={ouvert && !reduit}
            aria-controls={idListe}
            isActive={dedans && !ouvert}
            className="data-[active=true]:bg-blue-600 data-[active=true]:text-white"
            onClick={() => {
              if (reduit) { deployer(true); setOuvert(true); return; }
              setOuvert((o) => !o);
            }}
          >
            <Settings aria-hidden="true" />
            <span>{t("sidebar.groups.officeSettings")}</span>
            <ChevronDown aria-hidden="true" className={`ml-auto transition-transform ${ouvert ? "" : "-rotate-90"}`} />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {ouvert && !reduit && (
        <div id={idListe} className="max-h-[38vh] overflow-y-auto pb-2">
          <SidebarMenu>
            {entrees.map((e) => (
              <EntreeMenu key={e.cle} entree={e} ici={ici} compteur={e.rozet ? compteurs[e.rozet] : 0} />
            ))}
          </SidebarMenu>
        </div>
      )}
    </div>
  );
}

/** Dans la console plateforme, la sortie vers le bureau remplace les reglages. */
export function RetourAuBureau() {
  const { t } = useTranslation();
  return (
    <div className="border-t border-sidebar-border px-2 py-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={t("header.backToOffice")}>
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              <span>{t("header.backToOffice")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}

/**
 * Onglets en tete de page quand l'entree courante regroupe plusieurs pages
 * (Agents : profils, agents specialises, objectifs… ; Connexions : logiciels,
 * ligne telephonique…). Liens ordinaires : chaque onglet a sa propre adresse.
 */
export function OngletsDeSection({ ici }: { ici: Ici }) {
  const { t } = useTranslation();
  if (!ici || ici.entree.pages.length < 2) return null;
  const nomEntree = t(`sidebar.items.${ici.entree.cle}`);
  return (
    <nav aria-label={t("sidebar.sectionTabs", { name: nomEntree })} className="mb-5 border-b border-border overflow-x-auto" data-testid="onglets-section">
      <ul className="flex gap-1 min-w-max">
        {ici.entree.pages.map((p) => {
          const actif = p === ici.page;
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={actif ? "page" : undefined}
                className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md ${
                  actif ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`sidebar.items.${p.cle}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
