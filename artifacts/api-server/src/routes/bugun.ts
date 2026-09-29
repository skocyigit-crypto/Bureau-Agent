/**
 * GET /bugun — la table de decision « Aujourd'hui » (services/masa-bugun.ts).
 * Bornee a l'organisation connectee ; lecture seule.
 */
import { Router, type IRouter } from "express";
import { getOrgId } from "../middleware/tenant";
import { construireMasaBugun } from "../services/masa-bugun";

const router: IRouter = Router();

router.get("/bugun", async (req, res): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    res.json(await construireMasaBugun(orgId));
  } catch (err) {
    req.log.error({ err }, "Erreur de la table Aujourd'hui");
    res.status(500).json({ error: "La table du jour n'a pas pu etre construite." });
  }
});

export default router;
