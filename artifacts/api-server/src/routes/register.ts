import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { PLANS, type PlanKey } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendWelcomeEmail } from "../services/email";
import { generateUniqueLicenseKey, isUniqueViolation } from "../services/license-key";
import { logLicenseEvent } from "../services/license-audit";
import { logger } from "../lib/logger";

const router = Router();

const SALT_ROUNDS = 12;

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Trop de tentatives d'inscription. Reessayez dans une heure." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/auth/register", registerLimiter, async (req: Request, res: Response): Promise<void> => {
  const { orgName, firstName, lastName, email, password, phone, plan } = req.body;

  if (!orgName || orgName.trim().length < 2) {
    res.status(400).json({ error: "Le nom de l'organisation est requis (minimum 2 caracteres)." });
    return;
  }

  if (!firstName || !lastName) {
    res.status(400).json({ error: "Le prenom et le nom sont requis." });
    return;
  }

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Une adresse email valide est requise." });
    return;
  }

  const { validatePasswordStrength } = await import("./auth");
  const strength = validatePasswordStrength(String(password || ""));
  if (!strength.ok) {
    res.status(400).json({ error: strength.error });
    return;
  }

  const emailLower = email.toLowerCase().trim();
  const [existingUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, emailLower));
  if (existingUser) {
    res.status(409).json({ error: "Un compte avec cet email existe deja. Connectez-vous ou utilisez un autre email." });
    return;
  }

  const planKey: PlanKey = "essai";
  const planConfig = PLANS[planKey];

  const slug = orgName.trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 100);

  const [existingSlug] = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.slug, slug));
  const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

  let licenseKey = await generateUniqueLicenseKey("essai");

  try {
    let attempt = 0;
    let result: any;
    while (true) {
      try {
        result = await db.transaction(async (tx) => {
      const trialEnd = new Date(Date.now() + (planConfig.trialDays || 14) * 86400000);

      const [org] = await tx.insert(organisationsTable).values({
        name: orgName.trim(),
        slug: finalSlug,
        email: emailLower,
        phone: phone || null,
        maxUsers: planConfig.maxUsers,
        actif: true,
      }).returning();

      const [sub] = await tx.insert(subscriptionsTable).values({
        organisationId: org.id,
        plan: planKey,
        status: "active",
        licenseKey,
        maxUsers: planConfig.maxUsers,
        maxContacts: planConfig.maxContacts,
        maxCallsPerMonth: planConfig.maxCallsPerMonth,
        aiEnabled: planConfig.aiEnabled,
        stockEnabled: planConfig.stockEnabled,
        automationEnabled: planConfig.automationEnabled,
        price: String(planConfig.price),
        trialEndsAt: trialEnd,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
      }).returning();

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const avatar = `${firstName[0]}${lastName[0]}`.toUpperCase();

      const [user] = await tx.insert(usersTable).values({
        email: emailLower,
        passwordHash,
        nom: lastName.trim(),
        prenom: firstName.trim(),
        role: "administrateur",
        departement: "Direction",
        organisation: orgName.trim(),
        organisationId: org.id,
        telephone: phone || null,
        avatar,
        mfaActif: false,
        actif: true,
      }).returning({
        id: usersTable.id,
        email: usersTable.email,
        nom: usersTable.nom,
        prenom: usersTable.prenom,
        role: usersTable.role,
        organisation: usersTable.organisation,
        organisationId: usersTable.organisationId,
      });

      return { organisation: org, subscription: sub, user };
    });
        break;
      } catch (e) {
        if (isUniqueViolation(e) && attempt < 4) {
          attempt++;
          licenseKey = await generateUniqueLicenseKey("essai");
          continue;
        }
        throw e;
      }
    }

    void logLicenseEvent(result.organisation.id, "subscription_created", `Inscription initiale: plan ${planConfig.name}`, {
      performedBy: result.user.id,
      ipAddress: req.ip ?? null,
      metadata: { plan: planKey, licenseKey, trialEndsAt: result.subscription.trialEndsAt },
    });
    void logLicenseEvent(result.organisation.id, "trial_started", `Periode d'essai demarree (${planConfig.trialDays || 14} jours)`, {
      performedBy: result.user.id,
      metadata: { trialEndsAt: result.subscription.trialEndsAt },
    });

    // Email verification: cree et envoie un lien (gate de connexion s'active si REQUIRE_EMAIL_VERIFICATION=1).
    try {
      const { issueAndSendEmailVerification } = await import("./auth");
      await issueAndSendEmailVerification(result.user.id, emailLower, firstName.trim());
    } catch (verifyErr) {
      logger.error({ err: verifyErr }, "[Register] Erreur envoi email verification (non bloquant)");
    }

    const emailResult = await sendWelcomeEmail({
      to: emailLower,
      orgName: orgName.trim(),
      plan: planConfig.name,
      licenseKey,
      loginEmail: emailLower,
      adminName: `${firstName.trim()} ${lastName.trim()}`,
      trialEndsAt: result.subscription.trialEndsAt,
    });

    const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "1";
    if (!requireVerification) {
      // Auto-login uniquement si la verification email n'est pas requise.
      await new Promise<void>((resolve, reject) => req.session.regenerate((e) => e ? reject(e) : resolve()));
      req.session.userId = result.user.id;
      req.session.userRole = result.user.role;
      req.session.organisationId = result.user.organisationId ?? undefined;
      req.session.userEmail = result.user.email;
    }

    res.status(201).json({
      requiresEmailVerification: requireVerification,
      message: requireVerification
        ? `Votre compte a ete cree. Verifiez votre email pour activer la connexion.`
        : `Votre compte a ete cree avec succes ! Bienvenue sur Agent de Bureau.`,
      user: result.user,
      organisation: {
        id: result.organisation.id,
        name: result.organisation.name,
      },
      subscription: {
        plan: planConfig.name,
        trialEndsAt: result.subscription.trialEndsAt,
      },
      licenseKey,
      emailSent: emailResult.success,
      emailNote: emailResult.preview || (emailResult.success ? "Email de bienvenue envoye." : `Erreur: ${emailResult.error}`),
    });
  } catch (err: any) {
    logger.error({ err: err }, "[Register] Erreur:");
    res.status(500).json({ error: "Erreur lors de la creation du compte. Veuillez reessayer." });
  }
});

export default router;
