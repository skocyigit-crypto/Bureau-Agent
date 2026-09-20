/**
 * Un rappel programme survit a la nuit.
 *
 * Les trois routes `/telephony/schedule` rangeaient les appels programmes dans
 * une `Map` de module. Trois consequences, toutes invisibles depuis l'ecran :
 *
 *  - rien ne les executait ni ne les rappelait. L'ecran affichait « Appel
 *    planifie avec succes » et la ligne apparaissait dans la liste, mais
 *    personne n'etait jamais prevenu — alors que le sous-titre de cet ecran
 *    promet « programmez un rappel pour passer un appel a une heure
 *    precise » ;
 *  - avec `maxScale=3`, un POST recu par une instance etait invisible du GET
 *    servi par une autre : la liste changeait selon la requete ;
 *  - avec `min-instances=0`, tout disparaissait au recyclage de l'instance,
 *    c'est-a-dire des que le trafic cessait.
 *
 * Le produit a deja ce qu'il faut : une tache porte un titre, une echeance et
 * un responsable, et la machinerie des taches en retard previent. Ce qui n'est
 * PAS fait, volontairement : passer l'appel automatiquement. L'ecran ne l'a
 * jamais promis, et un appel sortant declenche tout seul est une fonction a
 * decider, pas a deduire d'un defaut de persistance.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, like } from "drizzle-orm";
import { db, organisationsTable, tasksTable, usersTable } from "@workspace/db";
import router from "../routes/telephony";

const stamp = Date.now();
let orgId = 0, autreOrgId = 0, userId = 0;

function appli(organisation = orgId) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: organisation, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

const DEMAIN = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

const programmer = (corps: Record<string, unknown>, organisation = orgId) =>
  request(appli(organisation)).post("/api/telephony/schedule").send(corps);

const lister = (organisation = orgId) =>
  request(appli(organisation)).get("/api/telephony/schedule");

const tachesProgrammees = (organisation = orgId) =>
  db.select().from(tasksTable).where(and(
    eq(tasksTable.organisationId, organisation),
    like(tasksTable.description, "[appel-programme]%"),
  ));

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Rappels ${stamp}`, slug: `rappels-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [a] = await db.insert(organisationsTable).values({
    name: `Voisine ${stamp}`, slug: `rappels-voisine-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  autreOrgId = a!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `rappels-${stamp}@example.test`, passwordHash: "x",
    prenom: "R", nom: "P", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(tasksTable).where(eq(tasksTable.organisationId, orgId));
    await db.delete(tasksTable).where(eq(tasksTable.organisationId, autreOrgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, autreOrgId));
  } catch { /* journaux en ajout seul */ }
});

describe("un appel programme est enregistre durablement", () => {
  it("il cree une vraie tache en base", async () => {
    const avant = (await tachesProgrammees()).length;
    const r = await programmer({ toNumber: "0601020304", scheduledAt: DEMAIN, note: "Relance devis" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await tachesProgrammees()).length - avant, "rien n'a ete ecrit en base").toBe(1);
  });

  it("la tache porte l'echeance demandee", async () => {
    const quand = new Date(Date.now() + 48 * 3600 * 1000);
    const r = await programmer({ toNumber: "0601020305", scheduledAt: quand.toISOString() });
    const [tache] = await db.select().from(tasksTable).where(eq(tasksTable.id, r.body.scheduled.id));
    expect(tache!.dueDate?.toISOString()).toBe(quand.toISOString());
  });

  it("son titre dit quoi faire", async () => {
    // Elle apparait dans la liste des taches: « Appeler 0601020306 » se
    // comprend sans ouvrir la fiche.
    const r = await programmer({ toNumber: "0601020306", scheduledAt: DEMAIN });
    const [tache] = await db.select().from(tasksTable).where(eq(tasksTable.id, r.body.scheduled.id));
    expect(tache!.title).toContain("0601020306");
  });

  it("le numero et la note se relisent a l'affichage", async () => {
    await programmer({ toNumber: "0601020307", scheduledAt: DEMAIN, note: "Points a aborder" });
    const r = await lister();
    const ligne = r.body.scheduled.find((s: any) => s.toNumber === "0601020307");
    expect(ligne, "le rappel n'apparait pas dans la liste").toBeTruthy();
    expect(ligne.note).toBe("Points a aborder");
  });

  it("une note absente ne casse pas la relecture", async () => {
    await programmer({ toNumber: "0601020308", scheduledAt: DEMAIN });
    const r = await lister();
    const ligne = r.body.scheduled.find((s: any) => s.toNumber === "0601020308");
    expect(ligne).toBeTruthy();
    expect(ligne.note).toBe("");
  });

  it("la liste est partagee, pas propre a une instance", async () => {
    // C'est tout l'objet du changement: deux applications distinctes — comme
    // deux instances Cloud Run — voient la meme chose.
    await programmer({ toNumber: "0601020309", scheduledAt: DEMAIN });
    const r = await request(appli()).get("/api/telephony/schedule");
    expect(r.body.scheduled.some((s: any) => s.toNumber === "0601020309")).toBe(true);
  });

  it("une date invalide est refusee", async () => {
    const r = await programmer({ toNumber: "0601020310", scheduledAt: "pas une date" });
    expect(r.status).toBe(400);
  });

  it("un numero manquant aussi", async () => {
    const r = await programmer({ scheduledAt: DEMAIN });
    expect(r.status).toBe(400);
  });
});

describe("la suppression reste bornee", () => {
  it("supprimer un rappel le retire de la liste", async () => {
    const r = await programmer({ toNumber: "0601020311", scheduledAt: DEMAIN });
    const id = r.body.scheduled.id;
    const suppr = await request(appli()).delete(`/api/telephony/schedule/${id}`);
    expect(suppr.status).toBe(200);
    const [reste] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    expect(reste).toBeUndefined();
  });

  it("un rappel d'une autre organisation est hors d'atteinte", async () => {
    const r = await programmer({ toNumber: "0601020312", scheduledAt: DEMAIN }, autreOrgId);
    const id = r.body.scheduled.id;
    const suppr = await request(appli(orgId)).delete(`/api/telephony/schedule/${id}`);
    expect(suppr.status).toBe(404);
    const [reste] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    expect(reste, "la tache d'un autre client a ete supprimee").toBeTruthy();
  });

  it("une tache ordinaire n'est pas supprimable par cette route", async () => {
    // Sans le filtre sur le marqueur, cette route deviendrait une suppression
    // de tache quelconque par identifiant.
    const [ordinaire] = await db.insert(tasksTable).values({
      organisationId: orgId,
      title: "Commander du ciment",
      status: "en_attente",
      priority: "moyenne",
    } as any).returning();
    const suppr = await request(appli()).delete(`/api/telephony/schedule/${ordinaire!.id}`);
    expect(suppr.status).toBe(404);
    const [reste] = await db.select().from(tasksTable).where(eq(tasksTable.id, ordinaire!.id));
    expect(reste, "une tache sans rapport a ete supprimee").toBeTruthy();
  });

  it("la liste d'une organisation ne montre pas celle d'une autre", async () => {
    await programmer({ toNumber: "0601020313", scheduledAt: DEMAIN }, autreOrgId);
    const r = await lister(orgId);
    expect(r.body.scheduled.some((s: any) => s.toNumber === "0601020313")).toBe(false);
  });

  it("et elle ne montre pas les taches ordinaires", async () => {
    await db.insert(tasksTable).values({
      organisationId: orgId, title: "Rappeler le fournisseur", status: "en_attente", priority: "basse",
    } as any);
    const r = await lister(orgId);
    expect(r.body.scheduled.every((s: any) => s.toNumber !== "")).toBe(true);
  });
});
