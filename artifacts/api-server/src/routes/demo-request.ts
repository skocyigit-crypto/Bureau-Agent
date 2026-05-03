import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { sendEmail } from "../services/email";
import { logger } from "../lib/logger";

const router = Router();

const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Trop de demandes. Reessayez dans une heure." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/public/demo-request", demoLimiter, async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, email, phone, company, employeeCount, message } = req.body;

  if (!firstName || !lastName || !email || !company) {
    res.status(400).json({ error: "Prenom, nom, email et societe sont obligatoires." });
    return;
  }

  if (!email.includes("@")) {
    res.status(400).json({ error: "Adresse email invalide." });
    return;
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@agentdebureau.fr";

    const adminHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a2744; margin-bottom: 24px;">📅 Nouvelle demande de démonstration</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 160px;"><strong>Prénom</strong></td><td style="padding: 8px 0; color: #111827;">${firstName}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Nom</strong></td><td style="padding: 8px 0; color: #111827;">${lastName}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Email</strong></td><td style="padding: 8px 0; color: #111827;"><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Téléphone</strong></td><td style="padding: 8px 0; color: #111827;">${phone || "—"}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Société</strong></td><td style="padding: 8px 0; color: #111827;">${company}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Taille équipe</strong></td><td style="padding: 8px 0; color: #111827;">${employeeCount || "—"}</td></tr>
          ${message ? `<tr><td style="padding: 8px 0; color: #6b7280;"><strong>Message</strong></td><td style="padding: 8px 0; color: #111827;">${message}</td></tr>` : ""}
        </table>
        <div style="margin-top: 24px; padding: 16px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #f59e0b;">
          <p style="margin: 0; color: #6b7280; font-size: 14px;">Répondre directement à : <a href="mailto:${email}" style="color: #1a2744; font-weight: bold;">${email}</a></p>
        </div>
      </div>
    `;

    const confirmHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 64px; height: 64px; background: #1a2744; border-radius: 16px; margin: 0 auto 16px;">
            <span style="color: white; font-size: 28px; line-height: 64px; display: block;">📞</span>
          </div>
          <h1 style="color: #1a2744; font-size: 24px; margin: 0;">Demande bien reçue !</h1>
        </div>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Bonjour <strong>${firstName}</strong>,</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Merci pour votre intérêt pour Agent de Bureau. Nous avons bien reçu votre demande de démonstration pour <strong>${company}</strong>.
        </p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Notre équipe vous contactera dans les <strong>24 heures ouvrées</strong> pour planifier une session personnalisée selon vos besoins.
        </p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <h3 style="color: #1a2744; margin: 0 0 12px;">En attendant, démarrez votre essai gratuit</h3>
          <p style="color: #6b7280; margin: 0 0 16px; font-size: 14px;">14 jours d'accès complet, sans carte bancaire.</p>
          <a href="/register" style="display: inline-block; background: #f59e0b; color: #1a2744; font-weight: bold; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
            Démarrer l'essai gratuit →
          </a>
        </div>
        <p style="color: #9ca3af; font-size: 13px; border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 24px;">
          Agent de Bureau SAS • La plateforme de référence pour les bureaux français
        </p>
      </div>
    `;

    await sendEmail(adminEmail, `[Demo] Nouvelle demande — ${company} (${firstName} ${lastName})`, adminHtml, `Demande demo de ${firstName} ${lastName} <${email}> pour ${company}`);
    await sendEmail(email, "Votre demande de démonstration — Agent de Bureau", confirmHtml, `Bonjour ${firstName}, nous avons bien reçu votre demande de demo. Notre equipe vous contacte sous 24h.`);

    logger.info({ email, company }, "[DemoRequest] Nouvelle demande de demo");
    res.status(200).json({ message: "Votre demande a ete envoyee. Nous vous recontactons sous 24h." });
  } catch (err: any) {
    logger.error({ err }, "[DemoRequest] Erreur envoi email");
    res.status(500).json({ error: "Erreur lors de l'envoi de la demande." });
  }
});

export default router;
