/**
 * Catalogue des agents : pour chaque agent, sa mission, son modele, ce qu'il
 * peut lire, ce qu'il peut faire (et a quel palier), ses limites et son
 * activite des 30 derniers jours. Source : GET /api/ajans/catalogue, lu du
 * catalogue que l'orchestrateur applique (services/catalogue-agents.ts).
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RegionAnnonce } from "@/components/region-annonce";
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { Bot, ShieldCheck } from "lucide-react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type Palier = "lecture" | "interne" | "externe" | "destructif";

interface AgentCatalogue {
  id: string;
  nom: string;
  mission: string;
  modele: string;
  sources: { baseConnaissances: string[] | null; donnees: string[] };
  outils: Array<{ nom: string; palier: Palier }>;
  limites: { coutMaxUsdParExecution: number; appelsModeleMax: number; actionsMax: number } | null;
  execution: "orchestrateur" | "assistant" | "cron" | "cron-plateforme";
  sortie: string;
  activite30j: { executions: number; echecs: number; coutUsd: number; derniere: string | null };
}

const PALIER_CLASSE: Record<Palier, string> = {
  lecture: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  interne: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  externe: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  destructif: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
};

export default function AgentsCataloguePage() {
  const { t } = useTranslation();
  // Nom et mission viennent du serveur en francais ; traduits s'ils le sont.
  const libelle = (cle: string, repli: string) => {
    const v = t(cle);
    return v === cle ? repli : v;
  };
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ajans-catalogue"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/ajans/catalogue`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { agents: AgentCatalogue[] };
    },
  });
  const agents = data?.agents ?? [];
  const annonce = isLoading ? t("agentsCatalogue.loading") : isError ? "" : t("agentsCatalogue.count", { count: agents.length });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" aria-hidden="true" /> {t("agentsCatalogue.title")}
        </h1>
        <p className="text-muted-foreground mt-1">{t("agentsCatalogue.subtitle")}</p>
      </div>
      <RegionAnnonce message={annonce} />
      {isError && <p role="alert" className="text-destructive">{t("agentsCatalogue.error")}</p>}
      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}
        </div>
      )}

      <ul className="grid gap-4 md:grid-cols-2" aria-label={t("agentsCatalogue.listLabel")}>
        {agents.map((a) => (
          <li key={a.id}>
            <Card className="h-full" data-testid={`agent-${a.id}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  <h2>{libelle(`agentsCatalogue.agents.${a.id}.nom`, a.nom)}</h2>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{libelle(`agentsCatalogue.agents.${a.id}.mission`, a.mission)}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="outline">{t(`agentsCatalogue.execution.${a.execution}`)}</Badge>
                  <Badge variant="outline">{t("agentsCatalogue.model")} : {a.modele}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <section>
                  <h3 className="font-semibold mb-1">{t("agentsCatalogue.sources")}</h3>
                  <p>
                    {t("agentsCatalogue.knowledgeBase")} :{" "}
                    {a.sources.baseConnaissances?.length
                      ? a.sources.baseConnaissances.join(", ")
                      : t("agentsCatalogue.none")}
                  </p>
                  <p className="text-muted-foreground">{a.sources.donnees.join(" · ")}</p>
                </section>
                <section>
                  <h3 className="font-semibold mb-1">{t("agentsCatalogue.tools")}</h3>
                  {a.outils.length === 0 ? (
                    <p className="text-muted-foreground">{t("agentsCatalogue.noTools")}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {a.outils.map((o) => (
                        <li key={o.nom}>
                          <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${PALIER_CLASSE[o.palier]}`}>
                            {o.nom}
                            <span className="sr-only">, </span>
                            <span className="opacity-80">({t(`agentsCatalogue.tier.${o.palier}`)})</span>
                            {(o.palier === "externe" || o.palier === "destructif") && (
                              <ShieldCheck className="h-3 w-3" aria-label={t("agentsCatalogue.needsApproval")} />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="font-semibold mb-1">{t("agentsCatalogue.limits")}</h3>
                  {a.limites ? (
                    <dl className="grid grid-cols-3 gap-2">
                      <div><dt className="text-muted-foreground text-xs">{t("agentsCatalogue.maxCost")}</dt><dd>{a.limites.coutMaxUsdParExecution} $</dd></div>
                      <div><dt className="text-muted-foreground text-xs">{t("agentsCatalogue.maxModelCalls")}</dt><dd>{a.limites.appelsModeleMax}</dd></div>
                      <div><dt className="text-muted-foreground text-xs">{t("agentsCatalogue.maxActions")}</dt><dd>{a.limites.actionsMax}</dd></div>
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">{t("agentsCatalogue.limitsInModule")}</p>
                  )}
                </section>
                <section>
                  <h3 className="font-semibold mb-1">{t("agentsCatalogue.activity30d")}</h3>
                  <p>
                    {t("agentsCatalogue.runs", { count: a.activite30j.executions })}
                    {" · "}{t("agentsCatalogue.failures", { count: a.activite30j.echecs })}
                    {" · "}{a.activite30j.coutUsd.toFixed(4)} $
                  </p>
                </section>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
