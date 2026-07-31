/**
 * Tests de la logique de proposition de l'agent super-admin
 * (services/saas-agent.ts, fonction pure `planProposalFor`).
 *
 * L'agent ne doit proposer QUE les actions clairement correctes et
 * reversibles, et laisser les arbitrages humains a la vue "à traiter":
 *   - impaye / echec de paiement / facture en retard → relance;
 *   - essai qui se termine bientot → prolongation de courtoisie;
 *   - essai deja expire, quota sature, compte suspendu → aucune proposition.
 * Un test verrouille aussi la deduplication (un sourceRef par org/categorie/jour).
 */
import { describe, expect, it, vi } from "vitest";

// saas-agent importe des modules qui touchent la DB au chargement; on les
// neutralise (planProposalFor est pure).
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({
  organisationsTable: {}, subscriptionsTable: {}, invoicesTable: {},
  usersTable: {}, contactsTable: {}, callsTable: {},
}));
vi.mock("../lib/super-admin-org", () => ({ getSuperAdminOrgId: async () => 1 }));
vi.mock("./proposal-queue", () => ({ enqueueProposal: async () => ({ ok: true }) }));

const { planProposalFor } = await import("../services/saas-agent");
type AttentionItem = import("../services/saas-attention").AttentionItem;

const TODAY = "2026-07-25";

function item(partial: Partial<AttentionItem>): AttentionItem {
  return {
    category: "payment_failed",
    severity: "moyenne",
    organisationId: 42,
    organisationName: "Acme",
    detail: "détail",
    suggestedAction: "action",
    metric: {},
    ...partial,
  };
}

describe("planProposalFor", () => {
  it("impayé → relance de facture", () => {
    const p = planProposalFor(item({ category: "subscription_past_due" }), TODAY);
    expect(p?.toolName).toBe("saas_send_invoice_reminder");
    expect(p?.args).toEqual({ organisationId: 42 });
  });

  it("échec de paiement et facture en retard partagent le même sourceRef (1 relance/jour)", () => {
    const a = planProposalFor(item({ category: "payment_failed" }), TODAY);
    const b = planProposalFor(item({ category: "overdue_saas_invoice" }), TODAY);
    expect(a?.sourceRef).toBe(b?.sourceRef);
    expect(a?.sourceRef).toBe("saas:relance:42:2026-07-25");
  });

  it("essai qui expire bientôt → prolongation de 7 jours", () => {
    const p = planProposalFor(item({ category: "trial_expiring" }), TODAY);
    expect(p?.toolName).toBe("saas_extend_trial");
    expect(p?.args).toEqual({ organisationId: 42, days: 7 });
  });

  it("essai déjà expiré → aucune proposition (décision humaine)", () => {
    expect(planProposalFor(item({ category: "trial_expired" }), TODAY)).toBeNull();
  });

  it("quota saturé → aucune proposition (arbitrage upsell)", () => {
    expect(planProposalFor(item({ category: "quota_breach" }), TODAY)).toBeNull();
  });

  it("compte suspendu → aucune proposition (réactiver ou clore = décision humaine)", () => {
    expect(planProposalFor(item({ category: "suspended" }), TODAY)).toBeNull();
  });

  it("une relance critique est priorité haute", () => {
    const p = planProposalFor(item({ category: "subscription_past_due", severity: "critique" }), TODAY);
    expect(p?.priority).toBe("haute");
  });
});
