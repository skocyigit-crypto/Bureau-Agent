/**
 * File d'approbation de l'agent autonome — "Onay Kuyruğu".
 *
 * Monté APRÈS requireTenant : toutes les routes sont déjà authentifiées et
 * scopées à l'organisation courante (getOrgId).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { agentProposalsTable } from "@workspace/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import {
  proposeActionsForOrg,
  executeProposal,
  rejectProposal,
} from "../services/autonomous-secretary";

const router: IRouter = Router();

/** Mutations de la file (générer / approuver / rejeter) réservées aux administrateurs. */
const requireAdmin = requireRole("super_admin", "administrateur");

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
  } catch (err) {
    req.log.error({ err }, "Erreur approbation proposition");
    res.status(500).json({ error: "Erreur lors de l'approbation" });
  }
});

/** Rejette une proposition. */
router.post("/agent-queue/:id/reject", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId as number;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "id invalide" }); return; }

    const ok = await rejectProposal(id, { orgId, userId });
    if (!ok) { res.status(404).json({ error: "Proposition introuvable ou déjà traitée" }); return; }
    res.json({ ok: true, status: "rejetee" });
  } catch (err) {
    req.log.error({ err }, "Erreur rejet proposition");
    res.status(500).json({ error: "Erreur lors du rejet" });
  }
});

export default router;
