/**
 * « Toutes les sessions ont ete revoquees » doit etre vrai.
 *
 * L'ecran de securite portait ce bouton depuis longtemps. Il appelait une
 * fonction qui AFFICHAIT cette phrase et s'arretait la — aucune requete, aucun
 * effet. Un administrateur qui vient de decouvrir une compromission lit cette
 * phrase, la croit, et ne fait rien de plus. C'est le pire moment du produit
 * pour affirmer quelque chose qu'on n'a pas fait.
 *
 * La revocation reprend les DEUX moities que la desactivation d'un compte
 * utilise deja : `tokenInvalidatedAt` pour les jetons Bearer, qui vivent
 * 30 jours, et la suppression des sessions cookie. L'une sans l'autre laisse
 * une porte — c'est exactement la lecon ecrite dans `bulk/deactivate`.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/auth";

const stamp = Date.now();
let orgId = 0, autreOrgId = 0;
let admin = 0, agent = 0, voisin = 0;

function appli(role: string, userId: number, organisationId = orgId) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId, userRole: role };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

async function utilisateur(organisation: number, role: string, marqueur: string) {
  const [u] = await db.insert(usersTable).values({
    organisationId: organisation, email: `${marqueur}-${stamp}@example.test`, passwordHash: "x",
    prenom: marqueur, nom: "R", role, actif: true,
  }).returning({ id: usersTable.id });
  return u!.id;
}

const lire = async (id: number) =>
  (await db.select().from(usersTable).where(eq(usersTable.id, id)))[0]!;

/** Une session cookie, telle que connect-pg-simple la range. */
async function poserSession(userId: number) {
  const sid = `sess-${userId}-${Math.random().toString(36).slice(2)}`;
  await db.execute(sql`
    INSERT INTO user_sessions (sid, sess, expire)
    VALUES (${sid}, ${JSON.stringify({ userId })}::json, now() + interval '1 day')
  `);
  return sid;
}

const sessionsDe = async (userId: number) => {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM user_sessions WHERE (sess->>'userId')::int = ${userId}`);
  return Number((r.rows[0] as any)?.n ?? 0);
};

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Revocation ${stamp}`, slug: `revoc-${stamp}`, maxUsers: 100, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [a] = await db.insert(organisationsTable).values({
    name: `Voisine ${stamp}`, slug: `voisine-${stamp}`, maxUsers: 100, actif: true,
  }).returning({ id: organisationsTable.id });
  autreOrgId = a!.id;

  admin = await utilisateur(orgId, "administrateur", "revadm");
  agent = await utilisateur(orgId, "agent", "revagt");
  voisin = await utilisateur(autreOrgId, "administrateur", "revvoisin");
}, 60_000);

afterAll(async () => {
  try {
    await db.execute(sql`DELETE FROM user_sessions WHERE (sess->>'userId')::int IN (${admin}, ${agent}, ${voisin})`);
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, autreOrgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, autreOrgId));
  } catch { /* journaux en ajout seul */ }
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM user_sessions WHERE (sess->>'userId')::int IN (${admin}, ${agent}, ${voisin})`);
  await db.update(usersTable).set({ tokenInvalidatedAt: null }).where(eq(usersTable.organisationId, orgId));
  await db.update(usersTable).set({ tokenInvalidatedAt: null }).where(eq(usersTable.organisationId, autreOrgId));
});

const revoquer = (role: string, userId: number, organisation = orgId) =>
  request(appli(role, userId, organisation)).post("/api/auth/sessions/revoke-all").send({});

describe("la revocation globale coupe vraiment", () => {
  it("elle repond le nombre de comptes concernes", async () => {
    const r = await revoquer("administrateur", admin);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.revoked).toBeGreaterThanOrEqual(2);
  });

  it("les sessions cookie disparaissent", async () => {
    await poserSession(agent);
    expect(await sessionsDe(agent)).toBe(1);
    await revoquer("administrateur", admin);
    expect(await sessionsDe(agent), "la session cookie a survecu").toBe(0);
  });

  it("les jetons Bearer sont invalides aussi", async () => {
    // L'une sans l'autre laisse une porte: `actif: false` seul ne coupait pas
    // la session de navigateur, et supprimer la session seule ne coupe pas un
    // jeton de 30 jours.
    await revoquer("administrateur", admin);
    expect((await lire(agent)).tokenInvalidatedAt, "aucun horodatage d'invalidation").toBeTruthy();
  });

  it("l'appelant se coupe lui-meme", async () => {
    // Une revocation qui s'epargne laisse ouverte la session depuis laquelle
    // l'attaquant pourrait justement agir.
    await poserSession(admin);
    await revoquer("administrateur", admin);
    expect(await sessionsDe(admin)).toBe(0);
    expect((await lire(admin)).tokenInvalidatedAt).toBeTruthy();
  });

  it("une autre organisation n'est pas touchee", async () => {
    await poserSession(voisin);
    await revoquer("administrateur", admin);
    expect(await sessionsDe(voisin), "la revocation a deborde sur un autre client").toBe(1);
    expect((await lire(voisin)).tokenInvalidatedAt).toBeNull();
  });

  it("un agent ne peut pas la declencher", async () => {
    const r = await revoquer("agent", agent);
    expect(r.status).toBe(403);
  });

  it("ni un compte en lecture seule", async () => {
    const lecteur = await utilisateur(orgId, "lecture_seule", `revlec${Math.random().toString(36).slice(2, 7)}`);
    const r = await revoquer("lecture_seule", lecteur);
    expect(r.status).toBe(403);
  });

  it("et un refus ne coupe rien", async () => {
    await poserSession(admin);
    await revoquer("agent", agent);
    expect(await sessionsDe(admin), "un refus a quand meme coupe").toBe(1);
  });

  it("un super_admin le peut", async () => {
    const proprietaire = await utilisateur(orgId, "super_admin", `revsa${Math.random().toString(36).slice(2, 7)}`);
    const r = await revoquer("super_admin", proprietaire);
    expect(r.status).toBe(200);
  });

  it("sans organisation, la route refuse", async () => {
    const r = await request(appli("administrateur", admin, 0 as unknown as number))
      .post("/api/auth/sessions/revoke-all").send({});
    expect(r.status).toBe(403);
  });
});
