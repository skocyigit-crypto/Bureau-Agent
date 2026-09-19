/**
 * Changer le plan d une organisation: ce qui manquait autour de la mutation.
 *
 * La route existe (PUT /api/organisations/:id/plan, reservee au super-admin
 * par un garde de prefixe) et ecrit correctement plafonds et fonctions. Trois
 * choses manquaient autour:
 *
 *  - AUCUNE INVALIDATION du cache de licence. L etat est garde 30 s cote
 *    middleware: le client passait au plan superieur et restait refuse, a
 *    l instant meme ou on lui dit « c est bon, essayez ». Invisible tant que
 *    les droits n etaient appliques nulle part (services/droits-plan.ts);
 *    bloquant desormais.
 *  - AUCUNE TRACE D AUDIT, alors que toutes les autres mutations d abonnement
 *    en laissent une. Le changement de plan est l acte commercial meme: rien
 *    ne permettait de dire qui avait change quoi, ni depuis quel plan.
 *  - un changement vers le plan DEJA EN COURS rendait « succes » sans rien
 *    changer.
 *
 * La mutation rejoint suspend et reactivate dans saas-admin-actions.ts, pour
 * que l action manuelle et celle proposee par l agent aient exactement le meme
 * effet.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable, PLANS } from "@workspace/db";
import { changePlan } from "../services/saas-admin-actions";
import { checkLicense } from "../middleware/license-check";

const marque = Date.now();
let compteur = 0;

async function orgEssai(): Promise<number> {
  const etiquette = `${marque}-${compteur++}`;
  const [org] = await db.insert(organisationsTable).values({
    name: `Plan ${etiquette}`,
    slug: `plan-${etiquette}`,
    maxUsers: 3,
    actif: true,
  }).returning({ id: organisationsTable.id });
  await db.insert(subscriptionsTable).values({
    organisationId: org.id,
    plan: "essai",
    status: "active",
    licenseKey: `PLAN-${etiquette}`,
    maxUsers: PLANS.essai.maxUsers,
    maxContacts: PLANS.essai.maxContacts,
    maxCallsPerMonth: PLANS.essai.maxCallsPerMonth,
    price: "0",
    trialEndsAt: new Date(Date.now() + 5 * 86400000),
  });
  return org.id;
}

const abonnement = async (orgId: number) =>
  (await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId)))[0];

describe("changement de plan", () => {
  it("fait passer l'organisation au plan demande", async () => {
    const id = await orgEssai();
    const r = await changePlan(id, "professionnel", 0);
    expect(r.ok, r.error).toBe(true);
    expect((await abonnement(id)).plan).toBe("professionnel");
  });

  it("reecrit les plafonds depuis le plan", async () => {
    const id = await orgEssai();
    await changePlan(id, "professionnel", 0);
    const sub = await abonnement(id);
    expect(sub.maxUsers).toBe(PLANS.professionnel.maxUsers);
    expect(sub.maxContacts).toBe(PLANS.professionnel.maxContacts);
    expect(Number(sub.price)).toBe(PLANS.professionnel.price);
  });

  it("reecrit aussi les fonctions, pour que l'abonnement decrive son plan", async () => {
    const id = await orgEssai();
    await changePlan(id, "starter", 0);
    const sub = await abonnement(id);
    expect(sub.aiEnabled, "Starter garderait l'IA de l'essai").toBe(PLANS.starter.aiEnabled);
    expect(sub.stockEnabled).toBe(PLANS.starter.stockEnabled);
  });

  it("porte le plafond d'utilisateurs sur l'organisation, qui sert de repli", async () => {
    const id = await orgEssai();
    await changePlan(id, "entreprise", 0);
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, id));
    expect(org.maxUsers).toBe(PLANS.entreprise.maxUsers);
  });

  it("met fin a l'essai en passant a un plan payant", async () => {
    const id = await orgEssai();
    await changePlan(id, "starter", 0);
    expect(
      (await abonnement(id)).trialEndsAt,
      "l'essai continuerait de courir et basculerait le payeur en lecture seule",
    ).toBeNull();
  });

  it("l'acces suit immediatement, sans attendre le cache de licence", async () => {
    const id = await orgEssai();
    // L'essai ouvre l'IA: on remplit le cache avec cet etat.
    expect((await checkLicense(id, "POST", "/api/ai/analyse")).allowed).toBe(true);
    await changePlan(id, "starter", 0);
    expect(
      (await checkLicense(id, "POST", "/api/ai/analyse")).allowed,
      "sans invalidation, le plan change mais les droits restent ceux d'avant",
    ).toBe(false);
  });

  it("dans l'autre sens aussi : le client qui paie obtient l'IA tout de suite", async () => {
    const id = await orgEssai();
    await changePlan(id, "starter", 0);
    expect((await checkLicense(id, "POST", "/api/ai/analyse")).allowed).toBe(false);
    await changePlan(id, "professionnel", 0);
    expect(
      (await checkLicense(id, "POST", "/api/ai/analyse")).allowed,
      "le client paie et reste bloque: exactement l'instant ou on lui dit « essayez »",
    ).toBe(true);
  });

  it("refuse un plan inconnu plutot que d'ecrire n'importe quoi", async () => {
    const id = await orgEssai();
    const r = await changePlan(id, "platine", 0);
    expect(r.ok).toBe(false);
    expect((await abonnement(id)).plan, "abonnement modifie malgre le refus").toBe("essai");
  });

  it("refuse une organisation inconnue", async () => {
    expect((await changePlan(999_999_999, "starter", 0)).ok).toBe(false);
  });

  it("refuse un changement vers le plan deja en cours", async () => {
    const id = await orgEssai();
    await changePlan(id, "starter", 0);
    const r = await changePlan(id, "starter", 0);
    expect(r.ok, "une facture serait emise pour un changement qui n'a pas eu lieu").toBe(false);
  });

  it("rend l'etat precedent, pour que l'ecran puisse dire d'ou l'on vient", async () => {
    const id = await orgEssai();
    const r = await changePlan(id, "starter", 0);
    expect((r.detail?.previousState as { plan: string }).plan).toBe("essai");
  });
});

describe("la route delegue au service partage", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "routes", "organisations.ts"), "utf8",
  );

  it("elle passe par changePlan au lieu de reecrire la mutation", () => {
    expect(source, "logique dupliquee: l action manuelle et l agent divergeraient").toContain("changePlan(id,");
  });

  it("tout le prefixe /organisations reste reserve au super-admin", () => {
    expect(source).toContain(`router.use("/organisations", requireSuperAdmin)`);
  });

  it("le service laisse une trace d audit", () => {
    const service = readFileSync(
      join(import.meta.dirname, "..", "services", "saas-admin-actions.ts"), "utf8",
    );
    const bloc = service.slice(service.indexOf("export async function changePlan"));
    expect(bloc, "l acte commercial meme, sans trace").toContain(`"plan_changed"`);
  });
});
