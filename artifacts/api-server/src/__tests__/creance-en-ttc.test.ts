/**
 * Une creance se compte en TTC ; un chiffre d'affaires en HT.
 *
 * `invoices.total_amount` est le HORS TAXES — `services/platform-invoice-issue.ts`
 * le pose ainsi — et `total_ttc` porte ce que le client doit. Le tableau de
 * bord de l'editeur sommait pourtant `total_amount` pour l'encours et les
 * impayes : il annoncait « a encaisser 4 900 EUR » quand les clients devaient
 * 5 880 EUR, soit 20 % de moins.
 *
 * La regle est deja ecrite ailleurs dans le meme fichier, sur la route
 * d'affectation d'un paiement : « `totalTtc` est ce que le client doit.
 * `totalAmount` est le HT : le prendre pour reference soldait la facture avant
 * la TVA. »
 *
 * Ce qui ne devait PAS changer, et que ces controles protegent aussi : le
 * chiffre d'affaires encaisse reste en HT. La TVA collectee n'appartient pas a
 * l'editeur, et la compter dans son revenu serait le defaut symetrique.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/billing";

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
  a.use("/api", router);
  return a;
}

/** Une facture plateforme: 490 HT, 98 de TVA, 588 TTC. */
async function facture(status: string, v: Record<string, unknown> = {}) {
  const [f] = await db.insert(invoicesTable).values({
    organisationId: orgId,
    periodLabel: "2026-09",
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-30"),
    plan: "professionnel",
    baseAmount: "490.00",
    overageAmount: "0.00",
    totalAmount: "490.00",
    vatRate: "20.00",
    vatAmount: "98.00",
    totalTtc: "588.00",
    status,
    ...v,
  } as any).returning();
  return f!;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Creance ${stamp}`, slug: `creance-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `creance-${stamp}@example.test`, passwordHash: "x",
    prenom: "C", nom: "R", role: "super_admin", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(invoicesTable).where(eq(invoicesTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

/**
 * Les totaux du tableau de bord sont GLOBAUX (vue editeur): d'autres suites
 * laissent des factures derriere elles. On mesure donc l'ECART produit par
 * nos propres lignes, pas la valeur absolue.
 */
async function resume() {
  const r = await request(appli()).get("/api/billing/summary");
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { due: Number(r.body.totalDue), paid: Number(r.body.totalPaid), overdue: Number(r.body.overdue) };
}

describe("l'encours annonce ce que les clients doivent", () => {
  it("une facture en attente ajoute son TTC, pas son HT", async () => {
    const avant = await resume();
    const f = await facture("en_attente");
    const apres = await resume();
    expect(apres.due - avant.due, "l'encours est compte hors taxes").toBeCloseTo(588, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });

  it("et surtout pas 490", async () => {
    const avant = await resume();
    const f = await facture("en_attente");
    const apres = await resume();
    expect(apres.due - avant.due).not.toBeCloseTo(490, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });

  it("un impaye aussi", async () => {
    const avant = await resume();
    const f = await facture("retard");
    const apres = await resume();
    expect(apres.overdue - avant.overdue, "les impayes sont comptes hors taxes").toBeCloseTo(588, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });

  it("un reglement partiel compte encore comme creance", async () => {
    const avant = await resume();
    const f = await facture("partiel");
    const apres = await resume();
    expect(apres.due - avant.due).toBeCloseTo(588, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });

  it("une facture anterieure a la TVA retombe sur son HT", async () => {
    // `total_ttc` vaut zero sur ces lignes: le HT etait bien le montant
    // reclame a l'epoque. Sans repli, elles disparaitraient de l'encours.
    const avant = await resume();
    const f = await facture("en_attente", { totalTtc: "0.00", vatAmount: "0.00" });
    const apres = await resume();
    expect(apres.due - avant.due, "les anciennes factures sortent de l'encours").toBeCloseTo(490, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });

  it("une facture payee ne compte plus dans l'encours", async () => {
    const avant = await resume();
    const f = await facture("payee");
    const apres = await resume();
    expect(apres.due - avant.due).toBeCloseTo(0, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });
});

describe("le chiffre d'affaires, lui, reste hors taxes", () => {
  it("une facture payee ajoute son HT", async () => {
    // La TVA collectee n'appartient pas a l'editeur: la compter dans son
    // revenu serait le defaut symetrique de celui qu'on corrige.
    const avant = await resume();
    const f = await facture("payee");
    const apres = await resume();
    expect(apres.paid - avant.paid, "la TVA est comptee comme du revenu").toBeCloseTo(490, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });

  it("et pas son TTC", async () => {
    const avant = await resume();
    const f = await facture("payee");
    const apres = await resume();
    expect(apres.paid - avant.paid).not.toBeCloseTo(588, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });
});

describe("les metriques SaaS suivent la meme regle", () => {
  const metriques = async () => {
    const r = await request(appli()).get("/api/billing/saas-metrics");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return Number(r.body.pendingRevenue?.total ?? 0);
  };

  it("l'encours en attente est en TTC", async () => {
    const avant = await metriques();
    const f = await facture("en_attente");
    const apres = await metriques();
    expect(apres - avant).toBeCloseTo(588, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });

  it("et pas en HT", async () => {
    const avant = await metriques();
    const f = await facture("retard");
    const apres = await metriques();
    expect(apres - avant).not.toBeCloseTo(490, 2);
    await db.delete(invoicesTable).where(eq(invoicesTable.id, f.id));
  });
});
