/**
 * Contrôle d'accès + circuit breaker sur la gestion des endpoints webhook.
 *
 * Un webhook exfiltre TOUT le flux d'événements de l'organisation vers une URL
 * externe : c'est un vecteur de fuite de données. La gestion est donc réservée
 * aux rôles d'administration (administrateur / super_admin). Cette suite
 * verrouille deux invariants — sans elle, une régression rouvrirait soit une
 * fuite (membre standard créant un webhook), soit un endpoint inutilisable :
 *
 *   - autorisation : un membre standard (agent) reçoit 403 sur list/create/
 *     update/delete ; un admin passe.
 *   - circuit breaker : réactiver (active=true) un endpoint coupé remet
 *     failureCount à zéro, sinon le tout premier échec qui suit le recoupe.
 *
 * Note: les cas 403 sont bloqués par le middleware AVANT le handler, donc aucun
 * appel réseau/SSRF n'a lieu. La réactivation admin ne modifie pas l'URL -> pas
 * de résolution DNS non plus. La suite reste hermétique (pas de réseau externe).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  webhookEndpointsTable,
  organisationsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";
import { encryptSensitiveData } from "../lib/crypto";

const stamp = Date.now();

let orgId: number;
let adminToken: string;
let agentToken: string;
let adminId: number;
let agentId: number;
let endpointId: number;

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

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Webhook ACL Org ${stamp}`,
      slug: `webhook-acl-${stamp}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;

  const [adminRow] = await db
    .insert(usersTable)
    .values({
      email: `wh-admin-${stamp}@example.test`,
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
      email: `wh-agent-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Agent",
      prenom: "Test",
      role: "agent",
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  adminId = adminRow.id;
  agentId = agentRow.id;

  adminToken = tokenFor({
    id: adminId,
    role: "administrateur",
    organisationId: orgId,
    email: `wh-admin-${stamp}@example.test`,
  });
  agentToken = tokenFor({
    id: agentId,
    role: "agent",
    organisationId: orgId,
    email: `wh-agent-${stamp}@example.test`,
  });

  // Endpoint déjà coupé par le circuit breaker (active=false, failureCount au
  // seuil) pour tester la RAZ du compteur à la réactivation.
  const [ep] = await db
    .insert(webhookEndpointsTable)
    .values({
      organisationId: orgId,
      url: "https://example.com/hook",
      events: ["*"],
      secret: encryptSensitiveData("whsec_test_seed"),
      active: false,
      failureCount: 15,
      createdByUserId: adminId,
    })
    .returning({ id: webhookEndpointsTable.id });
  endpointId = ep.id;
});

afterAll(async () => {
  try {
    await db
      .delete(webhookEndpointsTable)
      .where(inArray(webhookEndpointsTable.organisationId, [orgId]));
    await db.delete(usersTable).where(inArray(usersTable.id, [adminId, agentId]));
    await db
      .delete(organisationsTable)
      .where(inArray(organisationsTable.id, [orgId]));
  } catch {
    // nettoyage best-effort; ids uniques par run (stamp).
  }
});

describe("Webhooks — contrôle d'accès (admin uniquement)", () => {
  it("agent → ne liste PAS les webhooks (403)", async () => {
    const res = await request(app)
      .get("/api/webhooks")
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("agent → ne crée PAS de webhook (403, bloqué avant le handler)", async () => {
    const res = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost")
      .send({ url: "https://example.com/x", events: ["*"] });
    expect(res.status).toBe(403);
  });

  it("agent → ne met PAS à jour un webhook (403)", async () => {
    const res = await request(app)
      .patch(`/api/webhooks/${endpointId}`)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost")
      .send({ active: true });
    expect(res.status).toBe(403);
  });

  it("agent → ne supprime PAS un webhook (403)", async () => {
    const res = await request(app)
      .delete(`/api/webhooks/${endpointId}`)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("admin → liste les webhooks de l'org (200)", async () => {
    const res = await request(app)
      .get("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    const ids = new Set((res.body as Array<{ id: number }>).map((e) => e.id));
    expect(ids.has(endpointId)).toBe(true);
  });

  it("agent → ne consulte PAS l'historique des livraisons (403)", async () => {
    const res = await request(app)
      .get(`/api/webhooks/${endpointId}/deliveries`)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("agent → ne fait PAS tourner le secret (403)", async () => {
    const res = await request(app)
      .post(`/api/webhooks/${endpointId}/rotate-secret`)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("admin → consulte l'historique des livraisons (200)", async () => {
    const res = await request(app)
      .get(`/api/webhooks/${endpointId}/deliveries`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("admin → fait tourner le secret (200 + nouveau secret en clair)", async () => {
    const res = await request(app)
      .post(`/api/webhooks/${endpointId}/rotate-secret`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    expect(typeof res.body?.secret).toBe("string");
    expect(res.body.secret.startsWith("whsec_")).toBe(true);
  });
});

describe("Webhooks — circuit breaker", () => {
  it("réactivation (active=true) par admin remet failureCount à zéro", async () => {
    const res = await request(app)
      .patch(`/api/webhooks/${endpointId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Origin", "http://localhost")
      .send({ active: true });
    expect(res.status).toBe(200);
    expect(res.body?.active).toBe(true);
    expect(res.body?.failureCount).toBe(0);

    const [row] = await db
      .select({ failureCount: webhookEndpointsTable.failureCount })
      .from(webhookEndpointsTable)
      .where(eq(webhookEndpointsTable.id, endpointId));
    expect(row?.failureCount).toBe(0);
  });
});
