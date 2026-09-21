/**
 * Suivi periodique des accuses de la plateforme agreee.
 *
 * Une facture deposee part « Pending » ; la plateforme la controle ensuite
 * (antivirus, integrite, conformite) et rend « Ok » ou « Error ». Sans ce
 * suivi, un rejet ne se verrait qu'en ouvrant l'ecran et en demandant la mise
 * a jour — et une facture rejetee n'est, pour l'acheteur et le fisc, jamais
 * arrivee.
 *
 * Declenchement externe uniquement (Cloud Scheduler -> /api/cron/tick), comme
 * les autres taches : sur Cloud Run, un minuteur interne tourne sans CPU. Un
 * verrou par organisation empeche deux instances d'interroger la meme
 * plateforme en meme temps.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, facturesClientTable, plateformesAgreeesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { CRON_LOCK_NAMESPACE, withCronLock } from "../lib/cron-lock";
import { registerRunnableCron } from "./cron-registry";
import { recordCronHeartbeat } from "./health-agents";
import { raccordementDe, rafraichirAccuses } from "./plateforme-agreee-suivi";

export const CRON_PA = "plateforme-agreee-accuses";
export const TICK_PA_MS = 30 * 60 * 1000;

let started = false;
let running = false;

export async function tickPlateformeAgreee(): Promise<number> {
  // Seules les organisations raccordees ET ayant une facture en attente.
  const orgs = await db.selectDistinct({ id: facturesClientTable.organisationId })
    .from(facturesClientTable)
    .innerJoin(plateformesAgreeesTable, eq(plateformesAgreeesTable.organisationId, facturesClientTable.organisationId))
    .where(and(eq(facturesClientTable.paStatut, "Pending"), isNotNull(facturesClientTable.paFlowId), eq(plateformesAgreeesTable.actif, true)));
  let total = 0;
  for (const o of orgs) {
    await withCronLock(CRON_LOCK_NAMESPACE.plateformeAgreee, o.id, async () => {
      const r = await raccordementDe(o.id);
      if (!r) return;
      try {
        total += await rafraichirAccuses(o.id, r);
      } catch (err) {
        // Une plateforme indisponible ne bloque pas les autres organisations.
        logger.warn({ err, orgId: o.id }, "[pa-cron] suivi en echec pour cette organisation");
      }
    });
  }
  return total;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const n = await tickPlateformeAgreee();
    if (n > 0) logger.info({ misesAJour: n }, "[pa-cron] accuses mis a jour");
    await recordCronHeartbeat(CRON_PA, TICK_PA_MS / 1000);
  } catch (err) {
    logger.error({ err }, "[pa-cron] erreur du cycle");
    await recordCronHeartbeat(CRON_PA, TICK_PA_MS / 1000, err instanceof Error ? err.message : "erreur inconnue");
  } finally {
    running = false;
  }
}

export function startPlateformeAgreeeCron(): void {
  if (started) return;
  started = true;
  registerRunnableCron(CRON_PA, TICK_PA_MS, () => tick().catch(() => {}));
}
