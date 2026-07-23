/**
 * Webhook d'entree pour les e-mails de support/contact.
 *
 * Recoit les e-mails transmis par un Cloudflare Email Worker (Cloudflare
 * Email Routing n'offre pas de webhook HTTP natif — le Worker lit l'e-mail
 * brut et le POST ici). Authentifie par secret partage (pas de signature
 * vendor disponible pour ce chemin, contrairement a Twilio/Stripe) verifie
 * en temps constant, refuse fermee si le secret n'est pas configure.
 *
 * Le traitement (classification IA + brouillon + depot en file d'approbation)
 * se fait en arriere-plan (fire-and-forget) — la route repond immediatement
 * pour que le Worker ne timeout jamais, meme pattern que les webhooks Twilio/
 * WhatsApp deja fail-soft dans ce fichier de routes.
 */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { resolveClientIp, rateLimitKey } from "../lib/request-ip";
import { logger } from "../lib/logger";
import { processIncomingSupportEmail } from "../services/support-inbox";

const router = Router();

const MAX_TEXT_LEN = 50_000;

function isValidWebhookSecret(req: Request): boolean {
  const expected = process.env.SUPPORT_INBOX_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = req.headers["x-support-inbox-secret"];
  if (typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const incomingLimiter = rateLimit({
  keyGenerator: rateLimitKey,
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/support-inbox/incoming", incomingLimiter, (req: Request, res: Response): void => {
  if (!isValidWebhookSecret(req)) {
    logger.warn({ ip: resolveClientIp(req) }, "[support-inbox] Secret webhook invalide ou absent — requete refusee");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const from = typeof body?.from === "string" ? body.from.trim() : "";
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 500) : "(sans sujet)";
  const text = typeof body?.text === "string" ? body.text.slice(0, MAX_TEXT_LEN) : "";
  const messageId = typeof body?.messageId === "string" && body.messageId.trim()
    ? body.messageId.trim()
    : `${from}-${Date.now()}`;
  const fromName = typeof body?.fromName === "string" ? body.fromName.trim().slice(0, 200) : null;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(from) || !text) {
    res.status(400).json({ error: "from (e-mail valide) et text sont requis" });
    return;
  }

  // Reponse immediate: le traitement IA se fait en arriere-plan pour ne
  // jamais faire attendre le Worker (qui doit decider vite du routage SMTP).
  res.status(202).json({ accepted: true });

  void processIncomingSupportEmail({ from, fromName, to, subject, text, messageId });
});

export default router;
