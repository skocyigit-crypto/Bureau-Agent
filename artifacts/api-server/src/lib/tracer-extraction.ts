/**
 * Une extraction de donnees laisse une trace dans le journal d'audit.
 *
 * Le DPA (annexe 2) et la politique de confidentialite annoncent des journaux
 * d'audit couvrant « connexion, export, suppression ». Mesure le 29/09 : sur
 * 22 routes d'extraction, deux seulement ecrivaient cette trace. Les exports
 * CSV des contacts, appels, pointages, utilisateurs, messages, l'export RGPD
 * de portabilite, le telechargement d'une sauvegarde complete et la copie de
 * ses propres donnees partaient sans que l'organisation puisse savoir qui
 * avait extrait quoi — or c'est la premiere question apres une fuite.
 *
 * AVANT la reponse, pas apres. Sur Cloud Run, le processeur n'est alloue que
 * pendant le traitement de la requete : une ecriture lancee sur
 * `res.on("finish")` peut etre ralentie ou perdue avec l'instance. On attend
 * donc l'insertion, puis on envoie le fichier. `logAudit` avale deja ses
 * propres erreurs : une base indisponible ne bloque pas l'export.
 *
 * L'organisation est toujours passee. `performance.ts` l'oubliait : sa trace
 * existait, sans `organisation_id`, donc invisible dans le journal que
 * l'administrateur consulte.
 */
import type { Request } from "express";
import { logAudit } from "../routes/audit";

export async function tracerExtraction(
  req: Request,
  ressource: string,
  details: Record<string, unknown> = {},
  organisationId: number | null = req.session?.organisationId ?? null,
): Promise<void> {
  await logAudit(
    req.session?.userId,
    req.session?.userEmail,
    "export",
    ressource,
    undefined,
    { chemin: req.originalUrl?.split("?")[0], ...details },
    req.ip,
    req.get("user-agent"),
    organisationId,
  );
}
