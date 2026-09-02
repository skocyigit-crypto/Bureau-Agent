/**
 * Le client peut-il savoir avec QUELLE cle il consomme l'IA.
 *
 * L'ecran « Fournisseurs d'IA » permettait de coller une cle sans jamais dire
 * si elle servait. Elle ne servait pas: jusqu'au 2 septembre 2026, `ai-failover`
 * — par ou passe la quasi totalite des appels — prenait `orgId` uniquement pour
 * compter le quota, et appelait le fournisseur avec le singleton de la
 * plateforme. Un client qui avait fait la demarche continuait donc a depenser
 * le credit du proprietaire, et rien a l'ecran ne pouvait le lui apprendre.
 *
 * Le resume d'usage aggravait meme la chose: il affichait des jetons et des
 * couts sans dire a qui ils etaient factures. Un chiffre juste attribue au
 * mauvais compte est pire qu'un chiffre absent, parce qu'on le croit.
 *
 * Ces tests verrouillent la reponse — y compris quand elle est « non ».
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";
import { db, aiProvidersTable, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";
import { encryptSensitiveData } from "../lib/crypto";
import { clearOrgAiClientsCache } from "../services/ai-providers";

const stamp = Date.now();

let orgWithKey: number;
let orgWithoutKey: number;
let tokenWithKey: string;
let tokenWithoutKey: string;

async function seedOrg(tag: string): Promise<{ orgId: number; token: string }> {
  const [org] = await db
    .insert(organisationsTable)
    .values({ name: `AI Key ${tag} ${stamp}`, slug: `ai-key-${tag}-${stamp}`, maxUsers: 5, actif: true })
    .returning({ id: organisationsTable.id });
  const email = `ai-key-${tag}-${stamp}@example.test`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email, passwordHash: "x", nom: tag, prenom: "Test",
      role: "administrateur", organisationId: org.id, actif: true,
    })
    .returning({ id: usersTable.id });
  return {
    orgId: org.id,
    token: mintApiToken({
      userId: user.id, userRole: "administrateur", organisationId: org.id,
      userEmail: email, prenom: "Test", nom: tag,
    }),
  };
}

beforeAll(async () => {
  const withKey = await seedOrg("own");
  const withoutKey = await seedOrg("platform");
  orgWithKey = withKey.orgId;
  tokenWithKey = withKey.token;
  orgWithoutKey = withoutKey.orgId;
  tokenWithoutKey = withoutKey.token;

  // Une cle propre, chiffree comme l'ecran le ferait.
  await db.insert(aiProvidersTable).values({
    organisationId: orgWithKey,
    provider: "gemini",
    label: "Gemini du client",
    config: { apiKey: encryptSensitiveData("AIza-test-key-not-real") },
    isActive: true,
    isDefault: true,
  });
  clearOrgAiClientsCache();
});

afterAll(async () => {
  await db.delete(aiProvidersTable).where(eq(aiProvidersTable.organisationId, orgWithKey));
  await db.delete(usersTable).where(inArray(usersTable.organisationId, [orgWithKey, orgWithoutKey]));
  await db.delete(organisationsTable).where(inArray(organisationsTable.id, [orgWithKey, orgWithoutKey]));
  clearOrgAiClientsCache();
});

describe("GET /api/ai-usage/key-status", () => {
  it("dit a un client qui a configure sa cle qu'elle sert bien", async () => {
    const res = await request(app)
      .get("/api/ai-usage/key-status")
      .set("Authorization", `Bearer ${tokenWithKey}`);

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.providers).toContain("gemini");
    expect(res.body.usesPlatformCredit).toBe(false);
  });

  it("dit a un client sans cle qu'il consomme le credit de la plateforme", async () => {
    // C'est la reponse qui manquait: sans elle, le client ne pouvait pas
    // savoir qu'il fallait agir, et le proprietaire payait en silence.
    const res = await request(app)
      .get("/api/ai-usage/key-status")
      .set("Authorization", `Bearer ${tokenWithoutKey}`);

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.usesPlatformCredit).toBe(true);
    // Tant que l'application n'est pas activee, ce motif dit exactement
    // pourquoi la plateforme paie encore.
    expect(res.body.platformReason).toBe("enforcement-off");
    expect(res.body.enforced).toBe(false);
  });

  it("refuse un appel sans session", async () => {
    const res = await request(app).get("/api/ai-usage/key-status");
    expect(res.status).toBe(401);
  });

  it("ne divulgue jamais la cle elle-meme", async () => {
    const res = await request(app)
      .get("/api/ai-usage/key-status")
      .set("Authorization", `Bearer ${tokenWithKey}`);

    // Le statut dit QUE la cle existe, jamais ce qu'elle vaut. Une fuite ici
    // rendrait l'ecran de configuration plus dangereux que l'absence d'ecran.
    expect(JSON.stringify(res.body)).not.toContain("AIza-test-key-not-real");
    expect(JSON.stringify(res.body)).not.toMatch(/apiKey|api_key/i);
  });
});

describe("GET /api/ai-usage/summary", () => {
  it("attribue la depense: le resume dit desormais qui paie", async () => {
    const res = await request(app)
      .get("/api/ai-usage/summary?days=7")
      .set("Authorization", `Bearer ${tokenWithKey}`);

    expect(res.status).toBe(200);
    expect(res.body.billing).toBeTruthy();
    expect(res.body.billing.configured).toBe(true);
    // Les compteurs restent la: on ajoute l'attribution, on ne remplace rien.
    expect(res.body.totals).toBeTruthy();
  });

  it("reste borne au locataire de la session", async () => {
    const res = await request(app)
      .get("/api/ai-usage/summary?days=7")
      .set("Authorization", `Bearer ${tokenWithoutKey}`);

    expect(res.status).toBe(200);
    expect(res.body.billing.configured).toBe(false);
  });
});
