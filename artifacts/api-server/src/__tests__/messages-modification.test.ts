/**
 * Modifier un message depuis l'ecran (base reelle, vrai routeur).
 *
 * Mesure le 17/09 : le formulaire envoie contact, numero, type, contenu,
 * priorite. `UpdateMessageBody` ne declarait que isRead/content/priority : zod
 * retirait le reste, reponse 200, « modifie » a l'ecran, base inchangee.
 * Un contactId d'une autre organisation etait aussi stocke tel quel.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../services/whatsapp-notify", () => ({ notifyOrgUsers: async () => undefined, maskPhone: (p: string) => p.slice(-2) }));

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { contactsTable, db, messagesTable, organisationsTable } from "@workspace/db";
import router from "../routes/messages";

const stamp = Date.now();
let orgA = 0, orgB = 0, contactA = 0, contactB = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: null, organisationId: orgA, userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error(e: unknown) { console.error(e); } }; next(); });
  a.use("/api", router);
  return a;
}
async function org(n: string) {
  const [o] = await db.insert(organisationsTable).values({ name: `Msg ${n} ${stamp}`, slug: `msg-${n}-${stamp}`, email: `msg-${n}-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  return o!.id;
}
const lire = async (id: number) => (await db.select().from(messagesTable).where(eq(messagesTable.id, id)))[0]!;
const creer = async (corps: Record<string, unknown> = {}) => {
  const r = await request(appli()).post("/api/messages").send({ phoneNumber: "0600000001", content: "Rappeler", type: "note", priority: "moyenne", ...corps });
  expect(r.status).toBe(201);
  return r.body;
};

beforeAll(async () => {
  orgA = await org("a"); orgB = await org("b");
  const [ca] = await db.insert(contactsTable).values({ organisationId: orgA, firstName: "Paul", lastName: "Martin", phone: "0611111111" } as any).returning({ id: contactsTable.id });
  contactA = ca!.id;
  const [cb] = await db.insert(contactsTable).values({ organisationId: orgB, firstName: "Secret", lastName: "Ailleurs", phone: "0622222222" } as any).returning({ id: contactsTable.id });
  contactB = cb!.id;
}, 60_000);
afterAll(async () => {
  for (const o of [orgA, orgB]) {
    await db.delete(messagesTable).where(eq(messagesTable.organisationId, o));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, o));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
  }
});

describe("modification d'un message", () => {
  it("numero et type modifies sont enregistres (corps du formulaire)", async () => {
    const m = await creer();
    const r = await request(appli()).patch(`/api/messages/${m.id}`).send({ contactId: null, phoneNumber: "0699999999", content: "Rappeler demain", type: "rappel", priority: "haute" });
    expect(r.status).toBe(200);
    const l = await lire(m.id);
    expect([l.phoneNumber, l.type, l.content, l.priority]).toEqual(["0699999999", "rappel", "Rappeler demain", "haute"]);
  });

  it("choisir un contact l'enregistre et met a jour le nom affiche", async () => {
    const m = await creer({ contactName: "Inconnu du standard" });
    await request(appli()).patch(`/api/messages/${m.id}`).send({ contactId: contactA, phoneNumber: "0611111111", content: "x", type: "note", priority: "basse" });
    const l = await lire(m.id);
    expect([l.contactId, l.contactName]).toEqual([contactA, "Paul Martin"]);
  });

  it("sans contact, le nom saisi a la creation est conserve", async () => {
    const m = await creer({ contactName: "Mme Durand" });
    await request(appli()).patch(`/api/messages/${m.id}`).send({ contactId: null, phoneNumber: "0600000001", content: "y", type: "note", priority: "basse" });
    expect((await lire(m.id)).contactName).toBe("Mme Durand");
  });

  it("contact d'une autre organisation refuse a la modification", async () => {
    const m = await creer();
    expect((await request(appli()).patch(`/api/messages/${m.id}`).send({ contactId: contactB })).status).toBe(400);
    expect((await lire(m.id)).contactId).toBeNull();
  });

  it("contact d'une autre organisation refuse a la creation", async () => {
    const r = await request(appli()).post("/api/messages").send({ contactId: contactB, phoneNumber: "0600000001", content: "z", type: "note", priority: "basse" });
    expect(r.status).toBe(400);
  });

  it("type inconnu refuse", async () => {
    const m = await creer();
    expect((await request(appli()).patch(`/api/messages/${m.id}`).send({ type: "spam" })).status).toBe(400);
  });

  it("marquer lu seul ne touche a rien d'autre", async () => {
    const m = await creer({ contactId: contactA });
    await request(appli()).patch(`/api/messages/${m.id}`).send({ isRead: true });
    const l = await lire(m.id);
    expect([l.isRead, l.contactId, l.contactName, l.phoneNumber]).toEqual([true, contactA, "Paul Martin", "0600000001"]);
  });
});
