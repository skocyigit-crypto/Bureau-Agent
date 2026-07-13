import { Router, type IRouter } from "express";
import { generatePerformanceReport, getPerformanceHistory, gatherUserMetrics } from "../services/performance-analyzer";

const router: IRouter = Router();

router.get("/performance/metriques", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const orgId = req.session?.organisationId;
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
    req.log.error({ err }, "Erreur collecte metriques");
    res.status(500).json({ error: "Erreur lors de la collecte des metriques." });
  }
});

router.post("/performance/rapport", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const orgId = req.session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  const { periode, employeId } = req.body || {};
  const validPeriodes = ["jour", "semaine", "mois"];
  const p = validPeriodes.includes(periode) ? periode : "semaine";

  try {
    const rapport = await generatePerformanceReport(p, orgId, employeId || undefined);
    res.json(rapport);
  } catch (err: any) {
    req.log.error({ err }, "Erreur generation rapport performance");
    res.status(500).json({ error: "Erreur lors de la generation du rapport." });
  }
});

router.get("/performance/historique", async (req, res): Promise<void> => {
  const userId = req.session?.userId;
  const orgId = req.session?.organisationId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const historique = await getPerformanceHistory(limit, orgId);
    res.json({ historique });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation historique performance");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'historique." });
  }
});

router.get("/performance/metriques/export/csv", async (req, res): Promise<void> => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (!orgId) { res.status(403).json({ error: "Organisation non definie." }); return; }
  const periode = (req.query.periode as string) || "semaine";
  try {
    const now = new Date();
    const dateDebut = new Date(now);
    if (periode === "jour") dateDebut.setDate(now.getDate() - 1);
    else if (periode === "mois") dateDebut.setMonth(now.getMonth() - 1);
    else dateDebut.setDate(now.getDate() - 7);
    const metriques = await gatherUserMetrics(dateDebut, now, orgId);
    const escape = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s; };
    const headers = ["Employé", "Appels", "Durée moy. (min)", "Taux réponse (%)", "Tâches terminées", "Score performance", "Niveau"];
    const lines = [headers.join(","), ...metriques.map((m: any) => [
      escape(m.userName || m.userEmail), escape(m.callCount), escape(m.avgDuration),
      escape(m.answerRate), escape(m.tasksCompleted), escape(m.performanceScore), escape(m.performanceLevel),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="performance_${periode}_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export performance CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

export default router;
