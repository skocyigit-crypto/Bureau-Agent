/**
 * Contrôle d'accès & gizlilik sur la couche d'apprentissage PAR EMPLOYÉ.
 *
 * Le profil personnel appris (heures d'activité, domaines, thèmes, contacts,
 * style d'écriture) est une donnée sensible : il décrit le comportement réel
 * d'un employé. Cette suite verrouille les invariants de confidentialité —
 * sans elle, une régression qui retirerait le garde `isManager` rouvrirait :
 *
 *   - GET /ai-learning/user-profile : un employé ne peut consulter QUE son
 *     propre profil (403 sur celui d'un collègue) ; un dirigeant
 *     (administrateur / super_admin) peut consulter n'importe quel employé,
 *     mais TOUJOURS borné à son tenant (un userId d'une AUTRE organisation
 *     renvoie un profil vide, jamais les faits de l'autre org).
 *   - GET /ai-learning/users : la liste des employés est réservée aux
 *     dirigeants (un agent reçoit 403).
 *   - Validation : un userId non entier / négatif renvoie 400.
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
let agentY: SeededUser; // autre agent de orgA
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
  const email = `learn-${tag}-${stamp}@example.test`;
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
  return { id: row.id, token: tokenFor({ id: row.id, role, organisationId: orgId, email }) };
}

beforeAll(async () => {
  const [oA] = await db
    .insert(organisationsTable)
    .values({ name: `Learn ACL A ${stamp}`, slug: `learn-acl-a-${stamp}`, maxUsers: 10, actif: true })
    .returning({ id: organisationsTable.id });
  const [oB] = await db
    .insert(organisationsTable)
    .values({ name: `Learn ACL B ${stamp}`, slug: `learn-acl-b-${stamp}`, maxUsers: 10, actif: true })
    .returning({ id: organisationsTable.id });
  orgA = oA.id;
  orgB = oB.id;

  admin = await seedUser(orgA, "administrateur", "admin");
  agentX = await seedUser(orgA, "agent", "agentx");
  agentY = await seedUser(orgA, "agent", "agenty");
  agentZ = await seedUser(orgB, "agent", "agentz");

  // agentX (orgA) possède un fait appris : sert à prouver la visibilité
  // POSITIVE (l'employé lui-même ET un dirigeant du tenant le voient).
  await db.insert(aiUserProfileFactsTable).values({
    organisationId: orgA,
    userId: agentX.id,
    factType: "work_focus",
    label: "Contacts",
    value: "contacts",
    occurrences: 12,
    lastSeenAt: new Date(),
  });

  // L'employé de l'AUTRE org possède un fait appris : si l'isolation
  // tenant casse, un dirigeant de orgA le verrait.
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

function hasFact(
  body: { facts?: Array<{ factType: string; value: string }> },
  factType: string,
  value: string,
): boolean {
  return (body.facts ?? []).some(
    (f) => f.factType === factType && f.value === value,
  );
}

afterAll(async () => {
  try {
    await db
      .delete(aiUserProfileFactsTable)
      .where(inArray(aiUserProfileFactsTable.organisationId, [orgA, orgB]));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [admin.id, agentX.id, agentY.id, agentZ.id]));
    await db
      .delete(organisationsTable)
      .where(inArray(organisationsTable.id, [orgA, orgB]));
  } catch {
    // nettoyage best-effort; ids uniques par run (stamp).
  }
});

function getProfile(token: string, userId?: number) {
  const url =
    userId === undefined
      ? "/api/ai-learning/user-profile"
      : `/api/ai-learning/user-profile?userId=${userId}`;
  return request(app)
    .get(url)
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost");
}

describe("Apprentissage par employé — profil personnel (gizlilik)", () => {
  it("agent → consulte son PROPRE profil sans userId (200 + voit ses faits)", async () => {
    const res = await getProfile(agentX.token);
    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(agentX.id);
    expect(Array.isArray(res.body?.facts)).toBe(true);
    expect(hasFact(res.body, "work_focus", "contacts")).toBe(true);
  });

  it("agent → consulte explicitement son propre userId (200)", async () => {
    const res = await getProfile(agentX.token, agentX.id);
    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(agentX.id);
  });

  it("agent → NE consulte PAS le profil d'un collègue (403)", async () => {
    const res = await getProfile(agentX.token, agentY.id);
    expect(res.status).toBe(403);
  });

  it("dirigeant → consulte le profil d'un employé du tenant ET voit ses faits (200)", async () => {
    const res = await getProfile(admin.token, agentX.id);
    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(agentX.id);
    // Visibilité POSITIVE : le dirigeant récupère bien les faits de l'employé,
    // pas une liste vide (garde contre une régression "toujours vide").
    expect(hasFact(res.body, "work_focus", "contacts")).toBe(true);
  });

  it("dirigeant → un autre employé (sans faits) renvoie un profil distinct et vide", async () => {
    // agentY n'a aucun fait : prouve que la réponse dépend bien du userId
    // demandé (et n'est pas un écho figé des faits d'agentX).
    const res = await getProfile(admin.token, agentY.id);
    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(agentY.id);
    expect(hasFact(res.body, "work_focus", "contacts")).toBe(false);
  });

  it("dirigeant → un userId d'une AUTRE org renvoie un profil VIDE (isolation tenant)", async () => {
    const res = await getProfile(admin.token, agentZ.id);
    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(agentZ.id);
    // Org-scopé : les faits de orgB ne fuient jamais vers un dirigeant de orgA.
    expect(res.body?.facts).toEqual([]);
  });

  it("userId non entier → 400", async () => {
    const res = await getProfile(agentX.token, undefined);
    expect(res.status).toBe(200); // sanity: sans param, OK
    const bad = await request(app)
      .get("/api/ai-learning/user-profile?userId=abc")
      .set("Authorization", `Bearer ${agentX.token}`)
      .set("Origin", "http://localhost");
    expect(bad.status).toBe(400);
  });

  it("userId négatif → 400", async () => {
    const res = await getProfile(admin.token, -1);
    expect(res.status).toBe(400);
  });
});

describe("Apprentissage par employé — liste des employés (vue patron)", () => {
  it("agent → 403 sur GET /ai-learning/users", async () => {
    const res = await request(app)
      .get("/api/ai-learning/users")
      .set("Authorization", `Bearer ${agentX.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(403);
  });

  it("dirigeant → liste UNIQUEMENT les employés de son tenant (200)", async () => {
    const res = await request(app)
      .get("/api/ai-learning/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .set("Origin", "http://localhost");
    expect(res.status).toBe(200);
    const ids = new Set(
      (res.body?.users as Array<{ id: number }>).map((u) => u.id),
    );
    expect(ids.has(agentX.id)).toBe(true);
    expect(ids.has(agentY.id)).toBe(true);
    expect(ids.has(admin.id)).toBe(true);
    // L'employé de l'autre org n'apparaît jamais.
    expect(ids.has(agentZ.id)).toBe(false);
  });
});
