/**
 * Cron de l'agent de bureau autonome.
 *
 * Toutes les heures, l'agent vérifie chaque organisation et génère — au plus
 * une fois par jour et par organisation — une nouvelle salve de propositions
 * dans la file d'approbation.
 *
 * Durabilité (cf. mémoire "cron cadence durability"): le garde "une fois par
 * jour" n'est PAS en mémoire — il est dérivé des lignes agent_proposals déjà
 * écrites aujourd'hui (runId `auto-AAAA-MM-JJ`). Un redémarrage du serveur ne
 * provoque donc jamais de double génération.
 */
import { db } from "@workspace/db";
import { organisationsTable, agentProposalsTable } from "@workspace/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { proposeActionsForOrg } from "./autonomous-secretary";

const TICK_MS = 60 * 60 * 1000; // 1h
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

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

  try {
    const orgs = await withDbRetry(
      () => db.select({ id: organisationsTable.id }).from(organisationsTable),
      { label: "autonomous-secretary:orgs" },
    );

    for (const org of orgs) {
      try {
        // Garde "une fois par jour" persistant: déjà généré aujourd'hui ?
        const existing = await withDbRetry(
          () => db.select({ id: agentProposalsTable.id })
            .from(agentProposalsTable)
            .where(and(
              eq(agentProposalsTable.organisationId, org.id),
              eq(agentProposalsTable.runId, runId),
              gte(agentProposalsTable.createdAt, todayStart),
            ))
            .limit(1),
          { label: "autonomous-secretary:existing-proposal" },
        );
        if (existing.length > 0) continue;

        await proposeActionsForOrg(org.id, runId);
      } catch (err) {
        logger.warn({ err, orgId: org.id }, "[SecretaryCron] Échec pour une organisation");
      }
    }
  } catch (err) {
    logger.error({ err }, "[SecretaryCron] Erreur du cycle");
  } finally {
    running = false;
  }
}

export function startAutonomousSecretaryCron(): void {
  if (intervalHandle) return;
  logger.info("[SecretaryCron] Agent de bureau autonome démarré");

  // Premier passage différé de 90s pour ne pas alourdir le démarrage.
  setTimeout(() => { tick().catch(() => {}); }, 90 * 1000);
  intervalHandle = setInterval(() => { tick().catch(() => {}); }, TICK_MS);

  const shutdown = () => {
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
