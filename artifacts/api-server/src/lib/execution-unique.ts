/**
 * Reclamer une periode de travail : une seule instance l'obtient, et la
 * reclamation reste meme si le travail ne produit rien.
 *
 * Complement du verrou consultatif (lib/cron-lock.ts), qui empeche deux
 * instances de travailler EN MEME TEMPS mais s'oublie des qu'il est relache :
 * une instance qui lit sa liste avant le verrou refaisait ensuite une
 * organisation deja traitee. Ici la trace est durable pour la periode.
 */
import { and, eq, lt } from "drizzle-orm";
import { db, cronExecutionsTable } from "@workspace/db";

/** Periode = numero de tranche de `dureeMs` depuis l'epoque (tranches fixes, communes a toutes les instances). */
export function tranche(dureeMs: number, instant: Date = new Date()): string {
  return String(Math.floor(instant.getTime() / Math.max(60_000, dureeMs)));
}

/** true si CETTE instance obtient (job, entite, periode) ; false si deja reclame. */
export async function reclamerExecution(job: string, entityId: number, periode: string): Promise<boolean> {
  const lignes = await db.insert(cronExecutionsTable)
    .values({ job, entityId, periode })
    .onConflictDoNothing()
    .returning({ id: cronExecutionsTable.id });
  return lignes.length > 0;
}

/** Rend la periode quand le travail a echoue, pour qu'un passage suivant le refasse. */
export async function abandonnerExecution(job: string, entityId: number, periode: string): Promise<void> {
  await db.delete(cronExecutionsTable).where(and(
    eq(cronExecutionsTable.job, job), eq(cronExecutionsTable.entityId, entityId), eq(cronExecutionsTable.periode, periode),
  ));
}

export async function purgerExecutions(avant: Date = new Date(Date.now() - 60 * 86400_000)): Promise<number> {
  const r = await db.delete(cronExecutionsTable).where(lt(cronExecutionsTable.createdAt, avant)).returning({ id: cronExecutionsTable.id });
  return r.length;
}
