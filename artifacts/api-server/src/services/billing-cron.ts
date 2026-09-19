import { generateMonthlyInvoices } from "./billing-engine";
import { db, invoicesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { withHeartbeat } from "./health-agents";
import { basculerFacturesEnRetard } from "./factures-en-retard";
import { basculerDevisExpires } from "./devis-expires";

let lastRunMonth: string | null = null;
let timer: NodeJS.Timeout | null = null;

function periodLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function runForMonth(year: number, month: number): Promise<void> {
  const label = periodLabel(year, month);
  if (lastRunMonth === label) return;
  // Cross-instance safety: skip if invoices already exist for this period
  const [existing] = await withDbRetry(
    () => db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoicesTable)
      .where(eq(invoicesTable.periodLabel, label)),
    { label: "billing-cron:existing-invoices" },
  );
  if ((existing?.count ?? 0) > 0) {
    logger.info({ periodLabel: label, existing: existing?.count }, "[billing-cron] period already has invoices, skipping");
    lastRunMonth = label;
    return;
  }
  lastRunMonth = label;
  logger.info({ year, month }, "[billing-cron] generating monthly invoices");
  try {
    const result = await generateMonthlyInvoices(year, month);
    logger.info({ ...result, year, month }, "[billing-cron] invoices generated");
  } catch (err) {
    logger.error({ err, year, month }, "[billing-cron] failed");
    lastRunMonth = null; // allow retry next tick
  }
}

async function tick(): Promise<void> {
  const now = new Date();

  // Le statut « retard » etait lu partout et ecrit nulle part: le montant en
  // retard du tableau de bord valait toujours zero. Voir
  // `basculerFacturesEnRetard`. Fait a chaque passage, pas seulement le 1er du
  // mois: une facture echoit le jour ou elle echoit.
  try {
    const bascules = await basculerFacturesEnRetard(now);
    if (bascules.length > 0) {
      logger.info({ factures: bascules.length }, "[billing-cron] factures passees en retard");
    }
  } catch (err) {
    // Une erreur ici ne doit pas empecher la generation mensuelle.
    logger.error({ err }, "[billing-cron] bascule des factures en retard en echec");
  }

  // Meme oubli cote devis: `expire` etait un statut reconnu, `valid_until`
  // une colonne remplie, et rien ne rapprochait les deux. Un devis de l'an
  // dernier restait convertible en facture, a son ancien prix.
  try {
    const expires = await basculerDevisExpires(now);
    if (expires.length > 0) {
      logger.info({ devis: expires.length }, "[billing-cron] devis passes en expire");
    }
  } catch (err) {
    logger.error({ err }, "[billing-cron] bascule des devis expires en echec");
  }

  // Generate for previous month if we are in current month and haven't run yet
  // Triggers any time after day 1 02:00 UTC
  if (now.getUTCDate() === 1 && now.getUTCHours() < 2) return;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  await runForMonth(prev.getUTCFullYear(), prev.getUTCMonth() + 1);
}

export function startBillingCron(): void {
  if (timer) return;
  // Catch-up on startup (handles missed scheduled runs after downtime)
  void tick();
  // Then check every hour
  timer = setInterval(withHeartbeat("billing", 60 * 60 * 1000, tick), 60 * 60 * 1000);
  logger.info("[billing-cron] started — hourly check, generates previous-month invoices (catch-up enabled, dedupe via existing invoices)");
}

export function stopBillingCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
