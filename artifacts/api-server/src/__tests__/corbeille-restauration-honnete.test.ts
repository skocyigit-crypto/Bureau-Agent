/**
 * La corbeille ne doit ni mentir, ni oublier le cas le plus frequent.
 * Base reelle : un `ON CONFLICT DO NOTHING` ne se verifie pas en relisant le code.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, deletedRowsTable, notesInternesTable, organisationsTable } from "@workspace/db";
import { archiveDeletedRows, restoreFromTrash } from "../services/trash";

const lire = (f: string) => readFileSync(join(import.meta.dirname, "..", "routes", f), "utf8");
const stamp = Date.now();
let orgId = 0;

async function supprimerEtArchiver(prenom: string) {
  const [c] = await db.insert(notesInternesTable).values({ organisationId: orgId, content: prenom }).returning();
  const [d] = await db.delete(notesInternesTable).where(eq(notesInternesTable.id, c!.id)).returning();
  await archiveDeletedRows(notesInternesTable, [d!], { orgId, userId: null, userName: "test" });
  const [e] = await db.select().from(deletedRowsTable).where(and(eq(deletedRowsTable.organisationId, orgId), eq(deletedRowsTable.rowId, c!.id)));
  return { contact: d!, entree: e! };
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Corbeille ${stamp}`, slug: `corbeille-${stamp}`, email: `corbeille-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
}, 60_000);
afterAll(async () => { if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); });

describe("restauration (base reelle)", () => {
  it("une restauration normale remet la ligne et vide l'entree", async () => {
    const { contact, entree } = await supprimerEtArchiver("Normal");
    expect(await restoreFromTrash(orgId, entree.id)).toEqual({ ok: true });
    expect((await db.select().from(notesInternesTable).where(eq(notesInternesTable.id, contact.id))).length).toBe(1);
    expect((await db.select().from(deletedRowsTable).where(eq(deletedRowsTable.id, entree.id))).length).toBe(0);
  }, 60_000);

  it("en conflit, elle NE pretend PAS avoir restaure et GARDE l'entree", async () => {
    const { contact, entree } = await supprimerEtArchiver("Conflit");
    // Une ligne occupe deja l'identifiant.
    await db.insert(notesInternesTable).values({ id: contact.id, organisationId: orgId, content: "Occupant" });
    expect(await restoreFromTrash(orgId, entree.id)).toEqual({ ok: false, reason: "conflict" });
    expect((await db.select().from(deletedRowsTable).where(eq(deletedRowsTable.id, entree.id))).length).toBe(1);
    const [present] = await db.select().from(notesInternesTable).where(eq(notesInternesTable.id, contact.id));
    expect(present!.content).toBe("Occupant"); // rien ecrase
  }, 60_000);

  it("une entree d'une autre organisation est introuvable", async () => {
    const { entree } = await supprimerEtArchiver("Autre");
    expect(await restoreFromTrash(orgId + 999999, entree.id)).toEqual({ ok: false, reason: "not_found" });
  }, 60_000);
});

describe("route", () => {
  const trash = lire("trash.ts");
  it("un compte lecture seule ne peut pas restaurer", () => {
    expect(trash).toContain('router.post("/trash/:id/restore", requireRole("agent")');
  });
  it("le conflit est dit (409), pas maquille en succes", () => {
    const i = trash.indexOf('outcome.reason === "conflict"');
    expect(i).toBeGreaterThan(0);
    expect(trash.slice(i, i + 200)).toContain("status(409)");
  });
  it("la restauration est tracee", () => expect(trash).toContain('"trash_restore"'));
});

describe("les suppressions unitaires passent par la corbeille", () => {
  it("un contact", () => expect(lire("contacts.ts")).toContain("archiveDeletedRows(contactsTable, [contact]"));
  it("un appel ET les taches emportees avec lui", () => {
    const s = lire("calls.ts");
    expect(s).toContain("archiveDeletedRows(callsTable, [call.deleted]");
    expect(s).toContain("archiveDeletedRows(tasksTable, call.taches");
  });
  it("une depense", () => expect(lire("depenses.ts")).toContain("archiveDeletedRows(depensesTable, deleted"));
});
