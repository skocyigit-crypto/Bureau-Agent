/**
 * Inscription publique : saisies hors bornes et inscriptions simultanees.
 * Application complete (limiteur compris) ; les 400 ne consomment pas le quota.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost";

import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { contrainteUniciteViolee, lireInscription, slugOrganisation } from "../services/inscription-saisie";

const stamp = Date.now();
const base = { orgName: "Durand BTP", firstName: "Jean", lastName: "Durand", email: `ins-${stamp}@example.test`, password: "Kestrel7Vagon", acceptedTerms: true };
const inscrire = (corps: Record<string, unknown>) => request(app).post("/api/auth/register").set("Origin", "http://localhost").send(corps);

afterAll(async () => {
  try {
    const orgs = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.email, `ins-acc-${stamp}@example.test`));
    for (const o of orgs) await db.delete(organisationsTable).where(eq(organisationsTable.id, o.id));
  } catch { /* journaux en ajout seul : ligne residuelle horodatee */ }
});

describe("regles pures", () => {
  it("slug translittere les accents", () => {
    expect(slugOrganisation("Électricité Durand & Fils")).toBe("electricite-durand-fils");
  });
  it("slug turc lisible", () => {
    expect(slugOrganisation("Çelik İnşaat")).toBe("celik-insaat");
  });
  it("nom non latin : repli, jamais vide", () => {
    expect(slugOrganisation("بناء")).toBe("organisation");
  });
  it("espaces multiples et bornes nettoyes", () => {
    const l = lireInscription({ ...base, firstName: "  Jean   Marc ", orgName: "  Durand   BTP " });
    expect(l.ok && [l.firstName, l.orgName]).toEqual(["Jean Marc", "Durand BTP"]);
  });
  it("contrainte lue dans la cause drizzle", () => {
    expect(contrainteUniciteViolee({ message: "Failed query", cause: { code: "23505", constraint: "users_email_unique" } })).toBe("users_email_unique");
    expect(contrainteUniciteViolee(new Error("x"))).toBeNull();
  });
});

describe("POST /auth/register : saisies refusees proprement (400, pas 500)", () => {
  it.each([
    ["prenom de 150 caracteres", { firstName: "x".repeat(150) }],
    ["entreprise de 250 caracteres", { orgName: "x".repeat(250) }],
    ["telephone de 40 caracteres", { phone: "0".repeat(40) }],
    ["nom d'entreprise numerique", { orgName: 42 }],
    ["prenom fait d'espaces", { firstName: "   " }],
    ["email sans domaine", { email: "jean@" }],
    ["email numerique", { email: 12 }],
  ])("%s", async (_n, surcharge) => {
    const r = await inscrire({ ...base, ...surcharge });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
  });
});

describe("inscriptions simultanees avec le meme email", () => {
  it("un compte cree, l'autre 409 — aucune erreur 500", async () => {
    // Charge d'abord les modules importes a la demande (./auth) : sous vitest,
    // deux imports dynamiques concurrents a froid peuvent echouer, ce qui n'a
    // rien a voir avec ce qui est mesure ici.
    expect((await inscrire({ ...base, password: "123" })).status).toBe(400);
    const corps = { ...base, email: `ins-acc-${stamp}@example.test`, orgName: "Électricité Simultanée" };
    const [a, b] = await Promise.all([inscrire(corps), inscrire(corps)]);
    expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual([201, 409]);
    const users = await db.select().from(usersTable).where(eq(usersTable.email, corps.email));
    expect(users.length).toBe(1);
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, users[0]!.organisationId!));
    expect(org!.slug.startsWith("electricite-simultanee")).toBe(true);
  }, 60_000);

  it("meme nom d'entreprise en simultane (emails differents) : deux comptes, slugs distincts", async () => {
    const nom = `Plomberie Jumelle ${stamp}`;
    const [a, b] = await Promise.all([
      inscrire({ ...base, orgName: nom, email: `ins-acc-${stamp}@example.test`.replace("acc", "j1") }),
      inscrire({ ...base, orgName: nom, email: `ins-acc-${stamp}@example.test`.replace("acc", "j2") }),
    ]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    const [oa] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, a.body.organisation.id));
    const [ob] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, b.body.organisation.id));
    expect(oa!.slug).not.toBe(ob!.slug);
  }, 60_000);
});
