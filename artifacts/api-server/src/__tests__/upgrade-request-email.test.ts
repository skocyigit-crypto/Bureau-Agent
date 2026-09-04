process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, organisationsTable, usersTable, notificationsTable } from "@workspace/db";

/**
 * Tant que le paiement par carte n'est pas active, la demande de changement de
 * plan EST le canal de vente. Elle n'ecrivait qu'une notification dans
 * l'application — alors que la reponse promet au client d'etre « contacte sous
 * peu ». Si aucun super-administrateur n'ouvrait l'ecran, un client qui
 * demandait a payer restait invisible.
 *
 * Ces tests fixent les deux moities: la demande sort de l'application (mail),
 * et un echec d'envoi ne fait pas croire au client que sa demande est perdue.
 */
const sendEmail = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("../services/email", () => ({
  sendEmail,
  // Le module est importe ailleurs dans la chaine de routes; on ne garde que
  // ce dont ce test a besoin.
  sendWelcomeEmail: vi.fn(async () => ({ success: true })),
}));

const { default: app } = await import("../app");
const { mintApiToken } = await import("../lib/api-token");

const stamp = Date.now();
let orgId = 0;
let clientUserId = 0;
let superAdminId = 0;
let token = "";
const superAdminEmail = `super-${stamp}@example.test`;

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Org upgrade ${stamp}`, slug: `upgrade-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org!.id;

  const [client] = await db.insert(usersTable).values({
    organisationId: orgId, email: `client-${stamp}@example.test`,
    passwordHash: "x", prenom: "Client", nom: "Test", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  clientUserId = client!.id;

  const [admin] = await db.insert(usersTable).values({
    organisationId: orgId, email: superAdminEmail,
    passwordHash: "x", prenom: "Super", nom: "Admin", role: "super_admin", actif: true,
  }).returning({ id: usersTable.id });
  superAdminId = admin!.id;

  token = mintApiToken({
    userId: clientUserId, userRole: "administrateur", organisationId: orgId,
    userEmail: `client-${stamp}@example.test`, prenom: "Client", nom: "Test",
  });
});

afterAll(async () => {
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  if (superAdminId || clientUserId) {
    await db.delete(usersTable).where(inArray(usersTable.id, [superAdminId, clientUserId].filter(Boolean)));
  }
  vi.restoreAllMocks();
});

describe("demande de changement de plan", () => {
  it("sort de l'application: un mail part vers le super-administrateur", async () => {
    sendEmail.mockClear();

    const res = await request(app)
      .post("/api/my-subscription/upgrade-request")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost")
      .send({ targetPlan: "professionnel", message: "Nous voulons payer." });

    expect(res.status).toBe(200);
    expect(sendEmail, "aucun mail: la demande reste invisible hors de l'application")
      .toHaveBeenCalled();

    const destinataires = sendEmail.mock.calls.map((c: unknown[]) => c[0]);
    expect(destinataires).toContain(superAdminEmail);

    // Le contenu doit permettre d'agir sans ouvrir l'application: quel plan,
    // quelle organisation, qui demande.
    const [, sujet, , texte] = sendEmail.mock.calls[0] as string[];
    expect(sujet).toMatch(/professionnel/i);
    expect(texte).toMatch(/Nous voulons payer/);
  });

  it("enregistre aussi la notification: le mail ne remplace pas la trace", async () => {
    const notifs = await db.select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, superAdminId));
    expect(notifs.length).toBeGreaterThan(0);
  });

  it("repond succes meme si le mail echoue: la demande est deja enregistree", async () => {
    sendEmail.mockClear();
    sendEmail.mockImplementationOnce(async () => { throw new Error("SMTP indisponible"); });

    const res = await request(app)
      .post("/api/my-subscription/upgrade-request")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost")
      .send({ targetPlan: "entreprise" });

    // Faire echouer l'appel ferait croire au client que sa demande n'est pas
    // passee, alors que la notification, elle, est bien ecrite.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
