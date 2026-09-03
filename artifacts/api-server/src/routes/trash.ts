import { Router, type Request, type Response } from "express";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";
import {
  TRASH_RETENTION_DAYS,
  listTrash,
  restoreFromTrash,
} from "../services/trash";

/**
 * La corbeille, cote HTTP.
 *
 * Ouverte a toute personne authentifiee de l'organisation, sans garde de role.
 * C'est deliberé et c'est le coeur du sujet: la restauration de sauvegarde
 * existante est reservee aux administrateurs, alors que celui qui supprime par
 * erreur est le plus souvent un utilisateur ordinaire. Une protection qu'il
 * faut demander a quelqu'un d'autre arrive trop tard.
 *
 * La portee est celle de l'organisation, pas celle de l'auteur: dans une
 * equipe, la personne qui s'apercoit de la perte n'est pas toujours celle qui
 * a clique. Le contenu reste borne au locataire — `getOrgId` vient de la
 * session, jamais de l'appelant.
 */
const router = Router();

router.get("/trash", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const entries = await listTrash(orgId);
    res.json({ entries, retentionDays: TRASH_RETENTION_DAYS });
  } catch (err) {
    logger.error({ err }, "[trash] lecture impossible");
    res.status(500).json({ error: "Erreur lors de la lecture de la corbeille." });
  }
});

router.post("/trash/:id/restore", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant invalide." }); return;
    }

    const outcome = await restoreFromTrash(orgId, id);
    if (outcome.ok) { res.json({ success: true }); return; }

    if (outcome.reason === "not_found") {
      res.status(404).json({ error: "Entree introuvable ou deja restauree." }); return;
    }
    if (outcome.reason === "table_not_restorable") {
      res.status(422).json({ error: "Ce type d'element ne peut pas etre restaure." }); return;
    }
    // L'echec le plus courant est un parent lui-meme supprime. Le dire, plutot
    // que de renvoyer une erreur generique: l'utilisateur peut alors restaurer
    // le parent d'abord, ce qui est la seule action qui debloque la situation.
    res.status(409).json({
      error:
        "Restauration impossible: un element dont celui-ci depend a peut-etre " +
        "ete supprime lui aussi. Restaurez-le d'abord, puis reessayez.",
    });
  } catch (err) {
    logger.error({ err }, "[trash] restauration impossible");
    res.status(500).json({ error: "Erreur lors de la restauration." });
  }
});

export default router;
