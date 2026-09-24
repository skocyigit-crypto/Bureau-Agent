/**
 * Le cycle de vie d'un abonnement, applique par la plateforme elle-meme.
 *
 * CE QUI MANQUAIT, mesure en production le 24/09/2026. Les cinq abonnements
 * portaient `status = "active"` et des periodes closes depuis un a deux
 * mois — dont un plan « entreprise » a 199 EUR/mois dont la periode s'etait
 * terminee le 19 aout. `suspended_at` etait nul partout,
 * `payment_failed_count` valait zero partout.
 *
 * La cause n'etait pas une regle mal ecrite : AUCUNE ligne du depot n'ecrivait
 * `current_period_end`. Le seul endroit qui la mentionnait la LISAIT
 * (`routes/my-subscription.ts`). Une periode se terminait, et il ne se passait
 * rien — ni renouvellement, ni retard, ni suspension.
 *
 * L'APPLICATION, ELLE, EXISTAIT DEJA — et c'est ce qui rend le defaut couteux
 * a voir. `middleware/license-check.ts` traite `suspended` et `cancelled`
 * (lecture seule), l'essai expire (lecture seule) et `past_due` (delai de
 * grace). Tout le mecanisme de contrainte etait en place et correct ; rien ne
 * le declenchait. Le produit paraissait avoir une gestion d'abonnements.
 *
 * AUCUNE POLITIQUE N'EST INVENTEE ICI. Le delai de grace vient de
 * `services/payment-access-policy.ts` (`PAYMENT_GRACE_DAYS`, 7 jours par
 * defaut, reglable par l'environnement) — c'est-a-dire la MEME valeur que
 * celle deja appliquee aux acces. Deux delais de grace differents, l'un pour
 * bloquer l'ecriture et l'autre pour suspendre, seraient impossibles a
 * expliquer a un client.
 *
 * L'ESSAI N'EST PAS TOUCHE. `license-check` compare deja `trialEndsAt` a
 * maintenant et passe le compte en lecture seule, quel que soit le statut.
 * Ecrire en plus un statut « expire » ajouterait un second chemin pour le
 * meme fait, et deux chemins finissent par diverger.
 *
 * TOUTES LES DECISIONS SONT PURES. `deciderTransition` ne lit pas la base et
 * n'ecrit rien : elle prend un etat et une date, et rend ce qu'il faut faire.
 * C'est ce qui permet de la sonder sur les bords — le jour meme de
 * l'echeance, le dernier jour de grace, un mois de 31 jours — sans monter un
 * jeu de donnees a chaque fois.
 */
import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { db, invoicesTable, subscriptionsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { PAYMENT_GRACE_DAYS } from "./payment-access-policy";

const JOUR_MS = 86_400_000;

/** L'etat d'un abonnement, reduit a ce dont la decision depend. */
export interface EtatAbonnement {
  statut: string;
  plan: string;
  cycle: string | null;
  finPeriode: Date | null;
  /** Date de la plus ancienne facture emise et impayee, s'il y en a une. */
  impayeDepuis: Date | null;
  /** Date deja enregistree du premier echec de paiement. */
  echecDepuis: Date | null;
}

export type Transition =
  | { action: "rien"; raison: string }
  | { action: "renouveler"; nouveauDebut: Date; nouvelleFin: Date }
  | { action: "passer_en_retard"; depuis: Date }
  | { action: "suspendre"; raison: string };

/**
 * La fin de periode suivante.
 *
 * On ajoute a la fin PRECEDENTE, pas a aujourd'hui : un cron qui prend trois
 * jours de retard ne doit pas decaler la date d'anniversaire du client de
 * trois jours. Et on rattrape autant de periodes que necessaire, sinon un
 * abonnement oublie deux mois renouvellerait vers une date deja passee et
 * serait renouvele de nouveau au tick suivant, indefiniment.
 */
export function prochaineFinDePeriode(finActuelle: Date, cycle: string | null, maintenant: Date): { debut: Date; fin: Date } {
  const annuel = cycle === "yearly" || cycle === "annuel";
  let debut = new Date(finActuelle);
  let fin = avancer(debut, annuel);
  // Borne de securite : 400 iterations couvrent plus de trente ans de retard
  // mensuel. Sans elle, une date aberrante en base ferait tourner sans fin.
  for (let i = 0; i < 400 && fin.getTime() <= maintenant.getTime(); i++) {
    debut = fin;
    fin = avancer(debut, annuel);
  }
  return { debut, fin };
}

function avancer(d: Date, annuel: boolean): Date {
  const n = new Date(d);
  if (annuel) {
    n.setUTCFullYear(n.getUTCFullYear() + 1);
    return n;
  }
  // `setUTCMonth` ramene le 31 janvier au 3 mars. On borne au dernier jour du
  // mois vise, pour qu'un abonnement souscrit un 31 garde sa date.
  const jour = n.getUTCDate();
  n.setUTCDate(1);
  n.setUTCMonth(n.getUTCMonth() + 1);
  const dernierJour = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
  n.setUTCDate(Math.min(jour, dernierJour));
  return n;
}

/**
 * Ce qu'il faut faire de cet abonnement, maintenant.
 *
 * DEUX MECANISMES PROTEGENT L'ORDRE, et il vaut mieux savoir lequel fait quoi.
 *
 * Pour un abonnement deja `past_due`, `suspended` ou clos, c'est la GARDE DE
 * STATUT qui decide : les blocs de renouvellement exigent `active`, donc
 * intervertir les regles ne changerait rien. Je l'ai cru longtemps et je
 * l'avais ecrit ici ; un sabotage l'a dementi — ordre inverse, tous les tests
 * verts.
 *
 * Le seul cas ou l'ORDRE tranche vraiment est celui d'un abonnement `active`
 * a la fois IMPAYE et a periode close : les deux regles s'appliquent. Le
 * retard doit primer, sinon la periode repart et masque l'impaye — le client
 * repartirait pour un mois sans avoir paye le precedent.
 */
export function deciderTransition(etat: EtatAbonnement, maintenant: Date = new Date()): Transition {
  // Un abonnement clos ne bouge plus. C'est un etat terminal : le client
  // reprend par une nouvelle souscription, pas par un renouvellement.
  if (etat.statut === "cancelled" || etat.statut === "annulee" || etat.statut === "annule") {
    return { action: "rien", raison: "abonnement clos" };
  }

  if (etat.statut === "suspended") {
    return { action: "rien", raison: "deja suspendu" };
  }

  // L'essai est borne par `trialEndsAt` et applique par license-check. On ne
  // le renouvelle pas : un essai qui se renouvelle tout seul est un produit
  // gratuit.
  if (etat.plan === "essai") {
    return { action: "rien", raison: "essai : borne par trialEndsAt, applique a l'acces" };
  }

  const debutRetard = etat.echecDepuis ?? etat.impayeDepuis;

  if (etat.statut === "past_due" && debutRetard) {
    const finGrace = new Date(debutRetard.getTime() + PAYMENT_GRACE_DAYS * JOUR_MS);
    if (finGrace.getTime() <= maintenant.getTime()) {
      return { action: "suspendre", raison: `impaye depuis plus de ${PAYMENT_GRACE_DAYS} jours` };
    }
    return { action: "rien", raison: "delai de grace en cours" };
  }

  // Une facture emise et impayee fait basculer en retard, meme si la periode
  // n'est pas terminee : c'est l'impaye qui compte, pas le calendrier.
  if (etat.statut === "active" && etat.impayeDepuis && !etat.echecDepuis) {
    return { action: "passer_en_retard", depuis: etat.impayeDepuis };
  }

  if (etat.statut === "active" && etat.finPeriode && etat.finPeriode.getTime() <= maintenant.getTime()) {
    const { debut, fin } = prochaineFinDePeriode(etat.finPeriode, etat.cycle, maintenant);
    return { action: "renouveler", nouveauDebut: debut, nouvelleFin: fin };
  }

  return { action: "rien", raison: "rien a faire" };
}

export interface ResultatCycle {
  examines: number;
  renouveles: number;
  passesEnRetard: number;
  suspendus: number;
  /** Abonnements qu'on n'a PAS pu evaluer : on le dit, on ne les compte pas comme sains. */
  illisibles: string[];
}

/**
 * Applique le cycle a tous les abonnements.
 *
 * Rend le detail plutot qu'un booleen : un cron qui repond « ok » sans dire
 * combien de lignes il a touchees ne permet pas de distinguer « rien a faire »
 * de « rien n'a ete lu ».
 */
export async function appliquerCycleAbonnements(maintenant: Date = new Date()): Promise<ResultatCycle> {
  const r: ResultatCycle = { examines: 0, renouveles: 0, passesEnRetard: 0, suspendus: 0, illisibles: [] };

  const abonnements = await db.select().from(subscriptionsTable);

  for (const sub of abonnements) {
    r.examines++;
    try {
      // La plus ancienne facture EMISE et impayee. Une facture en brouillon
      // n'a pas ete envoyee au client : la lui opposer serait injuste, et
      // c'est precisement ce que l'emission (numero + date) distingue.
      const [impaye] = await db.select({ issuedAt: invoicesTable.issuedAt })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.organisationId, sub.organisationId),
          isNotNull(invoicesTable.issuedAt),
          or(eq(invoicesTable.status, "en_attente"), eq(invoicesTable.status, "retard")),
        ))
        .orderBy(invoicesTable.issuedAt)
        .limit(1);

      const decision = deciderTransition({
        statut: sub.status,
        plan: sub.plan,
        cycle: sub.billingCycle,
        finPeriode: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
        impayeDepuis: impaye?.issuedAt ? new Date(impaye.issuedAt) : null,
        echecDepuis: sub.lastPaymentFailedAt ? new Date(sub.lastPaymentFailedAt) : null,
      }, maintenant);

      if (decision.action === "rien") continue;

      if (decision.action === "renouveler") {
        await db.update(subscriptionsTable).set({
          currentPeriodStart: decision.nouveauDebut,
          currentPeriodEnd: decision.nouvelleFin,
          updatedAt: maintenant,
        }).where(eq(subscriptionsTable.id, sub.id));
        r.renouveles++;
        logger.info({ orgId: sub.organisationId, fin: decision.nouvelleFin.toISOString() }, "[CycleAbonnement] periode renouvelee");
        continue;
      }

      if (decision.action === "passer_en_retard") {
        await db.update(subscriptionsTable).set({
          status: "past_due",
          lastPaymentFailedAt: decision.depuis,
          paymentFailedCount: (sub.paymentFailedCount ?? 0) + 1,
          updatedAt: maintenant,
        }).where(eq(subscriptionsTable.id, sub.id));
        r.passesEnRetard++;
        logger.warn({ orgId: sub.organisationId, depuis: decision.depuis.toISOString() }, "[CycleAbonnement] passe en retard de paiement");
        continue;
      }

      await db.update(subscriptionsTable).set({
        status: "suspended",
        suspendedAt: maintenant,
        suspensionReason: decision.raison,
        updatedAt: maintenant,
      }).where(eq(subscriptionsTable.id, sub.id));
      r.suspendus++;
      logger.warn({ orgId: sub.organisationId, raison: decision.raison }, "[CycleAbonnement] abonnement suspendu");
    } catch (err) {
      // On NOMME ce qu'on n'a pas pu traiter. Un abonnement saute en silence
      // se compterait comme sain, et c'est exactement le mode de panne que ce
      // fichier corrige ailleurs.
      r.illisibles.push(`org ${sub.organisationId} : ${err instanceof Error ? err.message.slice(0, 80) : "erreur"}`);
      logger.error({ err, orgId: sub.organisationId }, "[CycleAbonnement] abonnement non traite");
    }
  }

  return r;
}

/** Les abonnements dont la periode est close — pour le diagnostic super-admin. */
export async function abonnementsEnRetardDePeriode(maintenant: Date = new Date()) {
  return db.select({
    id: subscriptionsTable.id,
    organisationId: subscriptionsTable.organisationId,
    plan: subscriptionsTable.plan,
    status: subscriptionsTable.status,
    currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
  }).from(subscriptionsTable)
    .where(and(
      eq(subscriptionsTable.status, "active"),
      lt(subscriptionsTable.currentPeriodEnd, maintenant),
    ));
}
