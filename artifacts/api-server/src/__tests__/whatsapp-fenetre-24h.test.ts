/**
 * Regle Meta des 24 heures sur les reponses WhatsApp (base reelle, vrai routeur).
 *
 * Mesure le 17/09 : l'envoi partait chez Twilio sans verifier la fenetre ; hors
 * fenetre Twilio refuse (63016) et l'ecran affichait l'erreur brute.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envois: { to: string; body: string }[] = [];
vi.mock("../services/telephony-providers", () => ({
  sendWhatsApp: async (_p: string, _c: unknown, m: { to: string; body: string }) => { envois.push(m); return { success: true, messageSid: "SMxx", status: "queued" }; },
  decryptProviderConfig: (_p: string, c: unknown) => c,
}));
vi.mock("../services/broadcaster", () => ({ broadcaster: { broadcast() {} } }));
vi.mock("../services/whatsapp-inbox", () => ({ generateDraftInBackground: async () => undefined }));

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, telephonyProvidersTable, whatsappConversationsTable, whatsappMessagesTable } from "@workspace/db";
import { whatsappInboxRouter } from "../routes/whatsapp-inbox";
import { etatFenetre, FENETRE_WHATSAPP_MS } from "../services/whatsapp-fenetre";

const stamp = Date.now();
let orgId = 0;
let numero = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: null, organisationId: orgId, userRole: "agent" }; next(); });
  a.use("/api", whatsappInboxRouter);
  return a;
}
async function conversation(recus: Date[], envoyes: Date[] = []) {
  const [c] = await db.insert(whatsappConversationsTable).values({ organisationId: orgId, customerPhone: `+336${String(10000000 + ++numero)}` }).returning();
  for (const at of recus) await db.insert(whatsappMessagesTable).values({ organisationId: orgId, conversationId: c!.id, direction: "inbound", body: "Bonjour", createdAt: at });
  for (const at of envoyes) await db.insert(whatsappMessagesTable).values({ organisationId: orgId, conversationId: c!.id, direction: "outbound", body: "Re", createdAt: at });
  return c!.id;
}
const ilYa = (h: number) => new Date(Date.now() - h * 3600_000);
const envoyer = (id: number) => request(appli()).post(`/api/whatsapp/conversations/${id}/send`).send({ text: "Nous passons demain a 9h." });

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Wa ${stamp}`, slug: `wa-${stamp}`, email: `wa-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  await db.insert(telephonyProvidersTable).values({ organisationId: orgId, provider: "twilio", label: "Test", isActive: true, config: {} } as any);
}, 60_000);
afterAll(async () => { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); });
beforeEach(() => { envois.length = 0; });

describe("regle pure", () => {
  it("23 h 59 : ouverte ; 24 h pile : fermee", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    expect(etatFenetre(new Date(now.getTime() - FENETRE_WHATSAPP_MS + 60_000), now).ouverte).toBe(true);
    expect(etatFenetre(new Date(now.getTime() - FENETRE_WHATSAPP_MS), now).ouverte).toBe(false);
  });
  it("jamais de message client : fermee, raison distincte", () => {
    expect(etatFenetre(null)).toEqual({ ouverte: false, raison: "aucun_message_client", fermeeLe: null });
  });
});

describe("envoi depuis la boite WhatsApp", () => {
  it("client ecrit il y a 2 h : envoye", async () => {
    const r = await envoyer(await conversation([ilYa(2)]));
    expect(r.status).toBe(201);
    expect(envois.length).toBe(1);
  });

  it("client ecrit il y a 30 h : 409 explicite, rien envoye a Twilio", async () => {
    const r = await envoyer(await conversation([ilYa(30)]));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("whatsapp_fenetre_24h");
    expect(r.body.error).toMatch(/24 heures/);
    expect(envois).toEqual([]);
  });

  it("nos propres envois recents ne rouvrent pas la fenetre", async () => {
    const r = await envoyer(await conversation([ilYa(40)], [ilYa(1)]));
    expect(r.status).toBe(409);
  });

  it("c'est le DERNIER message client qui compte", async () => {
    const r = await envoyer(await conversation([ilYa(50), ilYa(3)]));
    expect(r.status).toBe(201);
  });

  it("conversation sans message client : 409 avec l'explication du premier contact", async () => {
    const r = await envoyer(await conversation([]));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/jamais écrit/);
  });

  it("aucun message n'est enregistre quand l'envoi est bloque", async () => {
    const id = await conversation([ilYa(30)]);
    await envoyer(id);
    const sortants = (await db.select().from(whatsappMessagesTable).where(eq(whatsappMessagesTable.conversationId, id))).filter((m) => m.direction === "outbound");
    expect(sortants).toEqual([]);
  });
});
