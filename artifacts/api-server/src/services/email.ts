import nodemailer from "nodemailer";
import { Resend } from "resend";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@agentdebureau.fr";
const APP_URL = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "agentdebureau.fr"}`;
const MOBILE_APP_URL = process.env.MOBILE_APP_URL || "";

let resendConnectionSettings: any = null;

async function getResendCredentials(): Promise<{ apiKey: string; fromEmail: string } | null> {
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
      {
        headers: {
          "Accept": "application/json",
          "X-Replit-Token": xReplitToken,
        },
      }
    );

    const data = await response.json();
    resendConnectionSettings = data.items?.[0];

    if (!resendConnectionSettings?.settings?.api_key) return null;

    return {
      apiKey: resendConnectionSettings.settings.api_key,
      fromEmail: resendConnectionSettings.settings.from_email || "Agent de Bureau <onboarding@resend.dev>",
    };
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

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<{ success: boolean; error?: string; preview?: string }> {
  const resendCreds = await getResendCredentials();
  if (resendCreds) {
    try {
      const resend = new Resend(resendCreds.apiKey);
      const result = await resend.emails.send({
        from: resendCreds.fromEmail,
        to: [to],
        subject,
        html,
        text,
      });

      if (result.error) {
        console.error(`[Email/Resend] Erreur envoi a ${to}:`, result.error.message);
        return { success: false, error: result.error.message };
      }

      console.log(`[Email/Resend] Envoye a ${to}: ${result.data?.id}`);
      return { success: true };
    } catch (err: any) {
      console.error(`[Email/Resend] Erreur envoi a ${to}:`, err.message);
      return { success: false, error: err.message };
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
      console.log(`[Email/SMTP] Envoye a ${to}: ${info.messageId}`);
      return { success: true };
    } catch (err: any) {
      console.error(`[Email/SMTP] Erreur envoi a ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  console.log(`[Email] Aucun service configure. Email pour ${to}:`);
  console.log(`  Sujet: ${subject}`);
  console.log(`  Contenu texte: ${text.substring(0, 300)}...`);
  return { success: false, error: "Aucun service email configure (ni Resend, ni SMTP)." };
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
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bienvenue, ${adminName} !</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre compte <strong>Agent de Bureau</strong> pour <strong>${orgName}</strong> a ete cree avec succes. 
        Voici toutes les informations pour commencer :
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#166534;font-size:16px;margin:0 0 16px;">&#128272; Votre identifiant de connexion</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;width:140px;">Email</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${loginEmail}</td>
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
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${orgName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;">Plan</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${plan}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;">Cle de licence</td>
            <td style="padding:8px 0;">
              <span style="background:#0f1729;color:#f59e0b;padding:6px 14px;border-radius:8px;font-family:monospace;font-size:14px;font-weight:700;letter-spacing:1px;">${licenseKey}</span>
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
      <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">Vos identifiants de connexion</p>
    </div>

    <div style="padding:32px;">
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bonjour ${prenom} ${nom},</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre compte <strong>Agent de Bureau</strong> a ete cree pour l'organisation <strong>${orgName}</strong>. 
        Voici vos identifiants de connexion :
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#166534;font-size:16px;margin:0 0 16px;">&#128272; Identifiants de connexion</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;width:140px;">Email</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${to}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;">Mot de passe</td>
            <td style="padding:8px 0;">
              <span style="background:#0f1729;color:#f59e0b;padding:6px 14px;border-radius:8px;font-family:monospace;font-size:14px;font-weight:700;letter-spacing:1px;">${password}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;">Role</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${roleLabels[role] || role}</td>
          </tr>
        </table>
      </div>

      <div style="text-align:center;margin:32px 0 16px;">
        <a href="${APP_URL}" style="display:inline-block;background:#0f1729;color:#ffffff;text-decoration:none;padding:14px 48px;border-radius:10px;font-size:15px;font-weight:600;">
          &#128187; Se connecter maintenant
        </a>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-top:24px;">
        <p style="margin:0;color:#92400e;font-size:13px;">
          <strong>&#128274; Important :</strong> Pour votre securite, nous vous recommandons fortement de 
          <strong>changer votre mot de passe</strong> des votre premiere connexion via les parametres de votre compte.
        </p>
      </div>

      <div style="margin-top:24px;padding:20px;background:#f8fafc;border-radius:10px;">
        <h3 style="color:#0f1729;font-size:14px;margin:0 0 12px;">&#128640; Pour commencer</h3>
        <ol style="color:#64748b;font-size:13px;line-height:2;margin:0;padding-left:20px;">
          <li>Connectez-vous avec les identifiants ci-dessus</li>
          <li>Changez votre mot de passe dans les parametres</li>
          <li>Explorez le tableau de bord et les fonctionnalites</li>
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

Votre compte Agent de Bureau a ete cree pour ${orgName}.

IDENTIFIANTS DE CONNEXION:
- Email: ${to}
- Mot de passe: ${password}
- Role: ${roleLabels[role] || role}

ACCES:
- Application: ${APP_URL}

IMPORTANT: Changez votre mot de passe des votre premiere connexion.

Support: support@agentdebureau.fr
Agent de Bureau SAS`;

  return sendEmail(to, `Vos identifiants Agent de Bureau - ${orgName}`, html, text);
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
    ? `<p style="color:#e67e22;font-size:14px;">Votre periode d'essai se termine le <strong>${new Date(trialEndsAt).toLocaleDateString("fr-FR")}</strong>.</p>`
    : "";

  const credentialsSection = (adminEmail && adminPassword) ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#166534;font-size:16px;margin:0 0 16px;">&#128272; Identifiants administrateur</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;width:140px;">Administrateur</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${adminName || adminEmail}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;">Email de connexion</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${adminEmail}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#166534;font-size:13px;">Mot de passe</td>
            <td style="padding:8px 0;">
              <span style="background:#0f1729;color:#f59e0b;padding:6px 14px;border-radius:8px;font-family:monospace;font-size:14px;font-weight:700;letter-spacing:1px;">${adminPassword}</span>
            </td>
          </tr>
        </table>
        <p style="color:#166534;font-size:11px;margin:12px 0 0;font-style:italic;">
          &#9888; Changez votre mot de passe des votre premiere connexion.
        </p>
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
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bienvenue${adminName ? `, ${adminName}` : `, ${orgName}`} !</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre licence <strong>Agent de Bureau</strong> pour <strong>${orgName}</strong> a ete creee avec succes. 
        Voici toutes vos informations d'acces :
      </p>

      ${credentialsSection}

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#0f1729;font-size:16px;margin:0 0 16px;">&#128188; Licence</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;width:140px;">Organisation</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${orgName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;">Plan</td>
            <td style="padding:8px 0;color:#0f1729;font-size:14px;font-weight:600;">${plan}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;">Cle de licence</td>
            <td style="padding:8px 0;">
              <span style="background:#0f1729;color:#f59e0b;padding:6px 14px;border-radius:8px;font-family:monospace;font-size:14px;font-weight:700;letter-spacing:1px;">${licenseKey}</span>
            </td>
          </tr>
        </table>
      </div>

      ${trialInfo}

      <div style="text-align:center;margin:32px 0 16px;">
        <a href="${APP_URL}" style="display:inline-block;background:#0f1729;color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:10px;font-size:15px;font-weight:600;">
          &#128187; Acceder a l'application
        </a>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-top:24px;">
        <p style="margin:0;color:#92400e;font-size:13px;">
          <strong>&#128274; Important :</strong> Conservez cet email en lieu sur. 
          Il contient votre cle de licence${adminPassword ? " et vos identifiants de connexion" : ""}.
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

  const credText = (adminEmail && adminPassword) ? `\nIDENTIFIANTS ADMINISTRATEUR:\n- Administrateur: ${adminName || adminEmail}\n- Email: ${adminEmail}\n- Mot de passe: ${adminPassword}\n- IMPORTANT: Changez votre mot de passe des votre premiere connexion.\n` : "";

  const text = `Bienvenue${adminName ? ` ${adminName}` : ` ${orgName}`} !\n\nVotre licence Agent de Bureau pour ${orgName}:\n- Plan: ${plan}\n- Cle de licence: ${licenseKey}\n${credText}\nAccedez a l'application: ${APP_URL}\n\nPOUR COMMENCER:\n1. Connectez-vous sur ${APP_URL}\n2. Changez votre mot de passe\n3. Ajoutez vos premiers contacts\n4. Gerez vos appels et taches\n5. Invitez vos collaborateurs\n\nConservez cet email en lieu sur.\n\nSupport: support@agentdebureau.fr\nAgent de Bureau SAS`;

  return sendEmail(to, `Votre licence Agent de Bureau - ${orgName}`, html, text);
}
