/**
 * Studio de flux, de bout en bout sur la vraie base : les routes valident et
 * enregistrent le flux, le moteur l'execute pour une automatisation cadencee,
 * et une demande entrante suit le flux « Nouvelle demande » de SON
 * organisation (classificateur → condition → agent, journalise).
 *
 * Seul le modele est simule (reponses JSON en file).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, asc, eq } from "drizzle-orm";
import {
  db, organisationsTable, usersTable, tasksTable, automationRulesTable, automationLogsTable,
  agentRunsTable, agentRunStepsTable,
} from "@workspace/db";

const modele = vi.hoisted(() => ({ reponses: [] as string[] }));
vi.mock("../services/ai-failover", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-failover")>();
  return {
    ...actual,
    generateText: async () => {
      const r = modele.reponses.shift();
      if (r === undefined) throw new Error("[test] aucune reponse de modele en file");
      return { text: r, provider: "gemini", model: "test", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001, durationMs: 1 } };
    },
  };
});
vi.mock("../services/knowledge-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/knowledge-base")>();
  return { ...actual, searchKnowledge: async () => [] };
});
vi.mock("../services/ai-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-quota")>();
  return { ...actual, assertAiQuota: async () => {} };
});

import automationsRouter from "../routes/automations";
import ajansRouter from "../routes/ajans";
import { executerRegle } from "../services/automation-engine";

const stamp = Date.now();
let orgA = 0, userA = 0, orgB = 0, userB = 0;

function app(orgId: number, userId: number, ...routers: express.Router[]) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur", userEmail: "t@t.fr" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  for (const r of routers) a.use("/api", r);
  return a;
}
const classe = (type: string) => JSON.stringify({ type, confiance: 0.95, resume: `demande ${type}` });
const redaction = JSON.stringify({ reponse: "Bonjour, nous revenons vers vous.", actions: [] });

beforeAll(async () => {
  for (const s of ["a", "b"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Studio ${s} ${stamp}`, slug: `studio-${s}-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    const [u] = await db.insert(usersTable).values({
      organisationId: o!.id, email: `studio-${s}-${stamp}@exemple.test`, passwordHash: "x", prenom: "S", nom: s, role: "administrateur", actif: true,
    }).returning({ id: usersTable.id });
    if (s === "a") { orgA = o!.id; userA = u!.id; } else { orgB = o!.id; userB = u!.id; }
  }
}, 60_000);
beforeEach(() => { modele.reponses.length = 0; });
afterAll(async () => {
  try { for (const o of [orgA, orgB]) await db.delete(automationRulesTable).where(eq(automationRulesTable.organisationId, o)); } catch { /* base jetable */ }
});

describe("routes : le flux est valide avant d'etre enregistre", () => {
  it("« Nouvelle demande » sans flux fourni : le routage par defaut est enregistre, sans cadence", async () => {
    const r = await request(app(orgB, userB, automationsRouter)).post("/api/automations")
      .send({ name: "Routage B", type: "custom", trigger: "nouvelle_demande" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.flow.noeuds.map((n: { type: string }) => n.type)).toContain("agent");
    expect(r.body.schedule).toBeNull();
    await db.update(automationRulesTable).set({ enabled: false }).where(eq(automationRulesTable.id, r.body.id));
  });

  it("un agent sur une automatisation cadencee est refuse, erreur rattachee a l'etape", async () => {
    const r = await request(app(orgA, userA, automationsRouter)).post("/api/automations").send({
      name: "Mauvais", type: "custom", trigger: "task_overdue", schedule: "1h",
      flow: { noeuds: [{ id: "d", type: "declencheur" }, { id: "g", type: "agent", agent: "classificateur" }], liens: [{ de: "d", vers: "g" }] },
    });
    expect(r.status).toBe(400);
    expect(r.body.erreurs.some((e: { noeud?: string }) => e.noeud === "g")).toBe(true);
  });

  it("le flux d'une regle existante se modifie, et la liste d'actions suit", async () => {
    const cree = await request(app(orgA, userA, automationsRouter)).post("/api/automations").send({
      name: "Retards", type: "custom", trigger: "task_overdue", schedule: "1h", actions: [{ type: "send_notification", params: { title: "x" } }],
    });
    expect(cree.status).toBe(201);
    const flow = {
      noeuds: [
        { id: "d", type: "declencheur" },
        { id: "c", type: "condition", champ: "element.title", operateur: "contient", valeur: "urgent" },
        { id: "t", type: "action", action: { type: "create_task", params: { title: "Relancer : {{title}}" } } },
      ],
      liens: [{ de: "d", vers: "c" }, { de: "c", vers: "t", branche: "oui" }],
    };
    const maj = await request(app(orgA, userA, automationsRouter)).patch(`/api/automations/${cree.body.id}`).send({ flow });
    expect(maj.status, JSON.stringify(maj.body)).toBe(200);
    expect(maj.body.actions).toEqual([{ type: "create_task", params: { title: "Relancer : {{title}}" } }]);
    const liste = await request(app(orgA, userA, automationsRouter)).get("/api/automations");
    expect(liste.body.rules.find((x: { id: number }) => x.id === cree.body.id).flux.noeuds).toHaveLength(3);
  });

  it("une autre organisation ne modifie pas ce flux", async () => {
    const [r] = await db.select({ id: automationRulesTable.id }).from(automationRulesTable)
      .where(and(eq(automationRulesTable.organisationId, orgA), eq(automationRulesTable.name, "Retards")));
    const maj = await request(app(orgB, userB, automationsRouter)).patch(`/api/automations/${r!.id}`)
      .send({ flow: { noeuds: [{ id: "d", type: "declencheur" }, { id: "a", type: "action", action: { type: "send_notification" } }], liens: [{ de: "d", vers: "a" }] } });
    expect(maj.status).toBe(404);
  });
});

describe("moteur : une automatisation cadencee suit son flux", () => {
  it("seules les taches qui passent la condition declenchent l'action, et le journal porte la regle", async () => {
    const hier = new Date(Date.now() - 86400_000);
    await db.insert(tasksTable).values([
      { organisationId: orgA, title: `Devis urgent ${stamp}`, status: "en_attente", priority: "haute", dueDate: hier },
      { organisationId: orgA, title: `Classement ${stamp}`, status: "en_attente", priority: "basse", dueDate: hier },
    ]);
    const [regle] = await db.select().from(automationRulesTable)
      .where(and(eq(automationRulesTable.organisationId, orgA), eq(automationRulesTable.name, "Retards")));
    await executerRegle(regle!);
    const creees = await db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgA), eq(tasksTable.title, `Relancer : Devis urgent ${stamp}`)));
    expect(creees).toHaveLength(1);
    expect(await db.select().from(tasksTable).where(eq(tasksTable.title, `Relancer : Classement ${stamp}`))).toEqual([]);
    const journaux = await db.select().from(automationLogsTable).where(eq(automationLogsTable.ruleId, regle!.id));
    expect(journaux.length, "le journal d'une regle personnalisee doit porter son identifiant").toBeGreaterThan(0);
  });
});

describe("demande entrante : le flux de SON organisation la route", () => {
  let regleId = 0;
  beforeAll(async () => {
    const r = await request(app(orgA, userA, automationsRouter)).post("/api/automations").send({ name: "Routage A", type: "custom", trigger: "nouvelle_demande" });
    regleId = r.body.id;
  });

  it("une demande commerciale : classificateur, condition, puis l'agent commercial — tout journalise", async () => {
    modele.reponses.push(classe("vente"), redaction);
    const r = await request(app(orgA, userA, ajansRouter)).post("/api/ajans/demandes").send({
      canal: "formulaire", expediteur: { nom: "Paul", email: `paul-${stamp}@exemple.test` }, sujet: "Devis cuisine", contenu: "Bonjour, je voudrais un devis.",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.type).toBe("vente");
    expect(r.body.agent).toBe("agent-vente");
    const [racine] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, r.body.runId));
    expect(racine!.trigger).toBe(`flux:${regleId}`);
    const etapes = await db.select().from(agentRunStepsTable).where(eq(agentRunStepsTable.runId, r.body.runId)).orderBy(asc(agentRunStepsTable.position));
    const flux = etapes.find((e) => e.kind === "decision" && e.name === "flux");
    expect((flux!.detail as { parcours: string[] }).parcours).toEqual(["declencheur", "classer", "est-support", "est-vente", "vente"]);
    const enfants = await db.select().from(agentRunsTable).where(eq(agentRunsTable.parentRunId, r.body.runId));
    expect(enfants.map((e) => e.agentId)).toEqual(["agent-vente"]);
  });

  it("une demande « autre » : aucun agent specialiste, une tache a trier pour un humain", async () => {
    modele.reponses.push(classe("autre"));
    const r = await request(app(orgA, userA, ajansRouter)).post("/api/ajans/demandes").send({
      canal: "formulaire", expediteur: { nom: "X" }, sujet: `Question ${stamp}`, contenu: "Bonjour.",
    });
    expect(r.status).toBe(201);
    expect(r.body.agent).toBeNull();
    const taches = await db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgA), eq(tasksTable.title, `Demande a trier : Question ${stamp}`)));
    expect(taches).toHaveLength(1);
  });

  it("sans flux actif, l'organisation garde le routage par defaut", async () => {
    modele.reponses.push(classe("support"), redaction);
    const r = await request(app(orgB, userB, ajansRouter)).post("/api/ajans/demandes").send({
      canal: "formulaire", expediteur: { email: `b-${stamp}@exemple.test` }, sujet: "Panne", contenu: "Ma facture a une erreur.",
    });
    expect(r.status).toBe(201);
    const [racine] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, r.body.runId));
    expect(racine!.trigger).toBe("demande_manuelle");
    expect(r.body.agent).toBe("agent-support");
  });
});
