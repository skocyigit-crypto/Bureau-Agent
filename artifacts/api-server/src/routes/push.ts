// Enregistrement des appareils mobiles pour les notifications push distantes.
//
// Routes :
//   * POST /push/register    — l'app declare son jeton Expo (a chaque demarrage)
//   * POST /push/unregister  — deconnexion : l'appareil ne doit plus rien recevoir
//
// L'envoi lui-meme vit dans services/push-notifications.ts (branche sur le flux
// d'evenements interne, comme les webhooks sortants).

import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, pushTokensTable } from "@workspace/db";
import { resolveClientIp } from "../lib/request-ip";
import { requireTenant, getOrgId } from "../middleware/tenant";
import { zodErrorResponse } from "../lib/zod-error";

const router: IRouter = Router();

router.use("/push", requireTenant);

// Un client honnete enregistre son jeton une fois par demarrage d'app (plus
// une fois par rotation de jeton Expo, rare). 20/minute laisse largement la
// place aux retries hors-ligne tout en bornant l'ecriture en base.
const pushLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = req.session?.userId;
    return uid ? `u:${uid}` : `ip:${ipKeyGenerator(resolveClientIp(req))}`;
  },
  message: { error: "Trop d'enregistrements push. Reessayez dans une minute." },
});

// Le format Expo est stable et strict : le valider ici evite de remplir la
// table de valeurs qui seront de toute facon rejetees a l'envoi.
const PushTokenBody = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[^\]\s]{1,128}\]$/, "Jeton Expo invalide."),
  platform: z.enum(["ios", "android"]).optional(),
});

router.post("/push/register", pushLimiter, async (req, res): Promise<void> => {
  const parsed = PushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Session invalide." });
    return;
  }

  try {
    // Le jeton identifie l'APPAREIL, pas le compte : sur conflit on reecrit le
    // proprietaire. Sans cela, un telephone repris par un collegue (ou un
    // second compte sur le meme appareil) continuerait a recevoir les
    // notifications du compte precedent — fuite inter-utilisateurs, et
    // inter-organisations.
    await db
      .insert(pushTokensTable)
      .values({
        organisationId: orgId,
        userId,
        token: parsed.data.token,
        platform: parsed.data.platform ?? null,
      })
      .onConflictDoUpdate({
        target: pushTokensTable.token,
        set: {
          organisationId: orgId,
          userId,
          platform: parsed.data.platform ?? null,
          lastError: null,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur enregistrement jeton push");
    res.status(500).json({ error: "Erreur lors de l'enregistrement du jeton." });
  }
});

router.post("/push/unregister", pushLimiter, async (req, res): Promise<void> => {
  const parsed = PushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  const orgId = getOrgId(req);
  try {
    // Scope tenant explicite : un jeton ne peut etre supprime que depuis
    // l'organisation a laquelle il est rattache.
    await db
      .delete(pushTokensTable)
      .where(
        and(
          eq(pushTokensTable.token, parsed.data.token),
          eq(pushTokensTable.organisationId, orgId),
        ),
      );
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression jeton push");
    res.status(500).json({ error: "Erreur lors de la suppression du jeton." });
  }
});

export default router;
