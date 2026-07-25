/**
 * Outils SaaS cross-organisation — l'equivalent super-admin des outils
 * d'assistant, mais qui agissent sur d'AUTRES organisations (l'org cible est un
 * argument). Ils alimentent l'agent autonome super-admin: celui-ci ne fait rien
 * directement, il DEPOSE une proposition dans la file d'approbation, et c'est
 * l'approbation du proprietaire de la plateforme qui declenche l'execution.
 *
 * ── POURQUOI UN REGISTRE SEPARE (et non TOOL_MAP) ──────────────────────────
 * Les 37 outils d'assistant sont strictement org-scoped: leur `execute` filtre
 * tout par `ctx.orgId`. Les outils SaaS violent cette isolation par nature (ils
 * modifient une organisation TIERS). Les melanger a TOOL_MAP ferait courir le
 * risque qu'un chemin org-scoped (executeTool) execute par megarde une action
 * cross-org. On les garde donc dans un registre distinct: `executeTool`
 * (org-scoped) ne peut littéralement pas les resoudre.
 *
 * ── LA GARDE ───────────────────────────────────────────────────────────────
 * `executeSaasTool` verifie DEUX invariants avant toute mutation, en base et
 * non sur la foi du contexte:
 *   1. l'utilisateur qui approuve (ctx.userId) est actif ET a le role
 *      `super_admin` — lu depuis la table users, pas depuis la session;
 *   2. la proposition vit dans la file de l'organisation super-admin
 *      (ctx.orgId === getSuperAdminOrgId()).
 * Si l'une echoue, aucune action n'est executee.
 */
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getSuperAdminOrgId } from "../lib/super-admin-org";
import {
  validateArgs,
  type FieldSpec,
  type ToolContext,
  type ToolExecutionResult,
} from "./assistant-tools";
import { extendTrial, suspendSubscription, reactivateSubscription } from "./saas-admin-actions";

export interface SaasToolDef {
  name: string;
  description: string;
  fields: Record<string, FieldSpec>;
  /** Resume lisible affiche dans la file d'approbation. */
  summarize: (args: Record<string, unknown>) => string;
  /** Suppose la garde deja passee et les args deja valides. */
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const SAAS_TOOLS: SaasToolDef[] = [
  {
    name: "saas_extend_trial",
    description: "Prolonge la période d'essai d'une organisation cliente.",
    fields: {
      organisationId: { kind: "number", required: true, min: 1 },
      days: { kind: "number", required: true, min: 1, max: 365 },
    },
    summarize: (a) => `Prolonger l'essai de l'organisation #${a.organisationId} de ${a.days} jour(s).`,
    run: (a, ctx) => extendTrial(Number(a.organisationId), Number(a.days), ctx.userId),
  },
  {
    name: "saas_suspend_subscription",
    description: "Suspend l'abonnement d'une organisation (accès en lecture seule côté client).",
    fields: {
      organisationId: { kind: "number", required: true, min: 1 },
      reason: { kind: "string", required: false, max: 500 },
    },
    summarize: (a) => `Suspendre l'abonnement de l'organisation #${a.organisationId}${a.reason ? ` (${a.reason})` : ""}.`,
    run: (a, ctx) => suspendSubscription(Number(a.organisationId), String(a.reason ?? ""), ctx.userId),
  },
  {
    name: "saas_reactivate_subscription",
    description: "Réactive un abonnement suspendu et remet à zéro le compteur d'échecs de paiement.",
    fields: {
      organisationId: { kind: "number", required: true, min: 1 },
    },
    summarize: (a) => `Réactiver l'abonnement de l'organisation #${a.organisationId}.`,
    run: (a, ctx) => reactivateSubscription(Number(a.organisationId), ctx.userId),
  },
  {
    name: "saas_send_invoice_reminder",
    description: "Déclenche les relances de facture pour une organisation cliente (respecte ses garde-fous anti-doublon).",
    fields: {
      organisationId: { kind: "number", required: true, min: 1 },
    },
    summarize: (a) => `Envoyer les relances de facture en attente pour l'organisation #${a.organisationId}.`,
    // On force le mode "send": la proposition ELLE-MEME est deja l'etape
    // d'approbation humaine, inutile de re-proposer dans la file de l'org cible.
    // Import dynamique: license-management importe deja la file d'approbation,
    // un import statique ici creerait un cycle (queue -> saas-tools ->
    // license-management -> queue).
    run: async (a) => {
      const { runAutoRemindersForOrg } = await import("../routes/license-management");
      return runAutoRemindersForOrg(Number(a.organisationId), undefined, { mode: "send" });
    },
  },
];

const SAAS_TOOL_MAP = new Map(SAAS_TOOLS.map((t) => [t.name, t]));

export function isSaasTool(name: string): boolean {
  return SAAS_TOOL_MAP.has(name);
}

export function getSaasTool(name: string): SaasToolDef | undefined {
  return SAAS_TOOL_MAP.get(name);
}

export function listSaasTools(): SaasToolDef[] {
  return [...SAAS_TOOLS];
}

/**
 * Execute un outil SaaS APRES avoir verifie, en base, les deux invariants de
 * securite (super_admin actif + file du super-admin). Toute autre situation
 * renvoie une erreur sans muter quoi que ce soit.
 */
export async function executeSaasTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolExecutionResult> {
  const tool = SAAS_TOOL_MAP.get(name);
  if (!tool) return { ok: false, error: `Outil SaaS inconnu: ${name}` };

  // Invariant 1: l'acteur est un super-admin actif (verifie en base).
  const [actor] = await db
    .select({ role: usersTable.role, actif: usersTable.actif })
    .from(usersTable)
    .where(eq(usersTable.id, ctx.userId))
    .limit(1);
  if (!actor || !actor.actif || actor.role !== "super_admin") {
    logger.warn({ userId: ctx.userId, tool: name }, "[SaasTools] Refus: acteur non super-admin");
    return { ok: false, error: "Action réservée au super-administrateur." };
  }

  // Invariant 2: la proposition vit dans la file de l'organisation super-admin.
  const superAdminOrgId = await getSuperAdminOrgId();
  if (superAdminOrgId == null || ctx.orgId !== superAdminOrgId) {
    logger.warn({ orgId: ctx.orgId, superAdminOrgId, tool: name }, "[SaasTools] Refus: hors file super-admin");
    return { ok: false, error: "Action hors du périmètre super-administrateur." };
  }

  // Empeche une organisation de s'auto-suspendre/prolonger via l'org cible.
  const parsed = validateArgs(tool.fields, rawArgs ?? {});
  if (!parsed.ok) return { ok: false, error: `Argument invalide pour ${name}: ${parsed.error}` };

  try {
    const result = await tool.run(parsed.data, ctx);
    return { ok: true, result };
  } catch (err) {
    logger.error({ err, tool: name }, "[SaasTools] Echec execution");
    return { ok: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}
