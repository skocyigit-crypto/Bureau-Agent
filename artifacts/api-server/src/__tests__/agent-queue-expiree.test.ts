/**
 * File d'approbation : une proposition expiree ne doit plus partir.
 *
 * `expireStaleProposals` passe a `expiree` ce qui dort depuis 14 jours, au
 * motif qu'une action proposee il y a trois semaines n'est plus pertinente.
 * L'ecran laissait pourtant l'approuver : la relance d'une facture deja
 * reglee, le rappel d'un rendez-vous passe ou le SMS d'un chantier termine
 * partaient quand meme.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const outilsExecutes: string[] = [];
vi.mock("../services/assistant-tools", async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  return {
    ...reel,
    executeTool: async (nom: string) => { outilsExecutes.push(nom); return { ok: true, result: { simule: true } }; },
  };
});

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { agentProposalsTable, db, organisationsTable, usersTable } from "@workspace/db";
import { expireStaleProposals } from "../services/proposal-queue";
import router from "../routes/agent-queue";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
async function proposition(v: Record<string, unknown> = {}) {
  const [p] = await db.insert(agentProposalsTable).values({
    organisationId: orgId, runId: `run-${stamp}`, toolName: "send_email",
    title: "Relancer la facture", summary: "Relance", args: { to: "client@exemple.fr" },
    status: "en_attente", ...v,
  } as any).returning();
  return p!;
}
const lire = async (id: number) => (await db.select().from(agentProposalsTable).where(eq(agentProposalsTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `File ${stamp}`, slug: `file-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `file-${stamp}@example.test`, passwordHash: "x", prenom: "F", nom: "A", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);
afterAll(async () => {
  try {
    await db.delete(agentProposalsTable).where(eq(agentProposalsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});
beforeEach(() => { outilsExecutes.length = 0; });

describe("file d'approbation et expiration", () => {
  it("une proposition de 20 jours passe a expiree", async () => {
    const p = await proposition({ createdAt: new Date(Date.now() - 20 * 86_400_000) });
    await expireStaleProposals(14);
    expect((await lire(p.id)).status).toBe("expiree");
  });

  it("une proposition d'hier reste en attente", async () => {
    const p = await proposition({ createdAt: new Date(Date.now() - 86_400_000) });
    await expireStaleProposals(14);
    expect((await lire(p.id)).status).toBe("en_attente");
  });

  it("approuver une proposition expiree : 409, aucun outil execute", async () => {
    const p = await proposition({ status: "expiree" });
    const r = await request(appli()).post(`/api/agent-queue/${p.id}/approve`);
    expect(r.status).toBe(409);
    expect(outilsExecutes).toEqual([]);
    expect((await lire(p.id)).status).toBe("expiree");
  });

  it("le message dit quoi faire", async () => {
    const p = await proposition({ status: "expiree" });
    const r = await request(appli()).post(`/api/agent-queue/${p.id}/approve`);
    expect(r.body.error).toMatch(/expir/i);
  });

  it("approuver une proposition en attente l'execute", async () => {
    const p = await proposition();
    const r = await request(appli()).post(`/api/agent-queue/${p.id}/approve`);
    expect(r.status).toBe(200);
    expect(outilsExecutes).toEqual(["send_email"]);
    expect((await lire(p.id)).status).toBe("executee");
  });

  it("le lot n'approuve pas une proposition expiree", async () => {
    const expiree = await proposition({ status: "expiree" });
    const attente = await proposition();
    const r = await request(appli()).post("/api/agent-queue/bulk-decide").send({ decision: "approve", ids: [expiree.id, attente.id] });
    expect(r.status).toBe(200);
    expect(outilsExecutes).toEqual(["send_email"]);
    expect((await lire(expiree.id)).status).toBe("expiree");
  });

  it("une proposition d'une autre organisation reste introuvable", async () => {
    const [autre] = await db.insert(organisationsTable).values({ name: `File2 ${stamp}`, slug: `file2-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    const [p] = await db.insert(agentProposalsTable).values({
      organisationId: autre!.id, runId: `run-${stamp}`, toolName: "send_email",
      title: "Chez le voisin", summary: "x", args: {}, status: "en_attente",
    } as any).returning();
    const r = await request(appli()).post(`/api/agent-queue/${p!.id}/approve`);
    expect(r.status).toBe(404);
    expect(outilsExecutes).toEqual([]);
    await db.delete(agentProposalsTable).where(eq(agentProposalsTable.organisationId, autre!.id));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id));
  });

  it("rejeter une proposition expiree ne la ressuscite pas", async () => {
    const p = await proposition({ status: "expiree" });
    await request(appli()).post(`/api/agent-queue/${p.id}/reject`).send({ note: "trop tard" });
    expect((await lire(p.id)).status).toBe("expiree");
  });
});
