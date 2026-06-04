/**
 * Contrôle d'accès intra-tenant sur la gestion des clés API.
 *
 * Une clé API authentifie AU NOM de son créateur (le porteur hérite de
 * l'identité/rôle du créateur). Révéler ou révoquer la clé d'autrui revient
 * donc à pouvoir l'usurper. Cette suite verrouille l'invariant — sans elle,
 * une régression qui retirerait le garde owner-or-admin rouvrirait une
 * escalade de privilèges au sein d'une même organisation :
 *
 *   - liste : un admin voit toutes les clés de l'org ; un membre standard ne
 *     voit que les siennes.
 *   - révélation / révocation : autorisées seulement au propriétaire OU à un
 *     admin (administrateur / super_admin), sinon 403.
 *   - révocation idempotente : seconde révocation = no-op 204.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, apiKeysTable, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const stamp = Date.now();

interface SeededUser {
  id: number;
  token: string;
}

let orgId: number;
let admin: SeededUser;
let agent: SeededUser;
let agentKeyId: number;
let adminKeyId: number;

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

async function createKey(token: string, name: string): Promise<number> {
  const res = await request(app)
    .post("/api/api-keys")
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost")
    .send({ name, scopes: ["read"] });
  expect(res.status).toBe(201);
  expect(res.body?.id).toBeTypeOf("number");
  return res.body.id as number;
}

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `ApiKey ACL Org ${stamp}`,
      slug: `apikey-acl-${stamp}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;

  const [adminRow] = await db
    .insert(usersTable)
    .values({
      email: `acl-admin-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Admin",
      prenom: "Test",
      role: "administrateur",
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  const [agentRow] = await db
    .insert(usersTable)
    .values({
      email: `acl-agent-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Agent",
      prenom: "Test",
      role: "agent",
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });

  admin = {
    id: adminRow.id,
    token: tokenFor({
      id: adminRow.id,
      role: "administrateur",
      organisationId: orgId,
      email: `acl-admin-${stamp}@example.test`,
    }),
  };
  agent = {
    id: agentRow.id,
    token: tokenFor({
      id: agentRow.id,
      role: "agent",
      organisationId: orgId,
      email: `acl-agent-${stamp}@example.test`,
    }),
  };

  agentKeyId = await createKey(agent.token, `acl-agent-key-${stamp}`);
  adminKeyId = await createKey(admin.token, `acl-admin-key-${stamp}`);
});

afterAll(async () => {
  try {
    await db
      .delete(apiKeysTable)
      .where(inArray(apiKeysTable.organisationId, [orgId]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [admin.id, agent.id]));
    await db
      .delete(organisationsTable)
      .where(inArray(organisationsTable.id, [orgId]));
  } catch {
    // nettoyage best-effort; ids uniques par run (stamp).
  }
});

describe("Clés API — contrôle d'accès intra-tenant", () => {
  it("agent → ne révèle PAS la clé d'un autre membre (403)", async () => {
    const res = await request(app)
      .post(`/api/api-keys/${adminKeyId}/reveal`)
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("agent → révèle sa propre clé (200 + clé en clair)", async () => {
    const res = await request(app)
      .post(`/api/api-keys/${agentKeyId}/reveal`)
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    expect(typeof res.body?.key).toBe("string");
    expect(res.body.key.length).toBeGreaterThan(0);
  });

  it("admin → révèle la clé de l'agent (override admin, 200)", async () => {
    const res = await request(app)
      .post(`/api/api-keys/${agentKeyId}/reveal`)
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
  });

  it("agent → ne révoque PAS la clé d'un autre membre (403)", async () => {
    const res = await request(app)
      .delete(`/api/api-keys/${adminKeyId}`)
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("liste — agent ne voit QUE ses propres clés", async () => {
    const res = await request(app)
      .get("/api/api-keys")
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    const ids = new Set((res.body as Array<{ id: number }>).map((k) => k.id));
    expect(ids.has(agentKeyId)).toBe(true);
    expect(ids.has(adminKeyId)).toBe(false);
  });

  it("liste — admin voit toutes les clés de l'org", async () => {
    const res = await request(app)
      .get("/api/api-keys")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    const ids = new Set((res.body as Array<{ id: number }>).map((k) => k.id));
    expect(ids.has(agentKeyId)).toBe(true);
    expect(ids.has(adminKeyId)).toBe(true);
  });

  it("révocation propriétaire (204) puis seconde révocation idempotente (204)", async () => {
    const first = await request(app)
      .delete(`/api/api-keys/${agentKeyId}`)
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(first.status).toBe(204);
    const second = await request(app)
      .delete(`/api/api-keys/${agentKeyId}`)
      .set("Authorization", `Bearer ${agent.token}`)
      .set("Origin", "http://localhost");
    expect(second.status).toBe(204);
  });
});
