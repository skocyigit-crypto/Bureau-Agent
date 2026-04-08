import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@agentdebureau.fr";
const APP_URL = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "agentdebureau.fr"}`;

function createTransport() {
  if (!SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
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

      <div style="text-align:center;margin-top:32px;">
        <p style="color:#64748b;font-size:13px;">
          Installez l'application sur votre appareil :<br>
          Ouvrez <a href="${APP_URL}" style="color:#f59e0b;">${APP_URL}</a> dans votre navigateur, 
          puis cliquez sur <strong>"Installer l'application"</strong>.
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

  const transport = createTransport();

  if (!transport) {
    console.log(`[Email] SMTP non configure. Email pour ${to}:`);
    console.log(`  Organisation: ${orgName}`);
    console.log(`  Plan: ${plan}`);
    console.log(`  Licence: ${licenseKey}`);
    return { success: true, preview: "SMTP non configure - email enregistre en log." };
  }

  try {
    const info = await transport.sendMail({
      from: `"Agent de Bureau" <${SMTP_FROM}>`,
      to,
      subject: `Votre licence Agent de Bureau - ${orgName}`,
      text,
      html,
    });
    console.log(`[Email] Licence envoyee a ${to}: ${info.messageId}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[Email] Erreur envoi a ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}
