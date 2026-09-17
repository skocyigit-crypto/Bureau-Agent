/**
 * Saisie des projets / chantiers (base reelle, vrai routeur).
 *
 * Mesure le 17/09 : « dupliquer » recopiait la date de reception (les garanties
 * legales du nouveau chantier partaient de l'ancien), `spent: null` -> 500,
 * avancement « abc » -> 500, contact d'une autre organisation liable, fin
 * reelle redatee a chaque re-enregistrement.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { contactsTable, db, organisationsTable, projetsTable } from "@workspace/db";
import router from "../routes/projets";

const stamp = Date.now();
let orgA = 0, orgB = 0, contactB = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: 1, organisationId: orgA, userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
async function org(n: string) {
  const [o] = await db.insert(organisationsTable).values({ name: `Proj ${n} ${stamp}`, slug: `proj-${n}-${stamp}`, email: `proj-${n}-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  return o!.id;
}
const lire = async (id: number) => (await db.select().from(projetsTable).where(eq(projetsTable.id, id)))[0]!;
const creer = async (corps: Record<string, unknown> = {}) => (await request(appli()).post("/api/projets").send({ title: "Chantier", ...corps })).body;

beforeAll(async () => {
  orgA = await org("a"); orgB = await org("b");
  const [cb] = await db.insert(contactsTable).values({ organisationId: orgB, firstName: "Autre", lastName: "Client", phone: "0600000000" } as any).returning({ id: contactsTable.id });
  contactB = cb!.id;
}, 60_000);
afterAll(async () => {
  for (const o of [orgA, orgB]) {
    await db.delete(projetsTable).where(eq(projetsTable.organisationId, o));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, o));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
  }
});

describe("projets", () => {
  it("dupliquer ne recopie ni la reception ni les reserves ni la depense", async () => {
    const p = await creer({ budget: "10000" });
    await request(appli()).patch(`/api/projets/${p.id}`).send({ status: "termine", spent: "8200", receptionDate: "2026-03-01", receptionWithReserves: true, receptionReserves: "Joint", reservesLiftedAt: "2026-04-01" });
    const r = await request(appli()).post(`/api/projets/${p.id}/duplicate`);
    expect(r.status).toBe(201);
    const c = await lire(r.body.id);
    expect([c.receptionDate, c.receptionWithReserves, c.receptionReserves, c.reservesLiftedAt, Number(c.spent), c.actualEndDate]).toEqual([null, false, null, null, 0, null]);
    expect(Number(c.budget)).toBe(10000);
  });

  it("la copie n'a pas d'echeances de garantie", async () => {
    const p = await creer();
    await request(appli()).patch(`/api/projets/${p.id}`).send({ receptionDate: "2025-01-15" });
    const d = await request(appli()).post(`/api/projets/${p.id}/duplicate`);
    const g = await request(appli()).get(`/api/projets/${d.body.id}`);
    expect(g.body.receptionDate).toBeNull();
  });

  it("depense vide : 0, pas 500", async () => {
    const p = await creer();
    expect((await request(appli()).patch(`/api/projets/${p.id}`).send({ spent: null })).status).toBe(200);
    expect(Number((await lire(p.id)).spent)).toBe(0);
  });

  it("avancement « abc » : 400, pas 500 (creation et modification)", async () => {
    expect((await request(appli()).post("/api/projets").send({ title: "X", progress: "abc" })).status).toBe(400);
    const p = await creer();
    expect((await request(appli()).patch(`/api/projets/${p.id}`).send({ progress: "abc" })).status).toBe(400);
  });

  it("avancement 140 borne a 100", async () => {
    const p = await creer();
    await request(appli()).patch(`/api/projets/${p.id}`).send({ progress: 140 });
    expect((await lire(p.id)).progress).toBe(100);
  });

  it("priorite inconnue refusee", async () => {
    expect((await request(appli()).post("/api/projets").send({ title: "X", priority: "critique" })).status).toBe(400);
  });

  it("budget negatif ou illisible refuse", async () => {
    expect((await request(appli()).post("/api/projets").send({ title: "X", budget: "-5" })).status).toBe(400);
    expect((await request(appli()).post("/api/projets").send({ title: "X", budget: "beaucoup" })).status).toBe(400);
  });

  it("date illisible ou fin avant debut refusee", async () => {
    expect((await request(appli()).post("/api/projets").send({ title: "X", startDate: "demain" })).status).toBe(400);
    expect((await request(appli()).post("/api/projets").send({ title: "X", startDate: "2026-10-01", endDate: "2026-09-01" })).status).toBe(400);
  });

  it("contact d'une autre organisation refuse", async () => {
    expect((await request(appli()).post("/api/projets").send({ title: "X", contactId: contactB })).status).toBe(400);
    const p = await creer();
    expect((await request(appli()).patch(`/api/projets/${p.id}`).send({ contactId: contactB })).status).toBe(400);
  });

  it("re-enregistrer un chantier termine ne redate pas la fin reelle ; le rouvrir l'efface", async () => {
    const p = await creer();
    await request(appli()).patch(`/api/projets/${p.id}`).send({ status: "termine" });
    const fin = (await lire(p.id)).actualEndDate!.getTime();
    await new Promise((r) => setTimeout(r, 15));
    await request(appli()).patch(`/api/projets/${p.id}`).send({ status: "termine", notes: "maj" });
    expect((await lire(p.id)).actualEndDate!.getTime()).toBe(fin);
    await request(appli()).patch(`/api/projets/${p.id}`).send({ status: "en_cours" });
    expect((await lire(p.id)).actualEndDate).toBeNull();
  });

  it("limit=abc ne fait plus echouer la liste", async () => {
    expect((await request(appli()).get("/api/projets?limit=abc")).status).toBe(200);
  });
});
