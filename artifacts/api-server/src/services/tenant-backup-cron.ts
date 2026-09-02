/**
 * Sauvegarde quotidienne, une par organisation active.
 *
 * Trois proprietes reprises des crons deja corrects du depot:
 *   - inscrite au registre du declencheur externe via `withHeartbeat`, sinon
 *     elle ne tournerait qu'au hasard des instances eveillees (min-instances=0);
 *   - verrou par organisation, pour que deux instances ne prennent pas la meme
 *     sauvegarde deux fois;
 *   - garde « deja fait aujourd'hui » derivee des LIGNES DEJA ECRITES, pas d'un
 *     drapeau en memoire: un redemarrage ne provoque donc pas de seconde prise.
 */
import { eq } from "drizzle-orm";
import { db, organisationsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { withCronLock, CRON_LOCK_NAMESPACE } from "../lib/cron-lock";
import { withHeartbeat } from "./health-agents";
import { createOrganisationBackup, hasBackupSince, purgeBackupsOlderThan } from "./tenant-backup";

const TICK_MS = 60 * 60 * 1000; // verifie chaque heure si l'heure est venue
const RUN_HOUR_UTC = 2; // ~3-4 h en France: hors des heures d'usage
/** Filet: au-dela, une sauvegarde ne sert plus a personne et pese en base. */
const HARD_RETENTION_DAYS = 60;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function runDailyBackups(): Promise<{ created: number; skipped: number; failed: number }> {
  const orgs = await withDbRetry(
    () => db.select({ id: organisationsTable.id, name: organisationsTable.name })
      .from(organisationsTable)
      .where(eq(organisationsTable.actif, true)),
    { label: "tenant-backup-cron:orgs" },
  );

  const since = startOfTodayUtc();
  let created = 0, skipped = 0, failed = 0;

  for (const org of orgs) {
    try {
      if (await hasBackupSince(org.id, since)) { skipped++; continue; }
      await withCronLock(CRON_LOCK_NAMESPACE.tenantBackup, org.id, async () => {
        // Re-verifie sous verrou: une autre instance a pu la prendre entre
        // notre controle et l'obtention du verrou.
        if (await hasBackupSince(org.id, since)) { skipped++; return; }
        await createOrganisationBackup(org.id, { origin: "auto" });
        created++;
      });
    } catch (err) {
      failed++;
      logger.error({ err, orgId: org.id }, "[tenant-backup-cron] sauvegarde echouee");
    }
  }

  const purged = await purgeBackupsOlderThan(HARD_RETENTION_DAYS).catch(() => 0);
  logger.info({ orgs: orgs.length, created, skipped, failed, purged }, "[tenant-backup-cron] cycle termine");
  return { created, skipped, failed };
}

async function tick(): Promise<void> {
  if (running) return;
  if (new Date().getUTCHours() !== RUN_HOUR_UTC) return;
  running = true;
  try {
    await runDailyBackups();
  } finally {
    running = false;
  }
}

export function startTenantBackupCron(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(withHeartbeat("tenant-backup", TICK_MS, tick), TICK_MS);
  intervalHandle.unref?.();
  logger.info({ hourUtc: RUN_HOUR_UTC }, "[tenant-backup-cron] planificateur demarre");

  const shutdown = () => stopTenantBackupCron();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export function stopTenantBackupCron(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
