/**
 * Contrôle d'accès sur la gestion des clés API.
 *
 * Une clé API authentifie AU NOM de son créateur, et les `scopes` enregistrés
 * ne sont pas encore appliqués par les routes en aval : émettre une clé revient
 * donc à déléguer l'intégralité de l'autorité du compte. Trois invariants en
 * découlent, tous verrouillés ici — les perdre rouvrirait une élévation de
 * privilège intra-tenant :
 *
 *   1. `/api-keys` est réservé aux administrateurs (administrateur /
 *      super_admin). Un agent — pourtant autorisé à muter le reste du tenant —
 *      reçoit 403 sur TOUTES les méthodes, lecture comprise : connaître l'ID
 *      d'une clé est déjà la cible d'une révocation non autorisée.
 *   2. La clé en clair n'est renvoyée qu'UNE fois, à la création. L'ancienne
 *      route `reveal` est supprimée (410) et plus aucun chiffré réutilisable
 *      n'est stocké : une compromission base + clé de chiffrement ne permet
 *      plus de récupérer des identifiants.
 *   3. Le cloisonnement inter-organisations tient : l'admin d'une autre org ne
 *      voit ni ne révoque les clés de celle-ci.
 *
 * Cette suite couvrait auparavant un modèle « reveal » où un agent créait et
 * redévoilait ses propres clés. Ce modèle a été retiré volontairement ; les cas
 * ci-dessous verrouillent le comportement de remplacement.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, apiKeysTable, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";
import { HASH_ONLY_KEY_SENTINEL } from "../lib/api-key-auth";

const stamp = Date.now();

interface SeededUser {
  id: number;
  token: string;
}

let orgId: number;
let otherOrgId: number;
let admin: SeededUser;
let agent: SeededUser;
let otherAdmin: SeededUser;
let adminKeyId: number;
let revocableKeyId: number;

function tokenFor(u: {
  id: number;
  role: string;
  organisationId: number;
  email: string;
}): string {
  return mintApiToken({
    userId: u.id,
    userRole: u.role,
    organisationId: u.organisationId,
    userEmail: u.email,
    prenom: "Test",
    nom: "User",
  });
}

async function seedOrg(slug: string): Promise<number> {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `ApiKey ACL Org ${slug}`,
      slug: `apikey-acl-${slug}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  return org.id;
}

async function seedUser(
  email: string,
  role: string,
  organisationId: number,
): Promise<SeededUser> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "x",
      nom: "Test",
      prenom: "User",
      role,
      organisationId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  return {
    id: row.id,
    token: tokenFor({ id: row.id, role, organisationId, email }),
  };
}

/** Crée une clé via l'API en tant qu'admin et renvoie (id, clé en clair). */
async function createKey(
  token: string,
  name: string,
): Promise<{ id: number; key: string }> {
  const res = await request(app)
    .post("/api/api-keys")
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost")
    .send({ name, scopes: ["read"] });
  expect(res.status).toBe(201);
  expect(res.body?.id).toBeTypeOf("number");
  expect(res.body?.key).toBeTypeOf("string");
  return { id: res.body.id as number, key: res.body.key as string };
}

beforeAll(async () => {
  orgId = await seedOrg(String(stamp));
  otherOrgId = await seedOrg(`other-${stamp}`);

  admin = await seedUser(
    `acl-admin-${stamp}@example.test`,
    "administrateur",
    orgId,
  );
  agent = await seedUser(`acl-agent-${stamp}@example.test`, "agent", orgId);
  otherAdmin = await seedUser(
    `acl-other-admin-${stamp}@example.test`,
    "administrateur",
    otherOrgId,
  );

  adminKeyId = (await createKey(admin.token, `acl-admin-key-${stamp}`)).id;
  revocableKeyId = (await createKey(admin.token, `acl-revoke-key-${stamp}`)).id;
});

afterAll(async () => {
  try {
    await db
      .delete(apiKeysTable)
      .where(inArray(apiKeysTable.organisationId, [orgId, otherOrgId]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [admin.id, agent.id, otherAdmin.id]));
    await db
      .delete(organisationsTable)
      .where(inArray(organisationsTable.id, [orgId, otherOrgId]));
  } catch {
    // nettoyage best-effort; ids uniques par run (stamp).
  }
});

describe("Clés API — réservées aux administrateurs", () => {
  it("agent → ne peut PAS créer de clé (403)", async () => {
    const res = await request(app)
      .post("/api/api-keys")
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost")
      .send({ name: `acl-agent-denied-${stamp}`, scopes: ["read"] });
    expect(res.status).toBe(403);
  });

  it("agent → ne peut PAS lister les clés (403)", async () => {
    // La lecture est refusée elle aussi : divulguer les IDs de clés est le
    // premier pas d'une révocation non autorisée.
    const res = await request(app)
      .get("/api/api-keys")
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("agent → ne peut PAS révoquer une clé (403)", async () => {
    const res = await request(app)
      .delete(`/api/api-keys/${adminKeyId}`)
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("appel non authentifié → 401", async () => {
    const res = await request(app)
      .get("/api/api-keys")
      .set("Origin", "http://localhost");
    expect(res.status).toBe(401);
  });
});

describe("Clés API — affichage unique, aucun secret récupérable", () => {
  it("la création renvoie la clé en clair exactement une fois", async () => {
    const created = await createKey(admin.token, `acl-once-${stamp}`);
    expect(created.key.length).toBeGreaterThan(0);

    // La liste ne doit jamais reproduire la clé complète.
    const list = await request(app)
      .get("/api/api-keys")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(list.status).toBe(200);
    const entry = (list.body as Array<Record<string, unknown>>).find(
      (k) => k.id === created.id,
    );
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("key");
    expect(entry).not.toHaveProperty("keyEncrypted");
    expect(entry).not.toHaveProperty("keyHash");
  });

  it("aucun chiffré réutilisable n'est stocké au repos", async () => {
    const [row] = await db
      .select({ keyEncrypted: apiKeysTable.keyEncrypted })
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, adminKeyId));
    expect(row?.keyEncrypted).toBe(HASH_ONLY_KEY_SENTINEL);
  });

  it("reveal est supprimé (410) même pour l'admin propriétaire", async () => {
    const res = await request(app)
      .post(`/api/api-keys/${adminKeyId}/reveal`)
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(410);
    expect(res.body?.code).toBe("api_key_reveal_removed");
    expect(res.body).not.toHaveProperty("key");
  });
});

describe("Clés API — cloisonnement inter-organisations", () => {
  it("l'admin d'une autre org ne voit pas les clés de celle-ci", async () => {
    const res = await request(app)
      .get("/api/api-keys")
      .set("Authorization", `Bearer ${otherAdmin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    const ids = new Set((res.body as Array<{ id: number }>).map((k) => k.id));
    expect(ids.has(adminKeyId)).toBe(false);
  });

  it("l'admin d'une autre org ne révoque pas une clé de celle-ci (404)", async () => {
    const res = await request(app)
      .delete(`/api/api-keys/${adminKeyId}`)
      .set("Authorization", `Bearer ${otherAdmin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(404);
  });
});

describe("Clés API — révocation", () => {
  it("l'admin voit les clés de son organisation", async () => {
    const res = await request(app)
      .get("/api/api-keys")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    const ids = new Set((res.body as Array<{ id: number }>).map((k) => k.id));
    expect(ids.has(adminKeyId)).toBe(true);
    expect(ids.has(revocableKeyId)).toBe(true);
  });

  it("révocation (204) puis seconde révocation idempotente (204)", async () => {
    const first = await request(app)
      .delete(`/api/api-keys/${revocableKeyId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(first.status).toBe(204);
    const second = await request(app)
      .delete(`/api/api-keys/${revocableKeyId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(second.status).toBe(204);
  });
});
