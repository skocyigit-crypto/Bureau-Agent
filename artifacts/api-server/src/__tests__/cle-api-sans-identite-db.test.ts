/**
 * Une cle API ne gere ni les comptes, ni les cles, ni la plateforme.
 *
 * Une cle authentifie au nom de son createur, avec tout son role (scopes non
 * appliques). Detenue par un tiers, une cle d'administrateur permettait de
 * creer un administrateur, de changer l'e-mail d'un compte, d'emettre
 * d'autres cles ou d'inviter quelqu'un — et de garder l'acces apres la
 * revocation de la cle. La meme chaine a ete trouvee et fermee cote BTP le
 * 29/09.
 *
 * Montage identique a routes/index.ts : le routeur d'authentification avant
 * la garde globale, les autres apres.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { apiKeysTable, contactsTable, db, organisationsTable, usersTable } from "@workspace/db";
import { generateApiKey, HASH_ONLY_KEY_SENTINEL } from "../lib/api-key-auth";
import { requireAuth, routeInterditeAuxCles } from "../middleware/auth";
import authRouter from "../routes/auth";
import apiKeysRouter from "../routes/api-keys";
import contactsRouter from "../routes/contacts";

const stamp = Date.now();
const ids: Record<string, number> = {};
let cle = "";

/** Session vide (comme une requete sans cookie) ou pre-remplie (cookie de l'admin). */
function appli(sessionAdmin = false) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = sessionAdmin
      ? { userId: ids.admin, organisationId: ids.org, userRole: "administrateur", userEmail: `admin-cle-${stamp}@exemple.test` }
      : {};
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", authRouter);
  a.use("/api", requireAuth);
  a.use("/api", apiKeysRouter);
  a.use("/api", contactsRouter);
  return a;
}
const avecCle = (r: request.Test) => r.set("Authorization", `Bearer ${cle}`);

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Cle ${stamp}`, slug: `cle-${stamp}`, maxUsers: 10, actif: true }).returning({ id: organisationsTable.id });
  ids.org = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: ids.org, email: `admin-cle-${stamp}@exemple.test`, passwordHash: "x", prenom: "Ada", nom: "Cle", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.admin = u!.id;
  const k = generateApiKey();
  cle = k.full;
  const [row] = await db.insert(apiKeysTable).values({ organisationId: ids.org, name: "Integration test", keyPrefix: k.prefix, keyHash: k.hash, keyEncrypted: HASH_ONLY_KEY_SENTINEL, createdByUserId: ids.admin }).returning({ id: apiKeysTable.id });
  ids.cle = row!.id;
  await db.insert(contactsTable).values({ organisationId: ids.org, firstName: "Lea", lastName: `Cle${stamp}`, phone: "+33600001111" });
});

afterAll(async () => {
  try {
    await db.delete(apiKeysTable).where(eq(apiKeysTable.organisationId, ids.org));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, ids.org));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [ids.org]));
  } catch { /* le journal d'audit peut retenir l'organisation */ }
});

describe("la regle", () => {
  it("refuse l'identite, les cles, les invitations, la plateforme ; laisse les dossiers", () => {
    for (const p of ["/api/auth/users", "/api/auth/users/3", "/api/api-keys", "/api/invitations", "/api/webhooks/2", "/api/organisations", "/api/license-management/record-payment", "/api/admin/audit"]) {
      expect(routeInterditeAuxCles("POST", p), p).toBe(true);
    }
    expect(routeInterditeAuxCles("GET", "/api/data-protection/registre")).toBe(false);
    expect(routeInterditeAuxCles("POST", "/api/data-protection/erase")).toBe(true);
    for (const p of ["/api/contacts", "/api/calls?limit=5", "/api/devis/4", "/api/authors", "/api/administration-like"]) {
      expect(routeInterditeAuxCles("POST", p), p).toBe(false);
    }
  });
});

describe("avec une cle d'administrateur", () => {
  it("les dossiers restent accessibles : c'est l'usage d'une integration", async () => {
    const r = await avecCle(request(appli()).get("/api/contacts"));
    expect(r.status, r.text).toBe(200);
  });

  it("ne cree pas d'administrateur", async () => {
    const avant = (await db.select().from(usersTable).where(eq(usersTable.organisationId, ids.org))).length;
    const r = await avecCle(request(appli()).post("/api/auth/users")).send({ email: `intrus-${stamp}@exemple.test`, password: "Intrus-2026-!!", prenom: "In", nom: "Trus", role: "administrateur" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("cle_api_interdite");
    expect((await db.select().from(usersTable).where(eq(usersTable.organisationId, ids.org))).length).toBe(avant);
  });

  it("ne change pas l'e-mail d'un compte", async () => {
    const r = await avecCle(request(appli()).patch(`/api/auth/users/${ids.admin}`)).send({ email: `pirate-${stamp}@exemple.test` });
    expect(r.status).toBe(403);
    const [u] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, ids.admin));
    expect(u!.email).toBe(`admin-cle-${stamp}@exemple.test`);
  });

  it("n'emet pas d'autre cle", async () => {
    const r = await avecCle(request(appli()).post("/api/api-keys")).send({ name: "Porte derobee" });
    expect(r.status).toBe(403);
    const cles = await db.select().from(apiKeysTable).where(eq(apiKeysTable.organisationId, ids.org));
    expect(cles).toHaveLength(1);
  });

  it("ne liste meme pas les cles", async () => {
    expect((await avecCle(request(appli()).get("/api/api-keys"))).status).toBe(403);
  });
});

describe("la meme personne, dans l'application", () => {
  it("gere ses cles depuis sa session", async () => {
    const r = await request(appli(true)).post("/api/api-keys").send({ name: "Legitime" });
    expect(r.status, r.text).toBeLessThan(300);
    const cles = await db.select().from(apiKeysTable).where(and(eq(apiKeysTable.organisationId, ids.org), eq(apiKeysTable.name, "Legitime")));
    expect(cles).toHaveLength(1);
  });
});

describe("une cle revoquee", () => {
  it("n'ouvre plus rien", async () => {
    await db.update(apiKeysTable).set({ revokedAt: new Date() }).where(eq(apiKeysTable.id, ids.cle));
    expect((await avecCle(request(appli()).get("/api/contacts"))).status).toBe(401);
  });
});
