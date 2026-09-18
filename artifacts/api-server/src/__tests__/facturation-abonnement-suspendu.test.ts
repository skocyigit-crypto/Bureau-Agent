/**
 * Un abonnement suspendu ne se facture pas au prix plein.
 *
 * Mesure le 18/09: `generateMonthlyInvoices` ne lit jamais `subscriptions.status`.
 * Or `middleware/license-check.ts` place un abonnement suspendu en LECTURE
 * SEULE — le client ne peut plus rien creer. Il recevait pourtant, le 1er du
 * mois suivant, une facture au tarif complet, depassements compris: on lui
 * facturait un mois qu'on l'avait empeche d'utiliser.
 *
 * La suspension est prononcee par la plateforme (impaye, decision manuelle:
 * routes/license-management.ts, services/saas-admin-actions.ts). Facturer
 * par-dessus, c'est facturer sa propre sanction.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, subscriptionsTable } from "@workspace/db";
import { generateMonthlyInvoices } from "../services/billing-engine";

const stamp = Date.now();
const ANNEE = 2026;
const MOIS = 5; // mai: periode close, aucun appel de test ne tombe dedans
const PERIODE = `${ANNEE}-05`;
let orgActive = 0, orgSuspendue = 0;

async function organisation(nom: string, statut: string) {
  const [o] = await db.insert(organisationsTable).values({
    name: `Fact ${nom} ${stamp}`, slug: `fact-${nom}-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  await db.insert(subscriptionsTable).values({
    organisationId: o!.id, plan: "starter", status: statut, price: "29",
    maxUsers: 5, maxContacts: 500, maxCallsPerMonth: 2000,
    aiEnabled: false, stockEnabled: true, automationEnabled: false,
  } as any);
  return o!.id;
}
const facture = async (orgId: number) =>
  db.select().from(invoicesTable).where(and(eq(invoicesTable.organisationId, orgId), eq(invoicesTable.periodLabel, PERIODE)));

beforeAll(async () => {
  orgActive = await organisation("active", "active");
  orgSuspendue = await organisation("suspendue", "suspended");
  await generateMonthlyInvoices(ANNEE, MOIS, "brouillon");
}, 120_000);
afterAll(async () => {
  for (const o of [orgActive, orgSuspendue]) {
    try { await db.delete(organisationsTable).where(eq(organisationsTable.id, o)); } catch { /* best-effort */ }
  }
});

describe("facturation mensuelle et statut d'abonnement", () => {
  it("un abonnement actif est facture", async () => {
    expect((await facture(orgActive)).length).toBe(1);
  });

  it("un abonnement SUSPENDU n'est pas facture", async () => {
    expect(
      await facture(orgSuspendue),
      "le client est en lecture seule: lui facturer le mois complet revient a facturer sa propre sanction",
    ).toEqual([]);
  });

  it("la facture de l'organisation active porte le prix du plan", async () => {
    const [f] = await facture(orgActive);
    expect(Number(f!.totalAmount)).toBe(29);
  });

  it("relancer la generation ne cree pas de doublon", async () => {
    await generateMonthlyInvoices(ANNEE, MOIS, "brouillon");
    expect((await facture(orgActive)).length).toBe(1);
  }, 120_000);

  it("… et ne fait pas apparaitre de facture pour le suspendu non plus", async () => {
    expect(await facture(orgSuspendue)).toEqual([]);
  });

  it("le compte rendu classe le suspendu en « ignore », pas en erreur", async () => {
    const r = await generateMonthlyInvoices(ANNEE, MOIS, "brouillon");
    expect(r.errors).toBe(0);
    expect(r.skipped).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
