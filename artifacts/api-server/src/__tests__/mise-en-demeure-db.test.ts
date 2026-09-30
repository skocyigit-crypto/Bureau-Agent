/**
 * La mise en demeure avant suspension (CGV art. 4), sur une vraie base.
 *
 * Le transport d'e-mail est simule (pas de fournisseur en test) : on verifie ce
 * qui depend de NOUS — une seule mise en demeure par impaye, datee, envoyee a
 * l'organisation et a ses administrateurs, qui ouvre un delai de quinze jours ;
 * et le webhook Stripe qui ne suspend plus au troisieme echec.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const envois = vi.hoisted(() => ({ liste: [] as Array<{ to: string; dateLimite: Date }>, reussir: true }));
vi.mock("../services/email", async (orig) => ({
  ...(await orig<typeof import("../services/email")>()),
  sendMiseEnDemeureEmail: vi.fn(async (p: { to: string; dateLimite: Date }) => {
    envois.liste.push({ to: p.to, dateLimite: p.dateLimite });
    return { success: envois.reussir };
  }),
  sendSubscriptionSuspendedEmail: vi.fn(async () => ({ success: true })),
}));

import { eq, inArray } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { DELAI_MISE_EN_DEMEURE_JOURS, mettreEnDemeure } from "../services/mise-en-demeure";
import { appliquerCycleAbonnements } from "../services/cycle-abonnement";
import { handleInvoicePaymentFailed } from "../services/stripe-sync";

const JOUR = 86_400_000;
const stamp = Date.now();
const orgs: number[] = [];

async function abonne(v: Record<string, unknown> = {}) {
  const [o] = await db.insert(organisationsTable).values({
    name: `MED ${stamp}-${orgs.length}`, slug: `med-${stamp}-${orgs.length}`, maxUsers: 5, actif: true,
    email: `compta-${stamp}-${orgs.length}@entreprise-reelle.fr`,
  } as any).returning({ id: organisationsTable.id });
  orgs.push(o!.id);
  await db.insert(usersTable).values({ organisationId: o!.id, email: `admin-${stamp}-${orgs.length}@entreprise-reelle.fr`, passwordHash: "x", prenom: "A", nom: "B", role: "administrateur", actif: true });
  const [s] = await db.insert(subscriptionsTable).values({
    organisationId: o!.id, plan: "pro", status: "active", billingCycle: "monthly", price: "49.00",
    maxUsers: 10, maxContacts: 1000, maxCallsPerMonth: 1000, ...v,
  } as any).returning({ id: subscriptionsTable.id });
  return { orgId: o!.id, subId: s!.id };
}
const relire = async (id: number) => (await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id)))[0]!;

beforeEach(() => { envois.liste = []; envois.reussir = true; });
afterAll(async () => { try { if (orgs.length) await db.delete(organisationsTable).where(inArray(organisationsTable.id, orgs)); } catch { /* au mieux */ } });

describe("la mise en demeure", () => {
  it("est envoyee a l'organisation ET a ses administrateurs, datee, avec l'echeance a J+15", async () => {
    const { orgId, subId } = await abonne({ status: "past_due", lastPaymentFailedAt: new Date() });
    const maintenant = new Date();
    const at = await mettreEnDemeure(orgId, "pro", maintenant);
    expect(at?.getTime()).toBe(maintenant.getTime());
    expect(envois.liste.map((e) => e.to).sort()).toHaveLength(2);
    expect(envois.liste[0]!.dateLimite.getTime()).toBe(maintenant.getTime() + DELAI_MISE_EN_DEMEURE_JOURS * JOUR);
    expect((await relire(subId)).miseEnDemeureAt).toBeTruthy();
  });

  it("n'est envoyee qu'une fois par impaye, meme appelee en parallele", async () => {
    const { orgId } = await abonne({ status: "past_due" });
    await Promise.all(Array.from({ length: 5 }, () => mettreEnDemeure(orgId, "pro")));
    expect(envois.liste).toHaveLength(2); // une mise en demeure, deux destinataires
  });

  it("si aucun envoi n'aboutit, le delai ne s'ouvre pas", async () => {
    envois.reussir = false;
    const { orgId, subId } = await abonne({ status: "past_due" });
    expect(await mettreEnDemeure(orgId, "pro")).toBeNull();
    expect((await relire(subId)).miseEnDemeureAt).toBeNull();
  });
});

describe("le cycle local suit le contrat", () => {
  it("un retard ouvre la mise en demeure ; le compte n'est suspendu qu'a J+15", async () => {
    const { subId } = await abonne({ status: "past_due", lastPaymentFailedAt: new Date(Date.now() - 40 * JOUR) });
    await appliquerCycleAbonnements();
    const a = await relire(subId);
    expect(a.status, "suspendu le jour de la mise en demeure").toBe("past_due");
    expect(a.miseEnDemeureAt).toBeTruthy();
    // Quatorze jours plus tard : toujours pas.
    await appliquerCycleAbonnements(new Date(Date.now() + 14 * JOUR));
    expect((await relire(subId)).status).toBe("past_due");
    // Quinze jours plus tard : oui.
    await appliquerCycleAbonnements(new Date(Date.now() + 15 * JOUR + 60_000));
    expect((await relire(subId)).status).toBe("suspended");
  });
});

describe("le webhook Stripe ne suspend plus au troisieme echec", () => {
  it("trois echecs le meme jour : mise en demeure, pas de suspension", async () => {
    const cus = `cus_${stamp}_${orgs.length}`;
    const { subId } = await abonne({ stripeCustomerId: cus });
    for (let i = 0; i < 3; i++) await handleInvoicePaymentFailed({ id: `in_${i}_${stamp}`, customer: cus } as any);
    const a = await relire(subId);
    expect(a.paymentFailedCount).toBe(3);
    expect(a.status, "suspendu sans mise en demeure echue").toBe("past_due");
    expect(a.miseEnDemeureAt).toBeTruthy();
    expect(envois.liste).toHaveLength(2);
  });

  it("un echec apres l'echeance de la mise en demeure suspend", async () => {
    const cus = `cus2_${stamp}_${orgs.length}`;
    const { subId } = await abonne({ stripeCustomerId: cus, status: "past_due", miseEnDemeureAt: new Date(Date.now() - 16 * JOUR) });
    await handleInvoicePaymentFailed({ id: `in_x_${stamp}`, customer: cus } as any);
    expect((await relire(subId)).status).toBe("suspended");
  });
});
