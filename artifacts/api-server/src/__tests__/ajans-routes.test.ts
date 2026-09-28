/**
 * Routes /ajans : catalogue, bureau des taches, detail, couts, demande.
 *
 * Vrai routeur, vraie base ; seul le modele est simule. Ce qu'on verrouille :
 * l'isolation entre organisations, le role exige pour les couts, la
 * validation de la demande, et le fait qu'une execution abandonnee ne
 * s'affiche jamais « en cours ».
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, usersTable, agentRunsTable, agentRunStepsTable } from "@workspace/db";

const modele = vi.hoisted(() => ({ reponses: [] as string[] }));
vi.mock("../services/ai-failover", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-failover")>();
  return {
    ...actual,
    generateText: async () => {
      const r = modele.reponses.shift();
      if (r === undefined) throw new Error("[test] aucune reponse");
      return { text: r, provider: "gemini", model: "test", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001, durationMs: 3 } };
    },
  };
});

import ajansRouter from "../routes/ajans";

const stamp = Date.now();
let orgA = 0, orgB = 0, userA = 0, userB = 0;

function appli(userId: number, organisationId: number, role = "administrateur") {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId, userRole: role };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", ajansRouter);
  return a;
}

async function execution(orgId: number, v: Partial<typeof agentRunsTable.$inferInsert> = {}): Promise<number> {
  const [r] = await db.insert(agentRunsTable).values({
    organisationId: orgId, agentId: "classificateur", trigger: "demande_manuelle", input: { sujet: "t" }, ...v,
  }).returning({ id: agentRunsTable.id });
  return r!.id;
}

beforeAll(async () => {
  for (const s of ["a", "b"]) {
    const [o] = await db.insert(organisationsTable).values({
      name: `Ajans ${s} ${stamp}`, slug: `ajans-${s}-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    const [u] = await db.insert(usersTable).values({
      organisationId: o!.id, email: `ajans-${s}-${stamp}@exemple.test`, passwordHash: "x",
      prenom: "A", nom: s, role: "administrateur", actif: true,
    }).returning({ id: usersTable.id });
    if (s === "a") { orgA = o!.id; userA = u!.id; } else { orgB = o!.id; userB = u!.id; }
  }
}, 60_000);

beforeEach(async () => {
  modele.reponses.length = 0;
  await db.delete(agentRunsTable).where(eq(agentRunsTable.organisationId, orgA));
  await db.delete(agentRunsTable).where(eq(agentRunsTable.organisationId, orgB));
});

afterAll(async () => {
  try {
    for (const o of [orgA, orgB]) {
      await db.delete(agentRunsTable).where(eq(agentRunsTable.organisationId, o));
      await db.delete(usersTable).where(eq(usersTable.organisationId, o));
      await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
    }
  } catch { /* best-effort */ }
});

describe("catalogue", () => {
  it("liste les agents avec leurs outils, sources et limites", async () => {
    const r = await request(appli(userA, orgA)).get("/api/ajans/catalogue");
    expect(r.status).toBe(200);
    const support = r.body.agents.find((a: { id: string }) => a.id === "agent-support");
    expect(support.outils.map((o: { nom: string }) => o.nom)).toEqual(["create_task", "send_email"]);
    expect(support.limites.actionsMax).toBe(3);
    expect(support.activite30j.executions).toBe(0);
  });

  it("l'activite ne compte que les executions de l'organisation", async () => {
    await execution(orgB, { agentId: "agent-support" });
    const r = await request(appli(userA, orgA)).get("/api/ajans/catalogue");
    expect(r.body.agents.find((a: { id: string }) => a.id === "agent-support").activite30j.executions).toBe(0);
  });
});

describe("bureau des taches", () => {
  it("ne liste que les executions de premier niveau, avec les compteurs par statut", async () => {
    const racine = await execution(orgA, { status: "en_attente" });
    await execution(orgA, { agentId: "agent-support", parentRunId: racine, status: "en_attente" });
    await execution(orgA, { status: "terminee" });
    const r = await request(appli(userA, orgA)).get("/api/ajans/executions");
    expect(r.body.executions).toHaveLength(2);
    expect(r.body.executions.find((e: { id: number }) => e.id === racine).specialiste).toBe("agent-support");
    expect(r.body.compteurs).toEqual({ en_cours: 0, en_attente: 1, terminee: 1, echouee: 0 });
  });

  it("filtre par statut, et refuse un statut inconnu", async () => {
    await execution(orgA, { status: "echouee", error: "x" });
    await execution(orgA, { status: "terminee" });
    const ok = await request(appli(userA, orgA)).get("/api/ajans/executions?statut=echouee");
    expect(ok.body.executions.map((e: { status: string }) => e.status)).toEqual(["echouee"]);
    expect((await request(appli(userA, orgA)).get("/api/ajans/executions?statut=nimporte")).status).toBe(400);
  });

  it("une execution abandonnee depuis plus de 15 minutes s'affiche echouee, jamais « en cours »", async () => {
    const id = await execution(orgA, { status: "en_cours", startedAt: new Date(Date.now() - 20 * 60_000) });
    await request(appli(userA, orgA)).get("/api/ajans/executions");
    const [e] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, id));
    expect(e!.status).toBe("echouee");
    expect(e!.error).toMatch(/Interrompue/);
  });

  it("une execution recente en cours reste en cours", async () => {
    const id = await execution(orgA, { status: "en_cours" });
    await request(appli(userA, orgA)).get("/api/ajans/executions");
    expect((await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, id)))[0]!.status).toBe("en_cours");
  });

  it("les executions d'une autre organisation sont invisibles", async () => {
    await execution(orgB);
    const r = await request(appli(userA, orgA)).get("/api/ajans/executions");
    expect(r.body.executions).toHaveLength(0);
  });
});

describe("detail d'une execution", () => {
  it("rend les etapes de la racine et de l'enfant, et le cout total", async () => {
    const racine = await execution(orgA, { costUsd: 0.002 });
    const enfant = await execution(orgA, { agentId: "agent-vente", parentRunId: racine, costUsd: 0.003 });
    await db.insert(agentRunStepsTable).values([
      { runId: racine, organisationId: orgA, position: 1, kind: "llm", name: "classification", status: "ok" },
      { runId: enfant, organisationId: orgA, position: 1, kind: "llm", name: "redaction", status: "ok" },
    ]);
    const r = await request(appli(userA, orgA)).get(`/api/ajans/executions/${racine}`);
    expect(r.status).toBe(200);
    expect(r.body.execution.etapes.map((e: { name: string }) => e.name)).toEqual(["classification"]);
    expect(r.body.enfants[0].etapes.map((e: { name: string }) => e.name)).toEqual(["redaction"]);
    expect(r.body.coutTotalUsd).toBeCloseTo(0.005, 6);
  });

  it("l'execution d'une autre organisation repond 404", async () => {
    const id = await execution(orgB);
    expect((await request(appli(userA, orgA)).get(`/api/ajans/executions/${id}`)).status).toBe(404);
  });
});

describe("couts et demande", () => {
  it("les couts sont reserves aux responsables", async () => {
    expect((await request(appli(userA, orgA, "agent")).get("/api/ajans/couts")).status).toBe(403);
    const r = await request(appli(userA, orgA)).get("/api/ajans/couts");
    expect(r.status).toBe(200);
    expect(r.body.quotaMensuel).toBeDefined();
  });

  it("une demande invalide est refusee en nommant ses champs", async () => {
    const r = await request(appli(userA, orgA)).post("/api/ajans/demandes").send({
      canal: "pigeon", expediteur: { email: "pas-une-adresse" }, contenu: "",
    });
    expect(r.status).toBe(400);
    expect(r.body.champs).toEqual(expect.arrayContaining(["canal", "expediteur.email", "contenu"]));
  });

  it("une demande valide traverse l'orchestrateur et apparait au bureau", async () => {
    modele.reponses.push(JSON.stringify({ type: "autre", confiance: 0.9, resume: "publicite" }));
    const r = await request(appli(userB, orgB)).post("/api/ajans/demandes").send({
      canal: "formulaire", expediteur: { nom: "X", email: "x@exemple.test" }, sujet: "Offre", contenu: "Promotion !",
    });
    expect(r.status).toBe(201);
    expect(r.body.statut).toBe("terminee");
    const liste = await request(appli(userB, orgB)).get("/api/ajans/executions");
    expect(liste.body.executions.map((e: { id: number }) => e.id)).toContain(r.body.runId);
  });
});
