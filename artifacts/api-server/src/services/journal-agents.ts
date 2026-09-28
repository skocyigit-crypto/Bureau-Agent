/**
 * Journal d'execution des agents (tables agent_runs / agent_run_steps).
 *
 * Une execution s'ouvre `en_cours`, accumule ses etapes — chaque appel au
 * modele avec ses jetons et son cout, chaque decision, chaque action — et se
 * clot `terminee`, `echouee` (avec une cause lisible) ou `en_attente` quand
 * une action attend une approbation humaine. L'approbation, tranchee dans la
 * file (`executeProposal` / `rejectProposal`), revient clore l'execution : la
 * proposition porte `run_id = "agent-run:<id>"`.
 *
 * Les totaux (jetons, cout) sont incrementes par UPDATE ... SET x = x + n :
 * jamais relus puis reecrits, deux etapes simultanees ne s'ecrasent pas.
 */
import { db, agentRunsTable, agentRunStepsTable, agentProposalsTable } from "@workspace/db";
import { and, eq, lt, or, sql, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";

export const STATUTS_EXECUTION = ["en_cours", "en_attente", "terminee", "echouee"] as const;
export type StatutExecution = (typeof STATUTS_EXECUTION)[number];

export type TypeEtape = "llm" | "decision" | "outil" | "approbation" | "devolution";
export type StatutEtape = "ok" | "echec" | "en_attente" | "refuse";

export interface Consommation { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number }

export const ECHEC_ACTION_APPROUVEE = "Une action approuvee n'a pas pu etre executee.";

/** Reference d'une execution dans `agent_proposals.run_id`. */
export const refExecution = (runId: number): string => `agent-run:${runId}`;
export function runIdDeRef(ref: string | null | undefined): number | null {
  const m = /^agent-run:(\d+)$/.exec(String(ref ?? ""));
  return m ? Number(m[1]) : null;
}

export async function demarrerExecution(input: {
  orgId: number;
  agentId: string;
  trigger: string;
  entree: Record<string, unknown>;
  parentRunId?: number | null;
  requestedBy?: number | null;
}): Promise<number> {
  const [row] = await db.insert(agentRunsTable).values({
    organisationId: input.orgId,
    agentId: input.agentId,
    trigger: input.trigger,
    input: input.entree,
    parentRunId: input.parentRunId ?? null,
    requestedBy: input.requestedBy ?? null,
    status: "en_cours",
  }).returning({ id: agentRunsTable.id });
  return row!.id;
}

export async function ajouterEtape(runId: number, orgId: number, etape: {
  kind: TypeEtape;
  name: string;
  status: StatutEtape;
  detail?: Record<string, unknown>;
  usage?: Consommation;
  error?: string | null;
}): Promise<void> {
  const u = etape.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
  await db.insert(agentRunStepsTable).values({
    runId,
    organisationId: orgId,
    position: sql`(select coalesce(max(${agentRunStepsTable.position}), 0) + 1 from ${agentRunStepsTable} where ${agentRunStepsTable.runId} = ${runId})`,
    kind: etape.kind,
    name: etape.name,
    status: etape.status,
    detail: etape.detail ?? {},
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    costUsd: u.costUsd,
    durationMs: u.durationMs,
    error: etape.error ? etape.error.slice(0, 500) : null,
  });
  if (etape.usage) {
    await db.update(agentRunsTable).set({
      inputTokens: sql`${agentRunsTable.inputTokens} + ${u.inputTokens}`,
      outputTokens: sql`${agentRunsTable.outputTokens} + ${u.outputTokens}`,
      costUsd: sql`${agentRunsTable.costUsd} + ${u.costUsd}`,
    }).where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.organisationId, orgId)));
  }
}

export async function terminerExecution(runId: number, orgId: number, fin: {
  status: Exclude<StatutExecution, "en_cours">;
  output?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<void> {
  await db.update(agentRunsTable).set({
    status: fin.status,
    output: fin.output ?? null,
    error: fin.error ? fin.error.slice(0, 500) : null,
    // Une execution en attente n'est pas finie : elle le sera a la decision.
    finishedAt: fin.status === "en_attente" ? null : new Date(),
  }).where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.organisationId, orgId)));
}

export async function coutExecution(runId: number, orgId: number): Promise<number> {
  const [r] = await db.select({ c: agentRunsTable.costUsd }).from(agentRunsTable)
    .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.organisationId, orgId)));
  return r?.c ?? 0;
}

/**
 * Une proposition issue d'une execution vient d'etre tranchee : l'execution
 * le note, et se clot quand plus rien ne l'attend.
 *
 * Ne leve jamais : le journal suit la decision, il ne doit pas la faire
 * echouer.
 */
export async function noterDecisionApprobation(input: {
  orgId: number;
  proposalRunRef: string | null | undefined;
  proposalId: number;
  toolName: string;
  decision: "executee" | "echouee" | "rejetee" | "expiree";
  erreur?: string | null;
}): Promise<void> {
  const runId = runIdDeRef(input.proposalRunRef);
  if (runId == null) return;
  try {
    const [run] = await db.select({ id: agentRunsTable.id, status: agentRunsTable.status, error: agentRunsTable.error, parentRunId: agentRunsTable.parentRunId })
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.organisationId, input.orgId)));
    if (!run) return;
    // Une execution close par l'echec d'une action approuvee se reevalue si
    // l'action est rejouee (une proposition echouee reste rejouable). Toute
    // autre fin (erreur du modele, limite) est definitive.
    const reevaluable = run.status === "en_attente"
      || (run.status === "echouee" && run.error === ECHEC_ACTION_APPROUVEE);

    await ajouterEtape(runId, input.orgId, {
      kind: "approbation",
      name: input.toolName,
      status: input.decision === "executee" ? "ok" : input.decision === "rejetee" ? "refuse" : "echec",
      detail: { proposalId: input.proposalId, decision: input.decision },
      error: input.erreur ?? null,
    });

    const [{ restantes }] = await db.select({ restantes: sql<number>`count(*)::int` })
      .from(agentProposalsTable)
      .where(and(
        eq(agentProposalsTable.organisationId, input.orgId),
        eq(agentProposalsTable.runId, refExecution(runId)),
        eq(agentProposalsTable.status, "en_attente"),
      ));
    if (restantes > 0 || !reevaluable) return;

    // Plus rien n'attend : l'execution est finie. Elle echoue si une action
    // approuvee n'a pas pu s'executer ; un refus, lui, est une issue normale.
    const echecs = await db.select({ id: agentProposalsTable.id }).from(agentProposalsTable)
      .where(and(
        eq(agentProposalsTable.organisationId, input.orgId),
        eq(agentProposalsTable.runId, refExecution(runId)),
        eq(agentProposalsTable.status, "echouee"),
      ));
    const fin = echecs.length > 0
      ? { status: "echouee" as const, error: ECHEC_ACTION_APPROUVEE }
      : { status: "terminee" as const };
    await db.update(agentRunsTable).set({ status: fin.status, error: fin.error ?? null, finishedAt: new Date() })
      .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.organisationId, input.orgId)));
    // L'execution parente (le classificateur) attendait la meme decision :
    // elle suit, sinon le Bureau des taches la montrerait « en attente » sans fin.
    if (run.parentRunId != null) {
      await db.update(agentRunsTable).set({ status: fin.status, error: fin.error ?? null, finishedAt: new Date() })
        .where(and(
          eq(agentRunsTable.id, run.parentRunId),
          eq(agentRunsTable.organisationId, input.orgId),
          or(
            eq(agentRunsTable.status, "en_attente"),
            and(eq(agentRunsTable.status, "echouee"), eq(agentRunsTable.error, ECHEC_ACTION_APPROUVEE)),
          ),
        ));
    }
  } catch (err) {
    logger.error({ err, runId }, "[journal-agents] decision d'approbation non notee");
  }
}

/** Au-dela, une execution `en_cours` ne tourne plus : le processus est mort. */
export const DELAI_EXECUTION_INTERROMPUE_MS = 15 * 60 * 1000;

/**
 * Clot les executions restees `en_cours` trop longtemps. L'orchestrateur
 * travaille dans la requete (quelques secondes) ; au-dela du delai, le
 * processus a ete arrete (redemarrage, deploiement) et l'execution ne se
 * finira jamais. La dire « echouee, interrompue » vaut mieux qu'un « en
 * cours » eternel qui ferait croire que l'agent travaille encore.
 */
export async function marquerExecutionsInterrompues(orgId?: number): Promise<number> {
  const limite = new Date(Date.now() - DELAI_EXECUTION_INTERROMPUE_MS);
  const res = await db.update(agentRunsTable).set({
    status: "echouee",
    error: "Interrompue : le serveur s'est arrete pendant l'execution.",
    finishedAt: new Date(),
  }).where(and(
    eq(agentRunsTable.status, "en_cours"),
    lt(agentRunsTable.startedAt, limite),
    orgId != null ? eq(agentRunsTable.organisationId, orgId) : undefined,
  )).returning({ id: agentRunsTable.id });
  return res.length;
}

const RETENTION_JOURS = Number(process.env.AGENT_RUNS_RETENTION_DAYS ?? 180);

/**
 * Supprime les executions de plus de RETENTION_JOURS (etapes en cascade).
 * Meme duree que `ai_usage` : le journal resume des demandes entrantes, c'est
 * une donnee personnelle, pas une archive.
 */
export async function purgerExecutionsAnciennes(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_JOURS * 86400_000);
    const res = await db.delete(agentRunsTable).where(and(
      lt(agentRunsTable.startedAt, cutoff),
      inArray(agentRunsTable.status, ["terminee", "echouee"]),
    ));
    const n = (res as { rowCount?: number }).rowCount ?? 0;
    if (n > 0) logger.info(`[journal-agents] Purge : ${n} executions (>${RETENTION_JOURS}j)`);
    return n;
  } catch (err) {
    logger.error({ err }, "[journal-agents] Purge echouee");
    return 0;
  }
}
