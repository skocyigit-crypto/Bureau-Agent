import { google } from "googleapis";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { logger } from "../lib/logger";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@agentdebureau.fr";
const APP_URL = process.env.PUBLIC_URL || process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "agentdebureau.fr"}`;
const MOBILE_APP_URL = process.env.MOBILE_APP_URL || "";

let resendCache: { client: Resend; from: string; fetchedAt: number } | null = null;

async function getResendClient(): Promise<{ client: Resend; from: string } | null> {
  if (resendCache && Date.now() - resendCache.fetchedAt < 5 * 60 * 1000) {
    return { client: resendCache.client, from: resendCache.from };
  }

  const directKey = process.env.RESEND_API_KEY;
  if (directKey) {
    const from = process.env.RESEND_FROM_EMAIL || `Agent de Bureau <${SMTP_FROM}>`;
    const client = new Resend(directKey);
    resendCache = { client, from, fetchedAt: Date.now() };
    return { client, from };
  }

  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    if (!hostname) return null;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? "depl " + process.env.WEB_REPL_RENEWAL
        : null;
    if (!xReplitToken) return null;

    const response = await fetch(
      "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=resend",
      { headers: { "Accept": "application/json", "X-Replit-Token": xReplitToken } }
    );
    const data = await response.json() as any;
    const conn = data.items?.[0];
    const apiKey = conn?.settings?.api_key;
    const fromEmail = conn?.settings?.from_email;
    if (!apiKey) return null;

    const fromAddress = fromEmail
      ? `Agent de Bureau <${fromEmail}>`
      : "Agent de Bureau <onboarding@resend.dev>";
    const client = new Resend(apiKey);
    resendCache = { client, from: fromAddress, fetchedAt: Date.now() };
    return { client, from: fromAddress };
  } catch (err: any) {
    logger.error({ err: err.message }, "[Email/Resend] Erreur recuperation connecteur:");
    return null;
  }
}

let gmailConnectionSettings: any = null;

async function getGmailClient() {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    if (!hostname) return null;

    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? "depl " + process.env.WEB_REPL_RENEWAL
        : null;

    if (!xReplitToken) return null;

    const needsRefresh = !gmailConnectionSettings
      || !gmailConnectionSettings.settings?.expires_at
      || new Date(gmailConnectionSettings.settings.expires_at).getTime() <= Date.now();

    if (needsRefresh) {
      const response = await fetch(
        "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=google-mail",
        {
          headers: {
            "Accept": "application/json",
            "X-Replit-Token": xReplitToken,
          },
        }
      );
      const data = await response.json() as any;
      gmailConnectionSettings = data.items?.[0];
    }

    const accessToken = gmailConnectionSettings?.settings?.access_token
      || gmailConnectionSettings?.settings?.oauth?.credentials?.access_token;

    if (!accessToken) return null;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const fromEmail = gmailConnectionSettings?.settings?.from_email
      || gmailConnectionSettings?.settings?.email_address
      || gmailConnectionSettings?.settings?.oauth?.credentials?.email
      || null;

    return { client: google.gmail({ version: "v1", auth: oauth2Client }), fromEmail };
  } catch {
    return null;
  }
}

function createSmtpTransport() {
  if (!SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<{ success: boolean; error?: string; preview?: string }> {
  const resend = await getResendClient();
  if (resend) {
    try {
      const result = await resend.client.emails.send({
        from: resend.from,
        to: [to],
        subject,
        html,
        text,
      });
      if (result.error) {
        logger.error({ err: result.error }, `[Email/Resend] Erreur envoi a ${to}:`);
      } else {
        logger.info(`[Email/Resend] Envoye a ${to}: ${result.data?.id}`);
        return { success: true };
      }
    } catch (err: any) {
      logger.error({ err: err.message }, `[Email/Resend] Exception envoi a ${to}:`);
    }
  }

  const gmail = await getGmailClient();
  if (gmail) {
    try {
      const fromHeader = gmail.fromEmail
        ? `=?UTF-8?B?${Buffer.from("Agent de Bureau").toString("base64")}?= <${gmail.fromEmail}>`
        : `=?UTF-8?B?${Buffer.from("Agent de Bureau").toString("base64")}?= <me>`;
      const rawLines = [
        `From: ${fromHeader}`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=UTF-8`,
        ``,
        html,
      ];
      const raw = rawLines.join("\r\n");
      const encodedMessage = Buffer.from(raw).toString("base64url");

      const result = await gmail.client.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedMessage },
      });

      logger.info(`[Email/Gmail] Envoye a ${to}: ${result.data.id}`);
      return { success: true };
    } catch (err: any) {
      logger.error({ err: err.message }, `[Email/Gmail] Erreur envoi a ${to}:`);
    }
  }

  const transport = createSmtpTransport();
  if (transport) {
    try {
      const info = await transport.sendMail({
        from: `"Agent de Bureau" <${SMTP_FROM}>`,
        to,
        subject,
        text,
        html,
      });
      logger.info(`[Email/SMTP] Envoye a ${to}: ${info.messageId}`);
      return { success: true };
    } catch (err: any) {
      logger.error({ err: err.message }, `[Email/SMTP] Erreur envoi a ${to}:`);
    }
  }

  logger.info(`[Email] Aucun service configure. Email pour ${to}:`);
  logger.info(`  Sujet: ${subject}`);
  logger.info(`  Contenu texte: ${text.substring(0, 300)}...`);
  return { success: false, error: "Aucun service email configure (ni Gmail, ni SMTP)." };
}

export async function sendWelcomeEmail(params: {
  to: string;
  orgName: string;
  plan: string;
  licenseKey: string;
  loginEmail: string;
  adminName: string;
  trialEndsAt?: Date | null;
}): Promise<{ success: boolean; error?: string; preview?: string }> {
  const { to, orgName, plan, licenseKey, loginEmail, adminName, trialEndsAt } = params;

  const trialInfo = trialEndsAt
    ? `<p style="color:#e67e22;font-size:14px;margin:16px 0 0;">&#9888; Votre periode d'essai gratuit se termine le <strong>${new Date(trialEndsAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong>.</p>`
    : "";

  const mobileSection = MOBILE_APP_URL ? `
      <div style="margin-top:24px;">
        <h3 style="color:#0f1729;font-size:16px;margin:0 0 12px;">&#128241; Application Mobile</h3>
        <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 12px;">
          Telechargez l'application mobile pour gerer votre bureau depuis votre telephone :
        </p>
        <div style="text-align:center;">
          <a href="${MOBILE_APP_URL}" style="display:inline-block;background:#22c55e;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:10px;font-size:14px;font-weight:600;">
            &#128229; Telecharger l'application mobile
          </a>
        </div>
      </div>` : `
      <div style="margin-top:24px;">
        <h3 style="color:#0f1729;font-size:16px;margin:0 0 12px;">&#128241; Application Mobile</h3>
        <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
          Accedez a l'application mobile depuis votre navigateur sur telephone :<br>
          Ouvrez <a href="${APP_URL}" style="color:#f59e0b;font-weight:600;">${APP_URL}</a> puis utilisez 
          <strong>"Ajouter a l'ecran d'accueil"</strong> pour l'installer comme une application native.
        </p>
      </div>`;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    
    <div style="background:linear-gradient(135deg,#0f1729 0%,#1a2744 100%);padding:40px 32px;text-align:center;">
      <div style="width:64px;height:64px;background:#f59e0b;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:28px;color:#0f1729;">&#9742;</span>
      </div>
      <h1 style="color:#ffffff;font-size:24px;margin:0;">Agent de Bureau</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">Solution professionnelle de gestion</p>
    </div>

    <div style="padding:32px;">
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bienvenue, ${escapeHtml(adminName)} !</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre compte <strong>Agent de Bureau</strong> pour <strong>${escapeHtml(orgName)}</strong> a ete cree avec succes. 
        Voici toutes les informations pour commencer :
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#166534;font-size:16px;margin:0 0 16px;">&#128272; Votre identifiant de connexion</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;width:140px;">Email</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${escapeHtml(loginEmail)}</td>
          </tr>
        </table>
        <p style="color:#166534;font-size:11px;margin:12px 0 0;font-style:italic;">
          Connectez-vous avec le mot de passe que vous avez choisi lors de l'inscription.
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#0f1729;font-size:16px;margin:0 0 16px;">&#128188; Votre licence</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;width:140px;">Organisation</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${escapeHtml(orgName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;">Plan</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${escapeHtml(plan)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;">Cle de licence</td>
            <td style="padding:8px 0;">
              <span style="background:#0f1729;color:#f59e0b;padding:6px 14px;border-radius:8px;font-family:monospace;font-size:14px;font-weight:700;letter-spacing:1px;">${escapeHtml(licenseKey)}</span>
            </td>
          </tr>
        </table>
      </div>

      ${trialInfo}

      <div style="text-align:center;margin:32px 0 16px;">
        <a href="${APP_URL}" style="display:inline-block;background:#0f1729;color:#ffffff;text-decoration:none;padding:14px 48px;border-radius:10px;font-size:15px;font-weight:600;">
          &#128187; Acceder a l'application Web
        </a>
      </div>

      ${mobileSection}

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-top:24px;">
        <p style="margin:0;color:#92400e;font-size:13px;">
          <strong>&#128274; Important :</strong> Conservez cet email en lieu sur. 
          Il contient votre cle de licence et vos informations d'acces.
        </p>
      </div>

      <div style="margin-top:24px;padding:20px;background:#f8fafc;border-radius:10px;">
        <h3 style="color:#0f1729;font-size:14px;margin:0 0 12px;">&#128640; Pour commencer</h3>
        <ol style="color:#64748b;font-size:13px;line-height:2;margin:0;padding-left:20px;">
          <li>Connectez-vous avec vos identifiants ci-dessus</li>
          <li>Changez votre mot de passe dans les parametres</li>
          <li>Ajoutez vos premiers contacts</li>
          <li>Commencez a gerer vos appels et taches</li>
          <li>Invitez vos collaborateurs depuis la gestion des utilisateurs</li>
        </ol>
      </div>
    </div>

    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">
        Besoin d'aide ? Contactez-nous : <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a>
      </p>
      <p style="color:#94a3b8;font-size:11px;margin:0;">
        &copy; ${new Date().getFullYear()} Agent de Bureau SAS - Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Bienvenue ${adminName} !

Votre compte Agent de Bureau pour ${orgName} a ete cree.

IDENTIFIANT DE CONNEXION:
- Email: ${loginEmail}
- Connectez-vous avec le mot de passe choisi lors de l'inscription.

LICENCE:
- Organisation: ${orgName}
- Plan: ${plan}
- Cle de licence: ${licenseKey}

ACCES:
- Application Web: ${APP_URL}
${MOBILE_APP_URL ? `- Application Mobile: ${MOBILE_APP_URL}` : "- Mobile: Ouvrez " + APP_URL + " sur votre telephone"}

POUR COMMENCER:
1. Connectez-vous sur ${APP_URL}
2. Ajoutez vos premiers contacts
3. Gerez vos appels et taches
4. Invitez vos collaborateurs

Conservez cet email - il contient votre licence et informations d'acces.

Support: support@agentdebureau.fr
Agent de Bureau SAS`;

  return sendEmail(to, `Bienvenue sur Agent de Bureau - ${orgName}`, html, text);
}

export async function sendCredentialsEmail(params: {
  to: string;
  prenom: string;
  nom: string;
  password: string;
  orgName: string;
  role: string;
}): Promise<{ success: boolean; error?: string; preview?: string }> {
  const { to, prenom, nom, password, orgName, role } = params;

  const roleLabels: Record<string, string> = {
    super_admin: "Super Administrateur",
    administrateur: "Administrateur",
    agent: "Agent",
    lecture_seule: "Lecture seule",
  };

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    
    <div style="background:linear-gradient(135deg,#0f1729 0%,#1a2744 100%);padding:40px 32px;text-align:center;">
      <div style="width:64px;height:64px;background:#f59e0b;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:28px;color:#0f1729;">&#9742;</span>
      </div>
      <h1 style="color:#ffffff;font-size:24px;margin:0;">Agent de Bureau</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">Code de connexion temporaire</p>
    </div>

    <div style="padding:32px;">
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bonjour ${escapeHtml(prenom)} ${escapeHtml(nom)},</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Un code de connexion temporaire a ete genere pour votre compte <strong>Agent de Bureau</strong> 
        dans l'organisation <strong>${escapeHtml(orgName)}</strong>.
      </p>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#92400e;font-size:16px;margin:0 0 16px;">&#128274; Code de connexion temporaire</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#92400e;font-size:13px;width:140px;">Email</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${to}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#92400e;font-size:13px;">Code temporaire</td>
            <td style="padding:8px 0;">
              <span style="background:#0f1729;color:#f59e0b;padding:10px 20px;border-radius:8px;font-family:monospace;font-size:22px;font-weight:700;letter-spacing:6px;">${password}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#92400e;font-size:13px;">Role</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${roleLabels[role] || role}</td>
          </tr>
        </table>
      </div>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin:0 0 24px;">
        <p style="margin:0;color:#991b1b;font-size:13px;">
          <strong>&#9888; Attention :</strong> Ce code est temporaire. Utilisez-le comme mot de passe pour vous connecter, 
          puis <strong>changez votre mot de passe</strong> immediatement dans les parametres de votre compte.
        </p>
      </div>

      <div style="text-align:center;margin:24px 0 16px;">
        <a href="${APP_URL}" style="display:inline-block;background:#0f1729;color:#ffffff;text-decoration:none;padding:14px 48px;border-radius:10px;font-size:15px;font-weight:600;">
          Se connecter maintenant
        </a>
      </div>

      <div style="margin-top:24px;padding:20px;background:#f8fafc;border-radius:10px;">
        <h3 style="color:#0f1729;font-size:14px;margin:0 0 12px;">&#128274; Comment utiliser</h3>
        <ol style="color:#64748b;font-size:13px;line-height:2;margin:0;padding-left:20px;">
          <li>Connectez-vous avec votre email et le code temporaire ci-dessus</li>
          <li>Allez dans les parametres de votre compte</li>
          <li>Changez immediatement votre mot de passe</li>
        </ol>
      </div>
    </div>

    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">
        Besoin d'aide ? Contactez-nous : <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a>
      </p>
      <p style="color:#94a3b8;font-size:11px;margin:0;">
        &copy; ${new Date().getFullYear()} Agent de Bureau SAS - Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Bonjour ${prenom} ${nom},

Un code de connexion temporaire a ete genere pour votre compte Agent de Bureau (${orgName}).

CODE DE CONNEXION TEMPORAIRE:
- Email: ${to}
- Code temporaire: ${password}
- Role: ${roleLabels[role] || role}

ATTENTION: Ce code est temporaire. Utilisez-le comme mot de passe pour vous connecter, puis changez votre mot de passe immediatement.

ACCES:
- Application: ${APP_URL}

IMPORTANT: Changez votre mot de passe des votre premiere connexion.

Support: support@agentdebureau.fr
Agent de Bureau SAS`;

  return sendEmail(to, `Code de connexion temporaire - Agent de Bureau (${orgName})`, html, text);
}

export async function sendLicenseEmail(params: {
  to: string;
  orgName: string;
  plan: string;
  licenseKey: string;
  trialEndsAt?: Date | null;
  adminName?: string;
  adminEmail?: string;
  adminPassword?: string;
}): Promise<{ success: boolean; error?: string; preview?: string }> {
  const { to, orgName, plan, licenseKey, trialEndsAt, adminName, adminEmail, adminPassword } = params;

  const trialInfo = trialEndsAt
    ? `<p style="color:#e67e22;font-size:14px;margin:16px 0 0;">Votre periode d'essai se termine le <strong>${new Date(trialEndsAt).toLocaleDateString("fr-FR")}</strong>.</p>`
    : "";

  const credentialsSection = (adminEmail && adminPassword) ? `
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#92400e;font-size:16px;margin:0 0 16px;">&#128274; Code de connexion temporaire</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#92400e;font-size:13px;width:140px;">Administrateur</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${escapeHtml(adminName || adminEmail)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#92400e;font-size:13px;">Email</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${escapeHtml(adminEmail)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#92400e;font-size:13px;">Code temporaire</td>
            <td style="padding:8px 0;">
              <span style="background:#0f1729;color:#f59e0b;padding:10px 20px;border-radius:8px;font-family:monospace;font-size:22px;font-weight:700;letter-spacing:6px;">${escapeHtml(adminPassword)}</span>
            </td>
          </tr>
        </table>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:12px 0 0;">
          <p style="margin:0;color:#991b1b;font-size:12px;">
            <strong>&#9888; Attention :</strong> Ce code est temporaire. Utilisez-le comme mot de passe pour vous connecter, 
            puis changez votre mot de passe immediatement dans les parametres.
          </p>
        </div>
      </div>` : "";

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#0f1729 0%,#1a2744 100%);padding:40px 32px;text-align:center;">
      <div style="width:64px;height:64px;background:#f59e0b;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:28px;color:#0f1729;">&#9742;</span>
      </div>
      <h1 style="color:#ffffff;font-size:24px;margin:0;">Agent de Bureau</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">Solution professionnelle de gestion</p>
    </div>

    <div style="padding:32px;">
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bienvenue${adminName ? `, ${escapeHtml(adminName)}` : `, ${escapeHtml(orgName)}`} !</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre compte <strong>Agent de Bureau</strong> pour <strong>${escapeHtml(orgName)}</strong> (plan <strong>${escapeHtml(plan)}</strong>) a ete cree avec succes.
      </p>

      ${trialInfo}

      ${credentialsSection}

      <div style="text-align:center;margin:32px 0 16px;">
        <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#0f1729;text-decoration:none;padding:16px 48px;border-radius:12px;font-size:16px;font-weight:700;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
          Acceder a l'application
        </a>
      </div>

      <div style="background:linear-gradient(135deg,#eff6ff 0%,#f0f9ff 100%);border:1px solid #bfdbfe;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#1e40af;font-size:16px;margin:0 0 16px;">&#128241; Installez l'application</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;vertical-align:top;width:40px;">
              <span style="display:inline-block;background:#dbeafe;border-radius:8px;padding:8px;font-size:18px;">&#128187;</span>
            </td>
            <td style="padding:10px 12px;vertical-align:top;">
              <strong style="color:#1e40af;font-size:13px;">Desktop / Navigateur</strong>
              <p style="color:#3b82f6;font-size:12px;margin:4px 0 0;">Ouvrez l'application dans Chrome ou Edge, puis cliquez sur "Installer" dans la barre d'adresse pour l'ajouter a votre bureau.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;vertical-align:top;">
              <span style="display:inline-block;background:#dbeafe;border-radius:8px;padding:8px;font-size:18px;">&#128241;</span>
            </td>
            <td style="padding:10px 12px;vertical-align:top;">
              <strong style="color:#1e40af;font-size:13px;">Mobile (iOS / Android)</strong>
              <p style="color:#3b82f6;font-size:12px;margin:4px 0 0;">Ouvrez l'application sur votre telephone, puis utilisez "Ajouter a l'ecran d'accueil" dans le menu du navigateur.</p>
            </td>
          </tr>
        </table>
      </div>

      <div style="margin-top:24px;padding:20px;background:#f8fafc;border-radius:10px;">
        <h3 style="color:#0f1729;font-size:14px;margin:0 0 12px;">&#128640; Pour commencer</h3>
        <ol style="color:#64748b;font-size:13px;line-height:2;margin:0;padding-left:20px;">
          <li>Connectez-vous avec votre email et le code temporaire</li>
          <li>Changez votre mot de passe dans les parametres</li>
          <li>Suivez l'assistant de configuration</li>
          <li>Ajoutez vos contacts et invitez vos collaborateurs</li>
        </ol>
      </div>
    </div>

    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">
        Besoin d'aide ? Contactez-nous : <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a>
      </p>
      <p style="color:#94a3b8;font-size:11px;margin:0;">
        &copy; ${new Date().getFullYear()} Agent de Bureau SAS - Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;

  const credText = (adminEmail && adminPassword) ? `\nCODE DE CONNEXION TEMPORAIRE:\n- Administrateur: ${adminName || adminEmail}\n- Email: ${adminEmail}\n- Code temporaire: ${adminPassword}\n- ATTENTION: Ce code est temporaire. Changez votre mot de passe des votre premiere connexion.\n` : "";

  const text = `Bienvenue${adminName ? ` ${adminName}` : ` ${orgName}`} !\n\nVotre compte Agent de Bureau pour ${orgName} (plan ${plan}) a ete cree.\n${credText}\nAccedez a l'application: ${APP_URL}\n\nPOUR COMMENCER:\n1. Connectez-vous avec votre code temporaire\n2. Changez votre mot de passe\n3. Ajoutez vos premiers contacts\n4. Invitez vos collaborateurs\n\nSupport: support@agentdebureau.fr\nAgent de Bureau SAS`;

  return sendEmail(to, `Bienvenue sur Agent de Bureau - ${orgName}`, html, text);
}
