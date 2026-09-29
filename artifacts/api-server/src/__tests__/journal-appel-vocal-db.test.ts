/**
 * « Note un appel avec Martin » (commande vocale), sur une vraie base.
 *
 * L'insertion omettait `direction` (NOT NULL, sans defaut) : la commande
 * echouait a chaque fois. Elle rattachait aussi l'appel au PREMIER contact dont
 * le nom contenait le mot dit, sans ordre : sur deux « Martin », une fiche au
 * hasard. Et elle ecrivait « termine », hors du vocabulaire des appels.
 *
 * On passe par la vraie route de confirmation, avec un jeton signe comme celui
 * que rend /voice/command.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
delete process.env.SESSION_SECRETS;

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { callsTable, contactsTable, db, organisationsTable, usersTable } from "@workspace/db";
import voiceCommandRouter from "../routes/voice-command";

const stamp = Date.now();
const ids: Record<string, number> = {};

function jeton(params: Record<string, string>) {
  const json = Buffer.from(JSON.stringify({ intent: "log_call", params, orgId: ids.org, userId: ids.user, exp: Date.now() + 60_000, raw: "note un appel" })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(json).digest("base64url");
  return `${json}.${sig}`;
}
function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: ids.user, organisationId: ids.org, userRole: "administrateur", userEmail: `jv-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", voiceCommandRouter);
  return a;
}
const confirmer = (params: Record<string, string>) => request(appli()).post("/api/voice/confirm").send({ token: jeton(params) });

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `JournalVocal ${stamp}`, slug: `jv-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  ids.org = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: ids.org, email: `jv-${stamp}@exemple.test`, passwordHash: "x", prenom: "Vox", nom: "User", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.user = u!.id;
  const [seul, m1, m2] = await db.insert(contactsTable).values([
    { organisationId: ids.org, firstName: "Paulette", lastName: `Unique${stamp}`, phone: "+33612000001" },
    { organisationId: ids.org, firstName: "Jean", lastName: `Martin${stamp}`, phone: "+33612000002" },
    { organisationId: ids.org, firstName: "Luc", lastName: `Martin${stamp}`, phone: "+33612000003" },
  ]).returning({ id: contactsTable.id });
  Object.assign(ids, { seul: seul!.id, m1: m1!.id, m2: m2!.id });
});

afterAll(async () => {
  try {
    await db.delete(callsTable).where(eq(callsTable.organisationId, ids.org));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, ids.org));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [ids.org]));
  } catch { /* le journal d'audit peut retenir l'organisation */ }
});

const dernier = async () => (await db.select().from(callsTable).where(eq(callsTable.organisationId, ids.org)))
  .sort((a, b) => b.id - a.id)[0]!;

describe("consigner un appel a la voix", () => {
  it("fonctionne : l'appel est ecrit, avec une direction et un statut du vocabulaire", async () => {
    const r = await confirmer({ contactName: "Paulette", note: "Devis toiture" });
    expect(r.status, r.text).toBe(200);
    expect(r.body.success).toBe(true);
    const c = await dernier();
    expect(c).toMatchObject({ direction: "sortant", status: "repondu", notes: "Devis toiture", createdBy: ids.user });
  });

  it("rattache la fiche quand UN seul contact correspond", async () => {
    await confirmer({ contactName: "Paulette" });
    expect((await dernier()).contactId).toBe(ids.seul);
  });

  it("ne rattache aucune fiche quand deux contacts correspondent : le nom dit reste, sans hasard", async () => {
    await confirmer({ contactName: `Martin${stamp}` });
    const c = await dernier();
    expect(c.contactId).toBeNull();
    expect(c.contactName).toBe(`Martin${stamp}`);
  });

  it("un appel recu dit « entrant »", async () => {
    await confirmer({ contactName: "Paulette", direction: "entrant" });
    expect((await dernier()).direction).toBe("entrant");
  });

  it("n'ecrit rien dans une autre organisation", async () => {
    const [autre] = await db.insert(organisationsTable).values({ name: `JV autre ${stamp}`, slug: `jv-autre-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    const n = (await db.select().from(callsTable).where(eq(callsTable.organisationId, autre!.id))).length;
    await confirmer({ contactName: "Paulette" });
    expect((await db.select().from(callsTable).where(eq(callsTable.organisationId, autre!.id))).length).toBe(n);
    const siens = await db.select().from(callsTable).where(and(eq(callsTable.organisationId, ids.org), eq(callsTable.contactId, ids.seul)));
    expect(siens.length).toBeGreaterThan(0);
    await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id)).catch(() => {});
  });
});
