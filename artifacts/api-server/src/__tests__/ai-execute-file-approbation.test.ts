/**
 * `POST /ai/execute` : un e-mail suggere par l'IA attend un humain, et l'argent
 * ne se touche pas depuis une suggestion.
 *
 * Avant, un clic sur un bouton dont le modele avait ecrit le libelle envoyait
 * l'e-mail sur-le-champ, arguments invisibles ; `chain_actions` atteignait
 * facture, encaissement et relance. Ces controles passent par le VRAI routeur
 * et la VRAIE base, et relisent la file d'approbation. Seul l'envoi est espionne
 * : il ne doit jamais etre appele.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, agentProposalsTable, organisationsTable, usersTable } from "@workspace/db";

const envois = vi.hoisted(() => ({ n: 0 }));
vi.mock("../services/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/email")>();
  return { ...actual, sendEmail: async () => { envois.n++; return { success: true }; } };
});

import aiRouter from "../routes/ai-analysis";

const stamp = Date.now();
let orgId = 0, userId = 0, autreOrg = 0;

function appli(org: () => number) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: org(), userRole: "agent" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", aiRouter);
  return a;
}

const executer = (body: Record<string, unknown>, org = () => orgId) =>
  request(appli(org)).post("/api/ai/execute").send(body);

const propositionsDe = async (o: number) =>
  db.select().from(agentProposalsTable).where(and(
    eq(agentProposalsTable.organisationId, o),
    eq(agentProposalsTable.sourceType, "ai_execute"),
  ));

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `File IA ${stamp}`, slug: `file-ia-${stamp}`, maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [o2] = await db.insert(organisationsTable).values({
    name: `File IA autre ${stamp}`, slug: `file-ia-autre-${stamp}`, maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  autreOrg = o2!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `file-ia-${stamp}@example.test`, passwordHash: "x",
    prenom: "F", nom: "IA", role: "agent", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    for (const o of [orgId, autreOrg]) {
      await db.delete(agentProposalsTable).where(eq(agentProposalsTable.organisationId, o));
      await db.delete(usersTable).where(eq(usersTable.organisationId, o));
      await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
    }
  } catch { /* best-effort */ }
});

beforeEach(() => { envois.n = 0; });

describe("un e-mail suggere entre en file, il ne part pas", () => {
  it("la reponse dit qu'il attend une approbation", async () => {
    const r = await executer({ type: "send_email", target: { to: "client@example.test", subject: `Devis ${stamp}`, body: "Bonjour" } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.queued).toBe(true);
    expect(String(r.body.message)).toMatch(/approbation/);
  });

  it("rien n'a ete envoye", async () => {
    await executer({ type: "send_email", target: { to: "client@example.test", subject: `Rien ${stamp}`, body: "Bonjour" } });
    expect(envois.n).toBe(0);
  });

  it("la proposition porte destinataire, sujet et corps, en attente", async () => {
    const r = await executer({ type: "send_email", target: JSON.stringify({ to: "x@example.test", subject: `Visible ${stamp}`, body: "Corps lisible" }) });
    const [p] = await db.select().from(agentProposalsTable).where(eq(agentProposalsTable.id, r.body.proposalId));
    expect(p!.status).toBe("en_attente");
    expect(p!.toolName).toBe("send_email");
    expect(p!.args).toEqual({ to: "x@example.test", subject: `Visible ${stamp}`, body: "Corps lisible" });
  });

  it("deux clics sur la meme suggestion ne font qu'une proposition", async () => {
    const e = { to: "double@example.test", subject: `Double ${stamp}`, body: "Une fois" };
    const r1 = await executer({ type: "send_email", target: e });
    const r2 = await executer({ type: "send_email", target: e });
    expect(r2.body.proposalId).toBe(r1.body.proposalId);
    const lignes = (await propositionsDe(orgId)).filter((p) => (p.args as { subject?: string }).subject === e.subject);
    expect(lignes).toHaveLength(1);
  });

  it("une cible incomplete est refusee sans rien mettre en file", async () => {
    const avant = (await propositionsDe(orgId)).length;
    const r = await executer({ type: "send_email", target: { to: "a@example.test", subject: "Sans corps" } });
    expect(r.status).toBe(400);
    expect((await propositionsDe(orgId)).length).toBe(avant);
  });

  it("une adresse invalide est refusee par la validation de l'outil", async () => {
    const r = await executer({ type: "send_email", target: { to: "pas-une-adresse", subject: "S", body: "B" } });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
  });

  it("la proposition reste dans l'organisation de l'appelant", async () => {
    await executer({ type: "send_email", target: { to: "iso@example.test", subject: `Iso ${stamp}`, body: "B" } });
    const ailleurs = (await propositionsDe(autreOrg)).filter((p) => (p.args as { subject?: string }).subject === `Iso ${stamp}`);
    expect(ailleurs).toHaveLength(0);
  });
});

describe("l'argent ne se touche pas depuis une suggestion", () => {
  for (const type of ["create_invoice", "record_payment", "send_invoice_email", "send_payment_reminder"]) {
    it(`${type} est refuse (403) sans effet`, async () => {
      const avant = (await propositionsDe(orgId)).length;
      const r = await executer({ type, target: JSON.stringify({ invoiceId: 1, amount: 10, clientName: "X", items: [{ description: "d", quantity: 1, unitPrice: 1 }] }) });
      expect(r.status).toBe(403);
      expect(r.body.success).toBe(false);
      expect(envois.n).toBe(0);
      expect((await propositionsDe(orgId)).length).toBe(avant);
    });
  }
});
