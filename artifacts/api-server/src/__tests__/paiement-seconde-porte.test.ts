/**
 * Deux portes menent au meme fait comptable ; une seule etait gardee.
 *
 * `POST /api/encaissements` refuse depuis le 18/09 un montant superieur au
 * reste a payer (409 `depasse_reste_a_payer`). Mais `POST
 * /api/license-management/record-payment` inscrit le MEME fait — un reglement
 * sur une facture client — et le traitait autrement : `Math.min` ramenait le
 * cumul au total de la facture.
 *
 * Saisir 1 000,00 sur une facture de 120,00 enregistrait donc 120,00 et
 * repondait « facture soldee ». Le surplus disparaissait sans trace : les
 * livres cessaient de correspondre a la banque, et la faute de frappe restait
 * invisible a celui qui l'avait commise.
 *
 * Une garde qu'une autre route contourne ne garde rien. Ces controles fixent
 * les deux portes sur la meme regle.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/license-management";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

async function facture(total = "120.00", dejaPaye = "0") {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId,
    reference: `LM-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Travaux", clientName: "Client", status: "envoyee",
    items: [], subtotal: "100.00", taxAmount: "20.00",
    totalAmount: total, paidAmount: dejaPaye, currency: "EUR",
  } as any).returning({ id: facturesClientTable.id });
  return f!.id;
}

const enregistrer = (corps: Record<string, unknown>) =>
  request(appli()).post("/api/license-management/record-payment").send(corps);

const lire = async (id: number) =>
  (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0];

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Paiement ${stamp}`, slug: `paiement-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `paiement-${stamp}@example.test`,
    passwordHash: "x", prenom: "P", nom: "A", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux en ajout seul */ }
});

describe("un montant superieur au reste a payer", () => {
  it("est refuse au lieu d'etre tronque", async () => {
    const id = await facture("120.00");
    const r = await enregistrer({ factureClientId: id, amount: 1000 });
    expect(r.status, "le trop-percu passait et la facture etait dite soldee").toBe(409);
    expect(r.body.code).toBe("depasse_reste_a_payer");
  });

  it("ne touche pas a la facture", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 1000 });
    const f = await lire(id);
    expect(Number(f.paidAmount)).toBe(0);
    expect(f.status, "facture marquee payee par un montant refuse").not.toBe("payee");
  });

  it("dit ce qui reste du, pour que la saisie soit corrigeable", async () => {
    const id = await facture("120.00", "20.00");
    const r = await enregistrer({ factureClientId: id, amount: 500 });
    expect(r.body.resteAPayer).toBe("100.00");
  });

  it("le dit autrement quand la facture est deja soldee", async () => {
    const id = await facture("120.00", "120.00");
    const r = await enregistrer({ factureClientId: id, amount: 10 });
    expect(r.body.error).toMatch(/deja entierement reglee/i);
  });

  it("renvoie vers l'avoir, qui est la forme comptable du trop-percu", async () => {
    const id = await facture("120.00");
    const r = await enregistrer({ factureClientId: id, amount: 200 });
    expect(r.body.remediation).toMatch(/avoir/i);
  });
});

describe("les reglements legitimes passent toujours", () => {
  it("un acompte est enregistre et laisse la facture ouverte", async () => {
    const id = await facture("120.00");
    const r = await enregistrer({ factureClientId: id, amount: 50 });
    expect(r.status).toBe(200);
    expect(r.body.isFullyPaid).toBe(false);
    expect(Number((await lire(id)).paidAmount)).toBe(50);
  });

  it("le solde exact clot la facture", async () => {
    const id = await facture("120.00", "100.00");
    const r = await enregistrer({ factureClientId: id, amount: 20 });
    expect(r.body.isFullyPaid).toBe(true);
    expect((await lire(id)).status).toBe("payee");
  });

  it("deux acomptes s'additionnent sans deriver au centime", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 0.1 });
    await enregistrer({ factureClientId: id, amount: 0.2 });
    expect(
      Number((await lire(id)).paidAmount),
      "0.1 + 0.2 en flottant vaut 0.30000000000000004",
    ).toBe(0.3);
  });

  it("le paiement au centime pres du reste est accepte", async () => {
    const id = await facture("120.00", "119.99");
    const r = await enregistrer({ factureClientId: id, amount: 0.01 });
    expect(r.status, "arrondi trop strict: le dernier centime deviendrait impayable").toBe(200);
    expect(r.body.isFullyPaid).toBe(true);
  });

  it("un montant nul ou negatif reste refuse", async () => {
    const id = await facture("120.00");
    expect((await enregistrer({ factureClientId: id, amount: 0 })).status).toBe(400);
    expect((await enregistrer({ factureClientId: id, amount: -5 })).status).toBe(400);
  });

  it("une facture d'une autre organisation reste introuvable", async () => {
    const [autre] = await db.insert(organisationsTable).values({
      name: `Autre ${stamp}`, slug: `autre-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    const [f] = await db.insert(facturesClientTable).values({
      organisationId: autre!.id, reference: `X-${stamp}`, title: "T", clientName: "C",
      status: "envoyee", items: [], subtotal: "10.00", taxAmount: "0",
      totalAmount: "10.00", paidAmount: "0", currency: "EUR",
    } as any).returning({ id: facturesClientTable.id });
    expect((await enregistrer({ factureClientId: f!.id, amount: 5 })).status).toBe(404);
    try { await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id)); } catch { /* journaux */ }
  });
});
