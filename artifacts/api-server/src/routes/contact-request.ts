import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, organisationsTable, prospectsTable } from "@workspace/db";
import { sendEmail } from "../services/email";
import { sendSms } from "../services/telephony-providers";
import { logger } from "../lib/logger";
import { escapeHtml, escapeAttr } from "../lib/html-escape";

const SUPER_ADMIN_ORG_SLUG = "agent-de-bureau-sas";

type ContactKind = "rappel" | "devis";

interface ContactPayload {
  kind: ContactKind;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company: string;
  employeeCount?: string;
  budget?: string;
  message?: string;
}

const KIND_META: Record<ContactKind, {
  label: string;
  source: string;
  priority: "haute" | "moyenne";
  emoji: string;
  adminSubject: (p: ContactPayload) => string;
  confirmSubject: string;
  confirmTitle: string;
  confirmBody: (firstName: string, company: string) => string;
  prospectTitle: (company: string) => string;
}> = {
  rappel: {
    label: "Demande de rappel téléphonique",
    source: "site_web_rappel",
    priority: "haute",
    emoji: "📞",
    adminSubject: (p) => `[Rappel] ${p.company} — ${p.firstName} ${p.lastName}`,
    confirmSubject: "Votre demande de rappel — Agent de Bureau",
    confirmTitle: "Nous vous rappelons très bientôt !",
    confirmBody: (firstName, company) =>
      `Bonjour <strong>${firstName}</strong>,<br/><br/>Merci pour votre intérêt pour Agent de Bureau. Nous avons bien reçu votre demande de rappel pour <strong>${company}</strong>. Notre équipe vous contactera par téléphone dans les <strong>2 heures ouvrées</strong>.`,
    prospectTitle: (company) => `Rappel téléphonique — ${company}`,
  },
  devis: {
    label: "Demande de devis sur mesure",
    source: "site_web_devis",
    priority: "moyenne",
    emoji: "📄",
    adminSubject: (p) => `[Devis] ${p.company} — ${p.firstName} ${p.lastName}`,
    confirmSubject: "Votre demande de devis — Agent de Bureau",
    confirmTitle: "Demande de devis bien reçue !",
    confirmBody: (firstName, company) =>
      `Bonjour <strong>${firstName}</strong>,<br/><br/>Merci pour votre intérêt pour Agent de Bureau. Nous avons bien reçu votre demande de devis sur mesure pour <strong>${company}</strong>. Notre équipe commerciale vous enverra une proposition personnalisée sous <strong>24 heures ouvrées</strong>.`,
    prospectTitle: (company) => `Devis sur mesure — ${company}`,
  },
};

async function getSuperAdminOrgId(): Promise<number | null> {
  const [row] = await db
    .select({ id: organisationsTable.id })
    .from(organisationsTable)
    .where(eq(organisationsTable.slug, SUPER_ADMIN_ORG_SLUG))
    .limit(1);
  return row?.id ?? null;
}

async function createProspectFromContactRequest(payload: ContactPayload): Promise<void> {
  const orgId = await getSuperAdminOrgId();
  if (!orgId) {
    logger.warn("[ContactRequest] Organisation super-admin introuvable, prospect non cree.");
    return;
  }

  const meta = KIND_META[payload.kind];
  const emailNorm = payload.email.trim().toLowerCase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [dup] = await db
    .select({ id: prospectsTable.id })
    .from(prospectsTable)
    .where(and(
      eq(prospectsTable.organisationId, orgId),
      eq(prospectsTable.source, meta.source),
      sql`lower(${prospectsTable.email}) = ${emailNorm}`,
      gte(prospectsTable.createdAt, since),
    ))
    .limit(1);

  if (dup) {
    logger.info({ email: emailNorm, prospectId: dup.id, kind: payload.kind }, "[ContactRequest] Prospect deja cree dans les 24h, deduplication.");
    return;
  }

  const fullName = `${payload.firstName} ${payload.lastName}`.trim();
  const noteParts: string[] = [];
  if (payload.employeeCount) noteParts.push(`Taille equipe: ${payload.employeeCount}`);
  if (payload.budget) noteParts.push(`Budget indicatif: ${payload.budget}`);
  if (payload.message) noteParts.push(`Message: ${payload.message}`);

  const [created] = await db.insert(prospectsTable).values({
    organisationId: orgId,
    title: meta.prospectTitle(payload.company),
    contactName: fullName || null,
    company: payload.company,
    email: emailNorm,
    phone: payload.phone?.trim() || null,
    stage: "nouveau",
    priority: meta.priority,
    source: meta.source,
    notes: noteParts.length > 0 ? noteParts.join("\n") : null,
  }).returning({ id: prospectsTable.id });

  logger.info({ prospectId: created?.id, email: emailNorm, company: payload.company, kind: payload.kind }, "[ContactRequest] Prospect cree depuis le site vitrine.");
}

function shouldSendAdminSms(kind: ContactKind): boolean {
  if (kind === "rappel") return true;
  // Opt-in pour les devis via env var
  const flag = (process.env.ADMIN_SMS_ON_DEVIS || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

async function sendAdminSmsAlert(payload: ContactPayload): Promise<void> {
  if (!shouldSendAdminSms(payload.kind)) return;

  const adminPhone = (process.env.ADMIN_PHONE || "").trim();
  if (!adminPhone) {
    logger.warn({ kind: payload.kind }, "[ContactRequest] ADMIN_PHONE non configure, SMS ignore.");
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    logger.warn({ kind: payload.kind }, "[ContactRequest] Configuration Twilio incomplete, SMS admin ignore.");
    return;
  }

  const meta = KIND_META[payload.kind];
  const fullName = `${payload.firstName} ${payload.lastName}`.trim();
  const phonePart = payload.phone ? ` Tel: ${payload.phone}` : "";
  const body = payload.kind === "rappel"
    ? `[Agent de Bureau] Rappel URGENT - ${fullName} (${payload.company}).${phonePart} A rappeler sous 2h.`
    : `[Agent de Bureau] ${meta.label} - ${fullName} (${payload.company}).${phonePart}`;

  const result = await sendSms(
    "twilio",
    { accountSid, authToken, fromNumber },
    { to: adminPhone, body: body.slice(0, 320) },
  );

  if (!result.success) {
    logger.error({ kind: payload.kind, error: result.error, to: adminPhone }, "[ContactRequest] SMS admin echoue");
    return;
  }
  logger.info({ kind: payload.kind, messageSid: result.messageSid, to: adminPhone }, "[ContactRequest] SMS admin envoye");
}

const router = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Trop de demandes. Reessayez dans une heure." },
  standardHeaders: true,
  legacyHeaders: false,
});

const trimOrUndefined = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
};

router.post("/public/contact-request", contactLimiter, async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { kind } = body;

  if (kind !== "rappel" && kind !== "devis") {
    res.status(400).json({ error: "Type de demande invalide." });
    return;
  }

  const firstName = trimOrUndefined(body.firstName);
  const lastName = trimOrUndefined(body.lastName);
  const email = trimOrUndefined(body.email);
  const company = trimOrUndefined(body.company);
  const phone = trimOrUndefined(body.phone);
  const employeeCount = trimOrUndefined(body.employeeCount);
  const budget = trimOrUndefined(body.budget);
  const message = trimOrUndefined(body.message);

  if (!firstName || !lastName || !email || !company) {
    res.status(400).json({ error: "Prenom, nom, email et societe sont obligatoires." });
    return;
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Adresse email invalide." });
    return;
  }

  if (kind === "rappel" && !phone) {
    res.status(400).json({ error: "Le numero de telephone est obligatoire pour une demande de rappel." });
    return;
  }

  const meta = KIND_META[kind];
  const payload: ContactPayload = {
    kind,
    firstName,
    lastName,
    email,
    phone,
    company,
    employeeCount,
    budget,
    message,
  };

  try {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@agentdebureau.fr";

    const fnSafe = escapeHtml(payload.firstName);
    const lnSafe = escapeHtml(payload.lastName);
    const emailSafe = escapeHtml(payload.email);
    const mailtoHref = /^[^@\s<>"']{1,254}@[^@\s<>"']{1,254}$/.test(payload.email)
      ? `mailto:${escapeAttr(payload.email)}`
      : "#";
    const phoneSafe = payload.phone ? escapeHtml(payload.phone) : "—";
    const companySafe = escapeHtml(payload.company);
    const employeeCountSafe = payload.employeeCount ? escapeHtml(payload.employeeCount) : "—";
    const budgetSafe = payload.budget ? escapeHtml(payload.budget) : "—";
    const messageSafe = payload.message ? escapeHtml(payload.message) : "";

    const accent = kind === "rappel" ? "#ef4444" : "#f59e0b";

    const adminHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a2744; margin-bottom: 24px;">${meta.emoji} ${meta.label}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #6b7280; width: 160px;"><strong>Prénom</strong></td><td style="padding: 8px 0; color: #111827;">${fnSafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Nom</strong></td><td style="padding: 8px 0; color: #111827;">${lnSafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Email</strong></td><td style="padding: 8px 0; color: #111827;"><a href="${mailtoHref}">${emailSafe}</a></td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Téléphone</strong></td><td style="padding: 8px 0; color: #111827;">${phoneSafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Société</strong></td><td style="padding: 8px 0; color: #111827;">${companySafe}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;"><strong>Taille équipe</strong></td><td style="padding: 8px 0; color: #111827;">${employeeCountSafe}</td></tr>
          ${kind === "devis" ? `<tr><td style="padding: 8px 0; color: #6b7280;"><strong>Budget indicatif</strong></td><td style="padding: 8px 0; color: #111827;">${budgetSafe}</td></tr>` : ""}
          ${messageSafe ? `<tr><td style="padding: 8px 0; color: #6b7280;"><strong>Message</strong></td><td style="padding: 8px 0; color: #111827;">${messageSafe}</td></tr>` : ""}
        </table>
        <div style="margin-top: 24px; padding: 16px; background: #f9fafb; border-radius: 8px; border-left: 4px solid ${accent};">
          <p style="margin: 0; color: #6b7280; font-size: 14px;">Répondre directement à : <a href="${mailtoHref}" style="color: #1a2744; font-weight: bold;">${emailSafe}</a></p>
        </div>
      </div>
    `;

    const confirmHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 64px; height: 64px; background: #1a2744; border-radius: 16px; margin: 0 auto 16px;">
            <span style="color: white; font-size: 28px; line-height: 64px; display: block;">${meta.emoji}</span>
          </div>
          <h1 style="color: #1a2744; font-size: 24px; margin: 0;">${meta.confirmTitle}</h1>
        </div>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">${meta.confirmBody(fnSafe, companySafe)}</p>
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

    await sendEmail(
      adminEmail,
      meta.adminSubject(payload),
      adminHtml,
      `${meta.label} de ${payload.firstName} ${payload.lastName} <${payload.email}> pour ${payload.company}`,
    );
    await sendEmail(
      payload.email,
      meta.confirmSubject,
      confirmHtml,
      `Bonjour ${payload.firstName}, nous avons bien recu votre demande.`,
    );

    try {
      await createProspectFromContactRequest(payload);
    } catch (prospectErr: any) {
      logger.error({ err: prospectErr, email: payload.email, company: payload.company, kind }, "[ContactRequest] Echec creation prospect (email envoye quand meme)");
    }

    try {
      await sendAdminSmsAlert(payload);
    } catch (smsErr: any) {
      logger.error({ err: smsErr, email: payload.email, company: payload.company, kind }, "[ContactRequest] Echec envoi SMS admin (demande traitee quand meme)");
    }

    logger.info({ email: payload.email, company: payload.company, kind }, "[ContactRequest] Nouvelle demande");
    const successMessage = kind === "rappel"
      ? "Votre demande a ete envoyee. Nous vous rappelons sous 2h ouvrees."
      : "Votre demande a ete envoyee. Vous recevrez un devis sous 24h ouvrees.";
    res.status(200).json({ message: successMessage });
  } catch (err: any) {
    logger.error({ err, kind }, "[ContactRequest] Erreur envoi email");
    res.status(500).json({ error: "Erreur lors de l'envoi de la demande." });
  }
});

export default router;
