import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// Un namespace DEDIE par cron (2e argument de pg_try_advisory_lock forme la
// cle avec l'entityId appelant) — evite qu'un verrou "daily-digest pour
// userId=1" bloque a tort un verrou sans rapport "invoice-reminder pour
// orgId=1" (userId et orgId sont tous deux de petits entiers sequentiels,
// donc des collisions de valeur entre crons differents sont probables si un
// seul namespace etait partage). CALL_LOCK_NAMESPACE (call-processor.ts,
// meme mecanisme Postgres) utilise 4242 — distinct de ceux-ci.
export const CRON_LOCK_NAMESPACE = {
  dailyDigest: 4301,
  invoiceReminder: 4302,
  autonomousSecretary: 4303,
} as const;

/**
 * Empeche deux instances Cloud Run (ou deux tics concurrents de la meme
 * instance) d'executer le meme travail de cron pour la meme entite en meme
 * temps. Les crons de ce depot verifient "deja execute aujourd'hui" via un
 * SELECT puis ecrivent un marqueur — non-atomique, donc course possible en
 * multi-instance (maxScale=3 sur agent-de-bureau-api). `entityId` doit
 * identifier de facon stable l'entite traitee (orgId ou userId) pour CE cron.
 *
 * Si le verrou n'est pas obtenu (deja pris ailleurs), `fn` n'est PAS execute
 * — on saute ce cycle plutot que risquer un double envoi/traitement.
 */
export async function withCronLock(
  namespace: number,
  entityId: number,
  fn: () => Promise<void>,
): Promise<void> {
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${namespace}, ${entityId}) AS acquired`,
  );
  const acquired = (lockResult as any).rows?.[0]?.acquired ?? (lockResult as any)[0]?.acquired;
  if (!acquired) return;
  try {
    await fn();
  } finally {
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(${namespace}, ${entityId})`);
    } catch (err) {
      logger.error({ err }, "[cron-lock] Echec de liberation du verrou");
    }
  }
}
