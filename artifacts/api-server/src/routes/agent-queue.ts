/**
 * File d'approbation de l'agent autonome — "Onay Kuyruğu".
 *
 * Monté APRÈS requireTenant : toutes les routes sont déjà authentifiées et
 * scopées à l'organisation courante (getOrgId).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { agentProposalsTable } from "@workspace/db/schema";
import { and, eq, desc, gte, inArray, sql } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import {
  proposeActionsForOrg,
  executeProposal,
  rejectProposal,
} from "../services/autonomous-secretary";
import { bumpProposalPreference } from "../services/ai-learning";
import { getTool, validateArgs } from "../services/assistant-tools";
import { getSaasTool } from "../services/saas-tools";

const router: IRouter = Router();

/** Mutations de la file (générer / approuver / rejeter) réservées aux administrateurs. */
const requireAdmin = requireRole("super_admin", "administrateur");

/**
 * Apprentissage: après une décision (approbation/rejet) sur une proposition,
 * recalcule la préférence apprise de sa catégorie. Fire-and-forget, fail-soft —
 * c'est ainsi que les agents apprennent ce que le patron valide ou refuse.
 */
function learnFromDecision(orgId: number, proposalId: number): void {
  void (async () => {
    try {
      const [p] = await db
        .select({ category: agentProposalsTable.category })
        .from(agentProposalsTable)
        .where(and(eq(agentProposalsTable.id, proposalId), eq(agentProposalsTable.organisationId, orgId)));
      if (p) await bumpProposalPreference(orgId, p.category);
    } catch {
      /* fail-soft: l'apprentissage ne doit jamais casser la décision */
    }
  })();
}

const VALID_STATUSES = ["en_attente", "approuvee", "rejetee", "executee", "echouee", "expiree"] as const;

/** Liste les propositions de l'organisation (par défaut: en attente). */
router.get("/agent-queue", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const statusParam = typeof req.query.status === "string" ? req.query.status : "en_attente";
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const conds = [eq(agentProposalsTable.organisationId, orgId)];
    if (statusParam !== "all" && (VALID_STATUSES as readonly string[]).includes(statusParam)) {
      conds.push(eq(agentProposalsTable.status, statusParam));
    }

    const rows = await db.select().from(agentProposalsTable)
      .where(and(...conds))
      .orderBy(desc(agentProposalsTable.createdAt))
      .limit(limit);

    res.json({ proposals: rows });
  } catch (err) {
    req.log.error({ err }, "Erreur liste file d'approbation");
    res.status(500).json({ error: "Erreur lors du chargement de la file" });
  }
});

/** Compte des propositions en attente (pour le badge). */
router.get("/agent-queue/count", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const [row] = await db.select({ n: sql<number>`count(*)::int` })
      .from(agentProposalsTable)
      .where(and(
        eq(agentProposalsTable.organisationId, orgId),
        eq(agentProposalsTable.status, "en_attente"),
      ));
    res.json({ pending: row?.n ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Erreur comptage file d'approbation");
    res.status(500).json({ error: "Erreur lors du comptage" });
  }
});

/**
 * Tableau de bord de supervision: ce qui attend une décision, et comment le
 * dirigeant a décidé jusqu'ici.
 *
 * Pourquoi: le compteur seul ("12 en attente") ne dit pas s'il faut s'y mettre
 * tout de suite ni si l'agent propose des choses utiles. Deux chiffres
 * changent la conduite: l'âge de la plus vieille proposition (une file qu'on
 * ne vide jamais finit par expirer en silence) et le taux d'approbation sur
 * 30 jours (un agent approuvé à 95 % mérite qu'on lui délègue plus; à 20 % il
 * faut corriger ses règles plutôt que cliquer "Rejeter" chaque matin).
 */
router.get("/agent-queue/stats", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [pendingRows, decidedRows] = await Promise.all([
      db.select({
        priority: agentProposalsTable.priority,
        category: agentProposalsTable.category,
        n: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${agentProposalsTable.createdAt})`,
      })
        .from(agentProposalsTable)
        .where(and(
          eq(agentProposalsTable.organisationId, orgId),
          eq(agentProposalsTable.status, "en_attente"),
        ))
        .groupBy(agentProposalsTable.priority, agentProposalsTable.category),
      db.select({
        status: agentProposalsTable.status,
        n: sql<number>`count(*)::int`,
      })
        .from(agentProposalsTable)
        .where(and(
          eq(agentProposalsTable.organisationId, orgId),
          gte(agentProposalsTable.createdAt, since),
        ))
        .groupBy(agentProposalsTable.status),
    ]);

    const byPriority: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let pending = 0;
    let oldestMs: number | null = null;
    for (const row of pendingRows) {
      pending += row.n;
      byPriority[row.priority] = (byPriority[row.priority] ?? 0) + row.n;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + row.n;
      const t = row.oldest ? new Date(row.oldest).getTime() : NaN;
      if (Number.isFinite(t) && (oldestMs === null || t < oldestMs)) oldestMs = t;
    }

    const byStatus: Record<string, number> = {};
    for (const row of decidedRows) byStatus[row.status] = row.n;
    // "Approuvée" recouvre l'approbation et son exécution réussie; "échouée"
    // reste comptée comme approuvée (l'humain avait dit oui — c'est l'outil
    // qui a échoué), sinon le taux mesurerait la fiabilité technique et non la
    // qualité du jugement de l'agent.
    const approved = (byStatus.approuvee ?? 0) + (byStatus.executee ?? 0) + (byStatus.echouee ?? 0);
    const rejected = byStatus.rejetee ?? 0;
    const decided = approved + rejected;

    res.json({
      pending,
      byPriority,
      byCategory,
      oldestPendingAgeDays: oldestMs === null
        ? null
        : Math.floor((Date.now() - oldestMs) / (24 * 60 * 60 * 1000)),
      last30d: {
        approved,
        rejected,
        expired: byStatus.expiree ?? 0,
        approvalRate: decided === 0 ? null : Math.round((approved / decided) * 100),
      },
    });
  } catch (err) {
    req.log.error({ err }, "Erreur statistiques file d'approbation");
    res.status(500).json({ error: "Erreur lors du chargement des statistiques" });
  }
});

/** Lance une génération de propositions à la demande. */
router.post("/agent-queue/run-now", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const result = await proposeActionsForOrg(orgId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Erreur génération propositions");
    res.status(500).json({ error: "Erreur lors de la génération des propositions" });
  }
});

/**
 * Modifie les arguments d'une proposition EN ATTENTE avant approbation —
 * permet a un humain de corriger le brouillon (ex: le texte d'un e-mail
 * genere par l'IA, cf. services/support-inbox.ts) avant qu'il ne soit
 * envoye. Revalide via le meme validateArgs que l'execution reelle pour ne
 * jamais stocker des arguments que l'outil rejetterait de toute facon.
 */
router.patch("/agent-queue/:id/args", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "id invalide" }); return; }

    const [proposal] = await db.select().from(agentProposalsTable)
      .where(and(eq(agentProposalsTable.id, id), eq(agentProposalsTable.organisationId, orgId)));
    if (!proposal) { res.status(404).json({ error: "Proposition introuvable" }); return; }
    if (proposal.status !== "en_attente") { res.status(409).json({ error: "Cette proposition a deja ete traitee" }); return; }

    // Les outils SaaS (cross-org) ont leurs champs dans un registre distinct;
    // on les reconnait aussi pour permettre l'edition des arguments avant
    // approbation, avec la meme validation.
    const tool = getTool(proposal.toolName) ?? getSaasTool(proposal.toolName);
    if (!tool) { res.status(400).json({ error: "Outil inconnu" }); return; }

    const parsed = validateArgs(tool.fields, req.body?.args);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }

    await db.update(agentProposalsTable)
      .set({ args: parsed.data })
      .where(and(eq(agentProposalsTable.id, id), eq(agentProposalsTable.organisationId, orgId)));

    res.json({ ok: true, args: parsed.data });
  } catch (err) {
    req.log.error({ err }, "Erreur modification arguments proposition");
    res.status(500).json({ error: "Erreur lors de la modification" });
  }
});

/** Approuve et exécute une proposition. */
router.post("/agent-queue/:id/approve", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "id invalide" }); return; }

    const result = await executeProposal(id, { orgId, userId });
    if (!result.ok && result.status === "echouee" && result.error === "Proposition introuvable") {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json(result);
    learnFromDecision(orgId, id);
  } catch (err) {
    req.log.error({ err }, "Erreur approbation proposition");
    res.status(500).json({ error: "Erreur lors de l'approbation" });
  }
});

/**
 * Décide plusieurs propositions d'un coup.
 *
 * Pourquoi: la supervision doit tenir dans une journée de travail. Les crons
 * produisent régulièrement une dizaine de propositions du même genre (relances
 * de factures, rappels de tâches en retard); les trancher une par une décourage
 * — et une file qu'on renonce à traiter expire en silence, ce qui revient à
 * laisser l'agent sans supervision.
 *
 * Choix délibérés:
 *  - les identifiants sont EXPLICITES (jamais "tout approuver par filtre"):
 *    l'humain a vu à l'écran ce qu'il valide, ce que la règle d'or exige;
 *  - exécution SÉQUENTIELLE: chaque approbation déclenche un effet réel
 *    (e-mail, SMS, facture) et consomme une connexion base — le parallélisme
 *    avait déjà saturé le pool en production (cf. services/cron-registry.ts);
 *  - lot borné: au-delà, l'appel dépasserait le délai d'attente HTTP.
 */
const BULK_MAX = 25;

router.post("/agent-queue/bulk-decide", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;

    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject") {
      res.status(400).json({ error: "decision doit valoir 'approve' ou 'reject'" });
      return;
    }

    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!rawIds || rawIds.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
    const ids = [...new Set(rawIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))];
    if (ids.length === 0) { res.status(400).json({ error: "ids invalides" }); return; }
    if (ids.length > BULK_MAX) {
      res.status(400).json({ error: `Maximum ${BULK_MAX} propositions par lot` });
      return;
    }

    const note = typeof req.body?.note === "string" ? req.body.note : undefined;

    // On ne traite que ce qui est RÉELLEMENT en attente dans CETTE organisation:
    // un identifiant d'une autre organisation ou déjà tranché est écarté ici,
    // avant tout effet, plutôt que de compter sur chaque exécuteur.
    const eligible = await db.select({ id: agentProposalsTable.id })
      .from(agentProposalsTable)
      .where(and(
        eq(agentProposalsTable.organisationId, orgId),
        eq(agentProposalsTable.status, "en_attente"),
        inArray(agentProposalsTable.id, ids),
      ));
    const eligibleIds = new Set(eligible.map((r) => r.id));

    const results: Array<{ id: number; ok: boolean; status?: string; error?: string }> = [];
    for (const id of ids) {
      if (!eligibleIds.has(id)) {
        results.push({ id, ok: false, error: "Proposition introuvable ou déjà traitée" });
        continue;
      }
      if (decision === "approve") {
        const r = await executeProposal(id, { orgId, userId });
        results.push({ id, ok: r.ok, status: r.status, error: r.ok ? undefined : r.error });
      } else {
        const ok = await rejectProposal(id, { orgId, userId }, note);
        results.push({ id, ok, status: ok ? "rejetee" : undefined, error: ok ? undefined : "Rejet impossible" });
      }
      // Même apprentissage que les décisions unitaires: un lot approuvé doit
      // peser sur les préférences apprises, sinon l'agent n'apprend plus rien
      // dès que le dirigeant utilise le mode groupé.
      learnFromDecision(orgId, id);
    }

    res.json({
      requested: ids.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    req.log.error({ err }, "Erreur décision groupée");
    res.status(500).json({ error: "Erreur lors de la décision groupée" });
  }
});

/** Rejette une proposition. */
router.post("/agent-queue/:id/reject", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "id invalide" }); return; }

    const note = typeof req.body?.note === "string"
      ? req.body.note
      : typeof req.body?.reason === "string"
        ? req.body.reason
        : undefined;
    const ok = await rejectProposal(id, { orgId, userId }, note);
    if (!ok) { res.status(404).json({ error: "Proposition introuvable ou déjà traitée" }); return; }
    res.json({ ok: true, status: "rejetee" });
    learnFromDecision(orgId, id);
  } catch (err) {
    req.log.error({ err }, "Erreur rejet proposition");
    res.status(500).json({ error: "Erreur lors du rejet" });
  }
});

export default router;
