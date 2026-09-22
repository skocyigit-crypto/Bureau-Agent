import { Sparkles, Users } from "lucide-react";
import { useTranslation } from "@/i18n";

/**
 * Ce que le rapport d'evaluation dit de lui-meme (registre des risques,
 * docs/conformite-ia : R-1a, R-5a, R-8a).
 *
 *  - le commentaire est produit par une IA (AI Act, art. 50) ;
 *  - le rapport est une hypothese a verifier aupres de la personne, pas un
 *    constat — jamais le fondement seul d'une decision ;
 *  - en petite equipe, un chiffre sans nom designe encore quelqu'un.
 *
 * Le serveur envoie `cadre` avec chaque rapport ; sans lui (ancienne reponse),
 * l'avertissement general s'affiche quand meme : mieux vaut trop prevenir.
 */
export interface CadreEvaluation {
  genereParIa: boolean;
  nature: string;
  effectif: number;
  petiteEquipe: boolean;
}

export function CadreEvaluationIa({ cadre }: { cadre?: CadreEvaluation | null }) {
  const { t } = useTranslation();
  return (
    <div role="note" aria-label={t("cadreEvaluationIa.titre")} className="space-y-2 rounded-lg border border-violet-300/60 bg-violet-50 dark:bg-violet-950/30 px-4 py-3 text-sm">
      <p className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
        <span>{t("cadreEvaluationIa.hypothese")}</span>
      </p>
      {cadre?.petiteEquipe && (
        <p className="flex items-start gap-2">
          <Users className="w-4 h-4 mt-0.5 shrink-0 text-violet-700 dark:text-violet-300" aria-hidden="true" />
          <span>{t("cadreEvaluationIa.petiteEquipe", { count: cadre.effectif })}</span>
        </p>
      )}
    </div>
  );
}
