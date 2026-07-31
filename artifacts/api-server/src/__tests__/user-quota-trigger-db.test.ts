process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import { ensureUserQuotaTrigger, isUserQuotaDbError } from "../services/ensure-user-quota";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let orgId = 0;

beforeAll(async () => {
  await ensureUserQuotaTrigger();
  const [org] = await db.insert(organisationsTable).values({
    name: `Quota race ${stamp}`, slug: `quota-race-${stamp}`, maxUsers: 1, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org.id;
});

afterAll(async () => {
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

describe("database user quota trigger", () => {
  it("allows only one of two concurrent inserts for the final seat", async () => {
    const create = (suffix: string) => db.insert(usersTable).values({
      email: `quota-${stamp}-${suffix}@example.test`, passwordHash: "test-only",
      nom: "Quota", prenom: suffix, role: "agent", organisationId: orgId, actif: true,
    }).returning({ id: usersTable.id });
    const results = await Promise.allSettled([create("a"), create("b")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") expect(isUserQuotaDbError(rejected.reason)).toBe(true);
  });
});