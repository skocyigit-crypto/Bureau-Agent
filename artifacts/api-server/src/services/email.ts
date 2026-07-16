import { google } from "googleapis";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { logger } from "../lib/logger";
import { escapeHtml } from "../lib/html-escape";
import { getOrgEmailSender } from "./email-providers";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@agentdebureau.fr";
const APP_URL = process.env.PUBLIC_URL || process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "agentdebureau.fr"}`;
const MOBILE_APP_URL = process.env.MOBILE_APP_URL || "";

let resendCache: { client: Resend; from: string; fetchedAt: number } | null = null;

// ── Resend "from" address policy ──────────────────────────────────────────
// Resend n'autorise l'envoi qu'a partir de:
//   1) un domaine verifie dans le compte Resend du client (ex: agentdebureau.fr)
//   2) le domaine de test public `onboarding@resend.dev`
// Si le client connecte son compte Resend mais saisit comme `from_email`
// une adresse personnelle (gmail.com / hotmail.com / yahoo / outlook /
// icloud / etc), Resend rejette l'envoi avec 403 "domain not verified".
// C'etait le bug: le connecteur avait `from_email = ...@gmail.com` -> tous
// les envois echouaient silencieusement, et le fallback Gmail OAuth ne
// rattrapait pas toujours (rotation de token). On filtre maintenant les
// "free email providers" et on retombe sur `onboarding@resend.dev` qui
// fonctionne dans tous les plans Resend.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.fr", "yahoo.co.uk", "ymail.com",
  "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
  "free.fr", "orange.fr", "wanadoo.fr", "laposte.net", "sfr.fr", "bbox.fr", "neuf.fr",
]);

function pickResendFrom(rawFromEmail: string | null | undefined): { from: string; usedFallback: boolean; reason?: string } {
  // Override explicite via env -> on fait confiance a l'admin.
  const envOverride = process.env.RESEND_FROM_EMAIL?.trim();
  if (envOverride) return { from: envOverride, usedFallback: false };

  if (!rawFromEmail || !rawFromEmail.includes("@")) {
    return { from: "Ajant Bureau <onboarding@resend.dev>", usedFallback: true, reason: "no_from_email_set" };
  }
  const domain = rawFromEmail.split("@")[1].toLowerCase().trim();
  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return {
      from: "Ajant Bureau <onboarding@resend.dev>",
      usedFallback: true,
      reason: `from_domain_not_verifiable:${domain}`,
    };
  }
  // Domaine corporate -> on suppose qu'il est verifie cote Resend. Si non
  // verifie, Resend renverra une erreur explicite que l'on remonte au front.
  return { from: `Ajant Bureau <${rawFromEmail}>`, usedFallback: false };
}

async function getResendClient(): Promise<{ client: Resend; from: string; usedFallback: boolean } | null> {
  if (resendCache && Date.now() - resendCache.fetchedAt < 5 * 60 * 1000) {
    return { client: resendCache.client, from: resendCache.from, usedFallback: false };
  }

  const directKey = process.env.RESEND_API_KEY;
  if (directKey) {
    const picked = pickResendFrom(process.env.RESEND_FROM_EMAIL || SMTP_FROM);
    const client = new Resend(directKey);
    resendCache = { client, from: picked.from, fetchedAt: Date.now() };
    if (picked.usedFallback) {
      logger.warn({ reason: picked.reason }, `[Email/Resend] from_email non verifiable, fallback onboarding@resend.dev`);
    }
    return { client, from: picked.from, usedFallback: picked.usedFallback };
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

    const picked = pickResendFrom(fromEmail);
    const client = new Resend(apiKey);
    resendCache = { client, from: picked.from, fetchedAt: Date.now() };
    if (picked.usedFallback) {
      logger.warn({ reason: picked.reason, raw: fromEmail }, `[Email/Resend] connecteur from_email non verifiable, fallback onboarding@resend.dev`);
    }
    return { client, from: picked.from, usedFallback: picked.usedFallback };
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

// Envoi via un client Resend donné, avec retry "domaine non vérifié" ->
// onboarding@resend.dev. Partagé entre la clé plateforme et la clé BYOK
// d'une organisation. `tag` distingue les logs (platform / org / test).
async function sendViaResend(
  client: Resend,
  from: string,
  usedFallback: boolean,
  mail: { to: string; subject: string; html: string; text: string },
  tag: string,
): Promise<{ success: boolean; error?: string; provider?: string }> {
  try {
    const result = await client.emails.send({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text });
    if (result.error) {
      const errMsg = (result.error as any)?.message || JSON.stringify(result.error);
      logger.error({ err: result.error, from, to: mail.to }, `[Email/Resend:${tag}] Erreur envoi a ${mail.to}`);
      if (!usedFallback && /domain|verif|forbidden|not allowed/i.test(errMsg)) {
        try {
          const retry = await client.emails.send({ from: "Ajant Bureau <onboarding@resend.dev>", to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text });
          if (!retry.error) {
            logger.info(`[Email/Resend:${tag}] Envoye via fallback onboarding@resend.dev a ${mail.to}: ${retry.data?.id}`);
            return { success: true, provider: `resend-${tag}-fallback` };
          }
          return { success: false, error: `Resend retry: ${(retry.error as any)?.message || JSON.stringify(retry.error)}` };
        } catch (retryErr: any) {
          return { success: false, error: `Resend retry exception: ${retryErr.message}` };
        }
      }
      return { success: false, error: `Resend: ${errMsg}` };
    }
    logger.info(`[Email/Resend:${tag}] Envoye a ${mail.to}: ${result.data?.id} (from=${from})`);
    return { success: true, provider: `resend-${tag}` };
  } catch (err: any) {
    logger.error({ err: err.message }, `[Email/Resend:${tag}] Exception envoi a ${mail.to}:`);
    return { success: false, error: `Resend exception: ${err.message}` };
  }
}

/**
 * Envoie un email de test directement avec une clé Resend fournie (BYOK),
 * SANS repli sur la plateforme — pour que le test révèle la vraie erreur de
 * la clé du client (clé invalide, domaine non vérifié, ...).
 */
export async function sendTestEmailWithKey(apiKey: string, fromEmail: string | null, to: string): Promise<{ success: boolean; error?: string; from?: string }> {
  const picked = pickResendFrom(fromEmail);
  const client = new Resend(apiKey);
  const r = await sendViaResend(client, picked.from, picked.usedFallback, {
    to,
    subject: "Test d'envoi — Ajant Bureau",
    html: "<p>Votre clé d'envoi d'emails fonctionne. Cet email a été envoyé avec la clé de votre organisation.</p>",
    text: "Votre cle d'envoi d'emails fonctionne (cle de votre organisation).",
  }, "test");
  return r.success ? { success: true, from: picked.from } : { success: false, error: r.error };
}

export async function sendEmail(to: string, subject: string, html: string, text: string, opts?: { orgId?: number }): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
  // On collecte la derniere erreur de chaque provider pour pouvoir la
  // remonter au frontend si TOUS les providers echouent. Sans ca, l'admin
  // voit "Envoi email echoue" sans aucun moyen de savoir pourquoi.
  let lastError: string | undefined;

  // BYOK par locataire : si l'organisation a configuré sa propre clé Resend
  // active, on l'utilise en priorité (les coûts lui sont imputés). En cas
  // d'échec, on RETOMBE sur la chaîne plateforme (politique confirmée par
  // l'admin : "fallback clé plateforme") pour ne jamais bloquer un envoi.
  if (opts?.orgId) {
    try {
      const sender = await getOrgEmailSender(opts.orgId);
      if (sender) {
        const picked = pickResendFrom(sender.fromEmail);
        const orgClient = new Resend(sender.apiKey);
        const r = await sendViaResend(orgClient, picked.from, picked.usedFallback, { to, subject, html, text }, "org");
        if (r.success) return r;
        lastError = r.error;
        logger.warn({ orgId: opts.orgId, lastError }, "[Email] Clé d'organisation en échec, repli sur la plateforme");
      }
    } catch (err: any) {
      lastError = `Org email exception: ${err.message}`;
      logger.error({ err: err.message, orgId: opts.orgId }, "[Email] Exception clé organisation, repli plateforme");
    }
  }

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
        const errMsg = (result.error as any)?.message || JSON.stringify(result.error);
        logger.error({ err: result.error, from: resend.from, to }, `[Email/Resend] Erreur envoi a ${to}`);
        lastError = `Resend: ${errMsg}`;
        // Cas typique: domaine non verifie. Si on n'a PAS deja utilise le
        // fallback, on retente immediatement avec onboarding@resend.dev.
        if (!resend.usedFallback && /domain|verif|forbidden|not allowed/i.test(errMsg)) {
          try {
            const retry = await resend.client.emails.send({
              from: "Ajant Bureau <onboarding@resend.dev>",
              to: [to],
              subject,
              html,
              text,
            });
            if (!retry.error) {
              logger.info(`[Email/Resend] Envoye via fallback onboarding@resend.dev a ${to}: ${retry.data?.id}`);
              // On force le cache a utiliser le fallback pour les prochains envois.
              resendCache = resend ? { client: resend.client, from: "Ajant Bureau <onboarding@resend.dev>", fetchedAt: Date.now() } : null;
              return { success: true, provider: "resend-fallback" };
            }
            lastError = `Resend retry: ${(retry.error as any)?.message || JSON.stringify(retry.error)}`;
          } catch (retryErr: any) {
            lastError = `Resend retry exception: ${retryErr.message}`;
          }
        }
      } else {
        logger.info(`[Email/Resend] Envoye a ${to}: ${result.data?.id} (from=${resend.from})`);
        return { success: true, provider: "resend" };
      }
    } catch (err: any) {
      logger.error({ err: err.message }, `[Email/Resend] Exception envoi a ${to}:`);
      lastError = `Resend exception: ${err.message}`;
    }
  }

  const gmail = await getGmailClient();
  if (gmail) {
    try {
      const fromHeader = gmail.fromEmail
        ? `=?UTF-8?B?${Buffer.from("Ajant Bureau").toString("base64")}?= <${gmail.fromEmail}>`
        : `=?UTF-8?B?${Buffer.from("Ajant Bureau").toString("base64")}?= <me>`;
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
      return { success: true, provider: "gmail" };
    } catch (err: any) {
      logger.error({ err: err.message }, `[Email/Gmail] Erreur envoi a ${to}:`);
      lastError = `Gmail: ${err.message}`;
    }
  }

  const transport = createSmtpTransport();
  if (transport) {
    try {
      const info = await transport.sendMail({
        from: `"Ajant Bureau" <${SMTP_FROM}>`,
        to,
        subject,
        text,
        html,
      });
      logger.info(`[Email/SMTP] Envoye a ${to}: ${info.messageId}`);
      return { success: true, provider: "smtp" };
    } catch (err: any) {
      logger.error({ err: err.message }, `[Email/SMTP] Erreur envoi a ${to}:`);
      lastError = `SMTP: ${err.message}`;
    }
  }

  logger.warn({ to, subject, lastError }, "[Email] Aucun provider n'a pu envoyer le message");
  return {
    success: false,
    error: lastError || "Aucun service email configure (Resend, Gmail OAuth ou SMTP).",
  };
}

export async function sendWelcomeEmail(params: {
  to: string;
  orgName: string;
  plan: string;
  licenseKey: string;
  loginEmail: string;
  adminName: string;
  trialEndsAt?: Date | null;
}): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
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
      <h1 style="color:#ffffff;font-size:24px;margin:0;">Ajant Bureau</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">Solution professionnelle de gestion</p>
    </div>

    <div style="padding:32px;">
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bienvenue, ${escapeHtml(adminName)} !</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre compte <strong>Ajant Bureau</strong> pour <strong>${escapeHtml(orgName)}</strong> a ete cree avec succes. 
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
        &copy; ${new Date().getFullYear()} SK GROUP - Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Bienvenue ${adminName} !

Votre compte Ajant Bureau pour ${orgName} a ete cree.

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
SK GROUP`;

  return sendEmail(to, `Bienvenue sur Ajant Bureau - ${orgName}`, html, text);
}

export async function sendCredentialsEmail(params: {
  to: string;
  prenom: string;
  nom: string;
  password: string;
  orgName: string;
  role: string;
}): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
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
      <h1 style="color:#ffffff;font-size:24px;margin:0;">Ajant Bureau</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">Code de connexion temporaire</p>
    </div>

    <div style="padding:32px;">
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bonjour ${escapeHtml(prenom)} ${escapeHtml(nom)},</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Un code de connexion temporaire a ete genere pour votre compte <strong>Ajant Bureau</strong> 
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
        &copy; ${new Date().getFullYear()} SK GROUP - Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Bonjour ${prenom} ${nom},

Un code de connexion temporaire a ete genere pour votre compte Ajant Bureau (${orgName}).

CODE DE CONNEXION TEMPORAIRE:
- Email: ${to}
- Code temporaire: ${password}
- Role: ${roleLabels[role] || role}

ATTENTION: Ce code est temporaire. Utilisez-le comme mot de passe pour vous connecter, puis changez votre mot de passe immediatement.

ACCES:
- Application: ${APP_URL}

IMPORTANT: Changez votre mot de passe des votre premiere connexion.

Support: support@agentdebureau.fr
SK GROUP`;

  return sendEmail(to, `Code de connexion temporaire - Ajant Bureau (${orgName})`, html, text);
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
  resetLink?: string;
}): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
  const { to, orgName, plan, licenseKey, trialEndsAt, adminName, adminEmail, adminPassword, resetLink } = params;

  const trialInfo = trialEndsAt
    ? `<p style="color:#e67e22;font-size:14px;margin:16px 0 0;">Votre periode d'essai se termine le <strong>${new Date(trialEndsAt).toLocaleDateString("fr-FR")}</strong>.</p>`
    : "";

  const resetSection = (adminEmail && resetLink) ? `
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#065f46;font-size:16px;margin:0 0 12px;">&#128273; Definissez votre mot de passe</h3>
        <p style="color:#065f46;font-size:13px;margin:0 0 16px;line-height:1.6;">
          Cliquez sur le bouton ci-dessous pour creer (ou reinitialiser) le mot de passe de l'administrateur
          <strong>${escapeHtml(adminEmail)}</strong>. Ce lien securise est valide <strong>24 heures</strong> et
          ne peut etre utilise qu'une seule fois.
        </p>
        <div style="text-align:center;margin:8px 0 4px;">
          <a href="${resetLink}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">
            Definir mon mot de passe
          </a>
        </div>
        <p style="color:#065f46;font-size:11px;margin:12px 0 0;text-align:center;word-break:break-all;">
          Ou copiez ce lien : ${escapeHtml(resetLink)}
        </p>
      </div>` : "";

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
      <h1 style="color:#ffffff;font-size:24px;margin:0;">Ajant Bureau</h1>
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">Solution professionnelle de gestion</p>
    </div>

    <div style="padding:32px;">
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bienvenue${adminName ? `, ${escapeHtml(adminName)}` : `, ${escapeHtml(orgName)}`} !</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre compte <strong>Ajant Bureau</strong> pour <strong>${escapeHtml(orgName)}</strong> (plan <strong>${escapeHtml(plan)}</strong>) a ete cree avec succes.
      </p>

      ${trialInfo}

      ${resetSection}

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
        &copy; ${new Date().getFullYear()} SK GROUP - Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;

  const resetText = (adminEmail && resetLink) ? `\nDEFINISSEZ VOTRE MOT DE PASSE:\n- Administrateur: ${adminName || adminEmail}\n- Email: ${adminEmail}\n- Lien securise (valide 24h, usage unique): ${resetLink}\n` : "";
  const credText = (adminEmail && adminPassword) ? `\nCODE DE CONNEXION TEMPORAIRE:\n- Administrateur: ${adminName || adminEmail}\n- Email: ${adminEmail}\n- Code temporaire: ${adminPassword}\n- ATTENTION: Ce code est temporaire. Changez votre mot de passe des votre premiere connexion.\n` : "";

  const text = `Bienvenue${adminName ? ` ${adminName}` : ` ${orgName}`} !\n\nVotre compte Ajant Bureau pour ${orgName} (plan ${plan}) a ete cree.\n${resetText}${credText}\nAccedez a l'application: ${APP_URL}\n\nPOUR COMMENCER:\n1. Connectez-vous avec votre code temporaire\n2. Changez votre mot de passe\n3. Ajoutez vos premiers contacts\n4. Invitez vos collaborateurs\n\nSupport: support@agentdebureau.fr\nSK GROUP`;

  return sendEmail(to, `Bienvenue sur Ajant Bureau - ${orgName}`, html, text);
}

export async function sendSubscriptionSuspendedEmail(params: {
  to: string;
  orgName: string;
  plan: string;
  failedAttempts: number;
}): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
  const { to, orgName, plan, failedAttempts } = params;
  const portalUrl = `${APP_URL}/abonnement`;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<div style="background:linear-gradient(135deg,#7f1d1d 0%,#991b1b 100%);padding:32px;text-align:center;">
<h1 style="color:#fff;font-size:22px;margin:0;">Abonnement suspendu</h1>
<p style="color:rgba(255,255,255,0.7);font-size:13px;margin:8px 0 0;">Action requise — Ajant Bureau</p>
</div>
<div style="padding:32px;">
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Bonjour,</p>
<p style="color:#0f1729;font-size:15px;line-height:1.6;">L'abonnement <strong>${escapeHtml(plan)}</strong> de votre organisation <strong>${escapeHtml(orgName)}</strong> a ete <strong style="color:#991b1b;">suspendu</strong> apres ${failedAttempts} echecs consecutifs de paiement.</p>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin:20px 0;">
<p style="color:#991b1b;font-size:13px;margin:0;">L'acces en ecriture a votre compte est bloque jusqu'au reglement. Les donnees sont conservees et seront accessibles des le retablissement du paiement.</p>
</div>
<div style="text-align:center;margin:24px 0;">
<a href="${portalUrl}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;">Mettre a jour mon paiement</a>
</div>
<p style="color:#64748b;font-size:13px;line-height:1.6;">Apres mise a jour, votre abonnement sera reactive automatiquement sous quelques minutes.</p>
</div>
<div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="color:#94a3b8;font-size:11px;margin:0;">Support: <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a></p>
</div></div></body></html>`;
  const text = `Abonnement suspendu - Ajant Bureau\n\nL'abonnement ${plan} de ${orgName} a ete suspendu apres ${failedAttempts} echecs consecutifs de paiement.\n\nL'acces en ecriture est bloque. Les donnees sont conservees.\n\nMettez a jour votre moyen de paiement: ${portalUrl}\n\nSupport: support@agentdebureau.fr`;
  return sendEmail(to, `[Ajant Bureau] Abonnement suspendu - ${orgName}`, html, text);
}

export async function sendSubscriptionRecoveredEmail(params: {
  to: string;
  orgName: string;
  plan: string;
}): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
  const { to, orgName, plan } = params;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<div style="background:linear-gradient(135deg,#065f46 0%,#047857 100%);padding:32px;text-align:center;">
<h1 style="color:#fff;font-size:22px;margin:0;">Paiement recu — abonnement reactive</h1>
</div>
<div style="padding:32px;">
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Bonjour,</p>
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Votre paiement a bien ete recu. L'abonnement <strong>${escapeHtml(plan)}</strong> de <strong>${escapeHtml(orgName)}</strong> est de nouveau <strong style="color:#047857;">actif</strong>.</p>
<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px;margin:20px 0;">
<p style="color:#065f46;font-size:13px;margin:0;">L'acces complet a toutes les fonctionnalites est restaure. Merci de votre confiance.</p>
</div>
<div style="text-align:center;margin:24px 0;">
<a href="${APP_URL}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;">Acceder a l'application</a>
</div>
</div>
<div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="color:#94a3b8;font-size:11px;margin:0;">Support: <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a></p>
</div></div></body></html>`;
  const text = `Paiement recu - Ajant Bureau\n\nL'abonnement ${plan} de ${orgName} est de nouveau actif.\n\nMerci de votre confiance.\n\n${APP_URL}`;
  return sendEmail(to, `[Ajant Bureau] Abonnement reactive - ${orgName}`, html, text);
}

export async function sendTrialEndingEmail(params: {
  to: string;
  orgName: string;
  daysLeft: number;
  trialEndsAt: Date | string;
  expired?: boolean;
}): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
  const { to, orgName, daysLeft, trialEndsAt, expired } = params;
  const endStr = new Date(trialEndsAt).toLocaleDateString("fr-FR");
  const portalUrl = `${APP_URL}/settings?tab=abonnement`;
  const headerColor = expired ? "#7f1d1d" : daysLeft <= 1 ? "#9a3412" : "#92400e";
  const title = expired
    ? "Periode d'essai terminee"
    : daysLeft <= 1
      ? "Votre essai se termine demain"
      : `Plus que ${daysLeft} jours d'essai`;
  const intro = expired
    ? `La periode d'essai gratuit de <strong>${escapeHtml(orgName)}</strong> est <strong style="color:#991b1b;">terminee</strong>. Choisissez un plan pour continuer a utiliser Ajant Bureau.`
    : `Il vous reste <strong>${daysLeft} jour${daysLeft > 1 ? "s" : ""}</strong> avant la fin de votre periode d'essai gratuit (${endStr}).`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<div style="background:linear-gradient(135deg,${headerColor} 0%,#0f1729 100%);padding:32px;text-align:center;">
<h1 style="color:#fff;font-size:22px;margin:0;">${title}</h1>
</div>
<div style="padding:32px;">
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Bonjour,</p>
<p style="color:#0f1729;font-size:15px;line-height:1.6;">${intro}</p>
<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin:20px 0;">
<p style="color:#92400e;font-size:13px;margin:0;line-height:1.6;">Choisissez un plan adapte a votre activite a partir de <strong>29 EUR / mois</strong>. Pas d'engagement, annulable a tout moment.</p>
</div>
<div style="text-align:center;margin:24px 0;">
<a href="${portalUrl}" style="display:inline-block;background:#f59e0b;color:#0f1729;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;">Voir les plans</a>
</div>
</div>
<div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="color:#94a3b8;font-size:11px;margin:0;">Support: <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a></p>
</div></div></body></html>`;
  const text = `${title} - Ajant Bureau\n\n${expired ? `La periode d'essai gratuit de ${orgName} est terminee.` : `Il vous reste ${daysLeft} jour(s) avant la fin de votre essai gratuit (${endStr}).`}\n\nVoir les plans: ${portalUrl}\n\nSupport: support@agentdebureau.fr`;
  return sendEmail(to, `[Ajant Bureau] ${title} - ${orgName}`, html, text);
}

// ---------------------------------------------------------------------------
// Relance de facture impayee (backoffice B2B). Email courtois envoye au client
// dont la facture est en retard / non reglee. Ton poli, jamais agressif.
// ---------------------------------------------------------------------------

export async function sendInvoiceReminderEmail(params: {
  to: string;
  clientName: string;
  reference: string;
  title: string;
  amountLabel: string;
  dueDateLabel?: string | null;
  isOverdue: boolean;
  reminderNumber: number;
}): Promise<{ success: boolean; error?: string; preview?: string; provider?: string }> {
  const { to, clientName, reference, title, amountLabel, dueDateLabel, isOverdue, reminderNumber } = params;
  const heading = isOverdue ? "Rappel : facture echue" : "Rappel de facture";
  const headerColor = isOverdue ? "#9a3412" : "#1d4ed8";
  const dueLine = dueDateLabel
    ? (isOverdue
        ? `Cette facture etait due le <strong>${escapeHtml(dueDateLabel)}</strong> et apparait comme non reglee dans nos registres.`
        : `L'echeance de cette facture est fixee au <strong>${escapeHtml(dueDateLabel)}</strong>.`)
    : `Cette facture apparait comme non reglee dans nos registres.`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<div style="background:linear-gradient(135deg,${headerColor} 0%,#0f1729 100%);padding:32px;text-align:center;">
<h1 style="color:#fff;font-size:22px;margin:0;">${heading}</h1>
</div>
<div style="padding:32px;">
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Bonjour ${escapeHtml(clientName)},</p>
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Sauf erreur de notre part, nous n'avons pas encore recu le reglement de la facture suivante. ${dueLine}</p>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:20px 0;">
<table style="width:100%;border-collapse:collapse;">
<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Reference</td><td style="padding:6px 0;color:#0f1729;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(reference)}</td></tr>
<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Objet</td><td style="padding:6px 0;color:#0f1729;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(title)}</td></tr>
<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Montant</td><td style="padding:6px 0;color:#0f1729;font-size:15px;font-weight:700;text-align:right;">${escapeHtml(amountLabel)}</td></tr>
</table>
</div>
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Si le reglement a deja ete effectue, merci de ne pas tenir compte de ce message. Pour toute question, n'hesitez pas a nous repondre directement.</p>
<p style="color:#0f1729;font-size:15px;line-height:1.6;">Avec nos remerciements,<br/>L'equipe Ajant Bureau</p>
</div>
<div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="color:#94a3b8;font-size:11px;margin:0;">Support: <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a></p>
</div></div></body></html>`;
  const text = `${heading} - Ajant Bureau\n\nBonjour ${clientName},\n\nSauf erreur de notre part, nous n'avons pas encore recu le reglement de la facture ${reference} (${title}).\nMontant: ${amountLabel}${dueDateLabel ? `\nEcheance: ${dueDateLabel}` : ""}\n\nSi le reglement a deja ete effectue, merci de ne pas tenir compte de ce message.\n\nL'equipe Ajant Bureau\nSupport: support@agentdebureau.fr`;
  const subjectPrefix = reminderNumber > 1 ? `Relance ${reminderNumber}` : "Rappel";
  return sendEmail(to, `[Ajant Bureau] ${subjectPrefix} - Facture ${reference}`, html, text);
}
