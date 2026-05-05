import type Stripe from "stripe";
import { db, subscriptionsTable, invoicesTable, organisationsTable, PLANS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getPlanForPriceId } from "./stripe-client";

function statusFromStripe(s: Stripe.Subscription.Status): string {
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "annulee";
    case "incomplete":
    case "incomplete_expired":
      return "en_attente";
    case "unpaid":
      return "past_due";
    case "paused":
      return "pause";
    default:
      return "active";
  }
}

async function findOrgByCustomer(customerId: string): Promise<number | null> {
  const [row] = await db
    .select({ orgId: subscriptionsTable.organisationId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeCustomerId, customerId))
    .limit(1);
  return row?.orgId ?? null;
}

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orgId = Number(session.metadata?.organisationId);
  const plan = session.metadata?.plan;
  if (!orgId || !plan) {
    logger.warn({ session: session.id }, "[stripe-sync] checkout.session.completed missing metadata");
    return;
  }
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!customerId || !subscriptionId) {
    logger.warn({ session: session.id }, "[stripe-sync] checkout missing customer/subscription");
    return;
  }
  const planDef = PLANS[plan as keyof typeof PLANS];
  if (!planDef) return;
  await db
    .update(subscriptionsTable)
    .set({
      plan,
      status: "active",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      maxUsers: planDef.maxUsers,
      maxContacts: planDef.maxContacts,
      maxCallsPerMonth: planDef.maxCallsPerMonth,
      aiEnabled: planDef.aiEnabled,
      stockEnabled: planDef.stockEnabled,
      automationEnabled: planDef.automationEnabled,
      price: String(planDef.price),
      cancelledAt: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.organisationId, orgId));
  logger.info({ orgId, plan, subscriptionId }, "[stripe-sync] checkout completed -> subscription activated");
}

export async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const orgId = await findOrgByCustomer(customerId);
  if (!orgId) {
    logger.warn({ customerId, subscriptionId: sub.id }, "[stripe-sync] subscription update: no matching org");
    return;
  }
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? "";
  const planFromPrice = getPlanForPriceId(priceId);
  const planDef = planFromPrice ? PLANS[planFromPrice as keyof typeof PLANS] : null;
  const itemAny = item as unknown as { current_period_end?: number; current_period_start?: number } | undefined;
  const subAny = sub as unknown as { current_period_end?: number; current_period_start?: number };
  const periodEnd = itemAny?.current_period_end ?? subAny.current_period_end ?? null;
  const periodStart = itemAny?.current_period_start ?? subAny.current_period_start ?? null;
  const updates: Record<string, unknown> = {
    status: statusFromStripe(sub.status),
    stripeSubscriptionId: sub.id,
    currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : sub.cancel_at_period_end ? new Date((sub.cancel_at ?? periodEnd ?? 0) * 1000) : null,
    updatedAt: new Date(),
  };
  if (planFromPrice && planDef) {
    updates.plan = planFromPrice;
    updates.maxUsers = planDef.maxUsers;
    updates.maxContacts = planDef.maxContacts;
    updates.maxCallsPerMonth = planDef.maxCallsPerMonth;
    updates.aiEnabled = planDef.aiEnabled;
    updates.stockEnabled = planDef.stockEnabled;
    updates.automationEnabled = planDef.automationEnabled;
    updates.price = String(planDef.price);
  }
  await db.update(subscriptionsTable).set(updates).where(eq(subscriptionsTable.organisationId, orgId));
  logger.info({ orgId, status: sub.status, plan: planFromPrice }, "[stripe-sync] subscription updated");
}

export async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const orgId = await findOrgByCustomer(customerId);
  if (!orgId) return;
  const essai = PLANS.essai;
  await db
    .update(subscriptionsTable)
    .set({
      plan: "essai",
      status: "annulee",
      cancelledAt: new Date(),
      stripeSubscriptionId: null,
      maxUsers: essai.maxUsers,
      maxContacts: essai.maxContacts,
      maxCallsPerMonth: essai.maxCallsPerMonth,
      aiEnabled: essai.aiEnabled,
      stockEnabled: essai.stockEnabled,
      automationEnabled: essai.automationEnabled,
      price: "0",
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.organisationId, orgId));
  logger.info({ orgId }, "[stripe-sync] subscription deleted -> downgraded to essai");
}

export async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const orgId = await findOrgByCustomer(customerId);
  if (!orgId) return;
  const periodLabel = (() => {
    const item = invoice.lines.data[0];
    const ts = item?.period?.start ?? invoice.period_start ?? Math.floor(Date.now() / 1000);
    const d = new Date(ts * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  const total = ((invoice.amount_paid ?? invoice.amount_due ?? 0) / 100).toFixed(2);
  const currency = (invoice.currency || "eur").toUpperCase();
  const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : new Date();
  const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : new Date();
  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1);
  await db.insert(invoicesTable).values({
    organisationId: orgId,
    periodLabel,
    periodStart,
    periodEnd,
    plan: sub?.plan ?? "starter",
    baseAmount: total,
    overageAmount: "0",
    totalAmount: total,
    currency,
    status: "payee",
    paidAt: new Date(),
    notes: `Stripe invoice ${invoice.id}`,
  }).onConflictDoNothing?.().catch(() => {});
  logger.info({ orgId, invoice: invoice.id, total, currency }, "[stripe-sync] invoice.paid recorded");
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const orgId = await findOrgByCustomer(customerId);
  if (!orgId) return;
  await db
    .update(subscriptionsTable)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptionsTable.organisationId, orgId));
  logger.warn({ orgId, invoice: invoice.id }, "[stripe-sync] invoice.payment_failed -> past_due");
}
