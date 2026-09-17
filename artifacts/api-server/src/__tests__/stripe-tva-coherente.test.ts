/**
 * Le montant encaisse et le montant facture doivent etre le meme.
 *
 * Mesure le 17/09 : les tarifs sont annonces hors taxes (« TVA en sus ») et
 * services/platform-invoice-issue.ts ajoute 20 % sans condition, mais Stripe
 * ne calcule la TVA que si STRIPE_AUTOMATIC_TAX=1 — variable absente de toute
 * la configuration du depot. Stripe encaissait 29 €, la facture reclamait
 * 34,80 €, et la TVA mentionnee reste due au Tresor meme non encaissee
 * (CGI art. 283-3).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Stripe simule : en test, aucune cle n est configuree, et la route repondrait
// 503 pour cette raison-la. On veut mesurer le refus DU A LA TVA, donc on fait
// comme si Stripe etait pret et on regarde si une session est creee.
const sessionsCreees: unknown[] = [];
vi.mock("../services/stripe-client", () => ({
  isStripeConfigured: async () => true,
  getStripeClient: async () => ({
    customers: { create: async () => ({ id: "cus_test" }) },
    checkout: { sessions: { create: async (p: unknown) => { sessionsCreees.push(p); return { url: "https://checkout.stripe.com/x", id: "cs_test" }; } } },
  }),
  getPriceIdForPlan: (plan: string) => (plan === "essai" ? null : "price_test"),
  getPublicAppUrl: () => "https://exemple.test",
}));
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable } from "@workspace/db";
import router from "../routes/stripe";
import { TAUX_TVA } from "../services/platform-invoice-issue";

const RACINE = join(import.meta.dirname, "..", "..");
let avant: string | undefined;
const stamp = Date.now();
let orgId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: 1, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Tva ${stamp}`, slug: `tva-${stamp}`, email: `tva-${stamp}@example.test`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  await db.insert(subscriptionsTable).values({ organisationId: orgId, plan: "essai", status: "active", price: "0" } as any);
}, 60_000);
afterAll(async () => { try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* best-effort */ } });
beforeEach(() => { avant = process.env.STRIPE_AUTOMATIC_TAX; });
afterEach(() => { if (avant === undefined) delete process.env.STRIPE_AUTOMATIC_TAX; else process.env.STRIPE_AUTOMATIC_TAX = avant; });

describe("TVA : paiement et facture alignes", () => {
  it("la facture plateforme applique bien un taux non nul", () => {
    expect(TAUX_TVA).toBeGreaterThan(0);
  });

  it("sans Stripe Tax, /stripe/status n'annonce pas les paiements configures", async () => {
    delete process.env.STRIPE_AUTOMATIC_TAX;
    const r = await request(appli()).get("/api/stripe/status");
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(false);
    expect(r.body.tvaCalculeeParStripe).toBe(false);
  });

  it("sans Stripe Tax, aucune session de paiement n'est creee", async () => {
    delete process.env.STRIPE_AUTOMATIC_TAX;
    const r = await request(appli()).post("/api/stripe/create-checkout-session").send({ plan: "professionnel" });
    expect([503]).toContain(r.status);
    expect(r.body.url).toBeUndefined();
  });

  it("le refus explique la situation au client sans jargon technique", async () => {
    delete process.env.STRIPE_AUTOMATIC_TAX;
    const r = await request(appli()).post("/api/stripe/create-checkout-session").send({ plan: "professionnel" });
    expect(r.body.error).toMatch(/indisponible|Contactez/i);
    expect(JSON.stringify(r.body)).not.toMatch(/STRIPE_AUTOMATIC_TAX/);
  });

  it("le code source garde le lien entre les deux (garde-fou de lecture)", () => {
    const stripe = readFileSync(join(RACINE, "src", "routes", "stripe.ts"), "utf8");
    expect(stripe).toMatch(/STRIPE_AUTOMATIC_TAX !== "1"/);
    expect(stripe).toMatch(/platform-invoice-issue/);
  });

  it("sans Stripe Tax, Stripe pret ou non, aucune session n est creee", async () => {
    delete process.env.STRIPE_AUTOMATIC_TAX;
    sessionsCreees.length = 0;
    const r = await request(appli()).post("/api/stripe/create-checkout-session").send({ plan: "professionnel" });
    expect(r.status).toBe(503);
    expect(sessionsCreees).toEqual([]);
  });

  it("avec Stripe Tax, la session est creee ET la TVA calculee par Stripe", async () => {
    process.env.STRIPE_AUTOMATIC_TAX = "1";
    sessionsCreees.length = 0;
    const r = await request(appli()).post("/api/stripe/create-checkout-session").send({ plan: "professionnel" });
    expect(r.status).toBe(200);
    expect(sessionsCreees.length).toBe(1);
    expect((sessionsCreees[0] as any).automatic_tax).toEqual({ enabled: true });
    expect((sessionsCreees[0] as any).tax_id_collection).toEqual({ enabled: true });
  });

  it("avec Stripe Tax, /stripe/status annonce les paiements configures", async () => {
    process.env.STRIPE_AUTOMATIC_TAX = "1";
    const r = await request(appli()).get("/api/stripe/status");
    expect([r.body.configured, r.body.tvaCalculeeParStripe]).toEqual([true, true]);
  });
});
