import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@agentdebureau.fr";
const APP_URL = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "agentdebureau.fr"}`;
const MOBILE_APP_URL = process.env.MOBILE_APP_URL || "";

function createTransport() {
  if (!SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<{ success: boolean; error?: string; preview?: string }> {
  const transport = createTransport();

  if (!transport) {
    console.log(`[Email] SMTP non configure. Email pour ${to}:`);
    console.log(`  Sujet: ${subject}`);
    console.log(`  Contenu texte: ${text.substring(0, 300)}...`);
    return { success: true, preview: "SMTP non configure - email enregistre en log." };
  }

  try {
    const info = await transport.sendMail({
      from: `"Agent de Bureau" <${SMTP_FROM}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(`[Email] Envoye a ${to}: ${info.messageId}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[Email] Erreur envoi a ${to}:`, err.message);
    return { success: false, error: err.message };
  }
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

export async function sendLicenseEmail(params: {
  to: string;
  orgName: string;
  plan: string;
  licenseKey: string;
  trialEndsAt?: Date | null;
}): Promise<{ success: boolean; error?: string; preview?: string }> {
  const { to, orgName, plan, licenseKey, trialEndsAt } = params;

  const trialInfo = trialEndsAt
    ? `<p style="color:#e67e22;font-size:14px;">Votre periode d'essai se termine le <strong>${new Date(trialEndsAt).toLocaleDateString("fr-FR")}</strong>.</p>`
    : "";

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
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Bienvenue, ${orgName} !</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Votre licence <strong>Agent de Bureau</strong> a ete creee avec succes. 
        Voici vos informations d'acces :
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:24px 0;">
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
          Acceder a l'application
        </a>
      </div>

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-top:24px;">
        <p style="margin:0;color:#92400e;font-size:13px;">
          <strong>&#128274; Important :</strong> Conservez votre cle de licence en lieu sur. 
          Elle sera necessaire pour activer votre compte et acceder a toutes les fonctionnalites.
        </p>
      </div>
    </div>

    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">
        &copy; ${new Date().getFullYear()} Agent de Bureau SAS - Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `Bienvenue ${orgName} !\n\nVotre licence Agent de Bureau:\n- Plan: ${plan}\n- Cle de licence: ${licenseKey}\n\nAccedez a l'application: ${APP_URL}\n\nConservez votre cle de licence en lieu sur.`;

  return sendEmail(to, `Votre licence Agent de Bureau - ${orgName}`, html, text);
}
