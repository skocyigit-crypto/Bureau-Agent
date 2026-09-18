/**
 * L'usage doit rester vrai meme sans ligne d'abonnement.
 *
 * Mesure le 18/09 sur le banc local : l'ecran « Utilisateurs » recevait 404 sur
 * /subscription/usage pour une organisation sans ligne d'abonnement, et
 * retombait en silence sur un plafond invente de 5 utilisateurs — alors que le
 * plafond REELLEMENT applique est `organisations.max_users`, sur lequel
 * s'appuie le declencheur de quota en base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import router from "../routes/subscriptions";

const stamp = Date.now();
let orgSans = 0, orgAvec = 0;

function appli(orgId: () => number) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: 1, organisationId: orgId(), userRole: "administrateur" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
async function org(n: string, maxUsers: number) {
  const [o] = await db.insert(organisationsTable).values({ name: `Usage ${n} ${stamp}`, slug: `usage-${n}-${stamp}`, maxUsers, actif: true }).returning({ id: organisationsTable.id });
  return o!.id;
}

beforeAll(async () => {
  orgSans = await org("sans", 10);
  orgAvec = await org("avec", 10);
  await db.insert(usersTable).values({ organisationId: orgSans, email: `usage-${stamp}@example.test`, passwordHash: "x", prenom: "U", nom: "S", role: "agent", actif: true });
  await db.insert(subscriptionsTable).values({
    organisationId: orgAvec, plan: "starter", status: "active", price: "29",
    maxUsers: 5, maxContacts: 500, maxCallsPerMonth: 2000, aiEnabled: false, stockEnabled: true, automationEnabled: false,
  } as any);
}, 60_000);
afterAll(async () => {
  for (const o of [orgSans, orgAvec]) { try { await db.delete(organisationsTable).where(eq(organisationsTable.id, o)); } catch { /* best-effort */ } }
});

describe("usage sans ligne d'abonnement", () => {
  it("repond 200 au lieu de 404", async () => {
    expect((await request(appli(() => orgSans)).get("/api/subscription/usage")).status).toBe(200);
  });

  it("annonce le plafond REELLEMENT applique (organisations.max_users)", async () => {
    const r = await request(appli(() => orgSans)).get("/api/subscription/usage");
    expect(r.body.users.max).toBe(10);
  });

  it("compte les utilisateurs existants", async () => {
    const r = await request(appli(() => orgSans)).get("/api/subscription/usage");
    expect(r.body.users.current).toBe(1);
  });

  it("le dit explicitement, pour que l'ecran ne l'invente pas", async () => {
    const r = await request(appli(() => orgSans)).get("/api/subscription/usage");
    expect(r.body.sansAbonnement).toBe(true);
  });

  it("n'annonce aucune fonctionnalite payante", async () => {
    const r = await request(appli(() => orgSans)).get("/api/subscription/usage");
    expect(r.body.features).toEqual({ aiEnabled: false, stockEnabled: false, automationEnabled: false });
  });

  it("les plafonds inconnus sont nuls, pas inventes", async () => {
    const r = await request(appli(() => orgSans)).get("/api/subscription/usage");
    expect([r.body.contacts.max, r.body.callsThisMonth.max]).toEqual([null, null]);
  });
});

describe("usage avec abonnement (inchange)", () => {
  it("le plafond vient de l'abonnement", async () => {
    const r = await request(appli(() => orgAvec)).get("/api/subscription/usage");
    expect(r.body.users.max).toBe(5);
  });

  it("les plafonds contacts et appels sont ceux du plan", async () => {
    const r = await request(appli(() => orgAvec)).get("/api/subscription/usage");
    expect([r.body.contacts.max, r.body.callsThisMonth.max]).toEqual([500, 2000]);
  });

  it("les fonctionnalites du plan sont rendues", async () => {
    const r = await request(appli(() => orgAvec)).get("/api/subscription/usage");
    expect(r.body.features).toEqual({ aiEnabled: false, stockEnabled: true, automationEnabled: false });
  });

  it("aucun drapeau « sans abonnement »", async () => {
    const r = await request(appli(() => orgAvec)).get("/api/subscription/usage");
    expect(r.body.sansAbonnement).toBeUndefined();
  });
});
