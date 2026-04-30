import { db, invoicesTable, subscriptionsTable, organisationsTable, usersTable, contactsTable, callsTable, PLANS, type PlanKey, OVERAGE_RATES } from "@workspace/db";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export async function generateMonthlyInvoices(periodYear: number, periodMonth: number): Promise<{ generated: number; skipped: number; errors: number }> {
  const result = { generated: 0, skipped: 0, errors: 0 };

  const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 1, 0, 0, 0));
  const periodLabel = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;

  const orgs = await db.select().from(organisationsTable).where(eq(organisationsTable.actif, true));

  for (const org of orgs) {
    try {
      const existing = await db.select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.organisationId, org.id),
          eq(invoicesTable.periodLabel, periodLabel),
        ))
        .limit(1);

      if (existing.length > 0) {
        result.skipped++;
        continue;
      }

      const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, org.id));
      if (!sub) {
        result.skipped++;
        continue;
      }

      const planKey = sub.plan as PlanKey;
      const planConfig = PLANS[planKey];
      if (!planConfig) {
        result.skipped++;
        continue;
      }

      if (planKey === "essai") {
        result.skipped++;
        continue;
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

      await db.insert(invoicesTable).values({
        organisationId: org.id,
        periodLabel,
        periodStart,
        periodEnd,
        plan: planKey,
        baseAmount: String(baseAmount),
        overageAmount: String(overageAmount),
        totalAmount: String(totalAmount),
        currency: sub.currency || "EUR",
        status: "en_attente",
        usageSnapshot,
      });

      result.generated++;
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

    const totalDue = invoices
      .filter(i => i.status === "en_attente" || i.status === "partiel" || i.status === "retard")
      .reduce((sum, i) => sum + Number(i.totalAmount), 0);

    const totalPaid = invoices
      .filter(i => i.status === "payee")
      .reduce((sum, i) => sum + Number(i.totalAmount), 0);

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
