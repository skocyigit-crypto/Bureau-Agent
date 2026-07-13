import { Router, type IRouter } from "express";
import { db, subscriptionsTable, organisationsTable, PLANS, type PlanKey } from "@workspace/db";
import { sql, and, eq, ne, isNull, isNotNull, lte, gte, lt } from "drizzle-orm";

const router: IRouter = Router();

/**
 * Tableau de bord SaaS — réservé super-admin (gate posée à l'enregistrement
 * du router dans routes/index.ts via `requireSuperAdmin`).
 *
 * Renvoie:
 *  - metrics: MRR courant, clients payants actifs, essais en cours, churn
 *    mensuel (30 j glissants), taux de conversion essai → payant.
 *  - timeseries (12 mois): MRR mensuel, churn %, conversion %.
 *  - planBreakdown: répartition des clients payants par plan.
 *
 * Tout est calculé à partir de la table `subscriptions` (créée par Stripe via
 * webhooks ou par le flux d'essai interne). On n'appelle pas l'API Stripe en
 * direct : les webhooks `subscription.created/updated/deleted` maintiennent
 * déjà la table à jour, donc la lecture DB est plus fiable et plus rapide.
 */

const PAID_PLANS: PlanKey[] = ["starter", "professionnel", "entreprise"];

function monthlyPriceFor(plan: string, billingCycle: string, price: string | null): number {
  const planData = PLANS[plan as PlanKey];
  // Préférer le prix stocké dans la subscription (peut différer du catalogue
  // si remise / négociation), sinon retomber sur le plan canonique.
  const basePrice = price !== null ? Number(price) : planData ? planData.price : 0;
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
  return billingCycle === "yearly" ? basePrice / 12 : basePrice;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

router.get("/admin/saas-dashboard", async (req, res): Promise<void> => {
  try {
    const subs = await db.select().from(subscriptionsTable);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    // ---- Snapshot courant ---------------------------------------------------
    let mrr = 0;
    let activeCustomers = 0;
    let trialingCustomers = 0;
    const planBreakdown: Record<string, { count: number; mrr: number }> = {};

    for (const s of subs) {
      const isPaid = PAID_PLANS.includes(s.plan as PlanKey);
      const isTrial = s.plan === "essai";
      if (s.status === "active" && isPaid) {
        const m = monthlyPriceFor(s.plan, s.billingCycle, s.price);
        mrr += m;
        activeCustomers += 1;
        const slot = (planBreakdown[s.plan] ||= { count: 0, mrr: 0 });
        slot.count += 1;
        slot.mrr += m;
      } else if (s.status === "active" && isTrial) {
        // Essai encore valide (non expiré).
        if (!s.trialEndsAt || s.trialEndsAt > now) trialingCustomers += 1;
      }
    }

    // ---- Churn 30 j ---------------------------------------------------------
    // Numérateur: subs payantes annulées dans les 30 derniers jours.
    // Dénominateur: subs payantes actives au début de la fenêtre (active
    // aujourd'hui OU annulées dans la fenêtre).
    let churnedLast30 = 0;
    let activeAtWindowStart = 0;
    for (const s of subs) {
      const wasPaid = PAID_PLANS.includes(s.plan as PlanKey);
      if (!wasPaid) continue;
      const cancelled = s.cancelledAt;
      const created = s.createdAt;
      if (cancelled && cancelled >= thirtyDaysAgo && cancelled <= now) {
        churnedLast30 += 1;
      }
      // Considéré actif au début de la fenêtre si créé avant et pas encore
      // annulé à ce moment-là.
      const wasActiveAtStart =
        created <= thirtyDaysAgo && (!cancelled || cancelled > thirtyDaysAgo);
      if (wasActiveAtStart) activeAtWindowStart += 1;
    }
    const churnRate = activeAtWindowStart > 0 ? churnedLast30 / activeAtWindowStart : 0;

    // ---- Conversion essai → payant -----------------------------------------
    // On compte les subs dont la plus ancienne date de création est < 90 j
    // ET qui sont aujourd'hui en plan payant. Faute d'historique d'évènements,
    // on s'appuie sur l'heuristique: une sub passée en payant a déjà commencé
    // par un essai si trialEndsAt est renseigné.
    let trialsStarted90 = 0;
    let trialsConverted90 = 0;
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    for (const s of subs) {
      if (!s.trialEndsAt) continue;
      if (s.createdAt < ninetyDaysAgo) continue;
      trialsStarted90 += 1;
      if (PAID_PLANS.includes(s.plan as PlanKey) && s.status === "active") {
        trialsConverted90 += 1;
      }
    }
    const conversionRate = trialsStarted90 > 0 ? trialsConverted90 / trialsStarted90 : 0;

    // ---- Timeseries 12 mois -------------------------------------------------
    // Pour chaque mois M (de M-11 à M actuel):
    //  - mrr = somme des prix mensuels des subs payantes actives à la fin de M
    //  - churn = annulées pendant M / actives au début de M
    //  - conversion = subs créées en essai pendant M qui sont payantes aujourd'hui / essais créés en M
    const months: Array<{
      month: string;
      mrr: number;
      churnRate: number;
      conversionRate: number;
      activeCustomers: number;
    }> = [];
    const currentMonthStart = startOfMonth(now);
    for (let i = 11; i >= 0; i--) {
      const mStart = addMonths(currentMonthStart, -i);
      const mEnd = addMonths(mStart, 1);
      let monthMrr = 0;
      let monthActive = 0;
      let monthChurned = 0;
      let monthActiveAtStart = 0;
      let monthTrialsStarted = 0;
      let monthTrialsConverted = 0;
      for (const s of subs) {
        const created = s.createdAt;
        const cancelled = s.cancelledAt;
        const isPaidPlan = PAID_PLANS.includes(s.plan as PlanKey);

        // MRR / actives à la fin du mois.
        if (
          isPaidPlan &&
          created < mEnd &&
          (!cancelled || cancelled >= mEnd)
        ) {
          monthMrr += monthlyPriceFor(s.plan, s.billingCycle, s.price);
          monthActive += 1;
        }

        // Churn dans le mois.
        if (isPaidPlan) {
          if (created < mStart && (!cancelled || cancelled >= mStart)) {
            monthActiveAtStart += 1;
          }
          if (cancelled && cancelled >= mStart && cancelled < mEnd) {
            monthChurned += 1;
          }
        }

        // Conversion: essais démarrés dans le mois.
        if (s.trialEndsAt && created >= mStart && created < mEnd) {
          monthTrialsStarted += 1;
          if (isPaidPlan && s.status === "active") monthTrialsConverted += 1;
        }
      }
      months.push({
        month: mStart.toISOString().slice(0, 7),
        mrr: Math.round(monthMrr * 100) / 100,
        churnRate: monthActiveAtStart > 0 ? monthChurned / monthActiveAtStart : 0,
        conversionRate:
          monthTrialsStarted > 0 ? monthTrialsConverted / monthTrialsStarted : 0,
        activeCustomers: monthActive,
      });
    }

    res.json({
      generatedAt: now.toISOString(),
      currency: "EUR",
      metrics: {
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(mrr * 12 * 100) / 100,
        activeCustomers,
        trialingCustomers,
        churnRate,
        churnedLast30,
        conversionRate,
        trialsStarted90,
        trialsConverted90,
      },
      timeseries: months,
      planBreakdown: Object.entries(planBreakdown).map(([plan, v]) => ({
        plan,
        label: PLANS[plan as PlanKey]?.name ?? plan,
        count: v.count,
        mrr: Math.round(v.mrr * 100) / 100,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur admin/saas-dashboard");
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;
