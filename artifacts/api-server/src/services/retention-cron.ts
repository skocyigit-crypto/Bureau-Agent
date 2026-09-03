import { logger } from "../lib/logger";
import { purgeOldSecurityScans } from "./security-scans";
import { purgeExpiredTrash } from "./trash";

/**
 * Application effective des durees de conservation annoncees.
 *
 * La politique de confidentialite promet « Enregistrements d'appels : selon
 * parametrage client (max. 12 mois par defaut) ». Aucun traitement ne
 * l'appliquait: les seules purges existantes portaient sur l'usage IA et les
 * insights, et les deux seuls crons enregistres etaient la secretaire autonome
 * et les relances de facture. Une duree annoncee mais jamais appliquee est un
 * manquement au principe de limitation de la conservation (RGPD art. 5.1.e),
 * et une information inexacte au sens des art. 13/14.
 *
 * Ce qui est purge ici, c'est le CONTENU sensible — l'URL d'enregistrement et
 * la transcription — et non la ligne de journal d'appel elle-meme, qui reste
 * une donnee de facturation et d'exploitation (qui a appele qui, quand,
 * combien de temps). Effacer la ligne entiere ferait disparaitre des donnees
 * dont la conservation est par ailleurs justifiee.
 *
 * DEUXIEME PURGE, ajoutee le 2026-09-03: le journal des analyses de securite.
 * `purgeOldSecurityScans` existait depuis le 23 juillet, avec un commentaire
 * expliquant que la table « grossit indefiniment » — et rien ne l'appelait.
 * Six semaines d'ecriture sans effet, exactement le defaut que ce depot
 * rencontre a repetition: du code redige, jamais branche.
 *
 * L'enjeu n'est pas seulement la taille. Chaque ligne porte un `userId` et une
 * `target` — le fichier, l'adresse ou le numero analyse, y compris pour les
 * pieces jointes entrantes d'email et de WhatsApp. C'est donc de la donnee
 * personnelle, conservee sans terme, ce que l'article 5.1.e interdit — le
 * principe meme que ce module a ete ecrit pour appliquer.
 *
 * LIMITE CONNUE, a traiter separement: `recordingUrl` pointe vers un fichier
 * heberge chez l'operateur de telephonie (Twilio et equivalents). Effacer la
 * reference cote plateforme rend l'enregistrement inaccessible depuis le
 * produit mais ne supprime pas le fichier distant. Une suppression complete
 * suppose un appel a l'API de l'operateur, avec les identifiants de
 * l'organisation concernee — voir `services/ai-providers.ts` pour le modele
 * BYOK equivalent. Tant que ce n'est pas fait, la duree n'est tenue que
 * partiellement, et il faut le dire plutot que le supposer.
 */

/** 12 mois, la valeur par defaut annoncee. Surchargeable pour les tests. */
const RETENTION_DAYS = Number(process.env.CALL_RECORDING_RETENTION_DAYS ?? 365);
const TICK_MS = 24 * 60 * 60 * 1000;
const CRON_NAME = "retention-call-recordings";

/**
 * Efface le contenu des enregistrements d'appel plus vieux que la duree
 * annoncee. Renvoie le nombre de lignes nettoyees.
 */
export async function purgeExpiredCallRecordings(): Promise<number> {
  try {
    const { db, telephonyCallLogsTable } = await import("@workspace/db");
    const { and, lt, isNotNull, or } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000);

    const res = await db
      .update(telephonyCallLogsTable)
      .set({ recordingUrl: null, transcription: null })
      .where(
        and(
          lt(telephonyCallLogsTable.createdAt, cutoff),
          // Ne reecrit que les lignes qui portent encore quelque chose:
          // sans ce filtre, chaque passage quotidien reecrirait tout
          // l'historique d'appels de chaque organisation.
          or(
            isNotNull(telephonyCallLogsTable.recordingUrl),
            isNotNull(telephonyCallLogsTable.transcription),
          ),
        ),
      );

    const purged = (res as any).rowCount ?? 0;
    if (purged > 0) {
      logger.info(
        { purged, retentionDays: RETENTION_DAYS },
        "[retention] enregistrements d'appel expires effaces",
      );
    }
    return purged;
  } catch (err) {
    logger.error({ err }, "[retention] purge des enregistrements d'appel echouee");
    return 0;
  }
}

let started = false;

/**
 * Enregistre la purge quotidienne. Passe par le registre de crons pour que le
 * travail soit visible dans le diagnostic au meme titre que les autres — une
 * purge silencieuse dont personne ne sait si elle tourne ne vaut pas beaucoup
 * mieux que pas de purge du tout.
 */
export async function startRetentionCron(): Promise<void> {
  if (started) return;
  started = true;
  const { registerRunnableCron } = await import("./cron-registry");
  registerRunnableCron(CRON_NAME, TICK_MS, async () => {
    await purgeExpiredCallRecordings();
    await purgeOldSecurityScans();
    await purgeExpiredTrash();
  });
  logger.info(
    { retentionDays: RETENTION_DAYS },
    "[retention] purge des enregistrements d'appel enregistree",
  );
}
