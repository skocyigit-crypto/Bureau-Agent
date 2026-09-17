/**
 * Un champ que l'ecran permet de modifier ne doit pas disparaitre en silence.
 *
 * Mesure le 17/09 : le formulaire « modifier un appel » envoie le numero et le
 * sens (entrant/sortant). `UpdateCallBody` (zod, genere depuis OpenAPI) ne les
 * declarait pas : zod les retirait sans erreur, la reponse etait 200, l'ecran
 * disait « modifie » — et la base gardait l'ancien numero.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { callsTable, db, organisationsTable, tasksTable, usersTable } from "@workspace/db";
import * as zodApi from "@workspace/api-zod";
import callsRouter from "../routes/calls";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const stamp = Date.now();
let orgId = 0;
let userId = 0;

/** Cles du `formSchema = z.object({...})` d'une page web. */
function clesFormulaire(page: string): string[] {
  const s = readFileSync(join(RACINE, "artifacts", "buro-ajani", "src", "pages", `${page}.tsx`), "utf8");
  const i = s.indexOf("const formSchema = z.object({");
  expect(i, `formSchema introuvable dans ${page}`).toBeGreaterThan(-1);
  const corps = s.slice(i, s.indexOf("\n});", i));
  return [...corps.matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]!);
}
function clesZod(nom: string): string[] {
  const schema = (zodApi as Record<string, any>)[nom];
  expect(schema, `${nom} absent de @workspace/api-zod`).toBeTruthy();
  return Object.keys(schema.shape);
}

describe("chaque champ modifiable a l'ecran est accepte par l'API de modification", () => {
  // Pages dont la modification envoie le formulaire entier (`data: values`).
  for (const [page, schema] of [["calls", "UpdateCallBody"], ["tasks", "UpdateTaskBody"], ["contacts", "UpdateContactBody"]] as const) {
    it(`${page} -> ${schema}`, () => {
      const source = readFileSync(join(RACINE, "artifacts", "buro-ajani", "src", "pages", `${page}.tsx`), "utf8");
      expect(source, `${page} n'envoie plus le formulaire entier : revoir ce test`).toMatch(/\.mutate\(\{ id: [a-zA-Z.]+, data: values \}/);
      const perdus = clesFormulaire(page).filter((c) => !clesZod(schema).includes(c));
      expect(perdus, `champs retires en silence par ${schema}`).toEqual([]);
    });
  }
});

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Champs ${stamp}`, slug: `champs-${stamp}`, email: `champs-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `champs-${stamp}@example.test`, passwordHash: "x", prenom: "C", nom: "H", role: "agent", actif: true }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);
afterAll(async () => { if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); });

describe("modification d'un appel (base reelle, vrai routeur)", () => {
  it("le numero et le sens modifies sont enregistres", async () => {
    const a = express();
    a.use(express.json());
    a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole: "agent" }; next(); });
    a.use("/api", callsRouter);
    const [appel] = await db.insert(callsTable).values({ organisationId: orgId, phoneNumber: "0600000001", direction: "entrant", status: "repondu", duration: 30 } as any).returning();
    // Corps identique a celui du formulaire web.
    const r = await request(a).patch(`/api/calls/${appel!.id}`).send({ contactId: null, phoneNumber: "0699999999", direction: "sortant", status: "manque", duration: 45, notes: "modifie", sentiment: null });
    expect(r.status).toBe(200);
    const [relu] = await db.select().from(callsTable).where(eq(callsTable.id, appel!.id));
    expect(relu!.phoneNumber).toBe("0699999999");
    expect(relu!.direction).toBe("sortant");
    expect(relu!.notes).toBe("modifie");
  }, 60_000);
});

describe("tache recurrente de bout en bout (base reelle, vrai routeur)", () => {
  async function appli() {
    const tasksRouter = (await import("../routes/tasks")).default;
    const a = express();
    a.use(express.json());
    // pino-http fournit req.log dans la vraie application.
    a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error(e: unknown) { console.error(e); } }; next(); });
    a.use("/api", tasksRouter);
    return a;
  }

  it("cocher « recurrente » depuis le formulaire l'enregistre", async () => {
    const a = await appli();
    // Corps identique au formulaire web (date de fin en AAAA-MM-JJ).
    const r = await request(a).post("/api/tasks").send({ title: "Releve mensuel", status: "en_attente", priority: "moyenne", dueDate: "2026-09-30T08:00:00.000Z", isRecurring: true, recurrenceRule: "mensuel", recurrenceEndDate: "2027-09-30" });
    expect(r.status).toBe(201);
    const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, r.body.id));
    expect(t.isRecurring).toBe(true);
    expect(t.recurrenceRule).toBe("mensuel");
    expect(t.recurrenceEndDate).toBeTruthy();
  }, 60_000);

  it("terminer la tache cree l'occurrence suivante (la fonctionnalite est enfin atteignable)", async () => {
    const a = await appli();
    const cree = await request(a).post("/api/tasks").send({ title: "Controle extincteurs", status: "en_attente", priority: "haute", dueDate: "2026-10-01T08:00:00.000Z", isRecurring: true, recurrenceRule: "mensuel", recurrenceEndDate: "" });
    expect((await request(a).patch(`/api/tasks/${cree.body.id}`).send({ status: "termine" })).status).toBe(200);
    const suivantes = (await db.select().from(tasksTable).where(eq(tasksTable.organisationId, orgId)))
      .filter((x: any) => x.title === "Controle extincteurs" && x.id !== cree.body.id);
    expect(suivantes.length).toBe(1);
    expect(suivantes[0]!.dueDate).not.toBeNull();
    expect(new Date(suivantes[0]!.dueDate!).toISOString().slice(0, 7)).toBe("2026-11");
  }, 60_000);

  it("decocher efface la regle et la date de fin", async () => {
    const a = await appli();
    const cree = await request(a).post("/api/tasks").send({ title: "Ponctuelle", status: "en_attente", priority: "basse", isRecurring: true, recurrenceRule: "hebdomadaire", recurrenceEndDate: "2027-01-01" });
    await request(a).patch(`/api/tasks/${cree.body.id}`).send({ isRecurring: false, recurrenceRule: "", recurrenceEndDate: "" });
    const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, cree.body.id));
    expect([t.isRecurring, t.recurrenceRule, t.recurrenceEndDate]).toEqual([false, null, null]);
  }, 60_000);

  it("une frequence inconnue est refusee (400), pas enregistree en silence", async () => {
    const a = await appli();
    const r = await request(a).post("/api/tasks").send({ title: "X", status: "en_attente", priority: "basse", isRecurring: true, recurrenceRule: "toutes-les-heures" });
    expect(r.status).toBe(400);
  }, 60_000);

  it("une modification sans champ de recurrence ne la touche pas", async () => {
    const a = await appli();
    const cree = await request(a).post("/api/tasks").send({ title: "Garde", status: "en_attente", priority: "basse", isRecurring: true, recurrenceRule: "annuel" });
    await request(a).patch(`/api/tasks/${cree.body.id}`).send({ title: "Garde renommee" });
    const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, cree.body.id));
    expect([t.title, t.isRecurring, t.recurrenceRule]).toEqual(["Garde renommee", true, "annuel"]);
  }, 60_000);
});

describe("recurrence sans frequence", () => {
  it("cochee sans frequence : 400 (une tache recurrente sans regle ne peut pas se repeter)", async () => {
    const tasksRouter = (await import("../routes/tasks")).default;
    const a = express();
    a.use(express.json());
    a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
    a.use("/api", tasksRouter);
    const r = await request(a).post("/api/tasks").send({ title: "Sans regle", status: "en_attente", priority: "basse", isRecurring: true, recurrenceRule: "" });
    expect(r.status).toBe(400);
  }, 60_000);
});
