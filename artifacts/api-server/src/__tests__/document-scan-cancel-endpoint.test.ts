/**
 * Tâche #159 — endpoint d'annulation du scan « Tout analyser ».
 *
 * `POST /api/documents/scan-unscanned/cancel` doit :
 *   - être protégé par `requireMinAgent` (super_admin | administrateur | agent) :
 *       • sans authentification           → 401
 *       • rôle insuffisant (lecture_seule) → 403
 *       • rôle agent                       → 200
 *   - être un no-op idempotent quand aucun scan ne tourne : renvoie le statut
 *     « idle » sans planter (c'est le cas le plus courant : l'utilisateur clique
 *     « Annuler » alors que le job vient de finir, ou double-clique).
 *
 * Sans cette suite, une régression pourrait soit ouvrir l'endpoint à des comptes
 * non autorisés, soit le faire échouer quand il n'y a rien à annuler — ramenant
 * le problème « impossible d'arrêter proprement un scan ».
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const stamp = Date.now();
const CANCEL_URL = "/api/documents/scan-unscanned/cancel";

let orgId: number;
let agentId: number;
let lecteurId: number;
let agentToken: string;
let lecteurToken: string;

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Scan Cancel Test Org ${stamp}`,
    slug: `scan-cancel-test-${stamp}`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org.id;

  const [agent] = await db.insert(usersTable).values({
    email: `scancancel-agent-${stamp}@example.test`,
    passwordHash: "x",
    nom: "Agent",
    prenom: "Test",
    role: "agent",
    organisationId: orgId,
    actif: true,
  }).returning({ id: usersTable.id });
  agentId = agent.id;

  const [lecteur] = await db.insert(usersTable).values({
    email: `scancancel-lecteur-${stamp}@example.test`,
    passwordHash: "x",
    nom: "Lecteur",
    prenom: "Test",
    role: "lecture_seule",
    organisationId: orgId,
    actif: true,
  }).returning({ id: usersTable.id });
  lecteurId = lecteur.id;

  agentToken = mintApiToken({
    userId: agentId,
    userRole: "agent",
    organisationId: orgId,
    userEmail: `scancancel-agent-${stamp}@example.test`,
    prenom: "Agent",
    nom: "Test",
  });
  lecteurToken = mintApiToken({
    userId: lecteurId,
    userRole: "lecture_seule",
    organisationId: orgId,
    userEmail: `scancancel-lecteur-${stamp}@example.test`,
    prenom: "Lecteur",
    nom: "Test",
  });
});

afterAll(async () => {
  try {
    await db.delete(usersTable).where(inArray(usersTable.id, [agentId, lecteurId]));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [orgId]));
  } catch {
    // best-effort: ids uniques par run via `stamp`.
  }
});

describe("POST /api/documents/scan-unscanned/cancel — garde d'accès", () => {
  it("sans authentification → 401", async () => {
    const res = await request(app).post(CANCEL_URL).set("Origin", "http://localhost");
    expect(res.status).toBe(401);
  });

  it("rôle insuffisant (lecture_seule) → 403", async () => {
    const res = await request(app)
      .post(CANCEL_URL)
      .set("Authorization", `Bearer ${lecteurToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("rôle agent → 200", async () => {
    const res = await request(app)
      .post(CANCEL_URL)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/documents/scan-unscanned/cancel — no-op quand aucun scan", () => {
  it("renvoie un job 'idle' sans erreur quand rien ne tourne", async () => {
    const res = await request(app)
      .post(CANCEL_URL)
      .set("Authorization", `Bearer ${agentToken}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    expect(res.body?.job).toBeDefined();
    expect(res.body.job.status).toBe("idle");
  });
});
