import { Router } from "express";
import { getDataProtectionStatus } from "../services/data-protection-monitor";
import { requireRole } from "../middleware/auth";

const router = Router();

router.get("/data-protection/status", requireRole("super_admin", "administrateur"), async (_req, res) => {
  try {
    const status = await getDataProtectionStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
