// Pilier BTP — Moteur de risque de trésorerie (Radar de risque, couche client).
//
// 100 % déterministe au sens "aucun coût IA" : tout est du calcul pur sur des
// DONNÉES RÉELLES (factures de l'organisation + paramètres de trésorerie saisis
// par le patron). On ne simule JAMAIS sur des données inventées : si l'org n'a
// pas configuré sa trésorerie (treasury_settings), `analyzeTreasuryRisk` le
// signale (`configured: false`) et n'affiche pas de probabilité bidon.
//
// Cœur : une simulation Monte Carlo sur 90 jours qui estime la probabilité de
// "cash crunch" (solde de trésorerie qui passe sous zéro) en tenant compte :
//   - du solde de caisse courant,
//   - des charges fixes mensuelles (× 3 mois),
//   - des factures clients en attente, encaissées à une date simulée
//     (échéance + retard aléatoire ~ N(loc, scale)),
//   - de l'autoliquidation TVA (encaissement HT vs TTC).

import { db, facturesClientTable, treasurySettingsTable, depensesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 90;

// Statuts de facture "encaissables" : émise / partiellement payée / en retard.
// On exclut brouillon (pas encore envoyée), payee (déjà encaissée) et annulee.
const COLLECTIBLE_STATUSES = ["envoyee", "partiellement_payee", "en_retard"] as const;

// Distribution du retard de paiement (jours au-delà de l'échéance). Réglable via
// env : moyenne et écart-type. Défaut calé sur le comportement BTP France
// (au-delà des 60 jours légaux, ~12 j de retard moyen).
const DELAY_MEAN = Number(process.env.TREASURY_DELAY_MEAN_DAYS ?? 12);
const DELAY_STD = Number(process.env.TREASURY_DELAY_STD_DAYS ?? 5);
// Terme par défaut si une facture n'a pas d'échéance explicite (jours).
const DEFAULT_TERMS_DAYS = Number(process.env.TREASURY_DEFAULT_TERMS_DAYS ?? 45);
// Nombre de simulations (borné pour rester rapide même dans le cron).
const DEFAULT_SIMULATIONS = Number(process.env.TREASURY_SIMULATIONS ?? 2000);
// Seuil d'alerte (haut) : au-delà, on remonte un avertissement "cash crunch".
export const CASH_CRUNCH_THRESHOLD = Number(process.env.TREASURY_RISK_THRESHOLD ?? 0.15);
// Seuil de résolution (bas) : une alerte déjà ouverte ne se résout qu'en
// repassant sous ce seuil. L'écart (hystérésis) absorbe le bruit Monte Carlo
// et évite le clignotement de l'alerte d'un tick à l'autre.
export const CASH_CRUNCH_RESOLVE_THRESHOLD = Number(process.env.TREASURY_RISK_RESOLVE_THRESHOLD ?? 0.12);

export interface OverdueInvoice {
  id: number;
  reference: string;
  clientName: string;
  remaining: number;
  dueDate: string | null;
  daysOverdue: number;
}

export interface TreasuryRiskResult {
  configured: boolean;
  currentCash: number;
  monthlyFixedCosts: number;
  defaultAutoliquidation: boolean;
  horizonDays: number;
  pendingCount: number;
  pendingTotal: number;
  expectedCollectible: number;
  overdue: OverdueInvoice[];
  overdueCount: number;
  overdueTotal: number;
  // Dépenses approuvées non payées (sorties de caisse certaines).
  expensesPayableCount: number;
  expensesPayableTotal: number;
  simulation: {
    runs: number;
    insolvencyProbability: number; // 0..1
    projectedP5: number;
    projectedMedian: number;
    projectedP95: number;
    projectedMin: number;
  };
  alert: boolean;
  recommendation: string | null;
}

/** Échantillon N(mean, std) via Box-Muller (pas de dépendance numpy). */
function sampleNormal(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + std * z;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

interface CollectibleInvoice {
  remaining: number; // reste à payer (TTC), > 0
  collectible: number; // montant réellement encaissé (HT si autoliquidation, sinon TTC)
  daysUntilDue: number; // jours jusqu'à l'échéance (négatif si déjà dépassée)
}

/**
 * Charge les factures encaissables de l'org et calcule, pour chacune, le reste
 * à payer et le montant réellement encaissable (HT vs TTC selon autoliquidation).
 */
async function loadCollectibles(
  orgId: number,
  defaultAutoliq: boolean,
  now: Date,
): Promise<{ collectibles: CollectibleInvoice[]; overdue: OverdueInvoice[]; pendingTotal: number }> {
  const rows = await db
    .select()
    .from(facturesClientTable)
    .where(
      and(
        eq(facturesClientTable.organisationId, orgId),
        inArray(facturesClientTable.status, COLLECTIBLE_STATUSES as unknown as string[]),
      ),
    );

  const collectibles: CollectibleInvoice[] = [];
  const overdue: OverdueInvoice[] = [];
  let pendingTotal = 0;

  for (const r of rows) {
    const total = Number(r.totalAmount ?? 0);
    const paid = Number(r.paidAmount ?? 0);
    const remaining = Math.max(0, total - paid);
    if (remaining <= 0) continue;

    pendingTotal += remaining;

    // Part HT encaissée en autoliquidation : reste × (HT / TTC).
    const subtotal = Number(r.subtotal ?? 0);
    const htRatio = total > 0 ? Math.min(1, subtotal / total) : 1;
    const autoliq = r.isAutoliquidation || defaultAutoliq;
    const collectible = autoliq ? remaining * htRatio : remaining;

    const due = r.dueDate ? new Date(r.dueDate) : null;
    const daysUntilDue = due
      ? Math.round((due.getTime() - now.getTime()) / DAY_MS)
      : DEFAULT_TERMS_DAYS;

    collectibles.push({ remaining, collectible, daysUntilDue });

    if (due && due.getTime() < now.getTime()) {
      overdue.push({
        id: r.id,
        reference: r.reference,
        clientName: r.clientName,
        remaining,
        dueDate: due.toISOString(),
        daysOverdue: Math.floor((now.getTime() - due.getTime()) / DAY_MS),
      });
    }
  }

  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { collectibles, overdue, pendingTotal };
}

interface PayableExpense {
  amount: number; // sortie de caisse (TTC)
  dayOut: number; // jour de sortie (0..horizon)
}

/**
 * Charge les dépenses approuvées et non payées de l'org : ce sont des sorties
 * de caisse certaines (pas de hasard). Le jour de sortie est l'échéance si
 * elle existe, sinon la date de la dépense ; toute date passée tombe à jour 0.
 */
async function loadPayableExpenses(
  orgId: number,
  now: Date,
): Promise<{ expenses: PayableExpense[]; payableTotal: number }> {
  const rows = await db
    .select()
    .from(depensesTable)
    .where(
      and(
        eq(depensesTable.organisationId, orgId),
        eq(depensesTable.status, "approuve"),
        eq(depensesTable.paymentStatus, "a_payer"),
      ),
    );

  const expenses: PayableExpense[] = [];
  let payableTotal = 0;
  for (const r of rows) {
    const amount = Number(r.amountTtc ?? 0);
    if (amount <= 0) continue;
    payableTotal += amount;

    const ref = r.dueDate ?? r.expenseDate;
    let dayOut = ref ? Math.round((new Date(ref).getTime() - now.getTime()) / DAY_MS) : 0;
    if (dayOut < 0) dayOut = 0; // dépense due/passée : sortie imminente
    expenses.push({ amount, dayOut });
  }
  return { expenses, payableTotal };
}

/**
 * Analyse complète du risque de trésorerie d'une organisation sur 90 jours.
 * `simulations` permet d'alléger le calcul côté cron.
 */
export async function analyzeTreasuryRisk(
  orgId: number,
  opts: { simulations?: number } = {},
): Promise<TreasuryRiskResult> {
  const now = new Date();
  const simulations = Math.max(100, Math.min(20000, opts.simulations ?? DEFAULT_SIMULATIONS));

  const [settings] = await db
    .select()
    .from(treasurySettingsTable)
    .where(eq(treasurySettingsTable.organisationId, orgId))
    .limit(1);

  const currentCash = settings ? Number(settings.currentCash ?? 0) : 0;
  const monthlyFixedCosts = settings ? Number(settings.monthlyFixedCosts ?? 0) : 0;
  const defaultAutoliquidation = settings ? settings.defaultAutoliquidation : false;
  // La seule présence d'une ligne treasury_settings signifie que le patron a
  // saisi sa trésorerie (la création de la ligne se fait via PUT /settings).
  // Une caisse à 0 est une valeur légitime, pas une absence de configuration.
  const configured = !!settings;

  const { collectibles, overdue, pendingTotal } = await loadCollectibles(
    orgId,
    defaultAutoliquidation,
    now,
  );
  const { expenses, payableTotal: expensesPayableTotal } = await loadPayableExpenses(orgId, now);

  const expectedCollectible = collectibles.reduce((s, c) => s + c.collectible, 0);
  const overdueTotal = overdue.reduce((s, o) => s + o.remaining, 0);
  const expensesPayableCount = expenses.length;

  // Sorties de caisse déterministes des dépenses approuvées : un seul vecteur
  // par jour, réutilisé tel quel dans chaque simulation (aucune part aléatoire).
  const expenseOutflowByDay = new Float64Array(HORIZON_DAYS + 1);
  for (const e of expenses) {
    if (e.dayOut <= HORIZON_DAYS) expenseOutflowByDay[e.dayOut] += e.amount;
  }

  // Sans configuration de trésorerie, on ne fabrique pas de probabilité : on
  // renvoie les factures réelles (overdue/pending) mais une simulation neutre.
  if (!configured) {
    return {
      configured: false,
      currentCash,
      monthlyFixedCosts,
      defaultAutoliquidation,
      horizonDays: HORIZON_DAYS,
      pendingCount: collectibles.length,
      pendingTotal,
      expectedCollectible,
      overdue,
      overdueCount: overdue.length,
      overdueTotal,
      expensesPayableCount,
      expensesPayableTotal,
      simulation: {
        runs: 0,
        insolvencyProbability: 0,
        projectedP5: 0,
        projectedMedian: 0,
        projectedP95: 0,
        projectedMin: 0,
      },
      alert: false,
      recommendation: null,
    };
  }

  // Simulation jour par jour sur l'horizon : on détecte une tension de
  // trésorerie si le solde passe sous zéro À UN MOMENT QUELCONQUE (pas seulement
  // au solde final). Les charges fixes sont lissées par jour (mensuel / 30) et
  // chaque facture est encaissée à une date simulée (échéance + retard normal).
  const dailyFixed = monthlyFixedCosts / 30;
  const forecasts: number[] = new Array(simulations);
  let insolvent = 0;

  for (let i = 0; i < simulations; i++) {
    // Buckets d'encaissement par jour (0..horizon) pour cette simulation.
    const inflow = new Float64Array(HORIZON_DAYS + 1);
    for (const inv of collectibles) {
      let day = Math.round(inv.daysUntilDue + sampleNormal(DELAY_MEAN, DELAY_STD));
      if (day < 0) day = 0; // facture en retard : encaissement imminent, jamais avant aujourd'hui
      if (day <= HORIZON_DAYS) inflow[day] += inv.collectible;
    }

    let cash = currentCash + inflow[0] - expenseOutflowByDay[0];
    let crossed = cash < 0;
    for (let d = 1; d <= HORIZON_DAYS; d++) {
      cash -= dailyFixed;
      cash += inflow[d];
      cash -= expenseOutflowByDay[d];
      if (cash < 0) crossed = true;
    }
    if (crossed) insolvent++;
    forecasts[i] = cash; // solde terminal projeté (pour les percentiles)
  }

  forecasts.sort((a, b) => a - b);
  const insolvencyProbability = insolvent / simulations;
  const alert = insolvencyProbability > CASH_CRUNCH_THRESHOLD;

  let recommendation: string | null = null;
  if (alert) {
    recommendation =
      "Risque de tension de trésorerie élevé sur 90 jours. Échelonnez certains " +
      "paiements de sous-traitants, accélérez les relances des factures en retard, " +
      "ou activez une ligne d'affacturage (factoring) pour sécuriser la caisse.";
  } else if (insolvencyProbability > CASH_CRUNCH_THRESHOLD / 2) {
    recommendation =
      "Trésorerie sous surveillance : marge de sécurité limitée. Suivez de près " +
      "les encaissements et évitez d'engager de grosses dépenses non planifiées.";
  }

  return {
    configured: true,
    currentCash,
    monthlyFixedCosts,
    defaultAutoliquidation,
    horizonDays: HORIZON_DAYS,
    pendingCount: collectibles.length,
    pendingTotal,
    expectedCollectible,
    overdue,
    overdueCount: overdue.length,
    overdueTotal,
    expensesPayableCount,
    expensesPayableTotal,
    simulation: {
      runs: simulations,
      insolvencyProbability,
      projectedP5: percentile(forecasts, 5),
      projectedMedian: percentile(forecasts, 50),
      projectedP95: percentile(forecasts, 95),
      projectedMin: forecasts[0] ?? 0,
    },
    alert,
    recommendation,
  };
}
