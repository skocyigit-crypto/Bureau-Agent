/**
 * Le cycle des abonnements est BRANCHE, et il ecrit vraiment en base.
 *
 * Ce depot a un mode de panne recurrent, que `retention-cron.ts` documente
 * lui-meme : « du code redige, jamais branche ». `purgeOldSecurityScans` a
 * existe six semaines sans que rien ne l'appelle. Un moteur de cycle
 * parfaitement teste mais qu'aucun cron ne declenche aurait exactement la
 * meme valeur que l'etat trouve en production : zero.
 *
 * Les tests de decision d'a cote sondent les regles sur des dates. Ceux-ci
 * verifient les deux choses qu'ils ne peuvent pas verifier :
 *
 *   1. que le cycle ECRIT — un statut, une date de periode, une raison ;
 *   2. qu'il est inscrit au registre des crons et demarre au lancement.
 *
 * Le second point vaut d'etre verrouille : le moteur de facturation, lui,
 * tourne sur un `setInterval` alors que le service est en `cpu-throttling`,
 * et le depot a deja ecrit noir sur blanc pourquoi c'est faux.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable } from "@workspace/db";
import { appliquerCycleAbonnements } from "../services/cycle-abonnement";
import { PAYMENT_GRACE_DAYS } from "../services/payment-access-policy";

const SRC = join(import.meta.dirname, "..");
const INDEX = readFileSync(join(SRC, "index.ts"), "utf8");
const CRON = readFileSync(join(SRC, "services", "cycle-abonnement-cron.ts"), "utf8");

const JOUR = 86_400_000;
const stamp = Date.now();
const orgs: number[] = [];

async function abonnement(v: Record<string, unknown>): Promise<{ orgId: number; subId: number }> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Cycle ${stamp}-${orgs.length}`, slug: `cycle-${stamp}-${orgs.length}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgs.push(o!.id);
  const [s] = await db.insert(subscriptionsTable).values({
    organisationId: o!.id, plan: "entreprise", status: "active", billingCycle: "monthly",
    price: "199.00", maxUsers: 100, maxContacts: 50000, maxCallsPerMonth: 100000, ...v,
  } as any).returning({ id: subscriptionsTable.id });
  return { orgId: o!.id, subId: s!.id };
}

const relire = async (id: number) =>
  (await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id)))[0]!;

beforeAll(async () => { /* rien : chaque test cree ce qu'il lui faut */ }, 60_000);

afterAll(async () => {
  try { if (orgs.length) await db.delete(organisationsTable).where(inArray(organisationsTable.id, orgs)); } catch { /* au mieux */ }
});

describe("le cycle ecrit vraiment", () => {
  it("une periode close est repoussee dans le FUTUR", async () => {
    // L'etat exact trouve en production : periode terminee, statut « active ».
    const { subId } = await abonnement({
      currentPeriodStart: new Date(Date.now() - 66 * JOUR),
      currentPeriodEnd: new Date(Date.now() - 36 * JOUR),
    });
    await appliquerCycleAbonnements();
    const apres = await relire(subId);
    expect(new Date(apres.currentPeriodEnd!).getTime(), "la periode reste close").toBeGreaterThan(Date.now());
  });

  it("et le statut reste actif — on renouvelle, on ne punit pas", async () => {
    const { subId } = await abonnement({
      currentPeriodStart: new Date(Date.now() - 40 * JOUR),
      currentPeriodEnd: new Date(Date.now() - 10 * JOUR),
    });
    await appliquerCycleAbonnements();
    expect((await relire(subId)).status).toBe("active");
  });

  it("un abonnement en retard hors delai passe a suspended", async () => {
    const { subId } = await abonnement({
      status: "past_due",
      lastPaymentFailedAt: new Date(Date.now() - (PAYMENT_GRACE_DAYS + 2) * JOUR),
      currentPeriodEnd: new Date(Date.now() + 10 * JOUR),
    });
    await appliquerCycleAbonnements();
    expect((await relire(subId)).status).toBe("suspended");
  });

  it("la date et la raison de suspension sont posees, pas laissees vides", async () => {
    // Sans raison ecrite, le super-admin voit un compte suspendu sans savoir
    // pourquoi — et ne peut ni l'expliquer au client ni le reactiver en
    // confiance.
    const { subId } = await abonnement({
      status: "past_due",
      lastPaymentFailedAt: new Date(Date.now() - (PAYMENT_GRACE_DAYS + 3) * JOUR),
    });
    await appliquerCycleAbonnements();
    const a = await relire(subId);
    expect(a.suspendedAt).toBeTruthy();
    expect(String(a.suspensionReason)).toContain(String(PAYMENT_GRACE_DAYS));
  });

  it("un abonnement en grace n'est PAS suspendu", async () => {
    const { subId } = await abonnement({
      status: "past_due",
      lastPaymentFailedAt: new Date(Date.now() - 1 * JOUR),
    });
    await appliquerCycleAbonnements();
    expect((await relire(subId)).status).toBe("past_due");
  });

  it("un essai n'est jamais renouvele", async () => {
    const fin = new Date(Date.now() - 30 * JOUR);
    const { subId } = await abonnement({ plan: "essai", price: "0.00", currentPeriodEnd: fin });
    await appliquerCycleAbonnements();
    expect(new Date((await relire(subId)).currentPeriodEnd!).getTime()).toBe(fin.getTime());
  });

  it("un abonnement annule ne bouge pas", async () => {
    const fin = new Date(Date.now() - 30 * JOUR);
    const { subId } = await abonnement({ status: "cancelled", currentPeriodEnd: fin });
    await appliquerCycleAbonnements();
    const a = await relire(subId);
    expect(a.status).toBe("cancelled");
    expect(new Date(a.currentPeriodEnd!).getTime()).toBe(fin.getTime());
  });

  it("repasser le cycle ne change plus rien — il est idempotent", async () => {
    // Un rattrapage doit etre sans risque : c'est ce qui permet de le lancer
    // apres un incident sans craindre de facturer ou suspendre deux fois.
    const { subId } = await abonnement({ currentPeriodEnd: new Date(Date.now() - 5 * JOUR) });
    await appliquerCycleAbonnements();
    const apres1 = await relire(subId);
    await appliquerCycleAbonnements();
    const apres2 = await relire(subId);
    expect(new Date(apres2.currentPeriodEnd!).getTime()).toBe(new Date(apres1.currentPeriodEnd!).getTime());
  });

  it("le resultat compte ce qu'il a fait, pas seulement « ok »", async () => {
    await abonnement({ currentPeriodEnd: new Date(Date.now() - 2 * JOUR) });
    const r = await appliquerCycleAbonnements();
    expect(r.examines).toBeGreaterThan(0);
    expect(r.renouveles).toBeGreaterThan(0);
  });

  it("et il nomme ce qu'il n'a PAS pu traiter", async () => {
    // Un abonnement saute en silence se compterait comme sain.
    const r = await appliquerCycleAbonnements();
    expect(Array.isArray(r.illisibles)).toBe(true);
    expect(r.illisibles, "des abonnements n'ont pas ete traites").toEqual([]);
  });
});

describe("le cycle est branche au demarrage", () => {
  it("le cron est importe et demarre dans index.ts", () => {
    expect(INDEX).toContain("startCycleAbonnementCron");
    expect(INDEX).toMatch(/\["cycle-abonnement-cron", startCycleAbonnementCron\]/);
  });

  it("il s'inscrit au registre plutot qu'a un minuteur interne", () => {
    // `setInterval` dans un service en cpu-throttling travaille sans
    // processeur : le depot a deja tire cette lecon pour les autres crons.
    //
    // On cherche un APPEL, pas le mot : le commentaire d'en-tete explique
    // justement pourquoi on ne s'en sert pas, et une recherche de texte
    // tombait dessus. Verifier la forme du code plutot que sa prose.
    expect(CRON).toContain("registerRunnableCron");
    const appels = CRON.split(/\r?\n/).filter((l) => {
      const nu = l.trim();
      if (nu.startsWith("//") || nu.startsWith("*")) return false;
      return /\bsetInterval\s*\(/.test(nu);
    });
    expect(appels, "minuteur interne : ne tournera pas de maniere fiable").toEqual([]);
  });

  it("sa cadence est quotidienne", () => {
    expect(CRON).toMatch(/TICK_MS = 24 \* 60 \* 60 \* 1000/);
  });

  it("il remonte un battement de coeur, meme en cas d'erreur", () => {
    // Un cron muet qui echoue tous les jours ressemble a un cron qui n'a rien
    // a faire.
    expect(CRON.match(/recordCronHeartbeat\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("et un abonnement non traite fait partie du battement", () => {
    expect(CRON).toMatch(/illisibles\.length > 0/);
  });
});
