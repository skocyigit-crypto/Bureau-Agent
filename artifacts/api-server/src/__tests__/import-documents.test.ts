/**
 * Import des lignes extraites d'un document (base reelle, vrai routeur).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { contactsTable, db, organisationsTable, tasksTable, usersTable } from "@workspace/db";
import { lireLigneTache } from "../services/import-document-lignes";

const stamp = Date.now();
let orgId = 0;
let userId = 0;
let appli: express.Express;

const ligne = (i: number, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ rowIndex: i, fields, errors: [], warnings: [], ...extra });
const importer = (targetModule: string, rows: unknown[]) => request(appli).post("/api/documents/import").send({ targetModule, rows });

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Doc ${stamp}`, slug: `doc-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `doc-${stamp}@example.test`, passwordHash: "x", prenom: "D", nom: "O", role: "agent", actif: true }).returning({ id: usersTable.id });
  userId = u!.id;
  const router = (await import("../routes/documents")).default;
  appli = express();
  appli.use(express.json());
  appli.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  appli.use("/api", router);
}, 120_000);
afterAll(async () => {
  await db.delete(contactsTable).where(eq(contactsTable.organisationId, orgId));
  await db.delete(tasksTable).where(eq(tasksTable.organisationId, orgId));
  await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

describe("lecture d'une tache", () => {
  it("alias francais reconnus", () => {
    const l = lireLigneTache({ title: "Poser placo", status: "Terminé", priority: "Urgent" });
    expect(l.ok && [l.valeurs.status, l.valeurs.priority]).toEqual(["termine", "haute"]);
  });
  it("statut inconnu refuse avec raison", () => {
    expect(lireLigneTache({ title: "x", status: "bloqué" })).toEqual({ ok: false, erreur: "statut « bloqué » inconnu" });
  });
});

describe("POST /documents/import", () => {
  it("taches : « Terminé » enregistre comme termine", async () => {
    const r = await importer("taches", [ligne(0, { title: "Livrer carrelage", status: "Terminé", priority: "basse" })]);
    expect(r.body.totalImported).toBe(1);
    const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, r.body.importedIds[0]));
    expect(t!.status).toBe("termine");
  });

  it("echeance illisible : ligne ignoree avec raison, pas d'erreur SQL a l'ecran", async () => {
    const r = await importer("taches", [ligne(0, { title: "Relancer", dueDate: "demain" })]);
    expect([r.body.totalImported, r.body.totalErrors]).toEqual([0, 0]);
    expect(r.body.skipped[0].reason).toMatch(/illisible/);
  });

  it("contact sans telephone ignore avec raison", async () => {
    const r = await importer("contacts", [ligne(0, { firstName: "A", lastName: "Sansnum" })]);
    expect(r.body.skipped[0].reason).toMatch(/téléphone/);
  });

  it("doublon verifie par le serveur meme si le navigateur ne le signale pas", async () => {
    await importer("contacts", [ligne(0, { firstName: "Paul", lastName: "Roux", phone: "0612121212" })]);
    const r = await importer("contacts", [ligne(0, { firstName: "Paul", lastName: "Roux", phone: "+33 6 12 12 12 12" })]);
    expect([r.body.totalImported, r.body.totalSkipped]).toEqual([0, 1]);
  });

  it("doublon a l'interieur du lot", async () => {
    const r = await importer("contacts", [
      ligne(0, { firstName: "Eve", lastName: "Blanc", phone: "0633333333", email: "eve@example.test" }),
      ligne(1, { firstName: "Eve", lastName: "Blanc", phone: "0644444444", email: "EVE@example.test" }),
    ]);
    expect([r.body.totalImported, r.body.totalSkipped]).toEqual([1, 1]);
  });

  it("champs objets ou categorie inconnue ne passent pas tels quels", async () => {
    const r = await importer("contacts", [ligne(0, { firstName: "Max", lastName: "Obj", phone: "0655555555", category: "VIP", company: { x: 1 } })]);
    expect(r.body.totalImported).toBe(1);
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, r.body.importedIds[0]));
    expect([c!.category, c!.company]).toEqual(["autre", null]);
  });

  it("module inconnu : 400", async () => {
    expect((await importer("factures", [ligne(0, {})])).status).toBe(400);
  });
});
