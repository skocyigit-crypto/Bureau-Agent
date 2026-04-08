import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { PLANS, type PlanKey } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendWelcomeEmail } from "../services/email";

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

  if (!password || password.length < 8) {
    res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caracteres." });
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

  const licenseKey = `ADB-ESS-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

  try {
    const result = await db.transaction(async (tx) => {
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

    const emailResult = await sendWelcomeEmail({
      to: emailLower,
      orgName: orgName.trim(),
      plan: planConfig.name,
      licenseKey,
      loginEmail: emailLower,
      adminName: `${firstName.trim()} ${lastName.trim()}`,
      trialEndsAt: result.subscription.trialEndsAt,
    });

    (req.session as any).userId = result.user.id;
    (req.session as any).userRole = result.user.role;
    (req.session as any).organisationId = result.user.organisationId;
    (req.session as any).userEmail = result.user.email;

    res.status(201).json({
      message: `Votre compte a ete cree avec succes ! Bienvenue sur Agent de Bureau.`,
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
    console.error("[Register] Erreur:", err);
    res.status(500).json({ error: "Erreur lors de la creation du compte. Veuillez reessayer." });
  }
});

export default router;
