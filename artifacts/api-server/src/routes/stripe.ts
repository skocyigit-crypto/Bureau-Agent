import { Router, type Request, type Response, raw } from "express";
import type Stripe from "stripe";
import { db, subscriptionsTable, organisationsTable, usersTable, stripeWebhookEventsTable, PLANS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";
import {
  getStripe,
  isStripeConfigured,
  getPriceIdForPlan,
  getPublicAppUrl,
} from "../services/stripe-client";
import {
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from "../services/stripe-sync";

// Webhook router uses RAW body — must mount BEFORE express.json
export const stripeWebhookRouter: Router = Router();

stripeWebhookRouter.post(
  "/api/stripe/webhook",
  raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) {
      res.status(503).json({ error: "Stripe webhook non configure" });
      return;
    }
    const sig = req.headers["stripe-signature"];
    if (!sig || typeof sig !== "string") {
      res.status(400).json({ error: "Signature manquante" });
      return;
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
    } catch (err) {
      logger.warn({ err }, "[stripe-webhook] invalid signature");
      res.status(400).json({ error: "Signature invalide" });
      return;
    }
    // Idempotency: dedupe by event.id (Stripe retries failed deliveries).
    // The schema has event_id as PRIMARY KEY, so onConflictDoNothing is safe.
    // If the dedupe insert itself fails (DB outage, etc.) we return 500 so
    // Stripe retries later. Processing a paid invoice twice can double-charge
    // / double-credit the customer; a transient retry is the safer failure
    // mode than a silent "continue anyway".
    try {
      const inserted = await db
        .insert(stripeWebhookEventsTable)
        .values({ eventId: event.id, eventType: event.type })
        .onConflictDoNothing({ target: stripeWebhookEventsTable.eventId })
        .returning({ eventId: stripeWebhookEventsTable.eventId });
      if (inserted.length === 0) {
        logger.info({ eventId: event.id, type: event.type }, "[stripe-webhook] duplicate event skipped");
        res.json({ received: true, deduped: true });
        return;
      }
    } catch (err) {
      logger.error({ err, eventId: event.id, type: event.type }, "[stripe-webhook] dedupe insert failed - asking Stripe to retry");
      res.status(500).json({ error: "Dedupe store unavailable, retry later" });
      return;
    }
    try {
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case "invoice.paid":
        case "invoice.payment_succeeded":
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;
        case "invoice.payment_failed":
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        default:
          logger.debug({ type: event.type }, "[stripe-webhook] unhandled event");
      }
      res.json({ received: true });
    } catch (err) {
      logger.error({ err, type: event.type }, "[stripe-webhook] handler failed");
      res.status(500).json({ error: "Webhook handler failed" });
    }
  }
);

// Authenticated router (mounted under /api with auth+tenant)
const router: Router = Router();

router.get("/stripe/status", (_req: Request, res: Response) => {
  res.json({
    configured: isStripeConfigured(),
    prices: {
      starter: Boolean(process.env.STRIPE_PRICE_STARTER),
      professionnel: Boolean(process.env.STRIPE_PRICE_PROFESSIONNEL),
      entreprise: Boolean(process.env.STRIPE_PRICE_ENTREPRISE),
    },
    portalConfigured: Boolean(process.env.STRIPE_PORTAL_RETURN_URL || true),
  });
});

router.post("/stripe/create-checkout-session", async (req: Request, res: Response) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Paiements Stripe non actives. Contactez l'administrateur." });
    return;
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise" });
    return;
  }
  const plan = String(req.body?.plan || "");
  if (!(plan in PLANS) || plan === "essai") {
    res.status(400).json({ error: "Plan invalide" });
    return;
  }
  const priceId = getPriceIdForPlan(plan);
  if (!priceId) {
    res.status(400).json({ error: `Prix Stripe non configure pour le plan ${plan}` });
    return;
  }
  try {
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId)).limit(1);
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1);
    let customerId = sub?.stripeCustomerId ?? null;
    if (!customerId) {
      const userId = (req.session as { userId?: number }).userId;
      const [user] = userId
        ? await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1)
        : [undefined];
      const customer = await stripe.customers.create({
        email: user?.email || org?.email || undefined,
        name: org?.name || undefined,
        metadata: { organisationId: String(orgId) },
      });
      customerId = customer.id;
      await db
        .update(subscriptionsTable)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(subscriptionsTable.organisationId, orgId));
    }
    const baseUrl = getPublicAppUrl();
    // Opt-in VAT/TVA handling (off by default to avoid breaking checkout in envs
    // where Stripe Tax isn't configured). Set STRIPE_AUTOMATIC_TAX=1 once Stripe Tax
    // is enabled in the dashboard: Stripe then computes French/EU VAT, collects the
    // buyer's address, and lets B2B customers enter a VAT id (reverse-charge).
    const automaticTaxEnabled = process.env.STRIPE_AUTOMATIC_TAX === "1";
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/buro-ajani/parametres?stripe=success`,
      cancel_url: `${baseUrl}/buro-ajani/parametres?stripe=cancel`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { organisationId: String(orgId), plan },
      },
      metadata: { organisationId: String(orgId), plan },
    };
    if (automaticTaxEnabled) {
      params.automatic_tax = { enabled: true };
      params.customer_update = { address: "auto", name: "auto" };
      params.tax_id_collection = { enabled: true };
    }
    const session = await stripe.checkout.sessions.create(params);
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    logger.error({ err, orgId, plan }, "[stripe] create-checkout-session failed");
    res.status(500).json({ error: "Impossible de creer la session de paiement" });
  }
});

router.post("/stripe/create-portal-session", async (req: Request, res: Response) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Stripe non configure" });
    return;
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise" });
    return;
  }
  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1);
  if (!sub?.stripeCustomerId) {
    res.status(400).json({ error: "Aucun client Stripe lie. Veuillez d'abord souscrire a un plan." });
    return;
  }
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${getPublicAppUrl()}/buro-ajani/parametres`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    logger.error({ err, orgId }, "[stripe] create-portal-session failed");
    res.status(500).json({ error: "Impossible d'ouvrir le portail de facturation" });
  }
});

router.post("/stripe/cancel-subscription", async (req: Request, res: Response) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Stripe non configure" });
    return;
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise" });
    return;
  }
  const immediate = Boolean(req.body?.immediate);
  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1);
  if (!sub?.stripeSubscriptionId) {
    res.status(400).json({ error: "Aucun abonnement Stripe actif" });
    return;
  }
  try {
    if (immediate) {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } else {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    }
    res.json({
      ok: true,
      message: immediate
        ? "Abonnement annule immediatement."
        : "Abonnement annule. Il restera actif jusqu'a la fin de la periode en cours.",
    });
  } catch (err) {
    logger.error({ err, orgId }, "[stripe] cancel-subscription failed");
    res.status(500).json({ error: "Impossible d'annuler l'abonnement" });
  }
});

router.post("/stripe/resume-subscription", async (req: Request, res: Response) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Stripe non configure" });
    return;
  }
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise" });
    return;
  }
  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)).limit(1);
  if (!sub?.stripeSubscriptionId) {
    res.status(400).json({ error: "Aucun abonnement Stripe" });
    return;
  }
  try {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false });
    res.json({ ok: true, message: "Abonnement reactive." });
  } catch (err) {
    logger.error({ err, orgId }, "[stripe] resume failed");
    res.status(500).json({ error: "Impossible de reactiver l'abonnement" });
  }
});

export default router;
