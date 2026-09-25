/**
 * On ne reclame pas le paiement d'une facture jamais emise.
 *
 * LE CAS EXACT, mesure en production le 24/09/2026 et attrape AVANT
 * deploiement. La facture #1 du seul client payant — juin, 199 EUR —
 * portait `status = 'en_attente'` avec `issued_at = NULL` et
 * `reference = NULL` : un reste d'avant l'existence de l'emission. La requete
 * des factures « en retard » ne regardait que le statut et la date de fin de
 * periode, pas l'emission. Elle la comptait donc en retard.
 *
 * Seul, ce defaut ne faisait qu'afficher un chiffre faux dans la vue
 * « a traiter ». Mais l'agent super-admin venait d'apprendre a AGIR sur ce
 * signal : au premier cycle en production, il aurait envoye une relance de
 * paiement au client, pour une facture sans numero, sans date et sans TVA —
 * un document qui n'existe pas juridiquement et qu'il n'a jamais recu.
 *
 * L'automatisation ne cree pas ce genre de defaut, elle le rend couteux : un
 * chiffre faux se corrige, un courriel envoye ne se reprend pas.
 *
 * LA REGLE : l'emission est ce qui rend une facture opposable. Tant qu'elle
 * n'a pas de numero, rien n'a ete demande au client, donc rien ne peut etre
 * en retard. C'est deja la regle appliquee par `cycle-abonnement.ts` pour
 * decider d'un impaye ; les deux endroits disent maintenant la meme chose.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, subscriptionsTable } from "@workspace/db";
import { gatherSaasAttention } from "../services/saas-attention";

const ATTENTION = readFileSync(join(import.meta.dirname, "..", "services", "saas-attention.ts"), "utf8");
const CYCLE = readFileSync(join(import.meta.dirname, "..", "services", "cycle-abonnement.ts"), "utf8");

const JOUR = 86_400_000;
const stamp = Date.now();
const orgs: number[] = [];

async function orgAvecFacture(facture: Record<string, unknown>): Promise<number> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Relance ${stamp}-${orgs.length}`, slug: `relance-${stamp}-${orgs.length}`,
    maxUsers: 10, actif: true,
  } as any).returning({ id: organisationsTable.id });
  orgs.push(o!.id);
  await db.insert(subscriptionsTable).values({
    organisationId: o!.id, plan: "entreprise", status: "active", billingCycle: "monthly",
    price: "199.00", maxUsers: 100, maxContacts: 50000, maxCallsPerMonth: 100000,
    currentPeriodEnd: new Date(Date.now() + 20 * JOUR),
  } as any);
  await db.insert(invoicesTable).values({
    organisationId: o!.id,
    periodLabel: "2026-06",
    periodStart: new Date(Date.now() - 120 * JOUR),
    periodEnd: new Date(Date.now() - 90 * JOUR),
    plan: "entreprise",
    baseAmount: "199.00", overageAmount: "0.00", totalAmount: "199.00",
    currency: "EUR",
    ...facture,
  } as any);
  return o!.id;
}

const signauxDe = async (orgId: number) => {
  const a = await gatherSaasAttention();
  return a.items.filter((i) => i.organisationId === orgId);
};

afterAll(async () => {
  try { if (orgs.length) await db.delete(organisationsTable).where(inArray(organisationsTable.id, orgs)); } catch { /* au mieux */ }
});

describe("une facture jamais emise n'est pas en retard", () => {
  it("le cas exact de production : en_attente, sans numero ni date d'emission", async () => {
    const orgId = await orgAvecFacture({ status: "en_attente", issuedAt: null, reference: null });
    const signaux = await signauxDe(orgId);
    const retard = signaux.filter((s) => s.category === "overdue_saas_invoice");
    expect(retard, "relance envoyee pour un document qui n'existe pas juridiquement").toEqual([]);
  });

  it("un brouillon non plus", async () => {
    const orgId = await orgAvecFacture({ status: "brouillon", issuedAt: null, reference: null });
    const retard = (await signauxDe(orgId)).filter((s) => s.category === "overdue_saas_invoice");
    expect(retard).toEqual([]);
  });

  it("meme si sa periode est close depuis des mois", async () => {
    const orgId = await orgAvecFacture({
      status: "en_attente", issuedAt: null, reference: null,
      periodEnd: new Date(Date.now() - 300 * JOUR),
    });
    const retard = (await signauxDe(orgId)).filter((s) => s.category === "overdue_saas_invoice");
    expect(retard).toEqual([]);
  });
});

describe("une facture EMISE et impayee, elle, est bien en retard", () => {
  it("le controle negatif : sans lui, une requete qui ne rend jamais rien passerait", async () => {
    const orgId = await orgAvecFacture({
      status: "en_attente",
      issuedAt: new Date(Date.now() - 95 * JOUR),
      reference: `FA-${stamp}-1`,
    });
    const retard = (await signauxDe(orgId)).filter((s) => s.category === "overdue_saas_invoice");
    expect(retard.length, "une vraie facture impayee doit etre signalee").toBe(1);
  });

  it("le statut « retard » explicite compte aussi, une fois emise", async () => {
    const orgId = await orgAvecFacture({
      status: "retard",
      issuedAt: new Date(Date.now() - 95 * JOUR),
      reference: `FA-${stamp}-2`,
    });
    const retard = (await signauxDe(orgId)).filter((s) => s.category === "overdue_saas_invoice");
    expect(retard.length).toBe(1);
  });

  it("mais un statut « retard » SANS emission ne compte pas", async () => {
    // L'etat serait incoherent, mais il ne doit pas produire une relance :
    // c'est l'emission qui rend la somme exigible, pas le statut.
    const orgId = await orgAvecFacture({ status: "retard", issuedAt: null, reference: null });
    const retard = (await signauxDe(orgId)).filter((s) => s.category === "overdue_saas_invoice");
    expect(retard).toEqual([]);
  });

  it("une facture emise et PAYEE n'est pas en retard", async () => {
    const orgId = await orgAvecFacture({
      status: "payee",
      issuedAt: new Date(Date.now() - 95 * JOUR),
      reference: `FA-${stamp}-3`,
    });
    const retard = (await signauxDe(orgId)).filter((s) => s.category === "overdue_saas_invoice");
    expect(retard).toEqual([]);
  });

  it("une facture emise RECEMMENT est encore dans son delai", async () => {
    const orgId = await orgAvecFacture({
      status: "en_attente",
      issuedAt: new Date(),
      reference: `FA-${stamp}-4`,
      periodEnd: new Date(),
    });
    const retard = (await signauxDe(orgId)).filter((s) => s.category === "overdue_saas_invoice");
    expect(retard).toEqual([]);
  });
});

describe("les deux endroits disent la meme chose", () => {
  it("la vue « a traiter » exige l'emission", () => {
    expect(ATTENTION).toMatch(/issuedAt\} IS NOT NULL/);
  });

  it("le cycle d'abonnement aussi", () => {
    // Deux regles differentes sur le meme fait — « cette somme est-elle
    // exigible ? » — finiraient par diverger, et l'une relancerait pendant
    // que l'autre suspendrait.
    expect(CYCLE).toMatch(/isNotNull\(invoicesTable\.issuedAt\)/);
  });

  it("et la raison est ecrite la ou la requete se lit", () => {
    expect(ATTENTION).toMatch(/JAMAIS EMISE ne peut pas etre en retard/);
  });
});
