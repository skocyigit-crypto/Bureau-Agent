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

/**
 * Délai entre l'encaissement d'une facture et le reversement de sa TVA.
 *
 * Une CA3 mensuelle se paie entre le 15 et le 24 du mois suivant: l'écart
 * réel va de ~20 à ~50 jours selon la date d'encaissement dans le mois. On
 * retient 35 jours, le milieu de cette plage.
 */
const DELAI_REVERSEMENT_TVA_JOURS = Number(process.env.TREASURY_VAT_REMITTANCE_DAYS ?? 35);
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


/**
 * Retard de paiement tire d'une loi LOGNORMALE de meme moyenne et de meme
 * ecart-type que les parametres annonces.
 *
 * POURQUOI CHANGER DE LOI
 *
 * Le tirage etait `sampleNormal(12, 5)`. Deux consequences mesurees le 16/09,
 * et les deux vont dans le meme sens — celui qui rassure :
 *
 *   - la loi normale n'a pratiquement pas de queue a droite. Avec 12 et 5,
 *     P(retard > 30 j) = 0,016 % et P(retard > 45 j) = 0,000 %. Or ce modele
 *     sert a estimer une probabilite de RUPTURE DE TRESORERIE, et ce sont
 *     precisement les paiements tres tardifs qui la provoquent. Le modele
 *     declarait donc quasi impossible le seul evenement qu'il devait
 *     anticiper ;
 *   - elle tire des retards NEGATIFS dans 0,82 % des cas — un client qui paie
 *     avant l'echeance — que `if (day < 0) day = 0` ecretait ensuite en
 *     silence, ce qui deplacait la moyenne effective vers le haut sans que
 *     personne ne l'ait choisi.
 *
 * La lognormale est bornee a zero par construction et asymetrique a droite,
 * ce qu'est un delai de paiement. A moyenne et ecart-type IDENTIQUES,
 * P(retard > 30 j) passe de 0,016 % a 0,64 % — quarante fois plus de queue,
 * sans qu'aucun chiffre annonce ne change.
 *
 * Les deux moments restent pilotes par TREASURY_DELAY_MEAN_DAYS et
 * TREASURY_DELAY_STD_DAYS : augmenter l'ecart-type epaissit la queue.
 *
 * CE QUI N'EST PAS FAIT ICI, ET POURQUOI
 *
 * Les sources publiques 2026 se contredisent : Altares situe le retard moyen
 * du batiment a 8 jours, et d'autres publications avancent que 47 % des
 * factures du secteur sont reglees avec plus de 30 jours de retard. Les deux
 * ne peuvent pas etre vraies ensemble — 47 % au-dela de 30 jours imposerait
 * une moyenne d'au moins 14 jours. On ne calibre donc rien sur ces chiffres :
 * on corrige la FAMILLE de loi, qui est defendable independamment, et on
 * laisse la calibration a l'exploitant.
 */
function sampleDelayDays(mean: number, std: number): number {
  if (!(mean > 0)) return 0;
  const variance = std * std;
  const sigma2 = Math.log(1 + variance / (mean * mean));
  const sigma = Math.sqrt(sigma2);
  const mu = Math.log(mean) - sigma2 / 2;
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(mu + sigma * z);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

interface CollectibleInvoice {
  remaining: number; // reste à payer (TTC), > 0
  collectible: number; // montant réellement encaissé (HT si autoliquidation, sinon TTC)
  /**
   * TVA contenue dans l'encaissement, et donc DUE AU TRESOR.
   *
   * Zero en autoliquidation (aucune TVA facturée) et zéro en franchise.
   */
  vatCollected: number;
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

    // TVA encaissée = part de TVA du reste à payer. Elle transite par la
    // trésorerie de l'entreprise mais ne lui appartient pas : elle est
    // reversée au Trésor le mois suivant.
    const taxAmount = Number(r.taxAmount ?? 0);
    const vatRatio = total > 0 ? Math.max(0, Math.min(1, taxAmount / total)) : 0;
    const vatCollected = autoliq ? 0 : remaining * vatRatio;

    collectibles.push({ remaining, collectible, daysUntilDue, vatCollected });

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
  opts: { simulations?: number; vatRemittanceDays?: number } = {},
): Promise<TreasuryRiskResult> {
  const now = new Date();
  const simulations = Math.max(100, Math.min(20000, opts.simulations ?? DEFAULT_SIMULATIONS));
  // Surchargeable pour que l'effet du reversement soit MESURABLE: comparer la
  // meme organisation avec la TVA qui sort dans l'horizon puis au-dela est la
  // seule facon de prouver que la correction change le resultat, et pas
  // seulement le texte du module.
  const delaiTva = Math.max(0, opts.vatRemittanceDays ?? DELAI_REVERSEMENT_TVA_JOURS);

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
      let day = Math.round(inv.daysUntilDue + sampleDelayDays(DELAY_MEAN, DELAY_STD));
      if (day < 0) day = 0; // facture en retard : encaissement imminent, jamais avant aujourd'hui
      if (day <= HORIZON_DAYS) {
        inflow[day] += inv.collectible;
        // LA TVA N'EST PAS DE LA TRESORERIE DISPONIBLE.
        //
        // Elle était comptée comme telle: une facture encaissée TTC entrait
        // en entier, et rien ne la faisait ressortir. Or la TVA collectée est
        // reversée au Trésor le mois suivant l'encaissement (virement entre
        // le 15 et le 24 pour une CA3 mensuelle). Sur une activité au taux
        // normal, c'était donc un cinquième de chaque encaissement compté
        // comme disponible alors qu'il ne l'était pas — et toujours dans le
        // sens rassurant, sur un modèle dont l'objet est justement d'annoncer
        // une rupture.
        //
        // Approximation assumée: on reverse JOUR_REVERSEMENT_TVA jours après
        // l'encaissement plutôt qu'à la date exacte de la CA3. L'écart est de
        // quelques jours; l'omission valait des dizaines de milliers d'euros.
        const jourTva = day + delaiTva;
        if (jourTva <= HORIZON_DAYS) inflow[jourTva] -= inv.vatCollected;
      }
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
