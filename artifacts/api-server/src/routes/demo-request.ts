import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, organisationsTable, prospectsTable } from "@workspace/db";
import { sendEmail } from "../services/email";
import { broadcaster } from "../services/broadcaster";
import { logger } from "../lib/logger";
import { escapeHtml, escapeAttr } from "../lib/html-escape";

const SUPER_ADMIN_ORG_SLUG = "agent-de-bureau-sas";

async function getSuperAdminOrgId(): Promise<number | null> {
  const [row] = await db
    .select({ id: organisationsTable.id })
    .from(organisationsTable)
    .where(eq(organisationsTable.slug, SUPER_ADMIN_ORG_SLUG))
    .limit(1);
  return row?.id ?? null;
}

async function createProspectFromDemoRequest(payload: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company: string;
  employeeCount?: string;
  message?: string;
}): Promise<void> {
  const orgId = await getSuperAdminOrgId();
  if (!orgId) {
    logger.warn("[DemoRequest] Organisation super-admin introuvable, prospect non cree.");
    return;
  }

  const emailNorm = payload.email.trim().toLowerCase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [dup] = await db
    .select({ id: prospectsTable.id })
    .from(prospectsTable)
    .where(and(
      eq(prospectsTable.organisationId, orgId),
      eq(prospectsTable.source, "site_web"),
      sql`lower(${prospectsTable.email}) = ${emailNorm}`,
      gte(prospectsTable.createdAt, since),
    ))
    .limit(1);

  if (dup) {
    logger.info({ email: emailNorm, prospectId: dup.id }, "[DemoRequest] Prospect deja cree dans les 24h, deduplication.");
    return;
  }

  const fullName = `${payload.firstName} ${payload.lastName}`.trim();
  const noteParts: string[] = [];
  if (payload.employeeCount) noteParts.push(`Taille equipe: ${payload.employeeCount}`);
  if (payload.message) noteParts.push(`Message: ${payload.message}`);

  const [created] = await db.insert(prospectsTable).values({
    organisationId: orgId,
    title: `Demande de demo - ${payload.company}`,
    contactName: fullName || null,
    company: payload.company,
    email: emailNorm,
    phone: payload.phone?.trim() || null,
    stage: "nouveau",
    priority: "moyenne",
    source: "site_web",
    notes: noteParts.length > 0 ? noteParts.join("\n") : null,
  }).returning({ id: prospectsTable.id });

  logger.info({ prospectId: created?.id, email: emailNorm, company: payload.company }, "[DemoRequest] Prospect cree depuis le site vitrine.");

  if (created?.id) {
    setImmediate(() => {
      broadcaster.broadcast(orgId, {
        type: "prospect",
        action: "created",
        resourceId: created.id,
      });
    });
  }
}

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

    // Public endpoint — every interpolated field is attacker-controlled.
    // Escape into HTML body context (escapeHtml) and into attribute context
    // (escapeAttr / mailto link) separately. mailtoHref is a sanitised email
    // string used only inside an href quoted attribute; if email is somehow
    // not a real address we fall back to "#".
    const fnSafe = escapeHtml(firstName);
    const lnSafe = escapeHtml(lastName);
    const emailSafe = escapeHtml(email);
    const mailtoHref = /^[^@\s<>"']{1,254}@[^@\s<>"']{1,254}$/.test(String(email))
      ? `mailto:${escapeAttr(email)}`
      : "#";
    const phoneSafe = phone ? escapeHtml(phone) : "—";
    const companySafe = escapeHtml(company);
    const employeeCountSafe = employeeCount ? escapeHtml(employeeCount) : "—";
    const messageSafe = message ? escapeHtml(message) : "";
    const adminHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a2744; margin-bottom: 24px;">📅 Nouvelle demande de démonstration</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 160px;"><strong>Prénom</strong></td><td style="padding: 8px 0; color: #111827;">${fnSafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Nom</strong></td><td style="padding: 8px 0; color: #111827;">${lnSafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Email</strong></td><td style="padding: 8px 0; color: #111827;"><a href="${mailtoHref}">${emailSafe}</a></td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Téléphone</strong></td><td style="padding: 8px 0; color: #111827;">${phoneSafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Société</strong></td><td style="padding: 8px 0; color: #111827;">${companySafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Taille équipe</strong></td><td style="padding: 8px 0; color: #111827;">${employeeCountSafe}</td></tr>
          ${messageSafe ? `<tr><td style="padding: 8px 0; color: #6b7280;"><strong>Message</strong></td><td style="padding: 8px 0; color: #111827;">${messageSafe}</td></tr>` : ""}
        </table>
        <div style="margin-top: 24px; padding: 16px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #f59e0b;">
          <p style="margin: 0; color: #6b7280; font-size: 14px;">Répondre directement à : <a href="${mailtoHref}" style="color: #1a2744; font-weight: bold;">${emailSafe}</a></p>
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
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Bonjour <strong>${fnSafe}</strong>,</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Merci pour votre intérêt pour Agent de Bureau. Nous avons bien reçu votre demande de démonstration pour <strong>${companySafe}</strong>.
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
          SK GROUP • La plateforme de référence pour les bureaux français
        </p>
      </div>
    `;

    await sendEmail(adminEmail, `[Demo] Nouvelle demande — ${company} (${firstName} ${lastName})`, adminHtml, `Demande demo de ${firstName} ${lastName} <${email}> pour ${company}`);
    await sendEmail(email, "Votre demande de démonstration — Agent de Bureau", confirmHtml, `Bonjour ${firstName}, nous avons bien reçu votre demande de demo. Notre equipe vous contacte sous 24h.`);

    try {
      await createProspectFromDemoRequest({ firstName, lastName, email, phone, company, employeeCount, message });
    } catch (prospectErr: any) {
      logger.error({ err: prospectErr, email, company }, "[DemoRequest] Echec creation prospect (email envoye quand meme)");
    }

    logger.info({ email, company }, "[DemoRequest] Nouvelle demande de demo");
    res.status(200).json({ message: "Votre demande a ete envoyee. Nous vous recontactons sous 24h." });
  } catch (err: any) {
    logger.error({ err }, "[DemoRequest] Erreur envoi email");
    res.status(500).json({ error: "Erreur lors de l'envoi de la demande." });
  }
});

export default router;
