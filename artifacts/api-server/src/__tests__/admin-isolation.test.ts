/**
 * Tests d'isolation backoffice vs client (Tâche #62).
 *
 * Verifie que les routes commerciales SaaS (`/api/prospects`,
 * `/api/devis`, `/api/factures-client`) sont strictement reservees
 * au super_admin:
 *
 *   - super_admin (200/201) — voit aussi les enregistrements de
 *     PLUSIEURS organisations (vue globale SaaS).
 *   - administrateur (403) — meme pour son propre tenant.
 *   - agent (403) — idem.
 *
 * Sans cette suite, une regression future qui retirerait
 * `requireSuperAdmin` du montage rouvrirait silencieusement l'acces
 * a tous les comptes clients via l'API mobile (Bearer token).
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

  // Une ressource de chaque type, dans CHACUNE des deux orgs, pour
  // pouvoir verifier que le super_admin voit bien les deux (vue SaaS
  // globale).
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
};

const RESOURCES: Resource[] = [
  {
    label: "prospects",
    base: "/api/prospects",
    listKey: "prospects",
    ids: () => ({ idA: seeded.prospectA, idB: seeded.prospectB }),
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
    postBody: (orgId) => ({
      title: `Iso new facture ${stamp}`,
      clientName: "Client New",
      organisationId: orgId,
    }),
    patchBody: { notes: "patched-by-test" },
  },
];

describe("Backoffice SaaS — isolation super_admin vs comptes clients", () => {
  for (const r of RESOURCES) {
    describe(`${r.label}`, () => {
      it("super_admin (GET liste) voit les enregistrements de PLUSIEURS organisations", async () => {
        const res = await request(app)
          .get(r.base)
          .set("Authorization", `Bearer ${seeded.superAdmin.token}`)
          .set("Origin", "http://localhost");
        expect(res.status).toBe(200);
        const rows: Array<{ id: number; organisationId: number | null }> =
          res.body[r.listKey];
        expect(Array.isArray(rows)).toBe(true);
        const ids = new Set(rows.map((row) => row.id));
        const { idA, idB } = r.ids();
        expect(ids.has(idA)).toBe(true);
        expect(ids.has(idB)).toBe(true);
        const orgs = new Set(rows.map((row) => row.organisationId));
        expect(orgs.size).toBeGreaterThanOrEqual(2);
      });

      for (const role of ["admin", "agent"] as const) {
        it(`${role} → 403 sur GET liste`, async () => {
          const token = seeded[role].token;
          const res = await request(app)
            .get(r.base)
            .set("Authorization", `Bearer ${token}`)
            .set("Origin", "http://localhost");
          expect(res.status).toBe(403);
        });

        it(`${role} → 403 sur GET /:id`, async () => {
          const token = seeded[role].token;
          const { idA } = r.ids();
          const res = await request(app)
            .get(`${r.base}/${idA}`)
            .set("Authorization", `Bearer ${token}`)
            .set("Origin", "http://localhost");
          expect(res.status).toBe(403);
        });

        it(`${role} → 403 sur POST`, async () => {
          const token = seeded[role].token;
          const res = await request(app)
            .post(r.base)
            .set("Authorization", `Bearer ${token}`)
            .set("Origin", "http://localhost")
            .send(r.postBody(seeded.orgA));
          expect(res.status).toBe(403);
        });

        it(`${role} → 403 sur PATCH /:id`, async () => {
          const token = seeded[role].token;
          const { idA } = r.ids();
          const res = await request(app)
            .patch(`${r.base}/${idA}`)
            .set("Authorization", `Bearer ${token}`)
            .set("Origin", "http://localhost")
            .send(r.patchBody);
          expect(res.status).toBe(403);
        });

        it(`${role} → 403 sur DELETE /:id`, async () => {
          const token = seeded[role].token;
          const { idA } = r.ids();
          const res = await request(app)
            .delete(`${r.base}/${idA}`)
            .set("Authorization", `Bearer ${token}`)
            .set("Origin", "http://localhost");
          expect(res.status).toBe(403);
        });
      }

      it("super_admin (POST) cree un enregistrement (201)", async () => {
        const res = await request(app)
          .post(r.base)
          .set("Authorization", `Bearer ${seeded.superAdmin.token}`)
          .set("Origin", "http://localhost")
          .send(r.postBody(seeded.orgB));
        expect(res.status).toBe(201);
        expect(res.body?.id).toBeTypeOf("number");
      });

      it("super_admin (PATCH) met a jour un enregistrement (200)", async () => {
        const { idA } = r.ids();
        const res = await request(app)
          .patch(`${r.base}/${idA}`)
          .set("Authorization", `Bearer ${seeded.superAdmin.token}`)
          .set("Origin", "http://localhost")
          .send(r.patchBody);
        expect(res.status).toBe(200);
      });

      it("super_admin (DELETE) supprime un enregistrement (200)", async () => {
        // On cree une ligne jetable plutot que d'utiliser une seed, pour
        // ne pas casser les autres iterations qui patchent par id.
        const created = await request(app)
          .post(r.base)
          .set("Authorization", `Bearer ${seeded.superAdmin.token}`)
          .set("Origin", "http://localhost")
          .send(r.postBody(seeded.orgB));
        expect(created.status).toBe(201);
        const id = created.body.id as number;
        const res = await request(app)
          .delete(`${r.base}/${id}`)
          .set("Authorization", `Bearer ${seeded.superAdmin.token}`)
          .set("Origin", "http://localhost");
        expect(res.status).toBe(200);
      });
    });
  }
});

