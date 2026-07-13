/**
 * Contrôle d'accès & gizlilik sur le RECALCUL MANUEL du profil par employé
 * (POST /ai-learning/recompute-user).
 *
 * Ce bouton permet à un employé de rafraîchir son propre profil appris sans
 * attendre le cron quotidien, et à un dirigeant de rafraîchir celui d'un
 * membre de son organisation. Le profil personnel étant une donnée sensible,
 * cette suite verrouille les mêmes invariants que la lecture :
 *
 *   - un employé recalcule UNIQUEMENT son propre profil (403 sur un collègue) ;
 *   - sans userId, le recalcul porte par défaut sur l'appelant ;
 *   - un dirigeant peut recalculer n'importe quel employé de SON tenant ;
 *   - un userId non entier / négatif renvoie 400 ;
 *   - un cooldown par (org, employé) renvoie 429 sur un appel trop rapproché.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db,
  aiUserProfileFactsTable,
  organisationsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const stamp = Date.now();

interface SeededUser {
  id: number;
  token: string;
}

let orgA: number;
let orgB: number;
let admin: SeededUser; // dirigeant (administrateur) de orgA
let agentX: SeededUser; // agent de orgA
let agentY: SeededUser; // autre agent de orgA (cible du cooldown)
let agentW: SeededUser; // agent de orgA (cible du recalcul par le dirigeant)
let agentZ: SeededUser; // agent de orgB (cross-tenant)

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

async function seedUser(
  orgId: number,
  role: string,
  tag: string,
): Promise<SeededUser> {
  const email = `recomp-${tag}-${stamp}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "x",
      nom: tag,
      prenom: "Test",
      role,
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  return {
    id: row.id,
    token: tokenFor({ id: row.id, role, organisationId: orgId, email }),
  };
}

beforeAll(async () => {
  const [oA] = await db
    .insert(organisationsTable)
    .values({ name: `Recomp A ${stamp}`, slug: `recomp-a-${stamp}`, maxUsers: 10, actif: true })
    .returning({ id: organisationsTable.id });
  const [oB] = await db
    .insert(organisationsTable)
    .values({ name: `Recomp B ${stamp}`, slug: `recomp-b-${stamp}`, maxUsers: 10, actif: true })
    .returning({ id: organisationsTable.id });
  orgA = oA.id;
  orgB = oB.id;

  admin = await seedUser(orgA, "administrateur", "admin");
  agentX = await seedUser(orgA, "agent", "agentx");
  agentY = await seedUser(orgA, "agent", "agenty");
  agentW = await seedUser(orgA, "agent", "agentw");
  agentZ = await seedUser(orgB, "agent", "agentz");

  // agentZ (orgB) possède un fait appris : si l'isolation tenant casse, un
  // dirigeant de orgA verrait ses faits en recalculant son userId.
  await db.insert(aiUserProfileFactsTable).values({
    organisationId: orgB,
    userId: agentZ.id,
    factType: "writing_style",
    label: "Style d'écriture: messages courts et directs.",
    value: "profil",
    occurrences: 7,
    lastSeenAt: new Date(),
  });
});

afterAll(async () => {
  try {
    await db
      .delete(aiUserProfileFactsTable)
      .where(inArray(aiUserProfileFactsTable.organisationId, [orgA, orgB]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [admin.id, agentX.id, agentY.id, agentW.id, agentZ.id]));
    await db
      .delete(organisationsTable)
      .where(inArray(organisationsTable.id, [orgA, orgB]));
  } catch {
    // nettoyage best-effort; ids uniques par run (stamp).
  }
});

function recompute(token: string, userId?: number) {
  const req = request(app)
    .post("/api/ai-learning/recompute-user")
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost");
  return userId === undefined ? req.send({}) : req.send({ userId });
}

function getProfile(token: string, userId?: number) {
  const url =
    userId === undefined
      ? "/api/ai-learning/user-profile"
      : `/api/ai-learning/user-profile?userId=${userId}`;
  return request(app).get(url).set("Authorization", `Bearer ${token}`);
}

describe("Recalcul manuel du profil par employé (gizlilik)", () => {
  it("agent → recalcule son PROPRE profil sans userId (200)", async () => {
    const res = await recompute(agentX.token);
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.profile?.userId).toBe(agentX.id);
    expect(Array.isArray(res.body?.profile?.facts)).toBe(true);
    // Le profil expose la date du dernier recalcul (champ présent, même null).
    expect(res.body?.profile).toHaveProperty("computedAt");
  });

  it("agent → NE recalcule PAS le profil d'un collègue (403)", async () => {
    const res = await recompute(agentX.token, admin.id);
    expect(res.status).toBe(403);
  });

  it("GET /user-profile → computedAt vaut null quand aucun fait appris", async () => {
    // agentW n'a aucun fait : la date de dernière analyse doit être absente (null).
    const res = await getProfile(agentW.token);
    expect(res.status).toBe(200);
    expect(res.body?.facts).toEqual([]);
    expect(res.body?.computedAt).toBeNull();
  });

  it("dirigeant → recalcule le profil d'un employé de son tenant (200)", async () => {
    const res = await recompute(admin.token, agentW.id);
    expect(res.status).toBe(200);
    expect(res.body?.profile?.userId).toBe(agentW.id);
  });

  it("dirigeant → recalcul d'un userId d'une AUTRE org renvoie un profil VIDE (isolation tenant)", async () => {
    const res = await recompute(admin.token, agentZ.id);
    expect(res.status).toBe(200);
    expect(res.body?.profile?.userId).toBe(agentZ.id);
    // Org-scopé : les faits de orgB ne fuient jamais via un recalcul orgA.
    expect(res.body?.profile?.facts).toEqual([]);
  });

  it("userId non entier → 400", async () => {
    const res = await recompute(admin.token, undefined);
    expect(res.status).toBe(200); // sanity: sans userId, recalcule l'appelant
    const bad = await request(app)
      .post("/api/ai-learning/recompute-user")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost")
      .send({ userId: "abc" });
    expect(bad.status).toBe(400);
  });

  it("userId négatif → 400", async () => {
    const res = await recompute(admin.token, -1);
    expect(res.status).toBe(400);
  });

  it("cooldown → un 2e recalcul rapproché du même employé renvoie 429", async () => {
    const first = await recompute(admin.token, agentY.id);
    expect(first.status).toBe(200);
    const second = await recompute(admin.token, agentY.id);
    expect(second.status).toBe(429);
  });
});
