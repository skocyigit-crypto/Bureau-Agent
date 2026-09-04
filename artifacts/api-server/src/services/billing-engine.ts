import { db, invoicesTable, subscriptionsTable, organisationsTable, usersTable, contactsTable, callsTable, PLANS, type PlanKey, OVERAGE_RATES } from "@workspace/db";
import { emettreFacturePlateforme } from "./platform-invoice-issue";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { withCronLock, CRON_LOCK_NAMESPACE } from "../lib/cron-lock";
import { logger } from "../lib/logger";

/**
 * Genere les factures mensuelles de la plateforme.
 *
 * `mode` (defaut "brouillon"): les factures sont creees avec le statut
 * `brouillon` et n'entrent dans aucun calcul d'impaye tant qu'un super-admin
 * ne les a pas validees (POST /license-management/invoices/validate-drafts).
 * Ce sont des documents comptables envoyes a des clients payants — ils ne
 * doivent pas se finaliser tout seuls dans le dos d'un humain. Passer "direct"
 * retablit l'ancien comportement (finalisation immediate) pour l'organisation
 * qui l'a explicitement choisi via `billingRequiresApproval = false`.
 *
 * Note: ces factures ne peuvent PAS passer par la file d'approbation
 * (agent_proposals), qui est scopee a une organisation — le locataire y
 * approuverait sa propre facture. La validation est donc cote super-admin.
 */
export async function generateMonthlyInvoices(
  periodYear: number,
  periodMonth: number,
  mode: "brouillon" | "direct" = "brouillon",
): Promise<{ generated: number; skipped: number; errors: number }> {
  const result = { generated: 0, skipped: 0, errors: 0 };

  const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 1, 0, 0, 0));
  const periodLabel = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;

  const orgs = await db.select().from(organisationsTable).where(eq(organisationsTable.actif, true));

  for (const org of orgs) {
    try {
      // Verrou par organisation avant de decider s'il faut facturer.
      //
      // Le controle « une facture existe-t-elle deja pour cette periode ? »
      // est un SELECT suivi d'un INSERT: entre les deux, une autre instance
      // peut faire le meme constat et inserer aussi. Il n'existe aucune
      // contrainte d'unicite sur (organisation, periode) pour rattraper —
      // l'index unique de cette table ne porte que sur l'identifiant Stripe,
      // absent des factures produites ici. Le resultat serait deux factures
      // pour le meme mois, sur le meme client.
      //
      // La course n'est pas hypothetique: `startBillingCron` lance un tick
      // des le demarrage (rattrapage), et Cloud Run demarre plusieurs
      // instances a la fois pendant un deploiement (maxScale=3).
      //
      // `withCronLock` existe deja pour exactement ce motif, et son propre
      // commentaire decrit ce schema SELECT-puis-ecriture; la facturation
      // avait ete oubliee alors que c'est le cron dont l'erreur coute le plus
      // cher. Si le verrou est pris ailleurs, on saute: l'autre instance fait
      // le travail.
      await withCronLock(CRON_LOCK_NAMESPACE.billing, org.id, async () => {
        const existing = await db.select({ id: invoicesTable.id })
          .from(invoicesTable)
          .where(and(
            eq(invoicesTable.organisationId, org.id),
            eq(invoicesTable.periodLabel, periodLabel),
          ))
          .limit(1);

        if (existing.length > 0) {
          result.skipped++;
          return;
        }

        const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, org.id));
        if (!sub) {
          result.skipped++;
          return;
        }

        const planKey = sub.plan as PlanKey;
        const planConfig = PLANS[planKey];
        if (!planConfig) {
          result.skipped++;
          return;
        }

        if (planKey === "essai") {
          result.skipped++;
          return;
        }

        const [userCount] = await db.select({ count: sql<number>`count(*)::int` })
          .from(usersTable)
          .where(eq(usersTable.organisationId, org.id));

        const [contactCount] = await db.select({ count: sql<number>`count(*)::int` })
          .from(contactsTable)
          .where(eq(contactsTable.organisationId, org.id));

        const [callCount] = await db.select({ count: sql<number>`count(*)::int` })
          .from(callsTable)
          .where(and(
            eq(callsTable.organisationId, org.id),
            gte(callsTable.createdAt, periodStart),
            lt(callsTable.createdAt, periodEnd),
          ));

        const users = userCount?.count ?? 0;
        const contacts = contactCount?.count ?? 0;
        const calls = callCount?.count ?? 0;

        const extraUsers = Math.max(0, users - sub.maxUsers);
        const extraContacts = Math.max(0, contacts - sub.maxContacts);
        const extraCalls = Math.max(0, calls - sub.maxCallsPerMonth);

        const extraUsersAmount = extraUsers * OVERAGE_RATES.extraUserPerMonth;
        const extraContactsAmount = Math.ceil(extraContacts / 100) * OVERAGE_RATES.extraContactsPer100;
        const extraCallsAmount = Math.ceil(extraCalls / 100) * OVERAGE_RATES.extraCallsPer100;

        const baseAmount = planConfig.price;
        const overageAmount = extraUsersAmount + extraContactsAmount + extraCallsAmount;
        const totalAmount = baseAmount + overageAmount;

        const usageSnapshot = {
          users: { current: users, max: sub.maxUsers, overage: extraUsers },
          contacts: { current: contacts, max: sub.maxContacts, overage: extraContacts },
          calls: { current: calls, max: sub.maxCallsPerMonth, overage: extraCalls },
          overageDetails: {
            extraUsers,
            extraUsersAmount,
            extraContacts,
            extraContactsAmount,
            extraCalls,
            extraCallsAmount,
          },
        };

        const emiseDirectement = mode === "direct" || !org.billingRequiresApproval;

        const [creee] = await db.insert(invoicesTable).values({
          organisationId: org.id,
          periodLabel,
          periodStart,
          periodEnd,
          plan: planKey,
          baseAmount: String(baseAmount),
          overageAmount: String(overageAmount),
          totalAmount: String(totalAmount),
          currency: sub.currency || "EUR",
          // Une org peut opter pour la finalisation directe; sinon la facture
          // reste un brouillon jusqu'a validation humaine.
          status: emiseDirectement ? "en_attente" : "brouillon",
          usageSnapshot,
        }).returning({ id: invoicesTable.id });

        // Numero, date, TVA et identite de l'acheteur — seulement si la facture
        // part vraiment. Numeroter un brouillon qui peut etre abandonne
        // ouvrirait un trou dans la sequence, ce que le CGI interdit.
        if (emiseDirectement && creee) {
          await emettreFacturePlateforme(creee.id);
        }

      result.generated++;
      });
    } catch (err: any) {
      result.errors++;
      logger.error({ err: err.message }, `[Billing] Erreur org ${org.id}:`);
    }
  }

  return result;
}

export async function getOrgBillingSummary(orgId: number) {
  try {
    const invoices = await db.select()
      .from(invoicesTable)
      .where(eq(invoicesTable.organisationId, orgId))
      .orderBy(sql`${invoicesTable.periodStart} DESC`)
      .limit(12);

    // « Ce que je dois » est un montant TTC: c'est ce que le client vire.
    // Sommer le HT afficherait un du inferieur a la realite. Les factures
    // anterieures a la TVA portent un `totalTtc` a zero — on retombe alors sur
    // le HT, qui etait bien le montant reclame a l'epoque.
    const duMontant = (i: { totalTtc: string; totalAmount: string }): number => {
      const ttc = Number(i.totalTtc);
      return ttc > 0 ? ttc : Number(i.totalAmount);
    };

    const totalDue = invoices
      .filter(i => i.status === "en_attente" || i.status === "partiel" || i.status === "retard")
      .reduce((sum, i) => sum + duMontant(i), 0);

    const totalPaid = invoices
      .filter(i => i.status === "payee")
      .reduce((sum, i) => sum + duMontant(i), 0);

    const lastInvoice = invoices[0] || null;

    return {
      invoices,
      totalDue: totalDue.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      lastInvoice,
      invoiceCount: invoices.length,
    };
  } catch (error) {
    logger.error({ err: error }, `[BillingEngine] getOrgBillingSummary error for org ${orgId}:`);
    return {
      invoices: [],
      totalDue: "0.00",
      totalPaid: "0.00",
      lastInvoice: null,
      invoiceCount: 0,
    };
  }
}
