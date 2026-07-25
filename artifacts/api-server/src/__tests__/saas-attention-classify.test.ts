/**
 * Tests de la classification d'attention SaaS (services/saas-attention.ts).
 *
 * `classifyOrganisation` est la logique de decision du super-admin: a partir de
 * l'etat d'une organisation et de son abonnement, elle produit la liste des
 * situations qui demandent une action (essai qui expire, impaye, quota sature,
 * facture en retard, suspension). Ces seuils pilotent aussi, en phase 2, les
 * propositions de l'agent autonome — un test verrouille qu'ils ne derivent pas.
 */
import { describe, expect, it, vi } from "vitest";

// `classifyOrganisation` est une fonction pure, mais le module importe la couche
// DB au chargement (pour la partie agregation). On la neutralise: le test ne
// touche jamais a la base.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({
  organisationsTable: {}, subscriptionsTable: {}, invoicesTable: {},
  usersTable: {}, contactsTable: {}, callsTable: {},
}));

const { classifyOrganisation } = await import("../services/saas-attention");
type OrgClassificationInput = import("../services/saas-attention").OrgClassificationInput;

const NOW = new Date("2026-07-25T12:00:00.000Z");
const day = 86400000;

function make(partial: Partial<OrgClassificationInput>): OrgClassificationInput {
  return {
    org: { id: 1, name: "Org", email: "o@x.fr", actif: true },
    sub: {
      plan: "professionnel",
      status: "active",
      trialEndsAt: null,
      paymentFailedCount: 0,
      suspendedAt: null,
      suspensionReason: null,
      maxUsers: 15,
      maxContacts: 5000,
      maxCallsPerMonth: 10000,
    },
    usage: { utilisateurs: 0, contacts: 0, appels: 0 },
    overdueInvoices: null,
    ...partial,
  };
}

const cats = (items: ReturnType<typeof classifyOrganisation>) => items.map((i) => i.category).sort();

describe("classifyOrganisation", () => {
  it("ne signale rien pour un compte payant sain", () => {
    expect(classifyOrganisation(make({}), NOW)).toEqual([]);
  });

  it("un compte suspendu est terminal (aucun autre signal cumulé)", () => {
    const r = classifyOrganisation(
      make({ org: { id: 1, name: "Org", email: null, actif: false }, sub: { ...make({}).sub!, status: "suspended", paymentFailedCount: 3, suspensionReason: "manual" } }),
      NOW,
    );
    expect(r).toHaveLength(1);
    expect(r[0].category).toBe("suspended");
  });

  it("essai qui expire dans 2 jours → trial_expiring (moyenne)", () => {
    const r = classifyOrganisation(make({ sub: { ...make({}).sub!, plan: "essai", trialEndsAt: new Date(NOW.getTime() + 2 * day) } }), NOW);
    expect(cats(r)).toEqual(["trial_expiring"]);
    expect(r[0].severity).toBe("moyenne");
  });

  it("essai qui expire demain → trial_expiring (haute)", () => {
    const r = classifyOrganisation(make({ sub: { ...make({}).sub!, plan: "essai", trialEndsAt: new Date(NOW.getTime() + 1 * day) } }), NOW);
    expect(r[0].category).toBe("trial_expiring");
    expect(r[0].severity).toBe("haute");
  });

  it("essai deja expiré, compte encore actif → trial_expired (critique)", () => {
    const r = classifyOrganisation(make({ sub: { ...make({}).sub!, plan: "essai", trialEndsAt: new Date(NOW.getTime() - 1 * day) } }), NOW);
    expect(r[0].category).toBe("trial_expired");
    expect(r[0].severity).toBe("critique");
  });

  it("essai encore loin (10 jours) → rien", () => {
    const r = classifyOrganisation(make({ sub: { ...make({}).sub!, plan: "essai", trialEndsAt: new Date(NOW.getTime() + 10 * day) } }), NOW);
    expect(r).toEqual([]);
  });

  it("past_due → subscription_past_due, sans doubler avec payment_failed", () => {
    const r = classifyOrganisation(make({ sub: { ...make({}).sub!, status: "past_due", paymentFailedCount: 2 } }), NOW);
    expect(cats(r)).toEqual(["subscription_past_due"]);
  });

  it("1 échec de paiement → payment_failed (moyenne)", () => {
    const r = classifyOrganisation(make({ sub: { ...make({}).sub!, paymentFailedCount: 1 } }), NOW);
    expect(r[0].category).toBe("payment_failed");
    expect(r[0].severity).toBe("moyenne");
  });

  it("facture d'abonnement en retard → overdue_saas_invoice", () => {
    const r = classifyOrganisation(make({ overdueInvoices: { count: 2, total: 158 } }), NOW);
    expect(cats(r)).toEqual(["overdue_saas_invoice"]);
    expect(r[0].metric.totalDue).toBe(158);
  });

  it("quota à 80% sur un plan payant → quota_breach (moyenne)", () => {
    const r = classifyOrganisation(make({ usage: { utilisateurs: 12, contacts: 0, appels: 0 } }), NOW); // 12/15 = 80%
    expect(r[0].category).toBe("quota_breach");
    expect(r[0].severity).toBe("moyenne");
  });

  it("quota dépassé → quota_breach (haute)", () => {
    const r = classifyOrganisation(make({ usage: { utilisateurs: 16, contacts: 0, appels: 0 } }), NOW);
    expect(r[0].category).toBe("quota_breach");
    expect(r[0].severity).toBe("haute");
  });

  it("un essai qui sature son quota n'est PAS un quota_breach (signal de conversion)", () => {
    const r = classifyOrganisation(make({ sub: { ...make({}).sub!, plan: "essai", maxUsers: 3, trialEndsAt: new Date(NOW.getTime() + 20 * day) }, usage: { utilisateurs: 3, contacts: 0, appels: 0 } }), NOW);
    expect(r.every((i) => i.category !== "quota_breach")).toBe(true);
  });

  it("cumule plusieurs signaux distincts sur un même compte", () => {
    const r = classifyOrganisation(
      make({ sub: { ...make({}).sub!, paymentFailedCount: 2 }, usage: { utilisateurs: 15, contacts: 0, appels: 0 }, overdueInvoices: { count: 1, total: 79 } }),
      NOW,
    );
    expect(cats(r)).toEqual(["overdue_saas_invoice", "payment_failed", "quota_breach"]);
  });
});
