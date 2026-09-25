/**
 * Agent autonome super-admin — la couche d'automatisation de la gestion SaaS.
 *
 * IL AGIT sur ce qui est mecanique, et propose le reste.
 *
 * Il ne modifiait rien du tout : chaque signal, meme le plus mecanique,
 * attendait un clic. Sur une plateforme dont le proprietaire veut qu'elle se
 * gere seule, cela revient a une file qui s'allonge.
 *
 * LA LIGNE DE PARTAGE N'EST PAS LE RISQUE, C'EST LA QUESTION POSEE. Relancer
 * un client dont la facture est impayee ne demande aucune decision — la regle
 * est « facture impayee, on relance », et la relance porte deja ses propres
 * garde-fous anti-doublon cote organisation cible. Prolonger un essai de sept
 * jours EN demande une : c'est un geste commercial, au cas par cas, qu'on ne
 * reprend pas une fois accorde.
 *
 * Deterministe (aucun appel IA, aucun cout): il lit les signaux calcules par
 * `gatherSaasAttention` (meme source que la vue "à traiter") et applique des
 * regles simples:
 *   - impayes / echecs de paiement / factures d'abonnement en retard
 *       → ENVOYER la relance de facture, sans attendre;
 *   - essai qui se termine bientot
 *       → PROPOSER une prolongation de courtoisie (7 jours).
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
import { jourLocal } from "../lib/jour-local";

const TRIAL_GRACE_DAYS = 7;

interface PlannedProposal {
  /**
   * Vrai quand l'action est la consequence MECANIQUE d'une regle, et non un
   * arbitrage.
   *
   * La difference n'est pas le risque, c'est la question posee. Relancer un
   * client dont la facture est impayee ne demande aucune decision : la regle
   * est « facture impayee, on relance », et la relance porte deja ses propres
   * garde-fous anti-doublon. Prolonger un essai de sept jours en demande une :
   * c'est un geste commercial, il se decide au cas par cas, et personne ne
   * peut le reprendre une fois accorde.
   *
   * Automatiser le mecanique et laisser proposer l'arbitraire, plutot que de
   * choisir entre tout automatiser et tout faire valider.
   */
  autoApplicable: boolean;
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
        autoApplicable: true,
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
      // Un geste commercial : il reste propose.
      return {
        autoApplicable: false,
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
  /** Actions mecaniques executees sans attendre d'approbation. */
  applied: number;
  /** Actions qui ont echoue a l'execution — comptees a part, jamais tues. */
  failed: number;
  proposed: number;
  duplicates: number;
  skipped: number;
  reason?: string;
}

/**
 * Declenche les relances de facture d'une organisation.
 *
 * Un echec ne doit PAS interrompre le cycle : une organisation dont la
 * relance echoue ne doit pas empecher les suivantes d'etre traitees. On le
 * compte et on le journalise — un echec silencieux se compterait comme un
 * succes, et le cycle rendrait « tout va bien » en n'ayant rien envoye.
 */
async function appliquerRelance(organisationId: number): Promise<{ ok: boolean }> {
  try {
    const { runAutoRemindersForOrg } = await import("../routes/license-management");
    await runAutoRemindersForOrg(organisationId, undefined, { mode: "send" });
    logger.info({ organisationId }, "[SaasAgent] relance de facture envoyee");
    return { ok: true };
  } catch (err) {
    logger.error({ err, organisationId }, "[SaasAgent] relance de facture en echec");
    return { ok: false };
  }
}

export async function runSaasAgent(): Promise<SaasAgentRunResult> {
  const superAdminOrgId = await getSuperAdminOrgId();
  if (superAdminOrgId == null) {
    // Pas d'organisation super-admin configuree: rien a faire (deploiement
    // sans compte plateforme, ou slug absent).
    logger.info("[SaasAgent] Organisation super-admin introuvable, cycle ignore.");
    return { ok: false, applied: 0, failed: 0, proposed: 0, duplicates: 0, skipped: 0, reason: "no_super_admin_org" };
  }

  const attention = await gatherSaasAttention();
  const today = jourLocal();

  let proposed = 0;
  let duplicates = 0;
  let skipped = 0;
  let applied = 0;
  let failed = 0;

  for (const item of attention.items) {
    const plan = planProposalFor(item, today);
    if (!plan) { skipped++; continue; }

    // Les actions mecaniques s'executent, elles ne se proposent pas.
    //
    // POURQUOI PAS PAR executeSaasTool : ses deux invariants exigent un
    // super-administrateur actif et la file du super-admin. Ils protegent la
    // FILE — dont la menace est qu'un locataire y fasse executer une action
    // de plateforme. Un cron interne n'est pas un acteur locataire, et lui
    // fabriquer une identite d'utilisateur affaiblirait l'invariant pour tous
    // les autres appels. On appelle donc l'action, pas l'outil.
    if (plan.autoApplicable) {
      const r = await appliquerRelance(plan.args.organisationId as number);
      if (r.ok) { applied++; } else { failed++; }
      continue;
    }

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

  logger.info({ applied, failed, proposed, duplicates, skipped, total: attention.total }, "[SaasAgent] Cycle termine");
  return { ok: true, applied, failed, proposed, duplicates, skipped };
}
