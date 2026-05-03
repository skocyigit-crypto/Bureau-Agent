import { Router } from "express";
import { getDataProtectionStatus } from "../services/data-protection-monitor";
import { requireRole } from "../middleware/auth";

const router = Router();

router.get("/data-protection/status", requireRole("super_admin", "administrateur"), async (req, res) => {
  try {
    const status = await getDataProtectionStatus();
    res.json(status);
  } catch (err: any) {
    req.log.error({ err }, "Erreur data protection status");
    res.status(500).json({ error: "Erreur lors de la recuperation du statut de protection." });
  }
});

export default router;
