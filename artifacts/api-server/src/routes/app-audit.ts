/**
 * Agent d'auto-audit — "Oto-Denetim Ajanı" (rapport + file d'approbation).
 *
 * Monté APRÈS requireTenant : toutes les routes sont déjà authentifiées et
 * scopées à l'organisation courante (getOrgId).
 *
 * L'agent inspecte l'application et produit des constats (eksik/yenilik). Les
 * constats actionnables créent en plus une proposition dans la file
 * d'approbation (agent_proposals) — rien n'est exécuté sans l'accord du patron.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { appAuditFindingsTable } from "@workspace/db/schema";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { runAuditForOrg } from "../services/app-audit";

const router: IRouter = Router();

const VALID_STATUSES = ["nouveau", "vu", "archive"] as const;
const VALID_KINDS = ["eksik", "yenilik"] as const;

/** Liste les constats de l'organisation (filtrable par kind et status). */
router.get("/app-audit/findings", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const kindParam = typeof req.query.kind === "string" ? req.query.kind : "all";
    const statusParam = typeof req.query.status === "string" ? req.query.status : "active";

    const conds = [eq(appAuditFindingsTable.organisationId, orgId)];
    if ((VALID_KINDS as readonly string[]).includes(kindParam)) {
      conds.push(eq(appAuditFindingsTable.kind, kindParam));
    }
    if (statusParam === "active") {
      conds.push(inArray(appAuditFindingsTable.status, ["nouveau", "vu"]));
    } else if ((VALID_STATUSES as readonly string[]).includes(statusParam)) {
      conds.push(eq(appAuditFindingsTable.status, statusParam));
    }

    const rows = await db.select().from(appAuditFindingsTable)
      .where(and(...conds))
      .orderBy(desc(appAuditFindingsTable.createdAt))
      .limit(limit);

    res.json({ findings: rows });
  } catch (err) {
    req.log.error({ err }, "Erreur liste constats d'audit");
    res.status(500).json({ error: "Erreur lors du chargement des constats" });
  }
});

/** Résumé chiffré pour le panneau (par kind / sévérité / actionnable). */
router.get("/app-audit/summary", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rows = await db.select({
      kind: appAuditFindingsTable.kind,
      severity: appAuditFindingsTable.severity,
      actionable: appAuditFindingsTable.actionable,
      n: sql<number>`count(*)::int`,
    })
      .from(appAuditFindingsTable)
      .where(and(
        eq(appAuditFindingsTable.organisationId, orgId),
        inArray(appAuditFindingsTable.status, ["nouveau", "vu"]),
      ))
      .groupBy(appAuditFindingsTable.kind, appAuditFindingsTable.severity, appAuditFindingsTable.actionable);

    let eksik = 0, yenilik = 0, actionable = 0, critique = 0, haute = 0;
    for (const r of rows) {
      if (r.kind === "eksik") eksik += r.n;
      if (r.kind === "yenilik") yenilik += r.n;
      if (r.actionable) actionable += r.n;
      if (r.severity === "critique") critique += r.n;
      if (r.severity === "haute") haute += r.n;
    }
    res.json({ total: eksik + yenilik, eksik, yenilik, actionable, critique, haute });
  } catch (err) {
    req.log.error({ err }, "Erreur résumé constats d'audit");
    res.status(500).json({ error: "Erreur lors du résumé" });
  }
});

/** Lance un audit à la demande. */
router.post("/app-audit/run-now", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const result = await runAuditForOrg(orgId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Erreur exécution audit");
    res.status(500).json({ error: "L'audit n'a pas pu être lancé" });
  }
});

/** Met à jour le statut d'un constat (vu / archive). */
router.patch("/app-audit/findings/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Identifiant invalide" }); return; }
    const status = typeof req.body?.status === "string" ? req.body.status : "";
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ error: "Statut invalide" }); return;
    }

    const updated = await db.update(appAuditFindingsTable)
      .set({ status })
      .where(and(
        eq(appAuditFindingsTable.id, id),
        eq(appAuditFindingsTable.organisationId, orgId),
      ))
      .returning({ id: appAuditFindingsTable.id });

    if (updated.length === 0) { res.status(404).json({ error: "Constat introuvable" }); return; }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Erreur mise à jour constat d'audit");
    res.status(500).json({ error: "Erreur lors de la mise à jour" });
  }
});

export default router;
