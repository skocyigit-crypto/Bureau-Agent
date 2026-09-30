/**
 * LA MISE EN DEMEURE AVANT SUSPENSION (CGV art. 4).
 *
 * Les CGV publiees promettent : suspension « apres mise en demeure restee sans
 * effet pendant quinze (15) jours ». Le code faisait autre chose, par deux
 * chemins differents (revue de vendabilite du 30/09) :
 *   - stripe-sync suspendait au 3e echec de prelevement, sans mise en demeure,
 *     a une date qui dependait du calendrier de relance de Stripe ;
 *   - le cycle local suspendait 7 jours apres le premier impaye.
 * Aucun n'envoyait la mise en demeure. Un client suspendu pouvait opposer le
 * contrat a la plateforme, et il aurait eu raison.
 *
 * La regle est ici, et les deux chemins la lisent :
 *   - au premier impaye, une mise en demeure DATEE est envoyee et enregistree
 *     (une seule par episode d'impaye) ;
 *   - la suspension n'est possible qu'a partir de cette date + 15 jours ;
 *   - le paiement remet la date a nul (stripe-sync, invoice.paid).
 *
 * `peutSuspendre` est pure : elle se sonde sur ses bords sans base.
 */
import { db, organisationsTable, subscriptionsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendMiseEnDemeureEmail } from "./email";
import { destinataires } from "./relance-abonnement";

/** Fixe par les CGV (art. 4) : ne se regle pas par l'environnement. */
export const DELAI_MISE_EN_DEMEURE_JOURS = 15;
const JOUR_MS = 86_400_000;

export function dateLimiteMiseEnDemeure(miseEnDemeureAt: Date): Date {
  return new Date(miseEnDemeureAt.getTime() + DELAI_MISE_EN_DEMEURE_JOURS * JOUR_MS);
}

/** Vrai seulement si une mise en demeure a ete envoyee il y a au moins 15 jours. */
export function peutSuspendre(miseEnDemeureAt: Date | null | undefined, maintenant: Date): boolean {
  if (!miseEnDemeureAt) return false;
  return dateLimiteMiseEnDemeure(miseEnDemeureAt).getTime() <= maintenant.getTime();
}

/**
 * Envoie la mise en demeure si elle ne l'a pas deja ete pour cet impaye, et
 * la date. L'ecriture conditionnelle (`mise_en_demeure_at is null`) garantit
 * un seul envoi meme si deux instances traitent le meme echec au meme instant.
 *
 * Rend la date de la mise en demeure en vigueur (nouvelle ou deja existante).
 */
export async function mettreEnDemeure(orgId: number, plan: string, maintenant: Date = new Date()): Promise<Date | null> {
  const posees = await db.update(subscriptionsTable)
    .set({ miseEnDemeureAt: maintenant, updatedAt: maintenant })
    .where(and(eq(subscriptionsTable.organisationId, orgId), isNull(subscriptionsTable.miseEnDemeureAt)))
    .returning({ at: subscriptionsTable.miseEnDemeureAt });

  if (posees.length === 0) {
    const [deja] = await db.select({ at: subscriptionsTable.miseEnDemeureAt }).from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, orgId)).limit(1);
    return deja?.at ? new Date(deja.at) : null;
  }

  const [org] = await db.select({ name: organisationsTable.name, email: organisationsTable.email })
    .from(organisationsTable).where(eq(organisationsTable.id, orgId)).limit(1);
  const a = await destinataires(orgId, org?.email ?? null);
  const limite = dateLimiteMiseEnDemeure(maintenant);
  if (a.length === 0) {
    // Une mise en demeure qui n'atteint personne ne fait pas courir le delai :
    // on retire la date, et la suspension reste impossible tant qu'aucune
    // n'a ete reellement envoyee. L'operateur le voit dans les journaux.
    await db.update(subscriptionsTable).set({ miseEnDemeureAt: null })
      .where(eq(subscriptionsTable.organisationId, orgId));
    logger.error({ orgId }, "[mise-en-demeure] aucun destinataire : non envoyee, delai non ouvert");
    return null;
  }
  let parties = 0;
  for (const to of a) {
    const r = await sendMiseEnDemeureEmail({ to, orgName: org?.name ?? `#${orgId}`, plan, dateLimite: limite })
      .catch((err) => { logger.warn({ err, orgId }, "[mise-en-demeure] envoi echoue"); return { success: false }; });
    if (r.success) parties++;
  }
  if (parties === 0) {
    // Meme regle : aucun envoi reussi, aucun delai ouvert. Le prochain echec
    // (ou le prochain passage du cycle) retentera.
    await db.update(subscriptionsTable).set({ miseEnDemeureAt: null })
      .where(eq(subscriptionsTable.organisationId, orgId));
    logger.error({ orgId, destinataires: a.length }, "[mise-en-demeure] aucun envoi reussi : delai non ouvert");
    return null;
  }
  logger.warn({ orgId, limite: limite.toISOString(), envoyees: parties }, "[mise-en-demeure] envoyee");
  return maintenant;
}
