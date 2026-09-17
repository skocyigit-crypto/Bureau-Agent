/**
 * Un salarie ne lit ni ne modifie les pointages de ses collegues.
 * Base reelle + vrai routeur (supertest) : une garde se mesure par une reponse HTTP.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { checkinsTable, db, organisationsTable, usersTable } from "@workspace/db";
import checkinsRouter from "../routes/checkins";
import { appartient, porteePointage } from "../services/portee-pointage";

const stamp = Date.now();
let orgId = 0;
const ids: Record<string, number> = {};
const pointages: Record<string, number> = {};

function app(session: Record<string, unknown>) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { organisationId: orgId, ...session }; next(); });
  a.use("/api", checkinsRouter);
  return a;
}
const agent = () => app({ userId: ids.alice, userRole: "agent", prenom: "Alice", nom: "Martin" });
const responsable = () => app({ userId: ids.chef, userRole: "administrateur", prenom: "Chef", nom: "Equipe" });

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Pointage ${stamp}`, slug: `pointage-${stamp}`, email: `pointage-${stamp}@example.test`, phone: "+33123456789", maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  for (const [cle, prenom, nom, role] of [["alice", "Alice", "Martin", "agent"], ["bob", "Bob", "Durand", "agent"], ["chef", "Chef", "Equipe", "administrateur"]] as const) {
    const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `${cle}-${stamp}@example.test`, passwordHash: "x", prenom, nom, role, actif: true }).returning({ id: usersTable.id });
    ids[cle] = u!.id;
  }
  const inserer = async (cle: string, v: Record<string, unknown>) => {
    const [c] = await db.insert(checkinsTable).values({ organisationId: orgId, type: "bureau", status: "termine", checkInAt: new Date(), breakMinutes: 30, ...v } as any).returning({ id: checkinsTable.id });
    pointages[cle] = c!.id;
  };
  await inserer("alice", { employeeName: "Alice Martin", createdBy: ids.alice });
  await inserer("bob", { employeeName: "Bob Durand", createdBy: ids.bob });
  await inserer("aliceGoogle", { employeeName: "  alice   MARTIN ", createdBy: null });
  await inserer("homonymeProche", { employeeName: "Alice Martinez", createdBy: null });
}, 60_000);

afterAll(async () => { if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); });

describe("lecture (routes reelles)", () => {
  it("un agent ne voit que SES pointages dans la liste", async () => {
    const r = await request(agent()).get("/api/checkins?limit=50");
    expect(r.status).toBe(200);
    const vus = r.body.checkins.map((c: any) => c.id).sort();
    expect(vus).toEqual([pointages.alice, pointages.aliceGoogle].sort());
  });
  it("…y compris ceux crees sans auteur a son nom exact, mais pas « Martinez »", async () => {
    const vus = (await request(agent()).get("/api/checkins")).body.checkins.map((c: any) => c.id);
    expect(vus).toContain(pointages.aliceGoogle);
    expect(vus).not.toContain(pointages.homonymeProche);
  });
  it("la fiche d'un collegue repond 404", async () => {
    expect((await request(agent()).get(`/api/checkins/${pointages.bob}`)).status).toBe(404);
    expect((await request(agent()).get(`/api/checkins/${pointages.alice}`)).status).toBe(200);
  });
  it("les statistiques ne comptent que les siens", async () => {
    const r = await request(agent()).get("/api/checkins/stats");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("Bob");
  });
  it("un responsable voit toute l'equipe", async () => {
    const vus = (await request(responsable()).get("/api/checkins?limit=50")).body.checkins.map((c: any) => c.id);
    expect(vus).toEqual(expect.arrayContaining(Object.values(pointages)));
  });
});

describe("ecriture et export", () => {
  it("un agent ne modifie pas le pointage d'un collegue", async () => {
    expect((await request(agent()).patch(`/api/checkins/${pointages.bob}`).send({ breakMinutes: 0 })).status).toBe(404);
    const [bob] = await db.select().from(checkinsTable).where(eq(checkinsTable.id, pointages.bob));
    expect(bob!.breakMinutes).toBe(30);
  });
  it("ni ne le supprime", async () => {
    expect((await request(agent()).delete(`/api/checkins/${pointages.bob}`)).status).toBe(404);
    expect((await db.select().from(checkinsTable).where(eq(checkinsTable.id, pointages.bob))).length).toBe(1);
  });
  it("ni ne le duplique", async () => {
    expect((await request(agent()).post(`/api/checkins/${pointages.bob}/duplicate`)).status).toBe(404);
  });
  it("l'export de toute l'equipe est refuse a un agent, permis au responsable", async () => {
    expect((await request(agent()).get("/api/checkins/export/csv")).status).toBe(403);
    expect((await request(responsable()).get("/api/checkins/export/csv")).status).toBe(200);
  });
});

describe("regle pure", () => {
  it("sans session : pas de portee", () => expect(porteePointage(undefined)).toBeNull());
  it("super_admin : organisation", () => expect(porteePointage({ userId: 1, userRole: "super_admin" })).toEqual({ type: "organisation" }));
  it("lecture_seule : personnelle", () => expect(porteePointage({ userId: 1, userRole: "lecture_seule" })?.type).toBe("personnelle"));
  it("un pointage sans auteur et sans nom de session n'appartient a personne", () => {
    expect(appartient({ createdBy: null, employeeName: "X" }, { type: "personnelle", userId: 1, nomComplet: null })).toBe(false);
  });
});
