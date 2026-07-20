/**
 * Point d'entrée UNIQUE de la file d'approbation (`agent_proposals`).
 *
 * RÈGLE D'OR: une IA ne déclenche jamais d'effet réel (e-mail, SMS, annulation,
 * facture, appel externe) sans qu'un humain ait vu ce qui allait être fait et
 * l'ait approuvé. Concrètement: l'IA prépare, `enqueueProposal()` met en
 * attente, l'écran "File d'approbation" montre le brouillon (modifiable), et
 * seule l'approbation déclenche `executeProposal()`.
 *
 * Pourquoi ce fichier existe: avant lui, chaque producteur de propositions
 * écrivait son propre `db.insert(agentProposalsTable)` à la main
 * (autonomous-secretary, app-audit, ...). Rien n'obligeait une nouvelle
 * fonctionnalité IA à passer par la file — l'oubli était silencieux et donnait
 * une action autonome non voulue. Tout producteur doit désormais passer ici.
 *
 * Garanties offertes:
 *  - `toolName` doit exister dans le registre d'outils, sinon la proposition
 *    est refusée immédiatement (plutôt que d'atterrir dans la file et d'échouer
 *    seulement au moment où le patron clique "Approuver").
 *  - `args` est validé avec le MÊME `validateArgs` que l'exécution réelle.
 *  - Déduplication sur `sourceRef` parmi les propositions déjà `en_attente`.
 *  - Ne lève jamais d'exception: les appelants sont majoritairement des crons,
 *    un producteur cassé ne doit pas tuer la boucle. L'échec est retourné dans
 *    le résultat ET journalisé.
 */
import { db } from "@workspace/db";
import { agentProposalsTable } from "@workspace/db/schema";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getTool, validateArgs } from "./assistant-tools";

export interface EnqueueProposalInput {
  orgId: number;
  /** Outil assistant à exécuter à l'approbation (doit exister dans le registre). */
  toolName: string;
  /** Titre court lisible: ce que l'humain lit en premier dans la file. */
  title: string;
  /** Ce que l'action fera concrètement si elle est approuvée. */
  summary: string;
  /** Pourquoi l'agent le propose (contexte déclencheur) — sert à décider vite. */
  reason?: string;
  args?: Record<string, unknown>;
  category?: string;
  priority?: string;
  confidence?: number;
  sourceType?: string;
  /** Clé de déduplication: deux appels avec le même ref ne créent qu'une entrée. */
  sourceRef?: string;
  runId?: string;
}

export interface EnqueueResult {
  ok: boolean;
  /** Id créé, absent si dédupliqué ou refusé. */
  id?: number;
  /** true si une proposition identique était déjà en attente. */
  duplicate?: boolean;
  error?: string;
}

/**
 * Met une action en attente d'approbation humaine. À utiliser à la place de
 * tout appel direct qui produirait un effet réel depuis un contexte IA/cron.
 */
export async function enqueueProposal(input: EnqueueProposalInput): Promise<EnqueueResult> {
  try {
    const tool = getTool(input.toolName);
    if (!tool) {
      // Refus bruyant et immédiat: une proposition dont l'outil n'existe pas
      // serait inapprouvable, autant le signaler au producteur maintenant.
      logger.error({ toolName: input.toolName, orgId: input.orgId }, "[Queue] Outil inconnu, proposition refusée");
      return { ok: false, error: `Outil inconnu: ${input.toolName}` };
    }

    const parsed = validateArgs(tool.fields, input.args ?? {});
    if (!parsed.ok) {
      logger.error({ toolName: input.toolName, orgId: input.orgId, error: parsed.error }, "[Queue] Arguments invalides, proposition refusée");
      return { ok: false, error: parsed.error };
    }

    const sourceRef = (input.sourceRef ?? "").trim();
    if (sourceRef) {
      const [dup] = await db.select({ id: agentProposalsTable.id })
        .from(agentProposalsTable)
        .where(and(
          eq(agentProposalsTable.organisationId, input.orgId),
          eq(agentProposalsTable.status, "en_attente"),
          eq(agentProposalsTable.sourceRef, sourceRef),
        ))
        .limit(1);
      if (dup) return { ok: true, duplicate: true, id: dup.id };
    }

    const [row] = await db.insert(agentProposalsTable).values({
      organisationId: input.orgId,
      runId: input.runId ?? `auto-${new Date().toISOString().slice(0, 10)}`,
      toolName: input.toolName,
      title: input.title.slice(0, 300),
      summary: input.summary.slice(0, 2000),
      reason: (input.reason ?? "").slice(0, 2000),
      args: parsed.data as Record<string, unknown>,
      category: input.category ?? "autre",
      priority: input.priority ?? "moyenne",
      confidence: clampConfidence(input.confidence),
      sourceType: input.sourceType ?? "",
      sourceRef,
      status: "en_attente",
    }).returning({ id: agentProposalsTable.id });

    return { ok: true, id: row?.id };
  } catch (err) {
    // Fail-soft volontaire: l'appelant est souvent un cron multi-organisations,
    // une organisation en erreur ne doit pas interrompre les suivantes.
    logger.error({ err, orgId: input.orgId, toolName: input.toolName }, "[Queue] Échec mise en file");
    return { ok: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

/** Met en file plusieurs actions; continue même si l'une d'elles est refusée. */
export async function enqueueProposals(
  inputs: EnqueueProposalInput[],
): Promise<{ inserted: number; duplicates: number; failed: number }> {
  let inserted = 0, duplicates = 0, failed = 0;
  for (const input of inputs) {
    const res = await enqueueProposal(input);
    if (!res.ok) failed++;
    else if (res.duplicate) duplicates++;
    else inserted++;
  }
  return { inserted, duplicates, failed };
}

/**
 * Passe à `expiree` les propositions en attente trop anciennes. Le statut
 * existait dans le schéma mais rien ne le posait: une proposition jamais
 * traitée restait en file indéfiniment et polluait le badge. Une action
 * proposée il y a trois semaines n'est de toute façon plus pertinente —
 * mieux vaut la laisser être re-proposée avec un contexte à jour.
 */
export async function expireStaleProposals(olderThanDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  try {
    const rows = await db.update(agentProposalsTable)
      .set({ status: "expiree" })
      .where(and(
        eq(agentProposalsTable.status, "en_attente"),
        lt(agentProposalsTable.createdAt, cutoff),
      ))
      .returning({ id: agentProposalsTable.id });
    if (rows.length > 0) logger.info({ count: rows.length, olderThanDays }, "[Queue] Propositions expirées");
    return rows.length;
  } catch (err) {
    logger.error({ err }, "[Queue] Échec expiration des propositions");
    return 0;
  }
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
