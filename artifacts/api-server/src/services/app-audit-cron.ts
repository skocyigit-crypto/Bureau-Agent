/**
 * Cron de l'agent d'auto-audit ("Oto-Denetim Ajanı").
 *
 * Toutes les heures, l'agent inspecte chaque organisation et génère — au plus
 * une fois par jour et par organisation — une nouvelle salve de constats
 * (eksik/yenilik) dans `app_audit_findings`.
 *
 * Durabilité (cf. secrétaire autonome): le garde "une fois par jour" n'est PAS
 * en mémoire — il est dérivé des lignes app_audit_findings déjà écrites
 * aujourd'hui (runId `auto-AAAA-MM-JJ`). Un redémarrage ne provoque donc jamais
 * de double génération.
 */
import { db } from "@workspace/db";
import { organisationsTable, appAuditFindingsTable } from "@workspace/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { runAuditForOrg } from "./app-audit";
import { withHeartbeat } from "./health-agents";

const TICK_MS = 60 * 60 * 1000; // 1h
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Garde "déjà tenté aujourd'hui" en mémoire, par runId du jour. Évite de
 * relancer l'IA toutes les heures pour une organisation dont l'audit n'a
 * produit aucun constat (donc aucune ligne en base pour servir de marqueur
 * durable). Au redémarrage, le garde durable basé sur les lignes prend le
 * relais dès qu'il existe au moins un constat du jour.
 */
let attemptedToday: { runId: string; orgIds: Set<number> } = { runId: "", orgIds: new Set() };

function todayRunId(): string {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `auto-${iso}`;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  const runId = todayRunId();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // Nouveau jour: réinitialise le garde mémoire.
  if (attemptedToday.runId !== runId) {
    attemptedToday = { runId, orgIds: new Set() };
  }

  try {
    const orgs = await withDbRetry(
      () => db.select({ id: organisationsTable.id }).from(organisationsTable),
      { label: "audit-cron:list-orgs" },
    );

    for (const org of orgs) {
      try {
        // Garde mémoire: déjà tenté ce jour-ci dans ce process (couvre les
        // runs sans constat, qui n'écrivent aucune ligne marqueur).
        if (attemptedToday.orgIds.has(org.id)) continue;

        // Garde "une fois par jour" persistant: déjà audité aujourd'hui ?
        const existing = await withDbRetry(
          () => db.select({ id: appAuditFindingsTable.id })
            .from(appAuditFindingsTable)
            .where(and(
              eq(appAuditFindingsTable.organisationId, org.id),
              eq(appAuditFindingsTable.runId, runId),
              gte(appAuditFindingsTable.createdAt, todayStart),
            ))
            .limit(1),
          { label: `audit-cron:already-audited:org=${org.id}` },
        );
        if (existing.length > 0) { attemptedToday.orgIds.add(org.id); continue; }

        await runAuditForOrg(org.id, runId);
        // Marque comme tenté seulement après succès (une erreur transitoire
        // pourra être réessayée au prochain tick).
        attemptedToday.orgIds.add(org.id);
      } catch (err) {
        logger.warn({ err, orgId: org.id }, "[AppAuditCron] Échec pour une organisation");
      }
    }
  } catch (err) {
    logger.error({ err }, "[AppAuditCron] Erreur du cycle");
  } finally {
    running = false;
  }
}

export function startAppAuditCron(): void {
  if (intervalHandle) return;
  logger.info("[AppAuditCron] Agent d'auto-audit démarré");

  // Premier passage différé de 120s pour ne pas alourdir le démarrage.
  setTimeout(() => { tick().catch(() => {}); }, 120 * 1000);
  intervalHandle = setInterval(withHeartbeat("app-audit", TICK_MS, tick), TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
