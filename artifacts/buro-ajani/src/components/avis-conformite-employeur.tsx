import { ShieldCheck } from "lucide-react";
import { useTranslation } from "@/i18n";

/**
 * Rappel, sur les ecrans qui suivent des salaries, de ce que l'employeur doit
 * faire AVANT de s'en servir : consulter le CSE (C. trav. L2312-38), informer
 * chaque salarie (L1222-4, RGPD art. 13), realiser une AIPD si requise (art. 35).
 *
 * Le kit qui l'y aide existait, mais aucun ecran n'y menait. Ce sont les
 * ecrans ou l'on active le suivi qui doivent le montrer : c'est la que se
 * prend la decision.
 */
export const URL_KIT_CONFORMITE = "https://agentdebureau.fr/conformite-employeur";

export function AvisConformiteEmployeur() {
  const { t } = useTranslation();
  return (
    <aside
      aria-label={t("conformiteEmployeur.titre")}
      className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm"
    >
      <ShieldCheck className="w-5 h-5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
      <p>
        {t("conformiteEmployeur.avis")}{" "}
        <a
          href={URL_KIT_CONFORMITE}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-2"
        >
          {t("conformiteEmployeur.lien")}
        </a>
      </p>
    </aside>
  );
}
