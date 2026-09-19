/**
 * Rapprocher un paiement soldait la facture, quel qu'en soit le montant.
 *
 * `/billing/payments/:id/assign` posait `status: "payee"` d'office. Un virement
 * de 5 EUR rapproche d'une facture de 490 EUR la declarait reglee :
 *
 *  - l'editeur perdait 485 EUR, et plus rien ne signalait l'impaye — la
 *    facture quittait le total « en attente » du tableau de bord ;
 *  - la licence restait ouverte, `invalidateLicenseCache` suivant ce statut ;
 *  - l'ecart etait durable, puisque rien ne recalculait ensuite.
 *
 * Un paiement partiel n'a pourtant rien d'exotique : acompte, virement tronque,
 * frais bancaires preleves en route.
 *
 * Le statut est desormais DERIVE de la somme des paiements rapproches, lue
 * dans la meme transaction. Reference : `totalTtc`, ce que le client doit —
 * `totalAmount` est le HT, et le prendre pour reference soldait la facture
 * avant la TVA.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, paymentsTable, usersTable } from "@workspace/db";
import billingRouter from "../routes/billing";
import { centimes, statutFacturePlateforme } from "../services/reglement-facture-plateforme";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "super_admin" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", billingRouter);
  return a;
}

/** Une facture de plateforme de 490 EUR TTC. */
async function facture(ttc = "490.00"): Promise<number> {
  const [f] = await db.insert(invoicesTable).values({
    organisationId: orgId,
    periodLabel: "2026-09",
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-30"),
    plan: "pro",
    totalAmount: "408.33",
    vatRate: "20.00",
    vatAmount: "81.67",
    totalTtc: ttc,
    currency: "EUR",
    status: "en_attente",
  } as any).returning({ id: invoicesTable.id });
  return f!.id;
}

async function paiement(montant: string): Promise<number> {
  const [p] = await db.insert(paymentsTable).values({
    amount: montant, currency: "EUR", source: "bank_upload", status: "pending",
  } as any).returning({ id: paymentsTable.id });
  return p!.id;
}

async function statutDe(id: number) {
  const [f] = await db.select({ status: invoicesTable.status, paidAt: invoicesTable.paidAt })
    .from(invoicesTable).where(eq(invoicesTable.id, id));
  return f!;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Partiel ${stamp}`, slug: `partiel-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `partiel-${stamp}@example.test`,
    passwordHash: "x", prenom: "P", nom: "T", role: "super_admin", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("la regle, isolement", () => {
  it("rien d'encaisse laisse la facture en attente", () => {
    expect(statutFacturePlateforme(49000, 0)).toBe("en_attente");
  });

  it("un paiement insuffisant rend « partiel »", () => {
    expect(statutFacturePlateforme(49000, 500), "5 EUR ne soldent pas 490 EUR").toBe("partiel");
  });

  it("le compte juste solde la facture", () => {
    expect(statutFacturePlateforme(49000, 49000)).toBe("payee");
  });

  it("un trop-percu la solde aussi", () => {
    expect(statutFacturePlateforme(49000, 50000)).toBe("payee");
  });

  it("une facture de montant nul est soldee, pas eternellement en attente", () => {
    expect(statutFacturePlateforme(0, 100)).toBe("payee");
  });

  it("on compte en centimes, pas en flottants", () => {
    // 0.1 + 0.2 > 0.3 en flottant: une facture resterait « partielle » a un
    // centime pres, pour toujours.
    expect(centimes("0.1") + centimes("0.2")).toBe(centimes("0.30"));
  });

  it("un `numeric` rendu en chaine est compris", () => {
    expect(centimes("490.00")).toBe(49000);
  });
});

describe("le rapprochement, contre la base", () => {
  it("un paiement partiel ne solde pas la facture", async () => {
    const f = await facture();
    const p = await paiement("5.00");
    const r = await request(appli()).post(`/api/billing/payments/${p}/assign`).send({ invoiceId: f });
    expect(r.status).toBe(200);
    expect((await statutDe(f)).status, "un virement de 5 EUR soldait une facture de 490 EUR").toBe("partiel");
  });

  it("et ne pose pas de date de reglement", async () => {
    const f = await facture();
    const p = await paiement("5.00");
    await request(appli()).post(`/api/billing/payments/${p}/assign`).send({ invoiceId: f });
    expect((await statutDe(f)).paidAt).toBeNull();
  });

  it("la reponse dit ce qui reste du, au lieu d'annoncer « payee »", async () => {
    const f = await facture();
    const p = await paiement("5.00");
    const r = await request(appli()).post(`/api/billing/payments/${p}/assign`).send({ invoiceId: f });
    expect(r.body.statut).toBe("partiel");
    expect(r.body.message).toMatch(/partiellement/);
  });

  it("le paiement complet, lui, solde bien la facture", async () => {
    const f = await facture();
    const p = await paiement("490.00");
    await request(appli()).post(`/api/billing/payments/${p}/assign`).send({ invoiceId: f });
    const etat = await statutDe(f);
    expect(etat.status, "un correctif qui ne solderait plus rien serait pire").toBe("payee");
    expect(etat.paidAt).not.toBeNull();
  });

  it("deux paiements partiels qui se completent la soldent", async () => {
    const f = await facture();
    await request(appli()).post(`/api/billing/payments/${await paiement("200.00")}/assign`).send({ invoiceId: f });
    expect((await statutDe(f)).status).toBe("partiel");
    await request(appli()).post(`/api/billing/payments/${await paiement("290.00")}/assign`).send({ invoiceId: f });
    expect((await statutDe(f)).status, "la somme des paiements rapproches fait foi").toBe("payee");
  });

  it("le montant du est le TTC, pas le HT", async () => {
    // 408.33 EUR HT pour 490.00 EUR TTC: payer le HT ne solde pas la facture.
    const f = await facture();
    const p = await paiement("408.33");
    await request(appli()).post(`/api/billing/payments/${p}/assign`).send({ invoiceId: f });
    expect((await statutDe(f)).status, "solder sur le HT, c'est offrir la TVA").toBe("partiel");
  });
});
