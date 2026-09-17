/**
 * Saisie des prospects (base reelle, vrai routeur).
 *
 * Mesure le 17/09 : etape/priorite libres (prospect hors pipeline), probabilite
 * « abc » -> 500, 250 % enregistre, contact d'une autre organisation liable,
 * « convertir » creait un contact a chaque clic, wonAt jamais efface.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { contactsTable, db, organisationsTable, prospectsTable, usersTable } from "@workspace/db";
import router from "../routes/prospects";
import { montantValide, pagination, probabiliteValide, validerSaisieProspect } from "../services/prospect-saisie";

const stamp = Date.now();
let orgA = 0, orgB = 0, userA = 0, contactB = 0, contactA = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: userA, organisationId: orgA, userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
async function org(n: string) {
  const [o] = await db.insert(organisationsTable).values({ name: `Pros ${n} ${stamp}`, slug: `pros-${n}-${stamp}`, email: `pros-${n}-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  return o!.id;
}
const lire = async (id: number) => (await db.select().from(prospectsTable).where(eq(prospectsTable.id, id)))[0]!;

beforeAll(async () => {
  orgA = await org("a"); orgB = await org("b");
  const [u] = await db.insert(usersTable).values({ organisationId: orgA, email: `pros-${stamp}@example.test`, passwordHash: "x", prenom: "P", nom: "R", role: "agent", actif: true }).returning({ id: usersTable.id });
  userA = u!.id;
  const [cb] = await db.insert(contactsTable).values({ organisationId: orgB, firstName: "Autre", lastName: "Client", phone: "0600000000" } as any).returning({ id: contactsTable.id });
  contactB = cb!.id;
  const [ca] = await db.insert(contactsTable).values({ organisationId: orgA, firstName: "Mon", lastName: "Client", phone: "0600000001" } as any).returning({ id: contactsTable.id });
  contactA = ca!.id;
}, 60_000);
afterAll(async () => {
  for (const o of [orgA, orgB]) {
    await db.delete(prospectsTable).where(eq(prospectsTable.organisationId, o));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, o));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
  }
});

describe("regles pures", () => {
  it("probabilite", () => {
    expect([probabiliteValide("50"), probabiliteValide(0), probabiliteValide(100), probabiliteValide("abc"), probabiliteValide(250), probabiliteValide(-1), probabiliteValide("")]).toEqual([50, 0, 100, null, null, null, null]);
  });
  it("montant", () => {
    expect([montantValide("12,5"), montantValide(""), montantValide("-3"), montantValide("x")]).toEqual(["12.5", null, undefined, undefined]);
  });
  it("pagination", () => {
    expect([pagination("abc", "-4"), pagination("10000", "20"), pagination(undefined, undefined)]).toEqual([{ limit: 50, offset: 0 }, { limit: 500, offset: 20 }, { limit: 50, offset: 0 }]);
  });
  it("PATCH partiel ne force pas les valeurs par defaut", () => {
    expect(validerSaisieProspect({ notes: "x" }, true)).toEqual({ ok: true, valeurs: {} });
  });
});

describe("routes prospects", () => {
  it("etape inconnue refusee a la creation et a la modification", async () => {
    const a = appli();
    expect((await request(a).post("/api/prospects").send({ title: "X", stage: "gagné!" })).status).toBe(400);
    const ok = await request(a).post("/api/prospects").send({ title: "Y" });
    expect((await request(a).patch(`/api/prospects/${ok.body.id}`).send({ stage: "archive" })).status).toBe(400);
    expect((await lire(ok.body.id)).stage).toBe("nouveau");
  });

  it("priorite inconnue refusee", async () => {
    expect((await request(appli()).post("/api/prospects").send({ title: "X", priority: "urgentissime" })).status).toBe(400);
  });

  it("probabilite non numerique : 400, pas 500", async () => {
    expect((await request(appli()).post("/api/prospects").send({ title: "X", probability: "abc" })).status).toBe(400);
  });

  it("probabilite 250 refusee", async () => {
    const a = appli();
    const ok = await request(a).post("/api/prospects").send({ title: "P" });
    expect((await request(a).patch(`/api/prospects/${ok.body.id}`).send({ probability: 250 })).status).toBe(400);
  });

  it("le contact d'une autre organisation ne peut pas etre lie", async () => {
    const a = appli();
    expect((await request(a).post("/api/prospects").send({ title: "X", contactId: contactB })).status).toBe(400);
    const ok = await request(a).post("/api/prospects").send({ title: "Z" });
    expect((await request(a).patch(`/api/prospects/${ok.body.id}`).send({ contactId: contactB })).status).toBe(400);
    expect((await lire(ok.body.id)).contactId).toBeNull();
  });

  it("son propre contact se lie", async () => {
    const r = await request(appli()).post("/api/prospects").send({ title: "Lie", contactId: contactA });
    expect(r.status).toBe(201);
    expect(r.body.contactId).toBe(contactA);
  });

  it("repasser un prospect gagne en negociation efface wonAt", async () => {
    const a = appli();
    const ok = await request(a).post("/api/prospects").send({ title: "Va-et-vient" });
    await request(a).patch(`/api/prospects/${ok.body.id}`).send({ stage: "gagne" });
    expect((await lire(ok.body.id)).wonAt).not.toBeNull();
    await request(a).patch(`/api/prospects/${ok.body.id}`).send({ stage: "negociation" });
    expect((await lire(ok.body.id)).wonAt).toBeNull();
  });

  it("re-enregistrer le formulaire d'un prospect gagne ne redate pas la victoire", async () => {
    const a = appli();
    const ok = await request(a).post("/api/prospects").send({ title: "Stable", stage: "gagne" });
    const avant = (await lire(ok.body.id)).wonAt!.getTime();
    await new Promise((r) => setTimeout(r, 15));
    await request(a).patch(`/api/prospects/${ok.body.id}`).send({ title: "Stable", stage: "gagne", notes: "maj" });
    expect((await lire(ok.body.id)).wonAt!.getTime()).toBe(avant);
  });

  it("convertir deux fois ne cree qu'un contact, et le lie au prospect", async () => {
    const a = appli();
    const ok = await request(a).post("/api/prospects").send({ title: "Conv", contactName: "Jean  Dupont", phone: "0611111111" });
    const r1 = await request(a).post(`/api/prospects/${ok.body.id}/convert`);
    expect(r1.status).toBe(201);
    expect(r1.body.contact.lastName).toBe("Dupont");
    const r2 = await request(a).post(`/api/prospects/${ok.body.id}/convert`);
    expect(r2.status).toBe(409);
    const p = await lire(ok.body.id);
    expect([p.contactId, p.stage, p.wonAt !== null]).toEqual([r1.body.contact.id, "gagne", true]);
  });

  it("limit=abc ne fait plus echouer la liste", async () => {
    const r = await request(appli()).get("/api/prospects?limit=abc&offset=zz");
    expect(r.status).toBe(200);
  });
});
