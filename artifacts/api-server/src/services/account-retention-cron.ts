/**
 * account-retention-cron.ts — la duree annoncee aux clients, appliquee.
 *
 * La politique de confidentialite promet, pour les donnees de compte:
 * « duree de l'abonnement + 3 ans apres resiliation ». Rien ne l'appliquait.
 * Un compte resilie en 2021 gardait indefiniment le nom, l'e-mail et le
 * telephone de chaque salarie. L'article 5.1.e du RGPD (limitation de la
 * conservation) l'interdit, et une promesse ecrite la rend en plus opposable.
 *
 * ANONYMISER, PAS SUPPRIMER. Deux contraintes rendent la suppression pure
 * impossible:
 *
 *   1. Les factures emises se conservent 10 ans (obligation comptable).
 *      Supprimer l'organisation les emporterait.
 *   2. `license_audit_log` est rendu append-only par un declencheur
 *      PostgreSQL: la suppression en cascade echoue, et ferait echouer le
 *      travail entier a chaque passage.
 *
 * On efface donc ce qui identifie des PERSONNES — nom, prenom, e-mail,
 * telephone, secret d'authentification — et on laisse intacte l'entite
 * juridique et sa comptabilite. C'est la ligne du RGPD: une organisation
 * cliente n'est pas une personne physique.
 *
 * L'operation est IRREVERSIBLE. Trois garde-fous:
 *   - la borne de 3 ans est comparee a `cancelled_at`, jamais a une date de
 *     derniere connexion ou d'inactivite;
 *   - seuls les abonnements explicitement resilies sont concernes: un
 *     abonnement suspendu pour impaye reste un client;
 *   - un verrou consultatif empeche deux instances Cloud Run (maxScale=3) de
 *     traiter la meme organisation en meme temps.
 */

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import {
  db,
  organisationsTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { CRON_LOCK_NAMESPACE, tryWithLock } from "../lib/cron-lock";
import { withHeartbeat } from "./health-agents";

/** 3 ans, comme annonce. Configurable pour les tests et un eventuel ajustement. */
export const RETENTION_APRES_RESILIATION_JOURS = Number(
  process.env.ACCOUNT_RETENTION_AFTER_CANCEL_DAYS ?? 365 * 3,
);

const TICK_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

/**
 * Les deux libelles d'un abonnement resilie. Le francais et l'anglais
 * coexistent dans les donnees; n'en traiter qu'un laisserait la moitie des
 * comptes en clair — et personne ne s'en apercevrait, puisque le travail
 * reussirait.
 */
const STATUTS_RESILIES = ["annulee", "cancelled"] as const;

/**
 * Marqueur porte par un compte deja anonymise. Sert a ne pas repasser dessus
 * a chaque tic: une deuxieme anonymisation ne ferait pas de mal, mais elle
 * ecraserait la trace du premier passage.
 */
const DOMAINE_ANONYME = "anonymise.invalid";

function estAnonymise(email: string): boolean {
  return email.endsWith(`@${DOMAINE_ANONYME}`);
}

/**
 * Anonymise les personnes des organisations resiliees depuis plus longtemps
 * que la duree annoncee. Exporte pour etre testable directement — un travail
 * irreversible ne doit pas n'etre atteignable qu'a travers un `setInterval`.
 */
export async function anonymiserComptesExpires(): Promise<number> {
  const limite = new Date(Date.now() - RETENTION_APRES_RESILIATION_JOURS * 86400_000);

  const expirees = await db
    .select({ organisationId: subscriptionsTable.organisationId })
    .from(subscriptionsTable)
    .where(and(
      inArray(subscriptionsTable.status, [...STATUTS_RESILIES]),
      isNotNull(subscriptionsTable.cancelledAt),
      lt(subscriptionsTable.cancelledAt, limite),
    ));

  let anonymises = 0;

  for (const { organisationId } of expirees) {
    // Verrou par organisation: deux instances peuvent tomber sur la meme
    // ligne, et l'e-mail anonymise porte l'identifiant de l'utilisateur —
    // deux passages concurrents se disputeraient la contrainte d'unicite.
    await tryWithLock(CRON_LOCK_NAMESPACE.accountRetention, organisationId, async () => {
      const personnes = await db
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.organisationId, organisationId));

      for (const personne of personnes) {
        if (estAnonymise(personne.email)) continue;

        await db.update(usersTable).set({
          // L'identifiant reste dans l'e-mail: `users.email` est unique, et
          // une valeur constante ferait echouer la mise a jour des le
          // deuxieme compte — en laissant le reste en clair.
          email: `anonyme-${personne.id}@${DOMAINE_ANONYME}`,
          nom: "Anonymise",
          prenom: "Compte",
          telephone: null,
          // Un condensat conserve reste une donnee exploitable, et un compte
          // anonyme mais actif serait une porte d'entree sans nom.
          passwordHash: "",
          actif: false,
          mfaActif: false,
          emailVerificationToken: null,
        }).where(eq(usersTable.id, personne.id));

        anonymises += 1;
      }

      // L'organisation garde son nom et son SIRET — ils figurent sur des
      // factures a conserver 10 ans. Seules ses coordonnees de contact, qui
      // sont le plus souvent celles d'une personne, sont retirees.
      await db.update(organisationsTable)
        .set({ phone: null })
        .where(eq(organisationsTable.id, organisationId));
    });
  }

  if (anonymises > 0) {
    logger.info(
      { anonymises, organisations: expirees.length, retentionJours: RETENTION_APRES_RESILIATION_JOURS },
      "[account-retention-cron] comptes anonymises",
    );
  }
  return anonymises;
}

async function tick(): Promise<void> {
  try {
    await anonymiserComptesExpires();
  } catch (err) {
    logger.error({ err }, "[account-retention-cron] tick failed");
  }
}

export function startAccountRetentionCron(): void {
  if (timer) return;
  // Premier passage differe: le demarrage n'est pas le moment pour un travail
  // irreversible, et rien ne presse a la minute pres sur une borne de 3 ans.
  setTimeout(() => { void tick(); }, 5 * 60_000);
  timer = setInterval(withHeartbeat("account-retention", TICK_MS, tick), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info(
    { retentionJours: RETENTION_APRES_RESILIATION_JOURS },
    "[account-retention-cron] started",
  );
}
