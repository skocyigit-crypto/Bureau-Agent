import { pool } from "@workspace/db";
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
  billing: 4304,
  aiInsights: 4305,
  tenantBackup: 4306,
  autopilot: 4307,
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
  await tryWithLock(namespace, entityId, fn);
}

/**
 * Meme verrou, mais qui DIT s'il l'a obtenu.
 *
 * `withCronLock` renvoie `void`: un cron qui saute un cycle n'a personne a
 * prevenir, il repassera dans dix minutes. Une route HTTP, elle, doit pouvoir
 * repondre « un cycle est deja en cours » plutot que « lance » a quelqu'un qui
 * attend une reponse.
 *
 * Rend `false` quand le verrou etait deja pris (ici ou sur une autre
 * instance), sans executer `fn`.
 */
export async function tryWithLock(
  namespace: number,
  entityId: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  // UNE connexion dediee, prise au pool pour toute la duree du verrou.
  //
  // C'est le point delicat, et la version precedente le manquait. Un verrou
  // consultatif `pg_advisory_lock` appartient a la SESSION, c'est-a-dire a la
  // connexion qui l'a pris. Or `db` est un pool de huit connexions et chaque
  // `db.execute` en emprunte une au hasard: la prise et la liberation
  // pouvaient donc partir sur deux connexions differentes. Dans ce cas
  // Postgres refuse la liberation (« you don't own a lock of this type »),
  // personne ne lit ce retour, et le verrou reste detenu par la premiere
  // connexion — jusqu'a ce qu'elle soit fermee pour inactivite, trente
  // secondes plus tard, ou bien plus tard sous charge puisqu'elle est alors
  // reutilisee en permanence.
  //
  // Pendant tout ce temps, chaque nouveau cycle du cron protege echouait a
  // prendre le verrou et se sautait lui-meme, en silence. Exactement le mode
  // de panne que ce depot a deja vecu plusieurs fois: rien ne casse, plus rien
  // ne se produit. Et de facon non deterministe, puisque le pool rend souvent
  // la meme connexion — ce qui explique que le defaut soit passe inapercu.
  //
  // Cout assume: une connexion sur huit immobilisee pendant la tache. Les
  // crons s'executent en sequence (cf. runDueCrons), donc une a la fois.
  const client = await pool.connect();
  let acquired = false;
  try {
    const res = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [namespace, entityId],
    );
    acquired = res.rows?.[0]?.acquired === true;
    if (!acquired) return false;
    await fn();
    return true;
  } finally {
    if (acquired) {
      try {
        // Meme connexion que la prise: la liberation aboutit reellement.
        await client.query("SELECT pg_advisory_unlock($1, $2)", [namespace, entityId]);
      } catch (err) {
        logger.error({ err }, "[cron-lock] Echec de liberation du verrou");
      }
    }
    client.release();
  }
}
