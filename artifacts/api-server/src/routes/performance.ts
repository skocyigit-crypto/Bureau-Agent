import { Router, type IRouter } from "express";
import { generatePerformanceReport, getPerformanceHistory, gatherUserMetrics } from "../services/performance-analyzer";

const router: IRouter = Router();

router.get("/performance/metriques", async (req, res): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const orgId = (req.session as any)?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  const periode = (req.query.periode as string) || "semaine";
  const now = new Date();
  let dateDebut: Date;

  if (periode === "jour") {
    dateDebut = new Date(now);
    dateDebut.setHours(0, 0, 0, 0);
  } else if (periode === "mois") {
    dateDebut = new Date(now);
    dateDebut.setMonth(dateDebut.getMonth() - 1);
  } else {
    dateDebut = new Date(now);
    dateDebut.setDate(dateDebut.getDate() - 7);
  }

  try {
    const metriques = await gatherUserMetrics(dateDebut, now, orgId);
    res.json({ metriques, dateDebut: dateDebut.toISOString(), dateFin: now.toISOString(), periode });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur lors de la collecte des metriques." });
  }
});

router.post("/performance/rapport", async (req, res): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const orgId = (req.session as any)?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  const { periode, employeId } = req.body || {};
  const validPeriodes = ["jour", "semaine", "mois"];
  const p = validPeriodes.includes(periode) ? periode : "semaine";

  try {
    const rapport = await generatePerformanceReport(p, orgId, employeId || undefined);
    res.json(rapport);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur lors de la generation du rapport." });
  }
});

router.get("/performance/historique", async (req, res): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const orgId = (req.session as any)?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const historique = await getPerformanceHistory(limit, orgId);
    res.json({ historique });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur lors de la recuperation de l'historique." });
  }
});

export default router;
