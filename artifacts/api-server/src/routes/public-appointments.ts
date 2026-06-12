import { Router, type Request, type Response } from "express";
import { getPublicOffer, confirmOfferSelection } from "../services/appointment-offers";

/**
 * Routes PUBLIQUES de selection de rendez-vous (aucune authentification).
 * Montees AVANT `requireAuth` dans routes/index.ts. Le `token` non devinable
 * (24 octets) sert de capability — pas de scope tenant ici.
 */
const router = Router();

router.get("/appointments/offer/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token || "");
  if (!token) {
    res.status(400).json({ error: "Token manquant." });
    return;
  }
  try {
    const offer = await getPublicOffer(token);
    if (!offer) {
      res.status(404).json({ error: "Offre introuvable." });
      return;
    }
    res.json({ offer });
  } catch (err) {
    req.log.error({ err }, "[public-appointments] lecture offre echouee");
    res.status(500).json({ error: "Erreur lors de la lecture de l'offre." });
  }
});

router.post("/appointments/offer/:token/select", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token || "");
  const slotIndex = Number(req.body?.slotIndex);
  if (!token) {
    res.status(400).json({ error: "Token manquant." });
    return;
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0) {
    res.status(400).json({ error: "Creneau invalide." });
    return;
  }
  try {
    const result = await confirmOfferSelection(token, slotIndex);
    if (!result.ok) {
      const statusByCode: Record<string, number> = {
        not_found: 404,
        invalid_slot: 400,
        expired: 410,
        already: 409,
        conflict: 409,
      };
      res.status(statusByCode[result.code] ?? 400).json({ error: result.message, code: result.code });
      return;
    }
    res.json({ success: true, slot: result.slot });
  } catch (err) {
    req.log.error({ err }, "[public-appointments] confirmation offre echouee");
    res.status(500).json({ error: "Erreur lors de la confirmation du rendez-vous." });
  }
});

export default router;
