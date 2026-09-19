/**
 * Les trois exports CSV n'ont jamais produit un fichier.
 *
 * Journal d'audit, depenses et messages parcourent leur table par lots
 * decroissants (`WHERE id < curseur`) en partant d'une valeur « plus grande
 * que tout » : `Number.MAX_SAFE_INTEGER`. Mais ces identifiants sont des
 * `serial`, donc des `integer` sur 4 octets. Postgres doit convertir le
 * litteral avant de comparer, et refuse :
 *
 *     value "9007199254740991" is out of range for type integer   (22003)
 *
 * La toute PREMIERE requete echouait, pour toute organisation, a chaque fois.
 * Le bouton « Exporter » renvoyait 500 — ou, pire, un fichier tronque a son
 * seul en-tete quand celui-ci etait deja parti.
 *
 * Le defaut etait illisible a l'oeil : la valeur est parfaitement correcte en
 * JavaScript. C'est la largeur de la COLONNE qui decide, pas celle du langage.
 * Ces controles passent donc par une vraie base : une relecture du code ne
 * dirait rien de ce que Postgres accepte.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, depensesTable, messagesTable, organisationsTable, pool, usersTable } from "@workspace/db";
import auditRouter from "../routes/audit";
import depensesRouter from "../routes/depenses";
import messagesRouter from "../routes/messages";
import { CURSEUR_EXPORT_DEBUT } from "../lib/curseur-export";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli(router: express.Router) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "super_admin" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Export ${stamp}`, slug: `export-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `export-${stamp}@example.test`,
    passwordHash: "x", prenom: "E", nom: "X", role: "super_admin", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;

  await db.insert(messagesTable).values({
    organisationId: orgId, type: "sms", contactName: "Client A",
    phoneNumber: "0102030405", content: "Bonjour", priority: "normale", isRead: false,
  } as any);
  await db.insert(depensesTable).values({
    organisationId: orgId, vendor: `Ciment ${stamp}`, title: "Sacs de ciment",
    category: "materiaux", expenseDate: new Date(),
    amountHt: "100.00", amountTva: "20.00", amountTtc: "120.00",
    // L'export ne rend par defaut que les depenses APPROUVEES (voir
    // routes/depenses.ts) : une depense en attente ne prouverait rien ici.
    status: "approuve",
  } as any);
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux append-only */ }
});

describe("la cause: la largeur de la colonne, pas celle du langage", () => {
  it("Postgres refuse MAX_SAFE_INTEGER contre un identifiant serial", async () => {
    await expect(
      pool.query("SELECT id FROM messages WHERE id < $1 LIMIT 1", [Number.MAX_SAFE_INTEGER]),
      "si Postgres l'acceptait, il n'y aurait jamais eu de defaut",
    ).rejects.toMatchObject({ code: "22003" });
  });

  it("et accepte la borne haute d'un integer", async () => {
    const r = await pool.query("SELECT id FROM messages WHERE id < $1 LIMIT 1", [CURSEUR_EXPORT_DEBUT]);
    expect(r).toBeTruthy();
  });

  it("la borne retenue est bien celle d'un integer signe", () => {
    expect(CURSEUR_EXPORT_DEBUT).toBe(2 ** 31 - 1);
  });

  it("elle depasse tout identifiant que la table peut porter", () => {
    expect(CURSEUR_EXPORT_DEBUT).toBeGreaterThan(2_000_000_000);
  });
});

describe("l'export des messages produit un fichier", () => {
  it("il repond 200, et non 500", async () => {
    const r = await request(appli(messagesRouter)).get("/api/messages/export/csv");
    expect(r.status, "le bouton « Exporter » renvoyait 500 pour toute organisation").toBe(200);
  });

  it("il porte l'en-tete CSV", async () => {
    const r = await request(appli(messagesRouter)).get("/api/messages/export/csv");
    expect(r.text).toContain("Contenu");
  });

  it("et les lignes de l'organisation", async () => {
    const r = await request(appli(messagesRouter)).get("/api/messages/export/csv");
    expect(r.text, "un en-tete seul est un fichier vide deguise").toContain("Client A");
  });

  it("il s'annonce comme un fichier a telecharger", async () => {
    const r = await request(appli(messagesRouter)).get("/api/messages/export/csv");
    expect(r.headers["content-disposition"]).toMatch(/attachment/);
  });
});

describe("l'export des depenses produit un fichier", () => {
  it("il repond 200", async () => {
    const r = await request(appli(depensesRouter)).get("/api/depenses/export");
    expect(r.status).toBe(200);
  });

  it("et contient la depense saisie", async () => {
    const r = await request(appli(depensesRouter)).get("/api/depenses/export");
    expect(r.text).toContain(`Ciment ${stamp}`);
  });
});

describe("l'export du journal d'audit produit un fichier", () => {
  it("il repond 200", async () => {
    const r = await request(appli(auditRouter)).get("/api/audit/export/csv");
    expect(r.status).toBe(200);
  });

  it("et commence par un en-tete, meme sans aucune ligne", async () => {
    // Un journal vide est un cas normal pour une organisation neuve: il doit
    // rendre un fichier lisible, pas une erreur.
    const r = await request(appli(auditRouter)).get("/api/audit/export/csv");
    expect(r.text.length).toBeGreaterThan(0);
  });
});
