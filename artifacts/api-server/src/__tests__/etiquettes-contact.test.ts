/**
 * Le bouton « etiquettes » de la fiche contact ecrit vraiment quelque chose.
 *
 * La route `PATCH /contacts/:id/tags` et le bouton de la fiche existaient tous
 * les deux depuis longtemps. La COLONNE, non. Chaque enregistrement tombait en
 * `42703 column "tags" of relation "contacts" does not exist`, et l'ecran
 * n'affichait que « Erreur lors de la mise a jour des etiquettes ».
 *
 * Pire que l'echec : l'ancienne route ecrivait en DEUX temps — `updatedAt` par
 * Drizzle, puis les etiquettes en SQL brut. Le premier UPDATE passait, le
 * second echouait. La fiche avait donc bouge (sa date de modification) pour un
 * changement qui n'a jamais eu lieu, et la reponse etait un 500.
 *
 * Un bouton qui echoue toujours vaut moins qu'un bouton absent : il fait
 * douter de tout le reste de l'ecran.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { contactsTable, db, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/contacts";

const stamp = Date.now();
let orgId = 0, autreOrgId = 0, userId = 0;

function appli(org = () => orgId) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: org(), userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

async function contact(v: Record<string, unknown> = {}) {
  const [c] = await db.insert(contactsTable).values({
    organisationId: orgId, firstName: "Jean", lastName: "Moreau",
    phone: "0102030405", category: "client", ...v,
  } as any).returning();
  return c!;
}
const relire = async (id: number) =>
  (await db.select().from(contactsTable).where(eq(contactsTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Etiquettes ${stamp}`, slug: `etiquettes-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [o2] = await db.insert(organisationsTable).values({
    name: `Etiquettes voisine ${stamp}`, slug: `etiquettes-v-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  autreOrgId = o2!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `etiq-${stamp}@example.test`, passwordHash: "x",
    prenom: "E", nom: "T", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, autreOrgId));
  } catch { /* nettoyage au mieux */ }
});

describe("poser des etiquettes sur un contact", () => {
  it("la colonne existe en base — sinon tout le reste est theorique", async () => {
    // Le defaut d'origine, teste directement : une ecriture sur `tags` levait
    // 42703. Passer par Drizzle ne suffit pas a le prouver cote route.
    const c = await contact();
    await db.update(contactsTable).set({ tags: ["essai"] }).where(eq(contactsTable.id, c.id));
    expect((await relire(c.id)).tags).toEqual(["essai"]);
  });

  it("la route repond 200 et rend le contact", async () => {
    const c = await contact();
    const r = await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["VIP"] });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(c.id);
  });

  it("l'etiquette est REELLEMENT en base apres l'appel", async () => {
    // Le test qui compte : une route peut repondre 200 en n'ecrivant rien.
    const c = await contact();
    await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["chantier", "urgent"] });
    expect((await relire(c.id)).tags).toEqual(["chantier", "urgent"]);
  });

  it("la reponse rend les etiquettes ecrites, pas celles d'avant", async () => {
    const c = await contact({ tags: ["ancien"] });
    const r = await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["nouveau"] });
    expect(r.body.tags).toEqual(["nouveau"]);
  });

  it("remplacer efface les precedentes", async () => {
    const c = await contact({ tags: ["a", "b"] });
    await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["c"] });
    expect((await relire(c.id)).tags).toEqual(["c"]);
  });

  it("une liste vide retire toutes les etiquettes", async () => {
    // Le seul moyen, depuis l'ecran, de retirer la derniere etiquette.
    const c = await contact({ tags: ["a"] });
    const r = await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: [] });
    expect(r.status).toBe(200);
    expect((await relire(c.id)).tags).toEqual([]);
  });

  it("les accents et espaces traversent sans etre abimes", async () => {
    const c = await contact();
    await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["Chantier à Sèvres", "gros œuvre"] });
    expect((await relire(c.id)).tags).toEqual(["Chantier à Sèvres", "gros œuvre"]);
  });

  it("une apostrophe ne casse pas l'ecriture", async () => {
    // L'ancienne route construisait du SQL brut : c'est exactement la ou une
    // apostrophe fait basculer une requete.
    const c = await contact();
    const r = await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["l'atelier"] });
    expect(r.status).toBe(200);
    expect((await relire(c.id)).tags).toEqual(["l'atelier"]);
  });

  it("la date de modification avance quand l'ecriture reussit", async () => {
    const c = await contact();
    await new Promise((r) => setTimeout(r, 10));
    await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["x"] });
    expect((await relire(c.id)).updatedAt.getTime()).toBeGreaterThan(c.updatedAt.getTime());
  });
});

describe("ce que la route doit refuser", () => {
  it("autre chose qu'un tableau est refuse en 400", async () => {
    const c = await contact();
    const r = await request(appli()).patch(`/api/contacts/${c.id}/tags`).send({ tags: "VIP" });
    expect(r.status).toBe(400);
  });

  it("un contact inexistant rend 404, pas 500", async () => {
    const r = await request(appli()).patch("/api/contacts/99999999/tags").send({ tags: ["x"] });
    expect(r.status).toBe(404);
  });

  it("le contact d'une autre organisation reste hors de portee", async () => {
    const c = await contact();
    const r = await request(appli(() => autreOrgId)).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["vole"] });
    expect(r.status).toBe(404);
  });

  it("et ses etiquettes n'ont pas bouge", async () => {
    // Un 404 rendu APRES ecriture serait une fuite silencieuse entre clients.
    const c = await contact({ tags: ["intact"] });
    await request(appli(() => autreOrgId)).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["vole"] });
    expect((await relire(c.id)).tags).toEqual(["intact"]);
  });

  it("une tentative refusee ne fait pas non plus avancer la date", async () => {
    // Le defaut precis de l'ancienne version : `updatedAt` posee d'abord, le
    // reste ensuite. La fiche bougeait pour un changement jamais applique.
    const c = await contact({ tags: ["intact"] });
    await new Promise((r) => setTimeout(r, 10));
    await request(appli(() => autreOrgId)).patch(`/api/contacts/${c.id}/tags`).send({ tags: ["vole"] });
    expect((await relire(c.id)).updatedAt.getTime()).toBe(c.updatedAt.getTime());
  });
});

describe("une seule ecriture, par le schema", () => {
  const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "contacts.ts"), "utf8");

  it("plus de SQL brut sur cette route", () => {
    const i = ROUTE.indexOf('"/contacts/:id/tags"');
    expect(i).toBeGreaterThan(-1);
    const bloc = ROUTE.slice(i, ROUTE.indexOf("router.", i + 10));
    expect(bloc, "SQL brut : c'est par la que la colonne absente passait inapercue").not.toMatch(/sql`/);
  });

  it("la mise a jour et les etiquettes partent ensemble", () => {
    const i = ROUTE.indexOf('"/contacts/:id/tags"');
    const bloc = ROUTE.slice(i, ROUTE.indexOf("router.", i + 10));
    expect(bloc).toMatch(/\.set\(\{\s*tags,\s*updatedAt/);
    expect(bloc.match(/db\.update\(/g)?.length, "une seule ecriture").toBe(1);
  });
});
