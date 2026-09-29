/**
 * File d'approbation (plan du 29/09, section 10), sur une vraie base.
 *
 *  - Chaque proposition dit ce qu'elle engage (nature), sur quelle fiche,
 *    qui l'a demandee et jusqu'a quand elle se decide.
 *  - Une action qui sort du bureau ne s'approuve que sur l'apercu lu :
 *    empreinte absente ou perimee -> 409, rien n'est execute.
 *  - Aucun lot d'approbations ne contient une action sensible, ni deux types
 *    melanges. Les rejets, eux, se groupent.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { agentProposalsTable, agentRunsTable, calendarEventsTable, db, organisationsTable, tasksTable, usersTable } from "@workspace/db";
import agentQueueRouter from "../routes/agent-queue";
import { dossierDe, empreinteArgs, estSensible, lotAutorise, natureAction } from "../services/sensibilite-propositions";

const stamp = Date.now();
const ids: Record<string, number> = {};

function appli(orgId = ids.orgA) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: ids.admin, organisationId: orgId, userRole: "administrateur", userEmail: `onay-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", agentQueueRouter);
  return a;
}

async function proposition(v: Record<string, unknown>) {
  const [p] = await db.insert(agentProposalsTable).values({
    organisationId: ids.orgA, runId: `test-${stamp}`, toolName: "create_task", title: "Proposition", summary: "Resume",
    ...v,
  } as any).returning();
  return p!;
}
const statut = async (id: number) => (await db.select({ s: agentProposalsTable.status }).from(agentProposalsTable).where(eq(agentProposalsTable.id, id)))[0]!.s;

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Onay ${k} ${stamp}`, slug: `onay-${k.toLowerCase()}-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const [u] = await db.insert(usersTable).values({ organisationId: ids.orgA, email: `onay-admin-${stamp}@exemple.test`, passwordHash: "x", prenom: "Nora", nom: "Admin", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.admin = u!.id;
});

afterAll(async () => {
  try {
    for (const o of [ids.orgA, ids.orgB]) {
      await db.delete(agentProposalsTable).where(eq(agentProposalsTable.organisationId, o));
      await db.delete(agentRunsTable).where(eq(agentRunsTable.organisationId, o));
      await db.delete(tasksTable).where(eq(tasksTable.organisationId, o));
      await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, o));
    }
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [ids.orgA, ids.orgB]));
  } catch { /* le journal d'audit peut retenir l'organisation */ }
});

describe("ce qu'une action engage", () => {
  it("classe les outils, et tient un outil inconnu pour sensible", () => {
    expect(natureAction("create_task")).toBe("interne");
    expect(natureAction("send_email")).toBe("externe");
    expect(natureAction("send_sms")).toBe("externe");
    expect(natureAction("cancel_calendar_event")).toBe("planning");
    expect(natureAction("delete_call")).toBe("suppression");
    expect(natureAction("saas_send_invoice_reminder")).toBe("financier");
    expect(natureAction("outil_jamais_vu")).toBe("externe");
    expect(estSensible("create_task")).toBe(false);
    expect(estSensible("outil_jamais_vu")).toBe(true);
  });

  it("l'empreinte ne depend pas de l'ordre des cles, mais de chaque valeur", () => {
    expect(empreinteArgs({ a: 1, b: "x" })).toBe(empreinteArgs({ b: "x", a: 1 }));
    expect(empreinteArgs({ a: 1, b: "x" })).not.toBe(empreinteArgs({ a: 1, b: "y" }));
  });

  it("trouve la fiche dans les arguments, sans rien deviner", () => {
    expect(dossierDe({ callId: 12 })).toBe("/appels/12");
    expect(dossierDe({ contactId: "5", to: "a@b.fr" })).toBe("/contacts/5");
    expect(dossierDe({ to: "a@b.fr", subject: "x" })).toBeNull();
  });

  it("n'admet en lot que des actions internes du meme type", () => {
    expect(lotAutorise([{ id: 1, toolName: "create_task" }, { id: 2, toolName: "create_task" }])).toEqual({ ok: true });
    expect(lotAutorise([{ id: 1, toolName: "create_task" }, { id: 2, toolName: "send_email" }])).toMatchObject({ ok: false, code: "lot_sensible", ids: [2] });
    expect(lotAutorise([{ id: 1, toolName: "create_task" }, { id: 2, toolName: "create_contact" }])).toMatchObject({ ok: false, code: "lot_heterogene" });
  });
});

describe("la liste dit quoi, ou, qui et jusqu'a quand", () => {
  it("enrichit chaque proposition, demandeur nomme compris", async () => {
    const [run] = await db.insert(agentRunsTable).values({ organisationId: ids.orgA, agentId: "agent-vente", trigger: "manuel", status: "en_attente", requestedBy: ids.admin }).returning({ id: agentRunsTable.id });
    const p = await proposition({ toolName: "send_email", runId: `agent-run:${run!.id}`, args: { to: "client@exemple.test", subject: "Devis", body: "Bonjour", contactId: 7 } });
    const r = await request(appli()).get("/api/agent-queue");
    expect(r.status).toBe(200);
    const ligne = r.body.proposals.find((x: any) => x.id === p.id);
    expect(ligne).toMatchObject({ nature: "externe", sensible: true, dossier: "/contacts/7", demandeur: "Nora Admin", empreinte: empreinteArgs(p.args) });
    expect(new Date(ligne.echeance).getTime() - new Date(p.createdAt).getTime()).toBe(14 * 24 * 3600 * 1000);
  });
});

describe("une action sensible s'approuve sur l'apercu lu", () => {
  it("sans empreinte : 409, rien n'est execute", async () => {
    const p = await proposition({ toolName: "send_email", args: { to: "client@exemple.test", subject: "Relance", body: "Texte" } });
    const r = await request(appli()).post(`/api/agent-queue/${p.id}/approve`).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("apercu_requis");
    expect(await statut(p.id)).toBe("en_attente");
  });

  it("avec l'empreinte d'une version modifiee depuis : 409, rien n'est execute", async () => {
    const p = await proposition({ toolName: "send_email", args: { to: "client@exemple.test", subject: "Relance", body: "Texte" } });
    const lue = empreinteArgs(p.args);
    await db.update(agentProposalsTable).set({ args: { to: "autre@exemple.test", subject: "Relance", body: "Texte" } }).where(eq(agentProposalsTable.id, p.id));
    const r = await request(appli()).post(`/api/agent-queue/${p.id}/approve`).send({ empreinte: lue });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("apercu_perime");
    expect(await statut(p.id)).toBe("en_attente");
  });

  it("sur l'empreinte de ce qui partira, l'action s'execute", async () => {
    const [ev] = await db.insert(calendarEventsTable).values({ organisationId: ids.orgA, title: "Visite", startDate: new Date(Date.now() + 86400000), endDate: new Date(Date.now() + 90000000) }).returning({ id: calendarEventsTable.id });
    const p = await proposition({ toolName: "cancel_calendar_event", args: { id: ev!.id } });
    const r = await request(appli()).post(`/api/agent-queue/${p.id}/approve`).send({ empreinte: empreinteArgs(p.args) });
    expect(r.status, r.text).toBe(200);
    expect(await statut(p.id)).not.toBe("en_attente");
  });

  it("l'edition rend la nouvelle empreinte, et c'est elle qui ouvre l'approbation", async () => {
    const p = await proposition({ toolName: "send_sms", args: { to: "+33600000000", message: "Premier texte" } });
    const edit = await request(appli()).patch(`/api/agent-queue/${p.id}/args`).send({ args: { to: "+33600000000", message: "Texte corrige" } });
    expect(edit.status, edit.text).toBe(200);
    expect(edit.body.empreinte).toBe(empreinteArgs(edit.body.args));
    const ancienne = await request(appli()).post(`/api/agent-queue/${p.id}/approve`).send({ empreinte: empreinteArgs(p.args) });
    expect(ancienne.status).toBe(409);
    expect(ancienne.body.code).toBe("apercu_perime");
  });

  it("une action interne s'approuve sans empreinte", async () => {
    const p = await proposition({ toolName: "create_task", args: { title: `Tache ${stamp}` } });
    const r = await request(appli()).post(`/api/agent-queue/${p.id}/approve`).send({});
    expect(r.status, r.text).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("les lots", () => {
  it("refuse un lot qui contient une action sensible, avant tout effet", async () => {
    const a = await proposition({ toolName: "create_task", args: { title: `A ${stamp}` } });
    const b = await proposition({ toolName: "send_email", args: { to: "x@exemple.test", subject: "s", body: "b" } });
    const r = await request(appli()).post("/api/agent-queue/bulk-decide").send({ ids: [a.id, b.id], decision: "approve" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "lot_sensible", ids: [b.id] });
    expect(await statut(a.id)).toBe("en_attente");
    expect(await statut(b.id)).toBe("en_attente");
  });

  it("refuse un lot qui melange deux types d'actions internes", async () => {
    const a = await proposition({ toolName: "create_task", args: { title: `C ${stamp}` } });
    const b = await proposition({ toolName: "create_contact", args: { nom: "Durand" } });
    const r = await request(appli()).post("/api/agent-queue/bulk-decide").send({ ids: [a.id, b.id], decision: "approve" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("lot_heterogene");
    expect(await statut(a.id)).toBe("en_attente");
  });

  it("accepte un lot d'actions internes du meme type", async () => {
    const a = await proposition({ toolName: "create_task", args: { title: `D ${stamp}` } });
    const b = await proposition({ toolName: "create_task", args: { title: `E ${stamp}` } });
    const r = await request(appli()).post("/api/agent-queue/bulk-decide").send({ ids: [a.id, b.id], decision: "approve" });
    expect(r.status, r.text).toBe(200);
    expect(r.body.succeeded).toBe(2);
  });

  it("laisse toujours rejeter en lot, meme des actions sensibles", async () => {
    const a = await proposition({ toolName: "send_email", args: { to: "x@exemple.test", subject: "s", body: "b" } });
    const b = await proposition({ toolName: "send_sms", args: { to: "+33600000001", message: "b" } });
    const r = await request(appli()).post("/api/agent-queue/bulk-decide").send({ ids: [a.id, b.id], decision: "reject" });
    expect(r.status).toBe(200);
    expect(await statut(a.id)).toBe("rejetee");
    expect(await statut(b.id)).toBe("rejetee");
  });

  it("ne voit ni ne decide la proposition d'une autre organisation", async () => {
    const [p] = await db.insert(agentProposalsTable).values({ organisationId: ids.orgB, runId: "x", toolName: "create_task", title: "Autre", summary: "s", args: { title: "x" } }).returning();
    const liste = await request(appli()).get("/api/agent-queue");
    expect(liste.body.proposals.map((x: any) => x.id)).not.toContain(p!.id);
    const r = await request(appli()).post("/api/agent-queue/bulk-decide").send({ ids: [p!.id], decision: "approve" });
    expect(r.body.succeeded ?? 0).toBe(0);
    expect(await statut(p!.id)).toBe("en_attente");
  });
});
