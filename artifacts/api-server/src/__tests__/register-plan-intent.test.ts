process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost";

import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, licenseAuditLogTable, organisationsTable } from "@workspace/db";

import app from "../app";

/**
 * Le plan sur lequel le visiteur a clique.
 *
 * Les cartes de tarifs envoyaient toutes vers la meme page d'inscription, et
 * `plan` etait lu du corps de la requete puis jamais utilise: le choix
 * disparaissait. Au bout des 14 jours d'essai, plus personne ne savait vers
 * quel abonnement convertir le compte — ni la relance automatique, ni la
 * personne qui rappelle le client.
 *
 * Ce qui est cree ne change pas: tout le monde commence par l'essai, c'est ce
 * que les cartes annoncent. Seule l'intention est conservee. D'ou les deux
 * moities testees ici: elle est bien consignee, et une valeur inventee dans
 * l'URL n'est pas recopiee telle quelle — sinon le journal de licence, qui est
 * append-only, garderait pour toujours une donnee fournie par l'exterieur.
 */

const stamp = Date.now();
const created: number[] = [];

afterAll(async () => {
  // Menage « au mieux »: un declencheur rend `license_audit_log` append-only et
  // la cascade s'y heurte. Ce n'est pas ce que ce test mesure.
  try {
    for (const id of created) {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    }
  } catch {
    // Ligne residuelle sans consequence: les identifiants portent
    // l'horodatage du run.
  }
});

async function inscrire(suffix: string, plan?: unknown) {
  const res = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost")
    .send({
      orgName: `Org plan ${suffix}`,
      firstName: "Jean",
      lastName: "Dupont",
      email: `plan-${suffix}@example.test`,
      password: "Kestrel7Vagon",
      acceptedTerms: true,
      ...(plan === undefined ? {} : { plan }),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const orgId = res.body.organisation?.id;
  expect(orgId).toBeTruthy();
  created.push(orgId);
  return orgId as number;
}

async function intentionConsignee(orgId: number): Promise<unknown> {
  const [ligne] = await db.select()
    .from(licenseAuditLogTable)
    .where(and(
      eq(licenseAuditLogTable.organisationId, orgId),
      eq(licenseAuditLogTable.action, "subscription_created"),
    ));
  expect(ligne, "aucune trace de creation d'abonnement").toBeTruthy();
  return (ligne.metadata as Record<string, unknown> | null)?.planSouhaite;
}

describe("le plan choisi sur la vitrine survit a l'inscription", () => {
  it("consigne le plan demande", async () => {
    const orgId = await inscrire(`pro-${stamp}`, "professionnel");
    expect(await intentionConsignee(orgId)).toBe("professionnel");
  });

  it("cree malgre tout un essai, pas l'abonnement demande", async () => {
    // Le point delicat: accuser reception du choix ne doit pas ouvrir un
    // abonnement payant que personne n'a paye.
    const orgId = await inscrire(`essai-${stamp}`, "starter");
    const [ligne] = await db.select()
      .from(licenseAuditLogTable)
      .where(and(
        eq(licenseAuditLogTable.organisationId, orgId),
        eq(licenseAuditLogTable.action, "subscription_created"),
      ));
    expect((ligne.metadata as Record<string, unknown>).plan).toBe("essai");
  });

  it("ignore un plan inconnu au lieu de le recopier", async () => {
    // `license_audit_log` est append-only: une valeur venue de l'URL y
    // resterait indefiniment.
    const orgId = await inscrire(`inconnu-${stamp}`, "plan-invente");
    expect(await intentionConsignee(orgId)).toBeNull();
  });

  it("s'accommode d'une inscription sans plan", async () => {
    const orgId = await inscrire(`sans-${stamp}`);
    expect(await intentionConsignee(orgId)).toBeNull();
  });
});
