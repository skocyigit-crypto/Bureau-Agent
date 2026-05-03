import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { eq, and, sql } from "drizzle-orm";
import { db, usersTable, organisationsTable, subscriptionsTable, invitationsTable } from "@workspace/db";
import { sendEmail } from "../services/email";
import { logAudit } from "./audit";

const router: IRouter = Router();
const SALT_ROUNDS = 12;
const INVITATION_EXPIRY_HOURS = 72;

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getAppUrl(): string {
  const base = process.env.REPLIT_DEPLOYMENT_URL
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
    || process.env.APP_URL
    || "https://agentdebureau.fr";
  const appPath = process.env.APP_BASE_PATH || "/buro-ajani";
  return `${base}${appPath}`;
}

router.get("/invitations", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces reserve aux administrateurs." });
    return;
  }

  try {
    const invitations = await db.select().from(invitationsTable)
      .where(eq(invitationsTable.organisationId, organisationId))
      .orderBy(sql`${invitationsTable.createdAt} DESC`);

    const now = new Date();
    const enriched = invitations.map(inv => ({
      ...inv,
      expired: inv.status === "pending" && new Date(inv.expiresAt) < now,
    }));

    res.json({ invitations: enriched });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste invitations");
    res.status(500).json({ error: "Erreur lors de la recuperation des invitations." });
  }
});

router.post("/invitations", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent envoyer des invitations." });
    return;
  }

  const { email, role } = req.body;

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "L'adresse email est obligatoire." });
    return;
  }

  const emailClean = email.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailClean)) {
    res.status(400).json({ error: "Adresse email invalide." });
    return;
  }

  const validRoles = ["administrateur", "agent", "lecture_seule"];
  const assignedRole = role && validRoles.includes(role) ? role : "agent";

  try {
  const existingUser = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, emailClean));
  if (existingUser.length > 0) {
    res.status(409).json({ error: "Un utilisateur avec cet email existe deja dans le systeme." });
    return;
  }

  const [sub] = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.organisationId, organisationId));

  if (sub) {
    const currentUsers = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable)
      .where(eq(usersTable.organisationId, organisationId));
    const userCount = currentUsers[0]?.count || 0;

    const pendingInvites = await db.select({ count: sql<number>`count(*)::int` }).from(invitationsTable)
      .where(and(
        eq(invitationsTable.organisationId, organisationId),
        eq(invitationsTable.status, "pending"),
        sql`${invitationsTable.expiresAt} > NOW()`
      ));
    const pendingCount = pendingInvites[0]?.count || 0;

    if (userCount + pendingCount >= sub.maxUsers) {
      res.status(403).json({
        error: `Limite d'utilisateurs atteinte (${sub.maxUsers} max pour votre plan). Passez a un plan superieur pour inviter plus de collaborateurs.`,
      });
      return;
    }
  }

  const existingPending = await db.select().from(invitationsTable)
    .where(and(
      eq(invitationsTable.organisationId, organisationId),
      eq(invitationsTable.email, emailClean),
      eq(invitationsTable.status, "pending"),
      sql`${invitationsTable.expiresAt} > NOW()`
    ));

  if (existingPending.length > 0) {
    res.status(409).json({ error: "Une invitation en attente existe deja pour cet email." });
    return;
  }

  const [inviter] = await db.select({ nom: usersTable.nom, prenom: usersTable.prenom })
    .from(usersTable).where(eq(usersTable.id, userId));
  const inviterName = inviter ? `${inviter.prenom} ${inviter.nom}` : "Administrateur";

  const [org] = await db.select({ name: organisationsTable.name })
    .from(organisationsTable).where(eq(organisationsTable.id, organisationId));
  const orgName = org?.name || "Agent de Bureau";

  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);

  const [invitation] = await db.insert(invitationsTable).values({
    organisationId,
    email: emailClean,
    role: assignedRole,
    token,
    invitedBy: userId,
    invitedByName: inviterName,
    expiresAt,
  }).returning();

  const appUrl = getAppUrl();
  const acceptUrl = `${appUrl}/invitation/${token}`;

  const roleLabels: Record<string, string> = {
    administrateur: "Administrateur",
    agent: "Agent",
    lecture_seule: "Lecture seule",
  };

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#0f1729 0%,#1e293b 100%);padding:40px 32px;text-align:center;">
        <div style="width:64px;height:64px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <span style="font-size:28px;">&#128588;</span>
        </div>
        <h1 style="color:#ffffff;font-size:24px;font-weight:700;margin:0 0 8px;">Vous etes invite !</h1>
        <p style="color:#94a3b8;font-size:14px;margin:0;">Rejoignez l'equipe sur Agent de Bureau</p>
      </div>
      <div style="padding:32px;">
        <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 20px;">
          Bonjour,<br><br>
          <strong style="color:#0f1729;">${inviterName}</strong> vous invite a rejoindre
          <strong style="color:#f59e0b;">${orgName}</strong> sur Agent de Bureau.
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 0 24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0;color:#64748b;font-size:13px;">Organisation</td>
              <td style="padding:6px 0;color:#0f1729;font-size:13px;font-weight:600;text-align:right;">${orgName}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#64748b;font-size:13px;">Role attribue</td>
              <td style="padding:6px 0;color:#0f1729;font-size:13px;font-weight:600;text-align:right;">${roleLabels[assignedRole] || assignedRole}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#64748b;font-size:13px;">Expire dans</td>
              <td style="padding:6px 0;color:#0f1729;font-size:13px;font-weight:600;text-align:right;">${INVITATION_EXPIRY_HOURS} heures</td>
            </tr>
          </table>
        </div>
        <div style="text-align:center;margin:32px 0;">
          <a href="${acceptUrl}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#0f1729;text-decoration:none;padding:16px 48px;border-radius:12px;font-size:16px;font-weight:700;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
            Accepter l'invitation
          </a>
        </div>
        <p style="color:#94a3b8;font-size:12px;text-align:center;margin:16px 0 0;">
          Ou copiez ce lien : <a href="${acceptUrl}" style="color:#f59e0b;word-break:break-all;">${acceptUrl}</a>
        </p>
        <div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:20px;">
          <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">
            &#128274; Cette invitation est securisee et a usage unique. Elle expire automatiquement apres ${INVITATION_EXPIRY_HOURS} heures.
            Si vous n'avez pas demande cette invitation, ignorez cet email.
          </p>
        </div>
      </div>
      <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="color:#94a3b8;font-size:11px;margin:0;">Agent de Bureau SAS &mdash; Solution professionnelle de gestion de bureau</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const text = `Vous etes invite a rejoindre ${orgName} sur Agent de Bureau !\n\n${inviterName} vous invite en tant que ${roleLabels[assignedRole] || assignedRole}.\n\nAcceptez l'invitation : ${acceptUrl}\n\nCette invitation expire dans ${INVITATION_EXPIRY_HOURS} heures.\n\nAgent de Bureau SAS`;

  const emailResult = await sendEmail(emailClean, `Invitation a rejoindre ${orgName} — Agent de Bureau`, html, text);

  logAudit(userId, "", "invitation_sent", "invitation", String(invitation.id), { email: emailClean, role: assignedRole }, req.ip, req.get("user-agent"));

  res.status(201).json({
    invitation: { ...invitation, expired: false },
    emailSent: emailResult.success,
    message: emailResult.success
      ? `Invitation envoyee a ${emailClean}`
      : `Invitation creee mais l'email n'a pas pu etre envoye: ${emailResult.error}`,
  });
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation invitation");
    res.status(500).json({ error: "Erreur lors de l'envoi de l'invitation." });
  }
});

router.post("/invitations/:id/resend", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;
  const invitationId = parseInt(String(req.params.id));

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces reserve aux administrateurs." });
    return;
  }

  try {
  const [invitation] = await db.select().from(invitationsTable)
    .where(and(eq(invitationsTable.id, invitationId), eq(invitationsTable.organisationId, organisationId)));

  if (!invitation) {
    res.status(404).json({ error: "Invitation non trouvee." });
    return;
  }

  if (invitation.status !== "pending") {
    res.status(400).json({ error: "Cette invitation a deja ete utilisee." });
    return;
  }

  const newToken = generateSecureToken();
  const newExpiresAt = new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.update(invitationsTable).set({ token: newToken, expiresAt: newExpiresAt }).where(eq(invitationsTable.id, invitationId));

  const [org] = await db.select({ name: organisationsTable.name })
    .from(organisationsTable).where(eq(organisationsTable.id, organisationId));
  const orgName = org?.name || "Agent de Bureau";

  const appUrl = getAppUrl();
  const acceptUrl = `${appUrl}/invitation/${newToken}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#0f1729 0%,#1e293b 100%);padding:32px;text-align:center;">
        <h1 style="color:#ffffff;font-size:22px;margin:0;">Rappel d'invitation</h1>
        <p style="color:#94a3b8;font-size:14px;margin:8px 0 0;">Rejoignez ${orgName} sur Agent de Bureau</p>
      </div>
      <div style="padding:32px;text-align:center;">
        <p style="color:#334155;font-size:15px;line-height:1.7;">Votre invitation est toujours valable ! Cliquez ci-dessous pour creer votre compte.</p>
        <a href="${acceptUrl}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#0f1729;text-decoration:none;padding:16px 48px;border-radius:12px;font-size:16px;font-weight:700;margin:24px 0;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
          Accepter l'invitation
        </a>
        <p style="color:#94a3b8;font-size:12px;margin:16px 0 0;">Expire dans ${INVITATION_EXPIRY_HOURS} heures</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const emailResult = await sendEmail(invitation.email, `Rappel : Invitation a rejoindre ${orgName}`, html, `Rappel: Acceptez votre invitation : ${acceptUrl}`);

  res.json({ success: true, emailSent: emailResult.success });
  } catch (err: any) {
    req.log.error({ err }, "Erreur renvoi invitation");
    res.status(500).json({ error: "Erreur lors du renvoi de l'invitation." });
  }
});

router.delete("/invitations/:id", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;
  const invitationId = parseInt(String(req.params.id));

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces reserve aux administrateurs." });
    return;
  }

  try {
    const [invitation] = await db.select().from(invitationsTable)
      .where(and(eq(invitationsTable.id, invitationId), eq(invitationsTable.organisationId, organisationId)));

    if (!invitation) {
      res.status(404).json({ error: "Invitation non trouvee." });
      return;
    }

    await db.update(invitationsTable).set({ status: "cancelled" }).where(eq(invitationsTable.id, invitationId));
    res.json({ success: true, message: "Invitation annulee." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur annulation invitation");
    res.status(500).json({ error: "Erreur lors de l'annulation de l'invitation." });
  }
});

router.get("/invitations/verify/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token);

  try {
    const [invitation] = await db.select({
      id: invitationsTable.id,
      email: invitationsTable.email,
      role: invitationsTable.role,
      status: invitationsTable.status,
      expiresAt: invitationsTable.expiresAt,
      invitedByName: invitationsTable.invitedByName,
      orgId: invitationsTable.organisationId,
    }).from(invitationsTable).where(eq(invitationsTable.token, token));

    if (!invitation) {
      res.status(404).json({ error: "Invitation invalide ou introuvable.", valid: false });
      return;
    }

    if (invitation.status !== "pending") {
      res.status(410).json({ error: "Cette invitation a deja ete utilisee.", valid: false });
      return;
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      res.status(410).json({ error: "Cette invitation a expire. Demandez une nouvelle invitation a votre administrateur.", valid: false });
      return;
    }

    const [org] = await db.select({ name: organisationsTable.name })
      .from(organisationsTable).where(eq(organisationsTable.id, invitation.orgId));

    res.json({
      valid: true,
      email: invitation.email,
      role: invitation.role,
      organisationName: org?.name || "Agent de Bureau",
      invitedBy: invitation.invitedByName,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur verification token invitation");
    res.status(500).json({ error: "Erreur lors de la verification de l'invitation.", valid: false });
  }
});

router.post("/invitations/accept/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params.token);
  const { nom, prenom, password } = req.body;

  if (!nom || !prenom || !password) {
    res.status(400).json({ error: "Nom, prenom et mot de passe sont obligatoires." });
    return;
  }

  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres." });
    return;
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  if (!hasUppercase || !hasLowercase || !hasNumber) {
    res.status(400).json({ error: "Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre." });
    return;
  }

  try {
    const [invitation] = await db.select().from(invitationsTable).where(eq(invitationsTable.token, token));

    if (!invitation) {
      res.status(404).json({ error: "Invitation invalide." });
      return;
    }

    if (invitation.status !== "pending") {
      res.status(410).json({ error: "Cette invitation a deja ete utilisee." });
      return;
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      res.status(410).json({ error: "Cette invitation a expire." });
      return;
    }

    const existingUser = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, invitation.email));
    if (existingUser.length > 0) {
      res.status(409).json({ error: "Un compte existe deja avec cet email." });
      return;
    }

    const [org] = await db.select({ name: organisationsTable.name })
      .from(organisationsTable).where(eq(organisationsTable.id, invitation.organisationId));

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const avatar = `${(prenom as string)[0]}${(nom as string)[0]}`.toUpperCase();

    const [newUser] = await db.insert(usersTable).values({
      email: invitation.email,
      passwordHash,
      nom,
      prenom,
      role: invitation.role,
      organisation: org?.name || "Agent de Bureau",
      organisationId: invitation.organisationId,
      avatar,
    }).returning({
      id: usersTable.id,
      email: usersTable.email,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
    });

    await db.update(invitationsTable).set({
      status: "accepted",
      acceptedAt: new Date(),
    }).where(eq(invitationsTable.id, invitation.id));

    (req.session as any).userId = newUser.id;
    (req.session as any).userRole = newUser.role;
    (req.session as any).organisationId = invitation.organisationId;
    (req.session as any).userEmail = newUser.email;

    logAudit(newUser.id, newUser.email, "invitation_accepted", "invitation", String(invitation.id), { role: invitation.role }, req.ip, req.get("user-agent"));

    res.status(201).json({
      success: true,
      user: newUser,
      message: `Bienvenue ${prenom} ! Votre compte a ete cree avec succes.`,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur acceptation invitation");
    res.status(500).json({ error: "Erreur lors de l'acceptation de l'invitation." });
  }
});

export default router;
