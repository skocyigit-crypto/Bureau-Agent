import type Stripe from "stripe";
import { db, subscriptionsTable, invoicesTable, organisationsTable, usersTable, contactsTable, PLANS } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getPlanForPriceId } from "./stripe-client";
import { logLicenseEvent } from "./license-audit";
import { sendSubscriptionSuspendedEmail, sendSubscriptionRecoveredEmail } from "./email";

async function getOrgEmail(orgId: number): Promise<{ email: string | null; name: string }> {
  const [org] = await db.select({ email: organisationsTable.email, name: organisationsTable.name }).from(organisationsTable).where(eq(organisationsTable.id, orgId)).limit(1);
  return { email: org?.email ?? null, name: org?.name ?? "" };
}

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
  const existing = await db
    .select({ status: subscriptionsTable.status, suspensionReason: subscriptionsTable.suspensionReason })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.organisationId, orgId))
    .limit(1);
  const currentStatus = existing[0]?.status ?? null;
  const currentReason = existing[0]?.suspensionReason ?? null;
  const stripeStatus = statusFromStripe(sub.status);
  const isManualSuspended = currentStatus === "suspended" && currentReason === "manual";
  const preserveSuspended = isManualSuspended || (currentStatus === "suspended" && sub.status !== "active" && sub.status !== "trialing");
  const updates: Record<string, unknown> = {
    status: preserveSuspended ? "suspended" : stripeStatus,
    stripeSubscriptionId: sub.id,
    currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : sub.cancel_at_period_end ? new Date((sub.cancel_at ?? periodEnd ?? 0) * 1000) : null,
    updatedAt: new Date(),
  };
  const previousPlan = (await db.select({ plan: subscriptionsTable.plan }).from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1))[0]?.plan ?? null;
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

  if (planFromPrice && planDef && previousPlan && previousPlan !== planFromPrice) {
    const prev = PLANS[previousPlan as keyof typeof PLANS];
    const isUpgrade = prev ? planDef.price > prev.price : false;
    await logLicenseEvent(orgId, isUpgrade ? "plan_upgraded" : "plan_downgraded", `Plan ${previousPlan} -> ${planFromPrice}`, {
      metadata: { from: previousPlan, to: planFromPrice, priceFrom: prev?.price, priceTo: planDef.price },
    });
    if (!isUpgrade) {
      await checkDowngradeQuotaBreach(orgId, planDef);
    }
  }
}

async function checkDowngradeQuotaBreach(orgId: number, planDef: { maxUsers: number; maxContacts: number }) {
  try {
    const [usersAgg] = await db.select({ c: sql<number>`count(*)::int` }).from(usersTable).where(and(eq(usersTable.organisationId, orgId), eq(usersTable.actif, true)));
    const [contactsAgg] = await db.select({ c: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId));
    const breaches: string[] = [];
    if ((usersAgg?.c ?? 0) > planDef.maxUsers) breaches.push(`utilisateurs: ${usersAgg!.c}/${planDef.maxUsers}`);
    if ((contactsAgg?.c ?? 0) > planDef.maxContacts) breaches.push(`contacts: ${contactsAgg!.c}/${planDef.maxContacts}`);
    if (breaches.length > 0) {
      await logLicenseEvent(orgId, "downgrade_quota_breach", `Downgrade depasse limites: ${breaches.join(", ")}`, {
        metadata: { breaches, newLimits: { maxUsers: planDef.maxUsers, maxContacts: planDef.maxContacts } },
      });
      logger.warn({ orgId, breaches }, "[stripe-sync] downgrade depasse les limites");
    }
  } catch (err) {
    logger.warn({ err, orgId }, "[stripe-sync] checkDowngradeQuotaBreach failed");
  }
}

export async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const orgId = await findOrgByCustomer(customerId);
  if (!orgId) return;
  const essai = PLANS.essai;
  await logLicenseEvent(orgId, "subscription_cancelled", "Abonnement Stripe supprime — downgrade vers essai", {
    metadata: { stripeSubscriptionId: sub.id },
  });
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
  const isPaymentSuspension = sub?.status === "suspended" && (sub as any)?.suspensionReason !== "manual";
  if ((sub?.paymentFailedCount ?? 0) > 0 || sub?.status === "past_due" || isPaymentSuspension) {
    const wasSuspended = isPaymentSuspension;
    await db.update(subscriptionsTable).set({
      paymentFailedCount: 0,
      suspendedAt: null,
      suspensionReason: null,
      status: isPaymentSuspension || sub?.status === "past_due" ? "active" : sub?.status ?? "active",
      updatedAt: new Date(),
    }).where(eq(subscriptionsTable.organisationId, orgId));
    logger.info({ orgId }, "[stripe-sync] payment recovered -> compteur reinitialise");
    await logLicenseEvent(orgId, "payment_recovered", "Paiement recupere — compteur d'echecs reinitialise", {
      metadata: { previousStatus: sub?.status, previousFailedCount: sub?.paymentFailedCount },
    });
    if (wasSuspended) {
      const { email: orgEmail, name: orgName } = await getOrgEmail(orgId);
      if (orgEmail) {
        await logLicenseEvent(orgId, "subscription_reactivated", "Abonnement reactive apres paiement", {});
        sendSubscriptionRecoveredEmail({ to: orgEmail, orgName, plan: sub?.plan ?? "starter" })
          .catch(err => logger.warn({ err, orgId }, "[stripe-sync] envoi email recovered echoue"));
      }
    }
  }
  logger.info({ orgId, invoice: invoice.id, total, currency }, "[stripe-sync] invoice.paid recorded");
}

const MAX_PAYMENT_FAILURES_BEFORE_SUSPEND = 3;

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const orgId = await findOrgByCustomer(customerId);
  if (!orgId) return;
  const [current] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1);
  const newCount = (current?.paymentFailedCount ?? 0) + 1;
  const shouldSuspend = newCount >= MAX_PAYMENT_FAILURES_BEFORE_SUSPEND;
  const isManualSuspension = (current as any)?.suspensionReason === "manual";
  const now = new Date();
  if (isManualSuspension) {
    await db.update(subscriptionsTable).set({
      paymentFailedCount: newCount,
      lastPaymentFailedAt: now,
      updatedAt: now,
    }).where(eq(subscriptionsTable.organisationId, orgId));
    await logLicenseEvent(orgId, "payment_failed", `Echec de paiement #${newCount} (suspension manuelle preservee)`, {
      metadata: { invoice: invoice.id, attempts: newCount, manualSuspensionPreserved: true },
    });
    logger.warn({ orgId, invoice: invoice.id, attempts: newCount }, "[stripe-sync] payment failed sur suspension manuelle — statut preserve");
    return;
  }
  await db
    .update(subscriptionsTable)
    .set({
      status: shouldSuspend ? "suspended" : "past_due",
      paymentFailedCount: newCount,
      lastPaymentFailedAt: now,
      suspendedAt: shouldSuspend ? now : current?.suspendedAt ?? null,
      suspensionReason: shouldSuspend ? "payment_failed" : (current as any)?.suspensionReason ?? null,
      updatedAt: now,
    })
    .where(eq(subscriptionsTable.organisationId, orgId));
  const transitionedToSuspended = shouldSuspend && current?.status !== "suspended";
  logger.warn(
    { orgId, invoice: invoice.id, attempts: newCount, suspended: shouldSuspend },
    `[stripe-sync] invoice.payment_failed -> ${shouldSuspend ? "suspended (3+ echecs)" : "past_due"}`,
  );
  await logLicenseEvent(orgId, transitionedToSuspended ? "subscription_suspended" : "payment_failed",
    transitionedToSuspended ? `Suspendu apres ${newCount} echecs consecutifs` : `Echec de paiement #${newCount}`,
    { metadata: { invoice: invoice.id, attempts: newCount } },
  );
  if (transitionedToSuspended) {
    const { email: orgEmail, name: orgName } = await getOrgEmail(orgId);
    if (orgEmail) {
      sendSubscriptionSuspendedEmail({ to: orgEmail, orgName, plan: current?.plan ?? "starter", failedAttempts: newCount })
        .catch(err => logger.warn({ err, orgId }, "[stripe-sync] envoi email suspended echoue"));
    }
  }
}
