/**
 * Agent autonome super-admin — la couche d'automatisation de la gestion SaaS.
 *
 * Il ne modifie RIEN directement. Comme l'agent de bureau autonome cote tenant,
 * il observe puis DEPOSE des propositions dans la file d'approbation; c'est
 * l'approbation du proprietaire de la plateforme qui declenche l'action.
 *
 * Deterministe (aucun appel IA, aucun cout): il lit les signaux calcules par
 * `gatherSaasAttention` (meme source que la vue "à traiter") et applique des
 * regles simples pour ne proposer QUE les actions clairement correctes et
 * reversibles:
 *   - impayes / echecs de paiement / factures d'abonnement en retard
 *       → proposer l'envoi d'une relance de facture;
 *   - essai qui se termine bientot
 *       → proposer une prolongation de courtoisie (7 jours).
 *
 * Les situations qui relevent d'un vrai arbitrage (quota sature = upsell ?,
 * compte suspendu = reactiver ou clore ?, essai deja expire = convertir /
 * prolonger / suspendre ?) ne sont PAS auto-proposees: elles restent visibles
 * dans la vue "à traiter" pour decision humaine. Mieux vaut une automatisation
 * etroite et sure qu'une avalanche de propositions ambigues.
 *
 * Les propositions vivent dans la file de l'organisation super-admin. La
 * deduplication (`sourceRef`) garantit au plus une proposition par organisation,
 * par categorie et par jour.
 */
import { logger } from "../lib/logger";
import { getSuperAdminOrgId } from "../lib/super-admin-org";
import { gatherSaasAttention, type AttentionItem } from "./saas-attention";
import { enqueueProposal } from "./proposal-queue";

const TRIAL_GRACE_DAYS = 7;

interface PlannedProposal {
  toolName: string;
  args: Record<string, unknown>;
  title: string;
  summary: string;
  reason: string;
  category: string;
  priority: "haute" | "moyenne" | "basse";
  sourceRef: string;
}

/**
 * Traduit un signal d'attention en proposition d'action — ou `null` si le
 * signal releve d'un arbitrage humain (pas d'action evidente et reversible).
 * Fonction PURE: testable sans base ni file.
 */
export function planProposalFor(item: AttentionItem, today: string): PlannedProposal | null {
  const orgRef = `${item.organisationId}:${today}`;
  switch (item.category) {
    case "payment_failed":
    case "subscription_past_due":
    case "overdue_saas_invoice":
      return {
        toolName: "saas_send_invoice_reminder",
        args: { organisationId: item.organisationId },
        title: `Relance de paiement — ${item.organisationName}`,
        summary: `Envoyer une relance de facture d'abonnement à ${item.organisationName}. ${item.detail}`,
        reason: item.detail,
        category: "relance",
        priority: item.severity === "critique" || item.severity === "haute" ? "haute" : "moyenne",
        // Une seule relance par org et par jour, quelle que soit la sous-cause.
        sourceRef: `saas:relance:${orgRef}`,
      };
    case "trial_expiring":
      return {
        toolName: "saas_extend_trial",
        args: { organisationId: item.organisationId, days: TRIAL_GRACE_DAYS },
        title: `Prolonger l'essai — ${item.organisationName}`,
        summary: `Accorder ${TRIAL_GRACE_DAYS} jours de délai à ${item.organisationName}. ${item.detail}`,
        reason: item.detail,
        category: "autre",
        priority: "moyenne",
        sourceRef: `saas:trial_grace:${orgRef}`,
      };
    default:
      // trial_expired, quota_breach, suspended → decision humaine.
      return null;
  }
}

export interface SaasAgentRunResult {
  ok: boolean;
  proposed: number;
  duplicates: number;
  skipped: number;
  reason?: string;
}

export async function runSaasAgent(): Promise<SaasAgentRunResult> {
  const superAdminOrgId = await getSuperAdminOrgId();
  if (superAdminOrgId == null) {
    // Pas d'organisation super-admin configuree: rien a faire (deploiement
    // sans compte plateforme, ou slug absent).
    logger.info("[SaasAgent] Organisation super-admin introuvable, cycle ignore.");
    return { ok: false, proposed: 0, duplicates: 0, skipped: 0, reason: "no_super_admin_org" };
  }

  const attention = await gatherSaasAttention();
  const today = new Date().toISOString().slice(0, 10);

  let proposed = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const item of attention.items) {
    const plan = planProposalFor(item, today);
    if (!plan) { skipped++; continue; }
    const res = await enqueueProposal({
      orgId: superAdminOrgId,
      toolName: plan.toolName,
      title: plan.title,
      summary: plan.summary,
      reason: plan.reason,
      args: plan.args,
      category: plan.category,
      priority: plan.priority,
      sourceType: "saas_agent",
      sourceRef: plan.sourceRef,
    });
    if (res.ok && res.duplicate) duplicates++;
    else if (res.ok) proposed++;
    else skipped++;
  }

  logger.info({ proposed, duplicates, skipped, total: attention.total }, "[SaasAgent] Cycle termine");
  return { ok: true, proposed, duplicates, skipped };
}
