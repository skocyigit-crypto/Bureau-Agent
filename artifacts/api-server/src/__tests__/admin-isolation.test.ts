/** Dynamic regression: no authenticated role may reach another organisation's customer content. */
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
  devisTable,
  facturesClientTable,
  organisationsTable,
  prospectsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

interface SeededUser {
  id: number;
  role: "super_admin" | "administrateur" | "agent";
  organisationId: number | null;
  token: string;
}

interface Seeded {
  orgA: number;
  orgB: number;
  superAdmin: SeededUser;
  admin: SeededUser;
  agent: SeededUser;
  prospectA: number;
  prospectB: number;
  devisA: number;
  devisB: number;
  factureA: number;
  factureB: number;
}

let seeded: Seeded;
const stamp = Date.now();

function tokenFor(user: {
  id: number;
  role: string;
  organisationId: number | null;
  email: string;
}): string {
  return mintApiToken({
    userId: user.id,
    userRole: user.role,
    organisationId: user.organisationId ?? undefined,
    userEmail: user.email,
    prenom: "Test",
    nom: "User",
  });
}

beforeAll(async () => {
  // Orgs de test (slug unique pour isolation des runs paralleles).
  const [orgA] = await db
    .insert(organisationsTable)
    .values({
      name: `Iso Test Org A ${stamp}`,
      slug: `iso-test-a-${stamp}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  const [orgB] = await db
    .insert(organisationsTable)
    .values({
      name: `Iso Test Org B ${stamp}`,
      slug: `iso-test-b-${stamp}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });

  // Utilisateurs (passwordHash bidon: on n'utilise jamais le login
  // password, seulement le Bearer token signe).
  const [su] = await db
    .insert(usersTable)
    .values({
      email: `iso-su-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Super",
      prenom: "Admin",
      role: "super_admin",
      organisationId: orgA.id,
      actif: true,
    })
    .returning({ id: usersTable.id });
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `iso-admin-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Admin",
      prenom: "Test",
      role: "administrateur",
      organisationId: orgA.id,
      actif: true,
    })
    .returning({ id: usersTable.id });
  const [agent] = await db
    .insert(usersTable)
    .values({
      email: `iso-agent-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Agent",
      prenom: "Test",
      role: "agent",
      organisationId: orgA.id,
      actif: true,
    })
    .returning({ id: usersTable.id });

  // Une ressource de chaque type, dans CHACUNE des deux orgs: org B sert de
  // temoin, elle ne doit jamais apparaitre pour un compte rattache a org A.
  const [pA] = await db
    .insert(prospectsTable)
    .values({
      organisationId: orgA.id,
      title: `Iso Prospect A ${stamp}`,
      stage: "nouveau",
      priority: "moyenne",
    })
    .returning({ id: prospectsTable.id });
  const [pB] = await db
    .insert(prospectsTable)
    .values({
      organisationId: orgB.id,
      title: `Iso Prospect B ${stamp}`,
      stage: "nouveau",
      priority: "moyenne",
    })
    .returning({ id: prospectsTable.id });

  const [dA] = await db
    .insert(devisTable)
    .values({
      organisationId: orgA.id,
      reference: `ISO-DEV-A-${stamp}`,
      title: `Iso Devis A ${stamp}`,
      clientName: "Client A",
    })
    .returning({ id: devisTable.id });
  const [dB] = await db
    .insert(devisTable)
    .values({
      organisationId: orgB.id,
      reference: `ISO-DEV-B-${stamp}`,
      title: `Iso Devis B ${stamp}`,
      clientName: "Client B",
    })
    .returning({ id: devisTable.id });

  const [fA] = await db
    .insert(facturesClientTable)
    .values({
      organisationId: orgA.id,
      reference: `ISO-FAC-A-${stamp}`,
      title: `Iso Facture A ${stamp}`,
      clientName: "Client A",
    })
    .returning({ id: facturesClientTable.id });
  const [fB] = await db
    .insert(facturesClientTable)
    .values({
      organisationId: orgB.id,
      reference: `ISO-FAC-B-${stamp}`,
      title: `Iso Facture B ${stamp}`,
      clientName: "Client B",
    })
    .returning({ id: facturesClientTable.id });

  seeded = {
    orgA: orgA.id,
    orgB: orgB.id,
    superAdmin: {
      id: su.id,
      role: "super_admin",
      organisationId: orgA.id,
      token: tokenFor({
        id: su.id,
        role: "super_admin",
        organisationId: orgA.id,
        email: `iso-su-${stamp}@example.test`,
      }),
    },
    admin: {
      id: admin.id,
      role: "administrateur",
      organisationId: orgA.id,
      token: tokenFor({
        id: admin.id,
        role: "administrateur",
        organisationId: orgA.id,
        email: `iso-admin-${stamp}@example.test`,
      }),
    },
    agent: {
      id: agent.id,
      role: "agent",
      organisationId: orgA.id,
      token: tokenFor({
        id: agent.id,
        role: "agent",
        organisationId: orgA.id,
        email: `iso-agent-${stamp}@example.test`,
      }),
    },
    prospectA: pA.id,
    prospectB: pB.id,
    devisA: dA.id,
    devisB: dB.id,
    factureA: fA.id,
    factureB: fB.id,
  };
});

afterAll(async () => {
  // Nettoyage best-effort puis fermeture du pool. Tout dans le meme
  // hook pour garantir que la fermeture passe APRES les DELETE
  // (vitest n'ordonne pas les afterAll multiples de maniere stable).
  try {
    if (seeded) {
      const orgs = [seeded.orgA, seeded.orgB];
      await db
        .delete(facturesClientTable)
        .where(inArray(facturesClientTable.organisationId, orgs));
      await db
        .delete(devisTable)
        .where(inArray(devisTable.organisationId, orgs));
      await db
        .delete(prospectsTable)
        .where(inArray(prospectsTable.organisationId, orgs));
      await db
        .delete(usersTable)
        .where(
          inArray(usersTable.id, [
            seeded.superAdmin.id,
            seeded.admin.id,
            seeded.agent.id,
          ]),
        );
      await db
        .delete(organisationsTable)
        .where(inArray(organisationsTable.id, orgs));
    }
  } catch {
    // best-effort cleanup; vitest fermera le process meme si une
    // ligne residuelle reste (les ids sont uniques par run grace a
    // `stamp`).
  }
});

type Resource = {
  label: string;
  base: string;
  listKey: string;
  ids: () => { idA: number; idB: number };
  postBody: (orgId: number) => Record<string, unknown>;
  patchBody: Record<string, unknown>;
  /** Reads the row straight from the database, bypassing every route guard. */
  readById: (id: number) => Promise<Array<{ id: number }>>;
};

const RESOURCES: Resource[] = [
  {
    label: "prospects",
    base: "/api/prospects",
    listKey: "prospects",
    ids: () => ({ idA: seeded.prospectA, idB: seeded.prospectB }),
    readById: (id) => db.select({ id: prospectsTable.id }).from(prospectsTable).where(eq(prospectsTable.id, id)),
    postBody: (orgId) => ({
      title: `Iso new prospect ${stamp}`,
      stage: "nouveau",
      priority: "moyenne",
      organisationId: orgId,
    }),
    patchBody: { notes: "patched-by-test" },
  },
  {
    label: "devis",
    base: "/api/devis",
    listKey: "devis",
    ids: () => ({ idA: seeded.devisA, idB: seeded.devisB }),
    readById: (id) => db.select({ id: devisTable.id }).from(devisTable).where(eq(devisTable.id, id)),
    postBody: (orgId) => ({
      title: `Iso new devis ${stamp}`,
      clientName: "Client New",
      organisationId: orgId,
    }),
    patchBody: { notes: "patched-by-test" },
  },
  {
    label: "factures-client",
    base: "/api/factures-client",
    listKey: "factures",
    ids: () => ({ idA: seeded.factureA, idB: seeded.factureB }),
    readById: (id) => db.select({ id: facturesClientTable.id }).from(facturesClientTable).where(eq(facturesClientTable.id, id)),
    postBody: (orgId) => ({
      title: `Iso new facture ${stamp}`,
      clientName: "Client New",
      organisationId: orgId,
    }),
    patchBody: { notes: "patched-by-test" },
  },
];

describe("Customer content is readable only inside the caller's own organisation", () => {
  for (const r of RESOURCES) {
    describe(r.label, () => {
      // Every seeded account belongs to org A, super-admin included: the
      // platform owner is a tenant like any other here, with no SaaS-wide
      // view of customer records.
      for (const role of ["superAdmin", "admin", "agent"] as const) {
        it(`${role} lists its own organisation and never another one`, async () => {
          const { idA, idB } = r.ids();
          const response = await request(app)
            .get(r.base)
            .set("Authorization", `Bearer ${seeded[role].token}`)
            .set("Origin", "http://localhost");

          expect(response.status).toBe(200);
          const ids = (response.body[r.listKey] as Array<{ id: number }>).map((row) => row.id);
          expect(ids).toContain(idA);
          expect(ids).not.toContain(idB);
        });

        it(`${role} cannot read, update or delete another organisation's record`, async () => {
          const token = seeded[role].token;
          const { idB } = r.ids();
          const calls = [
            request(app).get(`${r.base}/${idB}`),
            request(app).patch(`${r.base}/${idB}`).send(r.patchBody),
            request(app).delete(`${r.base}/${idB}`),
          ];
          for (const call of calls) {
            const response = await call
              .set("Authorization", `Bearer ${token}`)
              .set("Origin", "http://localhost");
            // 404 (invisible) or 403 (role floor, e.g. agent deleting a
            // prospect) — never 200, and never a mutation that lands.
            expect([403, 404]).toContain(response.status);
          }
        });

        it(`${role} cannot place a new record in another organisation`, async () => {
          const response = await request(app)
            .post(r.base)
            // The body asks for org B on purpose: it must be ignored in
            // favour of the session's organisation.
            .send(r.postBody(seeded.orgB))
            .set("Authorization", `Bearer ${seeded[role].token}`)
            .set("Origin", "http://localhost");

          expect(response.status).toBe(201);
          expect(response.body.organisationId).toBe(seeded.orgA);
        });
      }

      it("leaves the other organisation's record untouched after those attempts", async () => {
        const { idB } = r.ids();
        const rows = await r.readById(idB);
        expect(rows.length, "cross-organisation delete must not have removed the row").toBe(1);
      });
    });
  }
});