/**
 * Régression de l'idempotence du webhook Stripe (machine à états).
 *
 * Prouve que l'endpoint `/api/stripe/webhook` NE perd PAS un événement quand
 * son handler échoue : l'ancien code marquait l'event comme traité AVANT
 * d'exécuter le handler, donc un handler en erreur (500) déclenchait un retry
 * Stripe qui était ensuite ignoré comme « doublon » -> action métier jamais
 * rejouée (paiement/abonnement non synchronisé).
 *
 * Nouveau comportement vérifié :
 *   1. handler échoue   -> 500, ligne laissée en `processing` (PAS `processed`).
 *   2. retry, handler OK -> 200 (rejoué, PAS dédoublonné), ligne `processed`.
 *   3. retry après succès -> 200 `deduped`, handler PAS rappelé.
 *
 * Les handlers `stripe-sync` sont mockés : l'objet du test est la logique
 * d'idempotence de la ROUTE, pas les handlers (couverts ailleurs).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";
process.env.STRIPE_SECRET_KEY =
  process.env.STRIPE_SECRET_KEY ?? "sk_test_dummy_for_construct_event";
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test_dummy_secret_for_signing";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { invoiceHandler } = vi.hoisted(() => ({ invoiceHandler: vi.fn() }));

vi.mock("../services/stripe-sync", () => ({
  handleCheckoutCompleted: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionUpdated: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionDeleted: vi.fn().mockResolvedValue(undefined),
  handleInvoicePaid: invoiceHandler,
  handleInvoicePaymentFailed: vi.fn().mockResolvedValue(undefined),
}));

import Stripe from "stripe";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, stripeWebhookEventsTable } from "@workspace/db";
import app from "../app";

const sigStripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const eventId = `evt_wh_test_${Date.now()}`;
const payload = JSON.stringify({
  id: eventId,
  object: "event",
  type: "invoice.paid",
  data: { object: { id: "in_wh_test", object: "invoice", customer: "cus_wh_test" } },
});
const sigHeader = sigStripe.webhooks.generateTestHeaderString({
  payload,
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
});

function postEvent() {
  return request(app)
    .post("/api/stripe/webhook")
    .set("stripe-signature", sigHeader)
    .set("Content-Type", "application/json")
    .send(payload);
}

async function rowStatus(): Promise<string | null> {
  const [row] = await db
    .select({ status: stripeWebhookEventsTable.status })
    .from(stripeWebhookEventsTable)
    .where(eq(stripeWebhookEventsTable.eventId, eventId))
    .limit(1);
  return row?.status ?? null;
}

beforeEach(() => {
  invoiceHandler.mockReset();
});

afterAll(async () => {
  try {
    await db
      .delete(stripeWebhookEventsTable)
      .where(eq(stripeWebhookEventsTable.eventId, eventId));
  } catch {
    /* best-effort */
  }
});

describe("Webhook Stripe — idempotence machine à états (pas de perte d'event sur échec)", () => {
  it("un handler en échec renvoie 500 et laisse l'event en 'processing' (rejouable)", async () => {
    invoiceHandler.mockRejectedValueOnce(new Error("boom transitoire"));
    const res = await postEvent();
    expect(res.status).toBe(500);
    expect(await rowStatus()).toBe("processing");
    expect(invoiceHandler).toHaveBeenCalledTimes(1);
  });

  it("le retry est REJOUÉ (pas dédoublonné) puis marqué 'processed'", async () => {
    invoiceHandler.mockResolvedValueOnce(undefined);
    const res = await postEvent();
    expect(res.status).toBe(200);
    expect(res.body.deduped).toBeUndefined();
    expect(invoiceHandler).toHaveBeenCalledTimes(1);
    expect(await rowStatus()).toBe("processed");
  });

  it("un retry APRÈS succès est dédoublonné et ne rappelle pas le handler", async () => {
    const res = await postEvent();
    expect(res.status).toBe(200);
    expect(res.body.deduped).toBe(true);
    expect(invoiceHandler).toHaveBeenCalledTimes(0);
    expect(await rowStatus()).toBe("processed");
  });
});
