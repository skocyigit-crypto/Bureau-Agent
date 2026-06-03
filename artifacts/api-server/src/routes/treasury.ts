import { Router, type IRouter, type Request, type Response } from "express";
import { db, treasurySettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { getOrgId } from "../middleware/tenant";
import { analyzeTreasuryRisk } from "../services/treasury-risk";
import { logAudit } from "./audit";

// ─────────────────────────────────────────────────────────────────────────────
// Trésorerie / Radar de risque (pilier BTP — couche client).
//
// Trois routes, toutes bornées à l'organisation du tenant (getOrgId) :
//   - GET  /treasury/settings  -> paramètres de trésorerie (ou défauts à 0).
//   - PUT  /treasury/settings  -> upsert solde caisse + charges fixes + autoliq.
//   - GET  /treasury/risk      -> analyse Monte Carlo 90 jours (calcul pur, 0 IA).
//
// Monté APRÈS requireTenant (fonctionnalité client, pas backoffice super-admin).
// ─────────────────────────────────────────────────────────────────────────────

const router: IRouter = Router();

const settingsSchema = z.object({
  currentCash: z.number().finite().min(0).max(1_000_000_000),
  monthlyFixedCosts: z.number().finite().min(0).max(1_000_000_000),
  defaultAutoliquidation: z.boolean().optional().default(false),
});

// GET /treasury/settings
router.get("/treasury/settings", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const [row] = await db
      .select()
      .from(treasurySettingsTable)
      .where(eq(treasurySettingsTable.organisationId, orgId))
      .limit(1);

    res.json({
      configured: !!row,
      currentCash: row ? Number(row.currentCash) : 0,
      monthlyFixedCosts: row ? Number(row.monthlyFixedCosts) : 0,
      defaultAutoliquidation: row ? row.defaultAutoliquidation : false,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "[treasury] lecture paramètres échouée");
    res.status(500).json({ error: "Impossible de lire les paramètres de trésorerie." });
  }
});

// PUT /treasury/settings
router.put("/treasury/settings", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Données invalides.", details: parsed.error.issues });
      return;
    }
    const { currentCash, monthlyFixedCosts, defaultAutoliquidation } = parsed.data;

    const [row] = await db
      .insert(treasurySettingsTable)
      .values({
        organisationId: orgId,
        currentCash: currentCash.toFixed(2),
        monthlyFixedCosts: monthlyFixedCosts.toFixed(2),
        defaultAutoliquidation,
      })
      .onConflictDoUpdate({
        target: treasurySettingsTable.organisationId,
        set: {
          currentCash: currentCash.toFixed(2),
          monthlyFixedCosts: monthlyFixedCosts.toFixed(2),
          defaultAutoliquidation,
          updatedAt: new Date(),
        },
      })
      .returning();

    await logAudit(
      req.session?.userId,
      req.session?.userEmail,
      "update",
      "treasury_settings",
      String(row.id),
      { currentCash, monthlyFixedCosts, defaultAutoliquidation },
      req.ip,
      req.headers["user-agent"],
      orgId,
    );

    res.json({
      configured: true,
      currentCash: Number(row.currentCash),
      monthlyFixedCosts: Number(row.monthlyFixedCosts),
      defaultAutoliquidation: row.defaultAutoliquidation,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    req.log.error({ err }, "[treasury] mise à jour paramètres échouée");
    res.status(500).json({ error: "Impossible d'enregistrer les paramètres de trésorerie." });
  }
});

// GET /treasury/risk
router.get("/treasury/risk", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const result = await analyzeTreasuryRisk(orgId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "[treasury] analyse de risque échouée");
    res.status(500).json({ error: "Impossible d'analyser le risque de trésorerie." });
  }
});

export default router;
