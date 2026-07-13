/**
 * Régression du flux de synchronisation Stripe (mise en vente — audit paiement).
 *
 * Couvre deux bugs corrigés avant la mise en vente, contre la VRAIE base dev
 * (aucune clé Stripe requise — on appelle directement les handlers avec des
 * objets Stripe simulés ayant la forme réelle des webhooks) :
 *
 *  1. 🔴 Facture en double — un seul paiement réussi déclenche À LA FOIS
 *     `invoice.paid` ET `invoice.payment_succeeded` (deux event ids distincts
 *     => le dédoublonnage par event id laisse passer les deux). On vérifie que
 *     la clé d'unicité `stripeInvoiceId` n'écrit qu'UNE ligne facture par
 *     paiement, même si le handler est invoqué deux fois.
 *  2. 🟠 Résolution du plan — quand le price id Stripe ne correspond à aucun
 *     `STRIPE_PRICE_*` (env mal configurée), le plan doit retomber sur
 *     `subscription.metadata.plan` au lieu de laisser le plan/limites figés.
 *
 * `license-audit` et `email` sont mockés : ce ne sont pas l'objet du test, et
 * le trigger append-only de `license_audit_log` (no_delete) empêcherait sinon
 * la suppression de l'org de test en fin de suite.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
// Force getPlanForPriceId() à retourner null pour des price ids inconnus,
// afin de tester le repli sur metadata.plan de façon déterministe.
delete process.env.STRIPE_PRICE_STARTER;
delete process.env.STRIPE_PRICE_PROFESSIONNEL;
delete process.env.STRIPE_PRICE_ENTREPRISE;

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
import { handleInvoicePaid, handleSubscriptionUpdated } from "../services/stripe-sync";

const stamp = Date.now();
const customerId = `cus_test_${stamp}`;
let orgId: number;

function mockInvoice(id: string): Stripe.Invoice {
  return {
    id,
    customer: customerId,
    currency: "eur",
    amount_paid: 7900,
    amount_due: 7900,
    period_start: 1700000000,
    period_end: 1702592000,
    lines: { data: [{ period: { start: 1700000000, end: 1702592000 } }] },
  } as unknown as Stripe.Invoice;
}

function mockSub(opts: {
  id: string;
  priceId: string;
  plan?: string;
  status?: Stripe.Subscription.Status;
}): Stripe.Subscription {
  return {
    id: opts.id,
    customer: customerId,
    status: opts.status ?? "active",
    metadata: opts.plan ? { plan: opts.plan } : {},
    items: {
      data: [
        {
          price: { id: opts.priceId },
          current_period_start: 1700000000,
          current_period_end: 1702592000,
        },
      ],
    },
    canceled_at: null,
    cancel_at_period_end: false,
    cancel_at: null,
  } as unknown as Stripe.Subscription;
}

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Stripe Sync Test ${stamp}`,
      slug: `stripe-sync-test-${stamp}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;
  await db.insert(subscriptionsTable).values({
    organisationId: orgId,
    plan: "essai",
    status: "active",
    stripeCustomerId: customerId,
    maxUsers: 3,
    maxContacts: 100,
    maxCallsPerMonth: 500,
    aiEnabled: false,
  });
});

afterAll(async () => {
  try {
    await db.delete(invoicesTable).where(eq(invoicesTable.organisationId, orgId));
    await db
      .delete(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch {
    // best-effort : ids uniques par run grâce au stamp.
  }
});

describe("Stripe sync — facture en double (invoice.paid + invoice.payment_succeeded)", () => {
  it("deux livraisons du MÊME invoice id n'écrivent qu'une seule ligne facture", async () => {
    const invId = `in_test_${stamp}`;
    await handleInvoicePaid(mockInvoice(invId)); // invoice.paid
    await handleInvoicePaid(mockInvoice(invId)); // invoice.payment_succeeded (même id)
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.stripeInvoiceId, invId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("payee");
    expect(rows[0]?.totalAmount).toBe("79.00");
  });

  it("des invoice ids DISTINCTS créent bien des lignes distinctes (pas de sur-blocage)", async () => {
    const invId2 = `in_test2_${stamp}`;
    await handleInvoicePaid(mockInvoice(invId2));
    const rows = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.organisationId, orgId));
    expect(rows.length).toBe(2);
  });
});

describe("Stripe sync — résolution du plan via metadata (repli quand price id inconnu)", () => {
  it("plan + limites résolus depuis metadata.plan quand le price id ne matche aucun env", async () => {
    await handleSubscriptionUpdated(
      mockSub({
        id: `sub_${stamp}`,
        priceId: `price_unknown_${stamp}`,
        plan: "professionnel",
      }),
    );
    const [s] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, orgId));
    expect(s?.plan).toBe("professionnel");
    expect(s?.aiEnabled).toBe(true);
    expect(s?.maxUsers).toBe(15);
    expect(s?.maxContacts).toBe(5000);
  });

  it("metadata.plan invalide ('essai' ou inconnu) ne dégrade PAS le plan existant", async () => {
    await handleSubscriptionUpdated(
      mockSub({ id: `sub_${stamp}`, priceId: `price_unknown_${stamp}`, plan: "essai" }),
    );
    let [s] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, orgId));
    expect(s?.plan).toBe("professionnel");

    await handleSubscriptionUpdated(
      mockSub({ id: `sub_${stamp}`, priceId: `price_unknown_${stamp}`, plan: "n_importe_quoi" }),
    );
    [s] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, orgId));
    expect(s?.plan).toBe("professionnel");
  });
});
