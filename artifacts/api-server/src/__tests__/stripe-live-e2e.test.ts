/**
 * Test e2e RÉEL du flux d'abonnement Stripe (mode TEST uniquement).
 *
 * Sauté automatiquement si `STRIPE_SECRET_KEY` (sk_test_…) est absent, donc
 * inoffensif dans CI / runs locaux sans clé. Quand la clé test est présente :
 *
 *  1. Crée les 3 produits + prix EUR mensuels (29 / 79 / 199) dans le compte
 *     Stripe TEST (si pas déjà créés ce run).
 *  2. Crée un client + moyen de paiement test (carte 4242) et un abonnement
 *     RÉEL sur le prix « professionnel » => Stripe émet une vraie facture payée.
 *  3. Récupère les VRAIS objets Stripe (subscription, invoice) et les passe aux
 *     mêmes handlers que le webhook (`handleSubscriptionUpdated`,
 *     `handleInvoicePaid`) pour vérifier la synchronisation DB de bout en bout
 *     contre des charges utiles réelles — y compris la double livraison
 *     invoice.paid / invoice.payment_succeeded (1 seule ligne facture).
 *  4. Nettoie : annule l'abonnement, supprime le client, archive produits/prix,
 *     supprime l'org + facture + abonnement de test.
 *
 * `license-audit` / `email` mockés (hors objet du test ; le trigger append-only
 * de license_audit_log empêcherait sinon la suppression de l'org de test).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/license-audit", () => ({
  logLicenseEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/email", () => ({
  sendSubscriptionSuspendedEmail: vi.fn().mockResolvedValue(undefined),
  sendSubscriptionRecoveredEmail: vi.fn().mockResolvedValue(undefined),
}));

import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import {
  db,
  organisationsTable,
  subscriptionsTable,
  invoicesTable,
} from "@workspace/db";
import { getStripeClient } from "../services/stripe-client";
import { handleInvoicePaid, handleSubscriptionUpdated } from "../services/stripe-sync";

const secret = process.env.STRIPE_SECRET_KEY ?? "";
const isTestKey = secret.startsWith("sk_test_");
const stripe = isTestKey ? await getStripeClient() : null;

const PLAN_DEFS = [
  { plan: "starter", name: "Agent de Bureau — Starter", amount: 2900 },
  { plan: "professionnel", name: "Agent de Bureau — Professionnel", amount: 7900 },
  { plan: "entreprise", name: "Agent de Bureau — Entreprise", amount: 19900 },
] as const;

const stamp = Date.now();
let orgId: number;
let customerId: string | null = null;
let subscriptionId: string | null = null;
const createdProductIds: string[] = [];
const priceIds: Record<string, string> = {};

describe.skipIf(!isTestKey || !stripe)("Stripe e2e RÉEL (mode test)", () => {
  beforeAll(async () => {
    const s = stripe!;
    // 1) Produits + prix EUR mensuels.
    for (const def of PLAN_DEFS) {
      const product = await s.products.create({ name: `${def.name} ${stamp}` });
      createdProductIds.push(product.id);
      const price = await s.prices.create({
        product: product.id,
        unit_amount: def.amount,
        currency: "eur",
        recurring: { interval: "month" },
      });
      priceIds[def.plan] = price.id;
    }
    // Mappe le prix « professionnel » pour exercer le chemin getPlanForPriceId().
    process.env.STRIPE_PRICE_PROFESSIONNEL = priceIds.professionnel;

    // 2) Client + carte test 4242 + abonnement réel sur « professionnel ».
    const customer = await s.customers.create({
      name: `E2E Test ${stamp}`,
      email: `e2e-${stamp}@example.test`,
    });
    customerId = customer.id;
    const pm = await s.paymentMethods.attach("pm_card_visa", { customer: customer.id });
    await s.customers.update(customer.id, {
      invoice_settings: { default_payment_method: pm.id },
    });
    const sub = await s.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceIds.professionnel }],
      metadata: { plan: "professionnel" },
      expand: ["latest_invoice"],
    });
    subscriptionId = sub.id;

    // 3) Org + ligne abonnement de test reliée au client Stripe réel.
    const [org] = await db
      .insert(organisationsTable)
      .values({
        name: `Stripe E2E Org ${stamp}`,
        slug: `stripe-e2e-${stamp}`,
        maxUsers: 5,
        actif: true,
      })
      .returning({ id: organisationsTable.id });
    orgId = org.id;
    await db.insert(subscriptionsTable).values({
      organisationId: orgId,
      plan: "essai",
      status: "active",
      stripeCustomerId: customer.id,
      maxUsers: 3,
      maxContacts: 100,
      maxCallsPerMonth: 500,
      aiEnabled: false,
    });
  }, 60000);

  afterAll(async () => {
    const s = stripe;
    try {
      if (s && subscriptionId) await s.subscriptions.cancel(subscriptionId);
    } catch {
      /* best-effort */
    }
    try {
      if (s && customerId) await s.customers.del(customerId);
    } catch {
      /* best-effort */
    }
    try {
      if (s) {
        for (const id of Object.values(priceIds)) {
          await s.prices.update(id, { active: false });
        }
        for (const pid of createdProductIds) {
          await s.products.update(pid, { active: false });
        }
      }
    } catch {
      /* best-effort */
    }
    try {
      if (orgId) {
        await db.delete(invoicesTable).where(eq(invoicesTable.organisationId, orgId));
        await db
          .delete(subscriptionsTable)
          .where(eq(subscriptionsTable.organisationId, orgId));
        await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
      }
    } catch {
      /* best-effort */
    }
  }, 60000);

  it("synchronise un abonnement Stripe réel -> plan actif côté DB (chemin price id)", async () => {
    const s = stripe!;
    const sub = (await s.subscriptions.retrieve(subscriptionId!)) as Stripe.Subscription;
    await handleSubscriptionUpdated(sub);
    const [row] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, orgId));
    expect(row?.plan).toBe("professionnel");
    expect(row?.status).toBe("active");
    expect(row?.aiEnabled).toBe(true);
    expect(row?.stripeSubscriptionId).toBe(subscriptionId);
  });

  it("la double livraison invoice.paid / invoice.payment_succeeded n'écrit qu'UNE facture", async () => {
    const s = stripe!;
    const invoices = await s.invoices.list({ customer: customerId!, limit: 1 });
    const invoice = invoices.data[0];
    expect(invoice).toBeTruthy();
    expect(invoice.status).toBe("paid");
    // Même facture livrée deux fois (deux types d'events, même invoice id).
    await handleInvoicePaid(invoice);
    await handleInvoicePaid(invoice);
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.stripeInvoiceId, invoice.id!));
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("payee");
  });
});
