/**
 * Actions d'administration SaaS — la logique de mutation cross-organisation
 * reservee au proprietaire de la plateforme (prolonger un essai, suspendre,
 * reactiver un abonnement).
 *
 * Ces operations existaient deja, disseminees dans les handlers de
 * routes/license-management.ts (`/orgs/:id/extend-trial|suspend|reactivate`).
 * On les centralise ici pour que le nouvel agent autonome super-admin
 * (via services/saas-tools.ts) applique EXACTEMENT le meme effet — meme UPDATE,
 * meme invalidation de cache de licence, meme trace d'audit — sans dupliquer la
 * logique ni risquer une derive de comportement entre "action manuelle" et
 * "action proposee par l'agent".
 *
 * IMPORTANT: ce module fait de la mutation CROSS-ORG. Il ne contient AUCUN
 * controle d'autorisation — c'est volontaire: l'autorisation (super_admin
 * verifie en base + file d'approbation du super-admin) est appliquee en amont,
 * dans services/saas-tools.ts. Ne jamais appeler ces fonctions depuis un chemin
 * qui n'a pas d'abord passe cette garde.
 */
import { db } from "@workspace/db";
import { subscriptionsTable, organisationsTable, licenseAuditLogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { invalidateLicenseCache } from "../middleware/license-check";

export interface SaasActionResult {
  ok: boolean;
  error?: string;
  detail?: Record<string, unknown>;
}

async function loadOrgSub(targetOrgId: number) {
  const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, targetOrgId)).limit(1);
  if (!org) return null;
  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, targetOrgId)).limit(1);
  return { org, sub: sub ?? null };
}

async function audit(orgId: number, action: string, details: string, userId: number, metadata: Record<string, unknown>) {
  try {
    await db.insert(licenseAuditLogTable).values({ organisationId: orgId, action, details, performedBy: userId, metadata });
  } catch (err) {
    logger.error({ err }, "[SaasAdminActions] Echec ecriture audit");
  }
}

/** Prolonge (ou (re)demarre) la periode d'essai d'une organisation. */
export async function extendTrial(targetOrgId: number, days: number, actingUserId: number): Promise<SaasActionResult> {
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: "days doit etre un entier entre 1 et 365" };
  const loaded = await loadOrgSub(targetOrgId);
  if (!loaded || !loaded.sub) return { ok: false, error: "Abonnement introuvable" };
  const { org, sub } = loaded;
  const base = sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date() ? new Date(sub.trialEndsAt) : new Date();
  const newEnd = new Date(base.getTime() + days * 86400000);
  const previousState = { plan: sub.plan, status: sub.status, trialEndsAt: sub.trialEndsAt };
  await db.update(subscriptionsTable)
    .set({ trialEndsAt: newEnd, plan: "essai", status: "active", updatedAt: new Date() })
    .where(eq(subscriptionsTable.organisationId, targetOrgId));
  await audit(targetOrgId, "trial_extended_by_agent", `Essai prolonge de ${days} jours (org: ${org.name}, nouvelle fin: ${newEnd.toISOString()})`, actingUserId, { days, newTrialEndsAt: newEnd, previousState, orgName: org.name });
  return { ok: true, detail: { trialEndsAt: newEnd.toISOString(), previousState } };
}

/** Suspend l'abonnement d'une organisation (acces lecture seule cote client). */
export async function suspendSubscription(targetOrgId: number, reason: string, actingUserId: number): Promise<SaasActionResult> {
  const loaded = await loadOrgSub(targetOrgId);
  if (!loaded || !loaded.sub) return { ok: false, error: "Abonnement introuvable" };
  const { org, sub } = loaded;
  const cleanReason = String(reason || "").trim().slice(0, 500) || "Suspension proposee par l'agent";
  const previousState = { status: sub.status, suspendedAt: sub.suspendedAt, suspensionReason: sub.suspensionReason };
  await db.update(subscriptionsTable)
    .set({ status: "suspended", suspendedAt: new Date(), suspensionReason: "manual", updatedAt: new Date() })
    .where(eq(subscriptionsTable.organisationId, targetOrgId));
  // Le middleware met l'etat de licence en cache 30 s: sans invalidation, la
  // suspension ne prendrait effet qu'apres expiration.
  invalidateLicenseCache(targetOrgId);
  await audit(targetOrgId, "agent_suspended", `Suspendu (org: ${org.name}): ${cleanReason}`, actingUserId, { reason: cleanReason, previousState, orgName: org.name });
  return { ok: true, detail: { previousState } };
}

/** Reactive un abonnement suspendu et remet a zero le compteur d'echecs. */
export async function reactivateSubscription(targetOrgId: number, actingUserId: number): Promise<SaasActionResult> {
  const loaded = await loadOrgSub(targetOrgId);
  if (!loaded || !loaded.sub) return { ok: false, error: "Abonnement introuvable" };
  const { org, sub } = loaded;
  const previousState = { status: sub.status, suspendedAt: sub.suspendedAt, suspensionReason: sub.suspensionReason, paymentFailedCount: sub.paymentFailedCount };
  await db.update(subscriptionsTable)
    .set({ status: "active", suspendedAt: null, suspensionReason: null, paymentFailedCount: 0, updatedAt: new Date() })
    .where(eq(subscriptionsTable.organisationId, targetOrgId));
  invalidateLicenseCache(targetOrgId);
  await audit(targetOrgId, "agent_reactivated", `Reactive (org: ${org.name})`, actingUserId, { previousState, orgName: org.name });
  return { ok: true, detail: { previousState } };
}
