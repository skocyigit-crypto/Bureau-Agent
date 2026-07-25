// Remontee des plantages de l'application mobile.
//
// POST /api/client-errors  (non authentifie, fortement limite)
//
// POURQUOI NON AUTHENTIFIE : un plantage survient aussi (et surtout) avant la
// connexion — ecran de login, restauration de session, demarrage a froid. Exiger
// une session ferait disparaitre exactement les crashs les plus graves. Le
// compromis : rien n'est ecrit en base, on ne fait que journaliser (Cloud
// Logging) apres troncature stricte, avec un rate limit serre par IP.

import { Router, type IRouter } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { resolveClientIp } from "../lib/request-ip";
import { zodErrorResponse } from "../lib/zod-error";

const router: IRouter = Router();

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

// Un client honnete envoie 1 rapport par plantage, et un plantage au demarrage
// se repete au plus quelques fois avant que l'utilisateur n'abandonne.
// 10/heure/IP suffit largement et borne l'usage abusif de cet endpoint ouvert.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(resolveClientIp(req)),
  message: { error: "Trop de rapports d'erreur." },
});

const ClientErrorBody = z.object({
  message: z.string().min(1).max(MAX_MESSAGE),
  stack: z.string().max(MAX_STACK).optional(),
  platform: z.enum(["ios", "android", "web"]).optional(),
  appVersion: z.string().max(32).optional(),
});

router.post("/client-errors", reportLimiter, (req, res): void => {
  const parsed = ClientErrorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  const { message, stack, platform, appVersion } = parsed.data;
  // `warn` et non `error` : ce sont des donnees fournies par le client, non
  // verifiees — elles ne doivent pas declencher les alertes reservees aux
  // defaillances serveur reelles.
  req.log.warn(
    { clientCrash: true, platform, appVersion, stack },
    `[mobile] plantage signale: ${message}`,
  );
  // 204 : le client n'a rien a faire de la reponse, et un corps vide evite
  // qu'un rapport d'erreur ne coute plus cher que l'erreur elle-meme.
  res.status(204).end();
});

export default router;
