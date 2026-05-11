import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { db, usersTable, organisationsTable } from "@workspace/db";
import { logAudit } from "./audit";
import { sendCredentialsEmail, sendEmail } from "../services/email";
import { logger } from "../lib/logger";
import {
  isSuperAdmin,
  assertRoleAllowed,
  assertOrgOwnsUser,
  assertTargetNotSuperAdmin,
  assertCallerOutranks,
  assertUserQuotaNotExceeded,
  assertNotSelf,
  sanitiseUserPatch,
  logTenantViolation,
  checkSensitiveRateLimit,
} from "../middleware/tenant-guard";

const router: IRouter = Router();

const SALT_ROUNDS = (() => {
  const raw = parseInt(String(process.env.BCRYPT_SALT_ROUNDS || ""), 10);
  return Number.isFinite(raw) && raw >= 10 && raw <= 15 ? raw : 12;
})();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Reessayez dans 15 minutes." },
  skipSuccessfulRequests: true,
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de demandes de reinitialisation. Reessayez dans 1 heure." },
});

router.post("/auth/login", loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password, totpCode } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email et mot de passe sont obligatoires." });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));

    if (!user) {
      res.status(401).json({ error: "Identifiants invalides." });
      return;
    }

    if (!user.actif) {
      res.status(403).json({ error: "Ce compte est desactive. Contactez votre administrateur." });
      return;
    }

    if (user.verrouilleJusqua && new Date(user.verrouilleJusqua) > new Date()) {
      const remaining = Math.ceil((new Date(user.verrouilleJusqua).getTime() - Date.now()) / 60000);
      res.status(423).json({ error: `Compte verrouille. Reessayez dans ${remaining} minute(s).` });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      const newAttempts = user.tentativesEchouees + 1;
      const updateData: Record<string, any> = { tentativesEchouees: newAttempts };

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.verrouilleJusqua = new Date(Date.now() + LOCKOUT_DURATION_MS);
      }

      await db.update(usersTable).set(updateData).where(eq(usersTable.id, user.id));
      res.status(401).json({ error: "Identifiants invalides." });
      return;
    }

    if (user.mfaActif && user.mfaSecret) {
      if (!totpCode || typeof totpCode !== "string") {
        res.status(200).json({ requiresMfa: true, message: "Code TOTP requis." });
        return;
      }
      const { verifyMfaToken } = await import("../services/mfa");
      if (!verifyMfaToken(totpCode, user.mfaSecret)) {
        const newAttempts = user.tentativesEchouees + 1;
        const updateData: Record<string, any> = { tentativesEchouees: newAttempts };
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          updateData.verrouilleJusqua = new Date(Date.now() + LOCKOUT_DURATION_MS);
        }
        await db.update(usersTable).set(updateData).where(eq(usersTable.id, user.id));
        res.status(401).json({ error: "Code TOTP invalide.", requiresMfa: true });
        return;
      }
    }

    await db.update(usersTable).set({
      tentativesEchouees: 0,
      verrouilleJusqua: null,
      dernierAcces: new Date(),
    }).where(eq(usersTable.id, user.id));

    // Prevention de la fixation de session: regenerer l'ID avant d'attacher l'identite.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => err ? reject(err) : resolve());
    });

    (req.session as any).userId = user.id;
    (req.session as any).userRole = user.role;
    (req.session as any).organisationId = user.organisationId;
    (req.session as any).userEmail = user.email;
    (req.session as any).loginIp = req.ip;
    (req.session as any).loginUserAgent = req.get("user-agent");
    (req.session as any).loginAt = Date.now();

    logAudit(user.id, user.email, "login", "auth", undefined, { role: user.role, mfaUsed: user.mfaActif, ip: req.ip, ua: req.get("user-agent") }, req.ip, req.get("user-agent"));

    // Notification de nouvelle connexion (best-effort, ne bloque pas la reponse)
    void sendLoginNotificationIfNew(user, req.ip, req.get("user-agent")).catch(err => req.log.error({ err }, "Erreur notif login"));

    res.json({
      id: user.id,
      email: user.email,
      nom: user.nom,
      prenom: user.prenom,
      role: user.role,
      departement: user.departement,
      organisation: user.organisation,
      organisationId: user.organisationId,
      avatar: user.avatar,
      mfaActif: user.mfaActif,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur login");
    res.status(500).json({ error: "Erreur lors de la connexion." });
  }
});

router.post("/auth/mfa/setup", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable." }); return; }
    if (user.mfaActif) { res.status(400).json({ error: "MFA deja active. Desactivez-la avant de reconfigurer." }); return; }
    const { generateMfaSecret, buildMfaOtpAuthUrl, buildMfaQrDataUrl } = await import("../services/mfa");
    const secret = generateMfaSecret();
    const otpAuthUrl = buildMfaOtpAuthUrl(user.email, secret);
    const qrDataUrl = await buildMfaQrDataUrl(otpAuthUrl);
    await db.update(usersTable).set({ mfaSecret: secret, mfaActif: false, updatedAt: new Date() }).where(eq(usersTable.id, userId));
    res.json({ secret, otpAuthUrl, qrDataUrl });
  } catch (err: any) {
    req.log.error({ err }, "Erreur MFA setup");
    res.status(500).json({ error: "Erreur lors de la configuration MFA." });
  }
});

router.post("/auth/mfa/enable", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  const { totpCode } = req.body;
  if (!totpCode || typeof totpCode !== "string") { res.status(400).json({ error: "Code TOTP requis." }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user || !user.mfaSecret) { res.status(400).json({ error: "Lancez d'abord la configuration MFA." }); return; }
    const { verifyMfaToken } = await import("../services/mfa");
    if (!verifyMfaToken(totpCode, user.mfaSecret)) { res.status(400).json({ error: "Code TOTP invalide." }); return; }
    await db.update(usersTable).set({ mfaActif: true, updatedAt: new Date() }).where(eq(usersTable.id, userId));
    logAudit(userId, user.email, "mfa_enabled", "user", String(userId), undefined, req.ip, req.get("user-agent"));
    res.json({ message: "Authentification a deux facteurs activee." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur MFA enable");
    res.status(500).json({ error: "Erreur lors de l'activation MFA." });
  }
});

router.post("/auth/mfa/disable", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  const { password, totpCode } = req.body;
  if (!password) { res.status(400).json({ error: "Mot de passe requis pour desactiver MFA." }); return; }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "Utilisateur introuvable." }); return; }
    const pwOk = await bcrypt.compare(password, user.passwordHash);
    if (!pwOk) { res.status(401).json({ error: "Mot de passe incorrect." }); return; }
    if (user.mfaActif && user.mfaSecret) {
      const { verifyMfaToken } = await import("../services/mfa");
      if (!totpCode || !verifyMfaToken(totpCode, user.mfaSecret)) { res.status(400).json({ error: "Code TOTP invalide." }); return; }
    }
    await db.update(usersTable).set({ mfaActif: false, mfaSecret: null, updatedAt: new Date() }).where(eq(usersTable.id, userId));
    logAudit(userId, user.email, "mfa_disabled", "user", String(userId), undefined, req.ip, req.get("user-agent"));
    res.json({ message: "Authentification a deux facteurs desactivee." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur MFA disable");
    res.status(500).json({ error: "Erreur lors de la desactivation MFA." });
  }
});

router.get("/auth/mfa/status", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  try {
    const [user] = await db.select({ mfaActif: usersTable.mfaActif, hasSecret: usersTable.mfaSecret }).from(usersTable).where(eq(usersTable.id, userId));
    res.json({ mfaActif: user?.mfaActif ?? false, setupInProgress: !!user?.hasSecret && !user?.mfaActif });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur." });
  }
});

router.post("/auth/complete-onboarding", (req: Request, res: Response): void => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  res.json({ success: true });
});

router.post("/auth/logout", (req: Request, res: Response): void => {
  const userId = (req.session as any)?.userId;
  const userEmail = (req.session as any)?.userEmail;
  if (userId) logAudit(userId, userEmail, "logout", "auth");
  res.clearCookie("adb.sid", { path: "/" });
  if (req.session) {
    req.session.destroy(() => {
      res.json({ message: "Deconnecte avec succes." });
    });
  } else {
    res.json({ message: "Deconnecte avec succes." });
  }
});

router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;

  if (!userId) {
    res.status(401).json({ error: "Non authentifie." });
    return;
  }

  try {
    const [user] = await db.select({
      id: usersTable.id,
      email: usersTable.email,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
      departement: usersTable.departement,
      organisation: usersTable.organisation,
      organisationId: usersTable.organisationId,
      telephone: usersTable.telephone,
      avatar: usersTable.avatar,
      mfaActif: usersTable.mfaActif,
      actif: usersTable.actif,
      dernierAcces: usersTable.dernierAcces,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(eq(usersTable.id, userId));

    if (!user || !user.actif) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Session invalide." });
      return;
    }

    res.json(user);
  } catch (err: any) {
    req.log.error({ err }, "Erreur auth/me");
    res.status(500).json({ error: "Erreur lors de la verification de session." });
  }
});

router.post("/auth/change-password", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Mot de passe actuel et nouveau mot de passe sont obligatoires." });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: "Le nouveau mot de passe doit contenir au moins 8 caracteres." });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(401).json({ error: "Utilisateur non trouve." }); return; }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) { res.status(401).json({ error: "Mot de passe actuel incorrect." }); return; }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.update(usersTable).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(usersTable.id, userId));

    res.json({ message: "Mot de passe modifie avec succes." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur changement mot de passe");
    res.status(500).json({ error: "Erreur lors du changement de mot de passe." });
  }
});

router.get("/auth/users", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;

  if (!userId || (userRole !== "super_admin" && userRole !== "administrateur")) {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }

  try {
    const conditions = [];
    if (organisationId) {
      conditions.push(eq(usersTable.organisationId, organisationId));
    }

    const users = await db.select({
      id: usersTable.id,
      email: usersTable.email,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
      departement: usersTable.departement,
      organisation: usersTable.organisation,
      organisationId: usersTable.organisationId,
      actif: usersTable.actif,
      mfaActif: usersTable.mfaActif,
      dernierAcces: usersTable.dernierAcces,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({ users, total: users.length });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste utilisateurs");
    res.status(500).json({ error: "Erreur lors de la recuperation des utilisateurs." });
  }
});

router.post("/auth/users", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent creer des utilisateurs." });
    return;
  }

  const { email, password, nom, prenom, role, departement, organisation, telephone } = req.body;

  if (!email || !password || !nom || !prenom) {
    res.status(400).json({ error: "Email, mot de passe, nom et prenom sont obligatoires." });
    return;
  }
  if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    res.status(400).json({ error: "Format d'email invalide." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres." });
    return;
  }
  if (typeof nom !== "string" || nom.trim().length < 1 || nom.length > 100 || typeof prenom !== "string" || prenom.trim().length < 1 || prenom.length > 100) {
    res.status(400).json({ error: "Nom et prenom doivent contenir entre 1 et 100 caracteres." });
    return;
  }
  if (telephone !== undefined && telephone !== null && telephone !== "" && (typeof telephone !== "string" || telephone.length > 30)) {
    res.status(400).json({ error: "Telephone invalide." });
    return;
  }

  // ── GUARD: prevent role escalation to super_admin by tenant admins ──────────
  if (!assertRoleAllowed(req, res, role)) return;

  // ── GUARD: enforce user quota ───────────────────────────────────────────────
  if (organisationId && !isSuperAdmin(req)) {
    if (!(await assertUserQuotaNotExceeded(req, res, organisationId))) return;
  }

  // ── GUARD: rate-limit user creation ────────────────────────────────────────
  if (!checkSensitiveRateLimit(req, res, "create_user", 30, 60_000)) return;

  const validRoles = ["super_admin", "administrateur", "agent", "lecture_seule"];
  if (role && !validRoles.includes(role)) {
    res.status(400).json({ error: "Role invalide." });
    return;
  }

  try {
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
    if (existing.length > 0) {
      res.status(409).json({ error: "Un utilisateur avec cet email existe deja." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const avatar = `${(prenom as string)[0]}${(nom as string)[0]}`.toUpperCase();

    const [newUser] = await db.insert(usersTable).values({
      email: email.toLowerCase().trim(),
      passwordHash,
      nom,
      prenom,
      role: role || "agent",
      departement,
      organisation: organisation || "Agent de Bureau SAS",
      organisationId: organisationId || null,
      telephone,
      avatar,
    }).returning({
      id: usersTable.id,
      email: usersTable.email,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
      departement: usersTable.departement,
      organisation: usersTable.organisation,
      actif: usersTable.actif,
      createdAt: usersTable.createdAt,
    });

    let orgName = organisation || "Agent de Bureau";
    if (organisationId) {
      const [org] = await db.select({ name: organisationsTable.name }).from(organisationsTable).where(eq(organisationsTable.id, organisationId));
      if (org) orgName = org.name;
    }

    const emailResult = await sendCredentialsEmail({
      to: email.toLowerCase().trim(),
      prenom,
      nom,
      password,
      orgName,
      role: role || "agent",
    });

    logAudit((req.session as any)?.userId, (req.session as any)?.userEmail, "create_user", "user", String(newUser.id), { targetEmail: email, role: role || "agent" }, req.ip, req.get("user-agent"));

    res.status(201).json({
      ...newUser,
      emailSent: emailResult.success,
      emailNote: emailResult.success ? "Identifiants envoyes par email." : "Utilisateur cree. Envoi email echoue.",
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation utilisateur");
    res.status(500).json({ error: "Erreur lors de la creation de l'utilisateur." });
  }
});

router.patch("/auth/users/:id", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }

  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  // ── GUARD: verify target user belongs to caller's org ──────────────────────
  const ownership = await assertOrgOwnsUser(req, res, id);
  if (!ownership.ok) return;
  const targetUser = ownership.user;

  // ── GUARD: cannot modify super_admin accounts ───────────────────────────────
  if (!assertTargetNotSuperAdmin(req, res, targetUser)) return;

  // ── GUARD: caller must outrank target ───────────────────────────────────────
  if (!assertCallerOutranks(req, res, targetUser.role)) return;

  // ── GUARD: prevent role escalation ─────────────────────────────────────────
  const { role } = req.body;
  if (role !== undefined && !assertRoleAllowed(req, res, role)) return;

  // ── Sanitise: strip unexpected / dangerous fields ───────────────────────────
  const clean = sanitiseUserPatch(req.body);
  const updateData: Record<string, any> = { updatedAt: new Date() };

  // ── GUARD: cannot deactivate own account ───────────────────────────────────
  if (clean.actif === false && !assertNotSelf(req, res, id)) return;

  if (clean.nom !== undefined) {
    if (typeof clean.nom !== "string" || clean.nom.trim().length < 1 || clean.nom.length > 100) {
      res.status(400).json({ error: "Nom invalide (1-100 caracteres)." }); return;
    }
    updateData.nom = clean.nom;
  }
  if (clean.prenom !== undefined) {
    if (typeof clean.prenom !== "string" || clean.prenom.trim().length < 1 || clean.prenom.length > 100) {
      res.status(400).json({ error: "Prenom invalide (1-100 caracteres)." }); return;
    }
    updateData.prenom = clean.prenom;
  }
  if (clean.role !== undefined) updateData.role = clean.role;
  if (clean.departement !== undefined) updateData.departement = clean.departement;
  if (clean.telephone !== undefined) {
    if (clean.telephone !== null && clean.telephone !== "" && (typeof clean.telephone !== "string" || clean.telephone.length > 30)) {
      res.status(400).json({ error: "Telephone invalide." }); return;
    }
    updateData.telephone = clean.telephone;
  }
  if (clean.actif !== undefined) updateData.actif = clean.actif;
  if (clean.prenom && clean.nom) updateData.avatar = `${clean.prenom[0]}${clean.nom[0]}`.toUpperCase();

  if (clean.password) {
    if (clean.password.length < 8) {
      res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres." });
      return;
    }
    updateData.passwordHash = await bcrypt.hash(clean.password, SALT_ROUNDS);
  }

  try {
    const [updated] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning({
      id: usersTable.id,
      email: usersTable.email,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
      actif: usersTable.actif,
    });

    if (!updated) { res.status(404).json({ error: "Utilisateur non trouve." }); return; }

    logAudit((req.session as any)?.userId, (req.session as any)?.userEmail, "update_user", "user", String(id), { fields: Object.keys(updateData) }, req.ip, req.get("user-agent"));
    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour utilisateur");
    res.status(500).json({ error: "Erreur lors de la mise a jour de l'utilisateur." });
  }
});

router.delete("/auth/users/:id", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }

  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  // ── GUARD: cannot delete own account ───────────────────────────────────────
  if (!assertNotSelf(req, res, id)) return;

  // ── GUARD: verify target user belongs to caller's org ──────────────────────
  const ownership = await assertOrgOwnsUser(req, res, id);
  if (!ownership.ok) return;
  const targetUser = ownership.user;

  // ── GUARD: cannot delete super_admin accounts ───────────────────────────────
  if (!assertTargetNotSuperAdmin(req, res, targetUser)) return;

  // ── GUARD: caller must outrank target ───────────────────────────────────────
  if (!assertCallerOutranks(req, res, targetUser.role)) return;

  try {
    const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Utilisateur non trouve." }); return; }

    logAudit((req.session as any)?.userId, (req.session as any)?.userEmail, "delete_user", "user", String(id), { targetEmail: targetUser.email, targetRole: targetUser.role }, req.ip, req.get("user-agent"));
    res.status(204).send();
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression utilisateur");
    res.status(500).json({ error: "Erreur lors de la suppression de l'utilisateur." });
  }
});

function generateTempCode(): string {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += digits[crypto.randomInt(digits.length)];
  }
  return code;
}

function generateSecurePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*";
  const all = upper + lower + digits + special;

  let pw = "";
  pw += upper[crypto.randomInt(upper.length)];
  pw += lower[crypto.randomInt(lower.length)];
  pw += digits[crypto.randomInt(digits.length)];
  pw += special[crypto.randomInt(special.length)];

  for (let i = 4; i < 12; i++) {
    pw += all[crypto.randomInt(all.length)];
  }

  return pw.split("").sort(() => crypto.randomInt(3) - 1).join("");
}

router.post("/auth/users/:id/send-credentials", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;
  const sessionUserId = (req.session as any)?.userId;

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }

  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const conditions = [eq(usersTable.id, id)];
    if (organisationId && userRole !== "super_admin") {
      conditions.push(eq(usersTable.organisationId, organisationId));
    }

    const [user] = await db.select({ id: usersTable.id, email: usersTable.email, nom: usersTable.nom, prenom: usersTable.prenom, role: usersTable.role, organisation: usersTable.organisation, organisationId: usersTable.organisationId }).from(usersTable).where(and(...conditions));
    if (!user) { res.status(404).json({ error: "Utilisateur non trouve." }); return; }

    const tempCode = generateTempCode();
    const passwordHash = await bcrypt.hash(tempCode, SALT_ROUNDS);

    await db.update(usersTable).set({
      passwordHash,
      tentativesEchouees: 0,
      verrouilleJusqua: null,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, id));

    let orgName = user.organisation || "Agent de Bureau";
    if (user.organisationId) {
      const [org] = await db.select({ name: organisationsTable.name }).from(organisationsTable).where(eq(organisationsTable.id, user.organisationId));
      if (org) orgName = org.name;
    }

    const emailResult = await sendCredentialsEmail({
      to: user.email,
      prenom: user.prenom,
      nom: user.nom,
      password: tempCode,
      orgName,
      role: user.role,
    });

    logAudit(sessionUserId, (req.session as any)?.userEmail, "send_credentials", "user", String(id), { targetEmail: user.email }, req.ip, req.get("user-agent"));

    if (emailResult.success) {
      res.json({
        message: `Code de connexion temporaire genere et envoye a ${user.email}.`,
        preview: emailResult.preview,
      });
    } else {
      logger.warn({ err: emailResult.error }, "Envoi credentials email echoue");
      res.status(500).json({ error: "Mot de passe mis a jour mais erreur lors de l'envoi de l'email." });
    }
  } catch (err: any) {
    req.log.error({ err }, "Erreur envoi credentials");
    res.status(500).json({ error: "Erreur lors de l'envoi des identifiants." });
  }
});

router.post("/auth/users/create-and-send", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;
  const sessionUserId = (req.session as any)?.userId;

  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Seuls les administrateurs peuvent creer des utilisateurs." });
    return;
  }

  const { email, nom, prenom, role, departement, organisation, telephone } = req.body;

  if (!email || !nom || !prenom) {
    res.status(400).json({ error: "Email, nom et prenom sont obligatoires." });
    return;
  }

  // ── GUARD: prevent role escalation ─────────────────────────────────────────
  if (!assertRoleAllowed(req, res, role)) return;

  // ── GUARD: enforce user quota ───────────────────────────────────────────────
  if (organisationId && !isSuperAdmin(req)) {
    if (!(await assertUserQuotaNotExceeded(req, res, organisationId))) return;
  }

  // ── GUARD: rate-limit ───────────────────────────────────────────────────────
  if (!checkSensitiveRateLimit(req, res, "create_user", 30, 60_000)) return;

  const validRoles = ["super_admin", "administrateur", "agent", "lecture_seule"];
  if (role && !validRoles.includes(role)) {
    res.status(400).json({ error: "Role invalide." });
    return;
  }

  try {
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
    if (existing.length > 0) {
      res.status(409).json({ error: "Un utilisateur avec cet email existe deja." });
      return;
    }

    const generatedPassword = generateSecurePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, SALT_ROUNDS);
    const avatar = `${(prenom as string)[0]}${(nom as string)[0]}`.toUpperCase();

    const [newUser] = await db.insert(usersTable).values({
      email: email.toLowerCase().trim(),
      passwordHash,
      nom,
      prenom,
      role: role || "agent",
      departement,
      organisation: organisation || "Agent de Bureau SAS",
      organisationId: organisationId || null,
      telephone,
      avatar,
    }).returning({
      id: usersTable.id,
      email: usersTable.email,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
      role: usersTable.role,
      departement: usersTable.departement,
      organisation: usersTable.organisation,
      actif: usersTable.actif,
      createdAt: usersTable.createdAt,
    });

    let orgName = organisation || "Agent de Bureau";
    if (organisationId) {
      const [org] = await db.select({ name: organisationsTable.name }).from(organisationsTable).where(eq(organisationsTable.id, organisationId));
      if (org) orgName = org.name;
    }

    const emailResult = await sendCredentialsEmail({
      to: email.toLowerCase().trim(),
      prenom,
      nom,
      password: generatedPassword,
      orgName,
      role: role || "agent",
    });

    logAudit(sessionUserId, (req.session as any)?.userEmail, "create_and_send_credentials", "user", String(newUser.id), { targetEmail: email }, req.ip, req.get("user-agent"));

    res.status(201).json({
      ...newUser,
      emailSent: emailResult.success,
      emailNote: emailResult.preview || (emailResult.success ? "Identifiants envoyes par email." : "Utilisateur cree. Envoi email echoue."),
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation et envoi utilisateur");
    res.status(500).json({ error: "Erreur lors de la creation de l'utilisateur." });
  }
});

router.post("/auth/users/bulk/deactivate", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;
  const sessionUserId = (req.session as any)?.userId;
  if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces interdit." }); return; }
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
  const safeIds = ids.filter(id => id !== sessionUserId);
  if (safeIds.length === 0) { res.status(400).json({ error: "Impossible de desactiver votre propre compte." }); return; }
  try {
    const conditions = [inArray(usersTable.id, safeIds), ne(usersTable.role, "super_admin")];
    if (organisationId) conditions.push(eq(usersTable.organisationId, organisationId));
    await db.update(usersTable).set({ actif: false }).where(and(...conditions));
    res.json({ success: true, updated: safeIds.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk deactivate users error");
    res.status(500).json({ error: "Erreur lors de la desactivation." });
  }
});

router.post("/auth/users/bulk/delete", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;
  const sessionUserId = (req.session as any)?.userId;
  if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces interdit." }); return; }
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
  const safeIds = ids.filter(id => id !== sessionUserId);
  if (safeIds.length === 0) { res.status(400).json({ error: "Impossible de supprimer votre propre compte." }); return; }
  try {
    const conditions = [inArray(usersTable.id, safeIds), ne(usersTable.role, "super_admin")];
    if (organisationId) conditions.push(eq(usersTable.organisationId, organisationId));
    const result = await db.delete(usersTable).where(and(...conditions));
    res.json({ deleted: result.rowCount ?? safeIds.length });
  } catch (err: any) {
    logger.error({ err }, "Bulk delete users error");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

router.get("/auth/users/export/csv", async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.session as any)?.userRole;
  const organisationId = (req.session as any)?.organisationId;
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces interdit." });
    return;
  }
  try {
    const conditions = [];
    if (organisationId) conditions.push(eq(usersTable.organisationId, organisationId));
    const users = await db.select({
      id: usersTable.id, email: usersTable.email, nom: usersTable.nom,
      prenom: usersTable.prenom, role: usersTable.role,
      departement: usersTable.departement, actif: usersTable.actif,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(conditions.length > 0 ? and(...conditions) : undefined);

    const header = "ID,Email,Prenom,Nom,Role,Departement,Actif,Date creation\n";
    const rows = users.map(u =>
      [u.id, u.email, u.prenom || "", u.nom || "", u.role, u.departement || "", u.actif ? "oui" : "non",
        u.createdAt ? new Date(u.createdAt).toLocaleDateString("fr-FR") : ""].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="utilisateurs_${Date.now()}.csv"`);
    res.send("\uFEFF" + header + rows);
  } catch (err: any) {
    req.log.error({ err }, "Erreur export users CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.post("/auth/forgot-password", resetLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email obligatoire." });
    return;
  }

  const emailClean = email.toLowerCase().trim();

  try {
    const [user] = await db.select({ id: usersTable.id, email: usersTable.email, prenom: usersTable.prenom, nom: usersTable.nom, actif: usersTable.actif })
      .from(usersTable).where(eq(usersTable.email, emailClean));

    if (!user || !user.actif) {
      res.json({ message: "Si un compte existe avec cet email, un lien de reinitialisation a ete envoye." });
      return;
    }

    const token = crypto.randomBytes(48).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    await db.update(usersTable).set({
      resetPasswordToken: tokenHash,
      resetPasswordExpiry: expiry,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, user.id));

    const appUrl = process.env.PUBLIC_URL
      || process.env.APP_URL
      || process.env.REPLIT_DEPLOYMENT_URL
      || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null)
      || "https://agentdebureau.fr";
    const appBase = process.env.APP_BASE_PATH || "/buro-ajani";
    const resetLink = `${appUrl}${appBase}?reset_token=${token}`;

    const html = `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
        <h2 style="color:#1a2744">Reinitialisation de votre mot de passe</h2>
        <p>Bonjour ${user.prenom},</p>
        <p>Vous avez demande la reinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${resetLink}" style="background:#1a2744;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
            Reinitialiser mon mot de passe
          </a>
        </div>
        <p style="color:#666;font-size:13px">Ce lien est valable pendant <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#999;font-size:11px">Agent de Bureau &mdash; ${appUrl}</p>
      </div>`;

    await sendEmail(emailClean, "Reinitialisation de votre mot de passe - Agent de Bureau", html,
      `Bonjour ${user.prenom}, reinitialiser votre mot de passe: ${resetLink} (valide 1h)`);

    res.json({ message: "Si un compte existe avec cet email, un lien de reinitialisation a ete envoye." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur forgot-password");
    res.status(500).json({ error: "Erreur lors de l'envoi du lien de reinitialisation." });
  }
});

router.post("/auth/reset-password", resetLimiter, async (req: Request, res: Response): Promise<void> => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    res.status(400).json({ error: "Token et nouveau mot de passe obligatoires." });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres." });
    return;
  }

  try {
    const rawToken = String(token);
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    // Lookup par hash uniquement. Fallback plaintext autorise SEULEMENT pour
    // les anciens tokens (96 caracteres hex = 48 bytes), jamais pour les
    // longueurs correspondant a un hash SHA-256 (64 hex), ce qui empecherait
    // l'utilisation directe d'un hash leak comme bearer.
    let [user] = await db.select({ id: usersTable.id, email: usersTable.email, prenom: usersTable.prenom, resetPasswordExpiry: usersTable.resetPasswordExpiry })
      .from(usersTable).where(eq(usersTable.resetPasswordToken, tokenHash));
    if (!user && rawToken.length === 96 && /^[0-9a-f]+$/i.test(rawToken)) {
      [user] = await db.select({ id: usersTable.id, email: usersTable.email, prenom: usersTable.prenom, resetPasswordExpiry: usersTable.resetPasswordExpiry })
        .from(usersTable).where(eq(usersTable.resetPasswordToken, rawToken));
    }

    if (!user || !user.resetPasswordExpiry || new Date(user.resetPasswordExpiry) < new Date()) {
      res.status(400).json({ error: "Lien invalide ou expire. Veuillez refaire une demande." });
      return;
    }

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.update(usersTable).set({
      passwordHash: hash,
      resetPasswordToken: null,
      resetPasswordExpiry: null,
      tentativesEchouees: 0,
      verrouilleJusqua: null,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, user.id));

    // Invalider toutes les sessions existantes de cet utilisateur — fail-closed.
    try {
      await invalidateUserSessions(user.id);
    } catch (err: any) {
      req.log.error({ err }, "Echec invalidation sessions apres reset");
      res.status(500).json({ error: "Mot de passe mis a jour mais l'invalidation des sessions a echoue. Contactez le support." });
      return;
    }

    // Notification de securite (best-effort).
    void sendPasswordChangedEmail(user.email, user.prenom || "", req.ip).catch(err => req.log.error({ err }, "Erreur notif password reset"));

    logAudit(user.id, user.email, "password_reset", "auth", String(user.id), { ip: req.ip }, req.ip, req.get("user-agent"));

    res.json({ message: "Mot de passe reinitialise avec succes. Toutes vos sessions ont ete deconnectees. Vous pouvez maintenant vous reconnecter." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur reset-password");
    res.status(500).json({ error: "Erreur lors de la reinitialisation." });
  }
});

async function invalidateUserSessions(userId: number): Promise<void> {
  // Connect-pg-simple stocke session JSON dans user_sessions(sess jsonb).
  await db.execute(sql`DELETE FROM user_sessions WHERE (sess->>'userId')::int = ${userId}`);
}

async function sendPasswordChangedEmail(email: string, prenom: string, ip: string | undefined): Promise<void> {
  const when = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const html = `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
    <h2 style="color:#1a2744">Votre mot de passe a ete modifie</h2>
    <p>Bonjour ${prenom},</p>
    <p>Le mot de passe de votre compte Agent de Bureau a ete reinitialise le <strong>${when}</strong>${ip ? ` depuis l'IP <strong>${ip}</strong>` : ""}.</p>
    <p>Toutes vos sessions actives ont ete deconnectees par securite.</p>
    <p style="background:#fff7ed;border-left:4px solid #f59e0b;padding:12px;margin:16px 0">
      <strong>Vous n'etes pas a l'origine de cette action ?</strong> Contactez immediatement support@agentdebureau.fr.
    </p>
  </div>`;
  await sendEmail(email, "Securite: votre mot de passe a ete modifie", html, `Votre mot de passe a ete reinitialise le ${when}. Si ce n'est pas vous, contactez support@agentdebureau.fr.`);
}

async function sendLoginNotificationIfNew(user: any, ip: string | undefined, ua: string | undefined): Promise<void> {
  if (process.env.LOGIN_NOTIFICATIONS !== "1") return;
  if (!ip) return;
  // Empreinte simple IP+UA, comparee a la derniere connexion stockee.
  const fp = crypto.createHash("sha256").update(`${ip}|${ua || ""}`).digest("hex").slice(0, 32);
  const knownFp = (user.lastLoginFingerprint as string | null) || null;
  if (knownFp === fp) return;
  await db.update(usersTable).set({ lastLoginFingerprint: fp }).where(eq(usersTable.id, user.id)).catch(() => {});
  const when = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const html = `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
    <h2 style="color:#1a2744">Nouvelle connexion detectee</h2>
    <p>Bonjour ${user.prenom || ""},</p>
    <p>Une connexion a votre compte Agent de Bureau a ete detectee depuis un nouvel appareil :</p>
    <ul><li>Date : <strong>${when}</strong></li><li>IP : <strong>${ip}</strong></li>${ua ? `<li>Navigateur : ${String(ua).slice(0, 200)}</li>` : ""}</ul>
    <p style="background:#fff7ed;border-left:4px solid #f59e0b;padding:12px;margin:16px 0">
      <strong>Ce n'est pas vous ?</strong> Changez immediatement votre mot de passe et contactez support@agentdebureau.fr.
    </p>
  </div>`;
  await sendEmail(user.email, "Nouvelle connexion a votre compte", html, `Nouvelle connexion ${when} depuis ${ip}. Si ce n'est pas vous, changez votre mot de passe.`);
}

export default router;
