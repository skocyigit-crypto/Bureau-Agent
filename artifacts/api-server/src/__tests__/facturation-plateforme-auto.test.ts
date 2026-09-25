/**
 * La plateforme emet ses factures toute seule — sauf quand il y a une raison.
 *
 * MESURE EN PRODUCTION, le 24/09/2026. Trois factures existaient pour le seul
 * client payant (199 EUR/mois, periodes 06, 07 et 08) : toutes sans numero,
 * sans date d'emission, `total_ttc` a 0,00, et la table
 * `platform_invoice_sequences` VIDE. Autrement dit, la sequence chronologique
 * continue exigee par l'article 242 nonies A de l'annexe II au CGI n'avait
 * jamais commence, et le client n'avait jamais recu de facture opposable.
 *
 * CE QUE JE CROYAIS, ET QUI ETAIT FAUX. J'ai d'abord conclu que l'emission
 * n'etait appelee que par deux routes manuelles. Lecture faite,
 * `generateMonthlyInvoices` appelle bien `emettreFacturePlateforme` — a une
 * condition. La vraie cause est ailleurs : `billingRequiresApproval` valait
 * true pour les CINQ organisations, parce que c'etait le defaut du schema.
 * Personne ne l'avait choisi. Une garde que personne ne leve n'est pas une
 * garde, c'est un arret.
 *
 * CE QUI CHANGE, ET CE QUI NE CHANGE PAS. Le defaut passe a false : une
 * organisation creee demain est facturee sans intervention. Mais la raison
 * qui avait motive le defaut inverse — « une facture partie chez le client se
 * rattrape mal » — reste vraie pour une partie des cas. Une facture numerotee
 * ne se supprime pas : elle s'annule par un avoir. Le risque n'est pas le
 * mois ordinaire au tarif du plan, c'est le mois qui ajoute des frais que le
 * client n'attend pas. Un DEPASSEMENT force donc l'approbation, quel que soit
 * le reglage.
 *
 * Les organisations existantes gardent leur valeur en base : changer un
 * defaut ne doit pas modifier la facturation d'un client en cours.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, subscriptionsTable, usersTable, contactsTable } from "@workspace/db";
import { generateMonthlyInvoices } from "../services/billing-engine";

const MOTEUR = readFileSync(join(import.meta.dirname, "..", "services", "billing-engine.ts"), "utf8");
const SCHEMA = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "lib", "db", "src", "schema", "organisations.ts"),
  "utf8",
);

const stamp = Date.now();
const orgs: number[] = [];
const PERIODE = { annee: 2026, mois: 5 }; // mai 2026 : periode close, sans usage

async function organisation(v: Record<string, unknown> = {}): Promise<number> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Facturation ${stamp}-${orgs.length}`, slug: `fact-${stamp}-${orgs.length}`,
    maxUsers: 100, actif: true, ...v,
  } as any).returning({ id: organisationsTable.id });
  orgs.push(o!.id);
  await db.insert(subscriptionsTable).values({
    organisationId: o!.id, plan: "entreprise", status: "active", billingCycle: "monthly",
    price: "199.00", maxUsers: 100, maxContacts: 50000, maxCallsPerMonth: 100000,
  } as any);
  return o!.id;
}

const factures = async (orgId: number) =>
  db.select().from(invoicesTable).where(eq(invoicesTable.organisationId, orgId));

afterAll(async () => {
  try { if (orgs.length) await db.delete(organisationsTable).where(inArray(organisationsTable.id, orgs)); } catch { /* au mieux */ }
});

describe("un mois ordinaire part seul", () => {
  it("la facture est EMISE, pas laissee en brouillon", async () => {
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect(f, "aucune facture generee").toBeTruthy();
    expect(f!.status).toBe("en_attente");
  });

  it("elle porte un NUMERO — sinon la sequence du CGI ne commence jamais", async () => {
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect(f!.reference, "facture sans numero : non opposable").toBeTruthy();
  });

  it("et une date d'emission", async () => {
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect(f!.issuedAt).toBeTruthy();
  });

  it("le total TTC n'est plus a zero", async () => {
    // C'est l'etat exact trouve en production : 199,00 HT et 0,00 TTC.
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect(Number(f!.totalTtc)).toBeGreaterThan(Number(f!.totalAmount));
  });

  it("l'identite de l'acheteur est figee sur la facture", async () => {
    // Lire le nom a l'affichage reecrirait les factures passees d'un client
    // qui change de raison sociale.
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect((f!.buyerSnapshot as any)?.name).toContain("Facturation");
  });

  it("le montant est celui du plan", async () => {
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect(Number(f!.totalAmount)).toBe(199);
  });
});

describe("ce qui reste soumis a un regard", () => {
  it("un DEPASSEMENT attend l'approbation, meme sans exigence d'approbation", async () => {
    // Le risque n'est pas le mois ordinaire : c'est le mois qui ajoute des
    // frais que le client n'attend pas, sur une facture qu'on ne pourra plus
    // supprimer.
    const orgId = await organisation({ billingRequiresApproval: false });
    // Un abonnement a 1 contact maximum, puis deux contacts : depassement.
    await db.update(subscriptionsTable).set({ maxContacts: 1 })
      .where(eq(subscriptionsTable.organisationId, orgId));
    for (const n of [1, 2]) {
      await db.insert(contactsTable).values({
        organisationId: orgId, firstName: "C", lastName: `${n}`, phone: "0102030405", category: "client",
      } as any);
    }
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect(Number(f!.overageAmount), "pas de depassement : le test ne mesure rien").toBeGreaterThan(0);
    expect(f!.status, "un depassement doit attendre un regard").toBe("brouillon");
    expect(f!.reference, "un brouillon ne consomme pas de numero").toBeNull();
  });

  it("une organisation qui exige l'approbation la garde", async () => {
    const orgId = await organisation({ billingRequiresApproval: true });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const [f] = await factures(orgId);
    expect(f!.status).toBe("brouillon");
  });

  it("le mode « direct » passe outre — c'est l'emission manuelle validee", async () => {
    const orgId = await organisation({ billingRequiresApproval: true });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois, "direct");
    const [f] = await factures(orgId);
    expect(f!.status).toBe("en_attente");
    expect(f!.reference).toBeTruthy();
  });

  it("un abonnement non actif n'est pas facture", async () => {
    // Suspendre un client puis lui facturer le mois plein reviendrait a lui
    // facturer un mois qu'on l'a empeche d'utiliser.
    const orgId = await organisation({ billingRequiresApproval: false });
    await db.update(subscriptionsTable).set({ status: "suspended" })
      .where(eq(subscriptionsTable.organisationId, orgId));
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    expect(await factures(orgId)).toEqual([]);
  });

  it("un essai n'est jamais facture", async () => {
    const orgId = await organisation({ billingRequiresApproval: false });
    await db.update(subscriptionsTable).set({ plan: "essai", price: "0.00" })
      .where(eq(subscriptionsTable.organisationId, orgId));
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    expect(await factures(orgId)).toEqual([]);
  });

  it("repasser le mois ne cree pas de seconde facture", async () => {
    // Deux factures pour le meme mois chez le meme client est le defaut le
    // plus cher de cette famille.
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    expect((await factures(orgId)).length).toBe(1);
  });

  it("et ne consomme pas un second numero", async () => {
    const orgId = await organisation({ billingRequiresApproval: false });
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    const avant = (await factures(orgId))[0]!.reference;
    await generateMonthlyInvoices(PERIODE.annee, PERIODE.mois);
    expect((await factures(orgId))[0]!.reference).toBe(avant);
  });
});

describe("le defaut du schema, et ce qu'il ne fait pas", () => {
  it("une organisation nouvelle n'exige plus l'approbation", () => {
    expect(SCHEMA).toMatch(/billing_requires_approval"\)\.notNull\(\)\.default\(false\)/);
  });

  it("la raison du changement est ecrite, pas seulement la valeur", () => {
    // Un defaut inverse sans explication se re-inverse au premier doute.
    expect(SCHEMA).toMatch(/242 nonies A/);
  });

  it("le moteur force l'approbation sur depassement", () => {
    expect(MOTEUR).toMatch(/const depassement = overageAmount > 0;/);
    expect(MOTEUR).toMatch(/!org\.billingRequiresApproval && !depassement/);
  });
});
