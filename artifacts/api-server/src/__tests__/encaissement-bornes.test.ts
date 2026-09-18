/**
 * Un encaissement ne se date pas dans l'avenir et ne depasse pas la facture.
 *
 * Mesure le 18/09 sur le banc local (API reelle, base fraiche) : sur une
 * facture de 120,00 EUR, un encaissement de 1 000,00 EUR est passe (201), puis
 * un second date du 5 mars 2090. La facture affichait « 1010,00 encaisse ».
 * Les deux ecritures etaient entrees dans la chaine d'empreintes — donc
 * inalterables : la seule correction possible est une contre-passation, pour
 * une faute de frappe que rien n'avait retenue a la saisie.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, encaissementsTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/encaissements";

const stamp = Date.now();
const JOUR = 24 * 60 * 60 * 1000;
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
/** Une facture emise de 120,00 EUR. */
async function facture(total = "120.00") {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `FAC-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Travaux", clientName: "Client", status: "envoyee",
    items: [], subtotal: "100.00", taxAmount: "20.00", totalAmount: total, paidAmount: "0", currency: "EUR",
  } as any).returning({ id: facturesClientTable.id });
  return f!.id;
}
const encaisser = (corps: Record<string, unknown>) => request(appli()).post("/api/encaissements").send(corps);
const lignes = async (factureId: number) => db.select().from(encaissementsTable).where(eq(encaissementsTable.factureId, factureId));

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Enc ${stamp}`, slug: `enc-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `enc-${stamp}@example.test`, passwordHash: "x", prenom: "E", nom: "N", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);
afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux en ajout seul */ }
});

describe("date de l'encaissement", () => {
  it("une date en 2090 est refusee", async () => {
    const id = await facture();
    const r = await encaisser({ factureId: id, montant: 10, moyen: "virement", dateEncaissement: "2090-03-05T09:00:00.000Z" });
    expect(r.status).toBe(400);
    expect(await lignes(id)).toEqual([]);
  });

  it("le message dit pourquoi", async () => {
    const id = await facture();
    const r = await encaisser({ factureId: id, montant: 10, moyen: "virement", dateEncaissement: "2090-03-05T09:00:00.000Z" });
    expect(r.body.error).toMatch(/futur/i);
  });

  it("aujourd'hui passe", async () => {
    const id = await facture();
    expect((await encaisser({ factureId: id, montant: 10, moyen: "virement" })).status).toBe(201);
  });

  it("hier passe", async () => {
    const id = await facture();
    const r = await encaisser({ factureId: id, montant: 10, moyen: "virement", dateEncaissement: new Date(Date.now() - JOUR).toISOString() });
    expect(r.status).toBe(201);
  });

  it("dans deux heures passe (decalage de fuseau)", async () => {
    const id = await facture();
    const r = await encaisser({ factureId: id, montant: 10, moyen: "virement", dateEncaissement: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
    expect(r.status).toBe(201);
  });
});

describe("montant superieur au reste a payer", () => {
  it("1 000 sur une facture de 120 : refuse", async () => {
    const id = await facture();
    const r = await encaisser({ factureId: id, montant: 1000, moyen: "virement" });
    expect(r.status).toBe(409);
    expect(await lignes(id)).toEqual([]);
  });

  it("le refus dit le reste a payer", async () => {
    const id = await facture();
    const r = await encaisser({ factureId: id, montant: 1000, moyen: "virement" });
    expect([r.body.resteAPayer, r.body.code]).toEqual(["120.00", "depasse_reste_a_payer"]);
  });

  it("le montant exact passe", async () => {
    const id = await facture();
    expect((await encaisser({ factureId: id, montant: 120, moyen: "virement" })).status).toBe(201);
  });

  it("deux acomptes qui totalisent la facture passent", async () => {
    const id = await facture();
    expect((await encaisser({ factureId: id, montant: 50, moyen: "virement" })).status).toBe(201);
    expect((await encaisser({ factureId: id, montant: 70, moyen: "cheque" })).status).toBe(201);
  });

  it("le troisieme, lui, depasse et est refuse", async () => {
    const id = await facture();
    await encaisser({ factureId: id, montant: 50, moyen: "virement" });
    await encaisser({ factureId: id, montant: 70, moyen: "cheque" });
    const r = await encaisser({ factureId: id, montant: 1, moyen: "especes" });
    expect(r.status).toBe(409);
    expect(r.body.resteAPayer).toBe("0.00");
  });

  it("un trop-percu reel reste possible, mais il doit etre voulu", async () => {
    const id = await facture();
    const r = await encaisser({ factureId: id, montant: 1000, moyen: "virement", forcer: true });
    expect(r.status).toBe(201);
    const [f] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id));
    expect(f!.paidAmount).toBe("1000.00");
  });

  it("un montant nul ou negatif reste refuse", async () => {
    const id = await facture();
    expect((await encaisser({ factureId: id, montant: 0, moyen: "virement" })).status).toBe(400);
    expect((await encaisser({ factureId: id, montant: -5, moyen: "virement" })).status).toBe(400);
  });

  it("une facture d'une autre organisation reste introuvable", async () => {
    const [autre] = await db.insert(organisationsTable).values({ name: `Enc2 ${stamp}`, slug: `enc2-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    const [f] = await db.insert(facturesClientTable).values({
      organisationId: autre!.id, reference: `FAC-A-${stamp}`, title: "x", clientName: "y", status: "envoyee",
      items: [], subtotal: "10.00", taxAmount: "0", totalAmount: "10.00", paidAmount: "0", currency: "EUR",
    } as any).returning({ id: facturesClientTable.id });
    expect((await encaisser({ factureId: f!.id, montant: 5, moyen: "virement" })).status).toBe(404);
    try { await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id)); } catch { /* best-effort */ }
  });
});
