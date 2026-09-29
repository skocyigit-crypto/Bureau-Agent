/**
 * Le registre des activites de traitement (RGPD art. 30) et le registre IA,
 * tels que le serveur les tient (services/registre-traitements.ts,
 * services/registre-ia.ts).
 *
 * L'ecran ne reformule rien : il affiche ce que le serveur affirme, y compris
 * « aucun effacement automatique » quand c'est le cas. La difference entre
 * ce que le client decide et ce que la plateforme efface d'elle-meme est
 * precisement ce qu'un registre doit rendre lisible.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Bot, Download } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const lireJson = (chemin: string) =>
  fetch(`${BASE}/api${chemin}`, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

interface Activite {
  id: string; nom: string; finalite: string; roleEditeur: string; personnes: string; donnees: string;
  baseLegale: string; dureeAnnoncee: string; appliquee: string | null; destinataires: string;
  sensible: boolean; statut?: string; enregistrements: number;
}
interface SystemeIA {
  id: string; nom: string; usage: string; classe: "interdit" | "haut_risque" | "transparence" | "risque_minimal";
  obligation: string; tenue: string; personnesExposees: string;
}

const VARIANTE_CLASSE: Record<SystemeIA["classe"], "destructive" | "default" | "secondary" | "outline"> = {
  interdit: "destructive", haut_risque: "destructive", transparence: "default", risque_minimal: "secondary",
};

function Rubrique({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{libelle}</dt>
      <dd className="text-xs break-words">{valeur}</dd>
    </div>
  );
}

export function RegistreTraitements() {
  const { t } = useTranslation();
  const registre = useQuery<{ activites: Activite[] }>({ queryKey: ["data-protection-registre"], queryFn: () => lireJson("/data-protection/registre") });
  const ia = useQuery<{ systemes: SystemeIA[]; exclusionsExaminees: string[] }>({ queryKey: ["data-protection-registre-ia"], queryFn: () => lireJson("/data-protection/registre-ia") });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" aria-hidden="true" /> {t("dataProtection.registre.title")}</CardTitle>
            <CardDescription>{t("dataProtection.registre.desc")}</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <a href={`${BASE}/api/data-protection/registre/csv`} download>
              <Download className="h-4 w-4 mr-1" aria-hidden="true" /> {t("dataProtection.registre.csv")}
            </a>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {registre.isError && <p role="alert" className="p-4 text-sm text-destructive">{t("dataProtection.registre.erreur")}</p>}
          <ul className="divide-y" aria-busy={registre.isLoading}>
            {(registre.data?.activites ?? []).map((a) => (
              <li key={a.id} className="p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-medium text-sm">{a.nom}</h3>
                  <div className="flex items-center gap-1.5">
                    {a.sensible && <Badge variant="destructive" className="text-[10px]">{t("dataProtection.registre.sensible")}</Badge>}
                    <Badge variant="secondary" className="text-[10px]">{t("dataProtection.records", { count: a.enregistrements.toLocaleString() })}</Badge>
                  </div>
                </div>
                {a.statut && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{a.statut}</p>}
                <dl className="grid gap-2 mt-2 sm:grid-cols-2">
                  <Rubrique libelle={t("dataProtection.registre.finalite")} valeur={a.finalite} />
                  <Rubrique libelle={t("dataProtection.registre.personnes")} valeur={a.personnes} />
                  <Rubrique libelle={t("dataProtection.registre.donnees")} valeur={a.donnees} />
                  <Rubrique libelle={t("dataProtection.registre.baseLegale")} valeur={a.baseLegale} />
                  <Rubrique libelle={t("dataProtection.registre.duree")} valeur={a.dureeAnnoncee} />
                  <Rubrique libelle={t("dataProtection.registre.appliquee")} valeur={a.appliquee ?? t("dataProtection.registre.aucunEffacement")} />
                  <Rubrique libelle={t("dataProtection.registre.destinataires")} valeur={a.destinataires} />
                  <Rubrique libelle={t("dataProtection.registre.role")} valeur={a.roleEditeur} />
                </dl>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bot className="h-4 w-4" aria-hidden="true" /> {t("dataProtection.registre.iaTitle")}</CardTitle>
          <CardDescription>{t("dataProtection.registre.iaDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {ia.isError && <p role="alert" className="p-4 text-sm text-destructive">{t("dataProtection.registre.erreur")}</p>}
          <ul className="divide-y" aria-busy={ia.isLoading}>
            {(ia.data?.systemes ?? []).map((s) => (
              <li key={s.id} className="p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-medium text-sm">{s.nom}</h3>
                  <Badge variant={VARIANTE_CLASSE[s.classe]} className="text-[10px]">{t(`dataProtection.registre.classe_${s.classe}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{s.usage}</p>
                <dl className="grid gap-2 mt-2 sm:grid-cols-3">
                  <Rubrique libelle={t("dataProtection.registre.obligation")} valeur={s.obligation} />
                  <Rubrique libelle={t("dataProtection.registre.tenue")} valeur={s.tenue} />
                  <Rubrique libelle={t("dataProtection.registre.exposees")} valeur={s.personnesExposees} />
                </dl>
              </li>
            ))}
          </ul>
          {(ia.data?.exclusionsExaminees?.length ?? 0) > 0 && (
            <div className="p-4 border-t">
              <h3 className="text-xs font-medium text-muted-foreground">{t("dataProtection.registre.exclusions")}</h3>
              <ul className="list-disc pl-4 mt-1 space-y-1">
                {ia.data!.exclusionsExaminees.map((e) => <li key={e} className="text-xs">{e}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
