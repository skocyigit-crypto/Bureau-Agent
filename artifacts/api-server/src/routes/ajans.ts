/**
 * Agents : catalogue, bureau des taches, suivi et couts, nouvelle demande.
 *
 *   GET  /ajans/catalogue         ce que chaque agent peut lire et faire
 *   GET  /ajans/executions        executions de premier niveau, par statut
 *   GET  /ajans/executions/:id    detail : etapes, execution enfant, approbations
 *   GET  /ajans/couts             cout et jetons par agent sur la periode, quota
 *   POST /ajans/demandes          soumet une demande a l'orchestrateur
 *
 * Tout est borne a l'organisation de la session. Les couts sont reserves aux
 * responsables : ce sont des montants que l'entreprise paie.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, agentRunsTable, agentRunStepsTable, agentProposalsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { rateLimitKey } from "../lib/request-ip";
import { CATALOGUE_AGENTS } from "../services/catalogue-agents";
import { STATUTS_EXECUTION, marquerExecutionsInterrompues, refExecution } from "../services/journal-agents";
import { traiterDemande, CANAUX_DEMANDE } from "../services/orchestrateur";
import { executerFluxDemande, regleDemandeActive } from "../services/flux-demande";
import { getQuotaStatus } from "../services/ai-quota";

const router: IRouter = Router();
const requireResponsable = requireRole("super_admin", "administrateur");

// Chaque demande coute deux appels au modele : un plafond par personne
// empeche une boucle (ou un script) de vider le quota de l'entreprise.
const demandeLimiter = rateLimit({
  keyGenerator: rateLimitKey,
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de demandes soumises. Reessayez dans quelques minutes." },
});

router.get("/ajans/catalogue", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const depuis = new Date(Date.now() - 30 * 86400_000);
    const stats = await db.select({
      agentId: agentRunsTable.agentId,
      executions: sql<number>`count(*)::int`,
      echecs: sql<number>`count(*) filter (where ${agentRunsTable.status} = 'echouee')::int`,
      coutUsd: sql<number>`coalesce(sum(${agentRunsTable.costUsd}), 0)::float8`,
      derniere: sql<string | null>`max(${agentRunsTable.startedAt})`,
    }).from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), gte(agentRunsTable.startedAt, depuis)))
      .groupBy(agentRunsTable.agentId);
    const parAgent = new Map(stats.map((s) => [s.agentId, s]));
    res.json({
      agents: CATALOGUE_AGENTS.map((a) => ({
        ...a,
        activite30j: parAgent.get(a.id) ?? { agentId: a.id, executions: 0, echecs: 0, coutUsd: 0, derniere: null },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] catalogue");
    res.status(500).json({ error: "Catalogue indisponible." });
  }
});

router.get("/ajans/executions", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const statut = typeof req.query.statut === "string" ? req.query.statut : null;
    if (statut && !(STATUTS_EXECUTION as readonly string[]).includes(statut)) {
      res.status(400).json({ error: "Statut inconnu." });
      return;
    }
    const limite = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    // Une execution que le processus a abandonnee ne doit pas s'afficher
    // « en cours » : on la clot avant de lire.
    await marquerExecutionsInterrompues(orgId);

    const executions = await db.select().from(agentRunsTable)
      .where(and(
        eq(agentRunsTable.organisationId, orgId),
        isNull(agentRunsTable.parentRunId),
        statut ? eq(agentRunsTable.status, statut) : undefined,
      ))
      .orderBy(desc(agentRunsTable.startedAt))
      .limit(limite);

    const compteurs = await db.select({ status: agentRunsTable.status, n: sql<number>`count(*)::int` })
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), isNull(agentRunsTable.parentRunId)))
      .groupBy(agentRunsTable.status);

    // Agent specialiste de chaque execution (execution enfant), pour la liste.
    const ids = executions.map((e) => e.id);
    const enfants = ids.length
      ? await db.select({ parentRunId: agentRunsTable.parentRunId, agentId: agentRunsTable.agentId, costUsd: agentRunsTable.costUsd })
        .from(agentRunsTable)
        .where(and(eq(agentRunsTable.organisationId, orgId), inArray(agentRunsTable.parentRunId, ids)))
      : [];
    res.json({
      executions: executions.map((e) => {
        const enfant = enfants.find((c) => c.parentRunId === e.id);
        return { ...e, specialiste: enfant?.agentId ?? null, coutTotalUsd: e.costUsd + (enfant?.costUsd ?? 0) };
      }),
      compteurs: Object.fromEntries(STATUTS_EXECUTION.map((s) => [s, compteurs.find((c) => c.status === s)?.n ?? 0])),
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] executions");
    res.status(500).json({ error: "Executions indisponibles." });
  }
});

router.get("/ajans/executions/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Identifiant invalide." }); return; }
    const [execution] = await db.select().from(agentRunsTable)
      .where(and(eq(agentRunsTable.id, id), eq(agentRunsTable.organisationId, orgId)));
    if (!execution) { res.status(404).json({ error: "Execution introuvable." }); return; }

    const enfants = await db.select().from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), eq(agentRunsTable.parentRunId, id)))
      .orderBy(asc(agentRunsTable.id));
    const toutes = [execution, ...enfants];
    const etapes = await db.select().from(agentRunStepsTable)
      .where(and(eq(agentRunStepsTable.organisationId, orgId), inArray(agentRunStepsTable.runId, toutes.map((r) => r.id))))
      .orderBy(asc(agentRunStepsTable.runId), asc(agentRunStepsTable.position));
    const approbations = await db.select({
      id: agentProposalsTable.id, toolName: agentProposalsTable.toolName, title: agentProposalsTable.title,
      status: agentProposalsTable.status, runId: agentProposalsTable.runId,
    }).from(agentProposalsTable)
      .where(and(
        eq(agentProposalsTable.organisationId, orgId),
        inArray(agentProposalsTable.runId, toutes.map((r) => refExecution(r.id))),
      ));

    res.json({
      execution: { ...execution, etapes: etapes.filter((e) => e.runId === execution.id) },
      enfants: enfants.map((c) => ({ ...c, etapes: etapes.filter((e) => e.runId === c.id) })),
      approbations,
      coutTotalUsd: toutes.reduce((s, r) => s + r.costUsd, 0),
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] detail");
    res.status(500).json({ error: "Execution indisponible." });
  }
});

router.get("/ajans/couts", requireResponsable, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const jours = Math.min(Math.max(Number(req.query.jours) || 30, 1), 180);
    const depuis = new Date(Date.now() - jours * 86400_000);
    const parAgent = await db.select({
      agentId: agentRunsTable.agentId,
      executions: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${agentRunsTable.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${agentRunsTable.outputTokens}), 0)::int`,
      coutUsd: sql<number>`coalesce(sum(${agentRunsTable.costUsd}), 0)::float8`,
    }).from(agentRunsTable)
      .where(and(eq(agentRunsTable.organisationId, orgId), gte(agentRunsTable.startedAt, depuis)))
      .groupBy(agentRunsTable.agentId);
    const quota = await getQuotaStatus(orgId);
    res.json({
      jours,
      parAgent: parAgent.map((p) => ({
        ...p,
        limiteParExecutionUsd: CATALOGUE_AGENTS.find((a) => a.id === p.agentId)?.limites?.coutMaxUsdParExecution ?? null,
      })),
      totalUsd: parAgent.reduce((s, p) => s + p.coutUsd, 0),
      quotaMensuel: quota,
    });
  } catch (err) {
    req.log.error({ err }, "[ajans] couts");
    res.status(500).json({ error: "Couts indisponibles." });
  }
});

const CorpsDemande = z.object({
  canal: z.enum(CANAUX_DEMANDE),
  expediteur: z.object({
    nom: z.string().trim().max(120).optional().nullable(),
    email: z.string().trim().email().max(200).optional().nullable(),
  }),
  sujet: z.string().trim().max(300).optional().nullable(),
  contenu: z.string().trim().min(1).max(8000),
});

router.post("/ajans/demandes", demandeLimiter, async (req: Request, res: Response): Promise<void> => {
  const lu = CorpsDemande.safeParse(req.body);
  if (!lu.success) {
    res.status(400).json({ error: "Demande invalide.", champs: lu.error.issues.map((i) => i.path.join(".")) });
    return;
  }
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;
    // Le flux « Nouvelle demande » de l'organisation, s'il est actif ; sinon
    // le routage par defaut (classificateur → support / vente).
    const regle = await regleDemandeActive(orgId);
    const resultat = regle
      ? await executerFluxDemande(orgId, userId, regle, lu.data)
      : await traiterDemande(orgId, userId, lu.data);
    res.status(201).json(resultat);
  } catch (err) {
    req.log.error({ err }, "[ajans] demande");
    res.status(500).json({ error: "La demande n'a pas pu etre traitee." });
  }
});

export default router;
