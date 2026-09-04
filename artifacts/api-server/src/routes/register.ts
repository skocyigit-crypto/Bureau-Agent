import { Router, type Request, type Response } from "express";
import { resolveClientIp, rateLimitKey } from "../lib/request-ip";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { db, legalAgreementsTable, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { LEGAL_DOCUMENTS, PLANS, type PlanKey } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendWelcomeEmail } from "../services/email";
import { resolveEmailLang } from "../i18n/email-i18n";
import { generateUniqueLicenseKey, isUniqueViolation } from "../services/license-key";
import { logLicenseEvent } from "../services/license-audit";
import { logger } from "../lib/logger";

const router = Router();

const SALT_ROUNDS = 12;

/**
 * Cinq inscriptions par heure et par client.
 *
 * Une saisie refusee ne consomme PAS ce quota. Elle le consommait: oublier son
 * nom, choisir un mot de passe trop court, mal taper son adresse — trois
 * erreurs de formulaire ordinaires — et la cinquieme tentative repondait
 * "Reessayez dans une heure". La personne se voyait refuser la creation d'un
 * compte pendant une heure pour avoir mal rempli un champ, sans qu'on lui dise
 * quoi corriger. Sur une inscription, cela ne protege de rien et coute un
 * client.
 *
 * En revanche, un 409 « cet email existe deja » compte, lui: c'est la reponse
 * qui permettrait d'enumerer les comptes existants, et c'est donc elle qu'il
 * faut plafonner. Le debit brut reste borne par le limiteur general de
 * l'application (1000 requetes / 15 min).
 */
const registerLimiter = rateLimit({
  keyGenerator: rateLimitKey,
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Trop de tentatives d'inscription. Reessayez dans une heure." },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  // Seul un 400 (saisie invalide) est « non abouti » et donc non decompte.
  // Tout le reste — creation reussie, 409, erreur serveur — compte.
  requestWasSuccessful: (_req, res) => res.statusCode !== 400,
});

router.post("/auth/register", registerLimiter, async (req: Request, res: Response): Promise<void> => {
  const { orgName, firstName, lastName, email, password, phone, plan, acceptedTerms } = req.body;


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

// Acceptation des CGV/CGU au moment de la commande.
  //
  // Les CGV affirment que « toute commande vaut acceptation sans reserve des
  // presentes » (cgv.tsx). Encore faut-il que l'acheteur ait pu en prendre
  // connaissance: l'article 1119 du Code civil ecarte les conditions generales
  // qui n'ont pas ete portees a la connaissance de la partie qui les subit.
  // L'inscription ne les mentionnait nulle part — la clause etait donc
  // inopposable, et c'est le vendeur qui en supporte le risque.
  //
  // La case doit etre COCHEE PAR L'UTILISATEUR: un consentement pre-coche ne
  // vaut pas consentement.
  if (acceptedTerms !== true) {
    res.status(400).json({
      error: "Vous devez accepter les conditions generales d'utilisation et de vente.",
      champ: "acceptedTerms",
    });
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

  // Tout le monde commence par l'essai: c'est ce que les cartes de tarifs
  // annoncent. Mais le visiteur a clique sur un plan precis, et cette intention
  // se perdait — `plan` etait lu du corps de la requete puis jamais utilise. Au
  // bout des 14 jours, plus personne ne savait vers quoi convertir le compte.
  // On la conserve donc dans le journal de licence (deja append-only), sans
  // migration ni promesse tarifaire: c'est une intention, pas un engagement.
  const planKey: PlanKey = "essai";
  const planConfig = PLANS[planKey];
  const planSouhaite: PlanKey | null =
    typeof plan === "string"
    && plan !== "essai"
    && Object.prototype.hasOwnProperty.call(PLANS, plan)
      ? (plan as PlanKey)
      : null;

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

      // Trace de l'acceptation, DANS la transaction: si la creation echoue,
      // la preuve d'un consentement qui n'a jamais abouti ne reste pas en base.
      // Sans cette ligne, l'acceptation n'existait que dans la requete — donc
      // nulle part, et le vendeur ne pouvait rien prouver.
      for (const documentType of ["cgu", "cgv"] as const) {
        await tx.insert(legalAgreementsTable).values({
          organisationId: org.id,
          documentType,
          documentVersion: LEGAL_DOCUMENTS[documentType].version,
          acceptedAt: new Date(),
          acceptedBy: emailLower,
          acceptedIp: resolveClientIp(req) ?? null,
          notes: "Acceptation a l'inscription",
        });
      }

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
      metadata: { plan: planKey, planSouhaite, licenseKey, trialEndsAt: result.subscription.trialEndsAt },
    });
    void logLicenseEvent(result.organisation.id, "trial_started", `Periode d'essai demarree (${planConfig.trialDays || 14} jours)`, {
      performedBy: result.user.id,
      metadata: { trialEndsAt: result.subscription.trialEndsAt },
    });

    // Email verification: cree et envoie un lien (gate de connexion s'active si REQUIRE_EMAIL_VERIFICATION=1).
    try {
      const { issueAndSendEmailVerification } = await import("./auth");
      await issueAndSendEmailVerification(result.user.id, emailLower, firstName.trim(), resolveEmailLang(req));
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
    }, resolveEmailLang(req));

    const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "1";
    if (!requireVerification) {
      // Auto-login uniquement si la verification email n'est pas requise.
      await new Promise<void>((resolve, reject) => req.session.regenerate((e) => e ? reject(e) : resolve()));
      req.session.userId = result.user.id;
      req.session.userRole = result.user.role;
      req.session.organisationId = result.user.organisationId ?? undefined;
      req.session.userEmail = result.user.email;
      req.session.prenom = result.user.prenom ?? undefined;
      req.session.nom = result.user.nom ?? undefined;
    }

    res.status(201).json({
      requiresEmailVerification: requireVerification,
      message: requireVerification
        ? `Votre compte a ete cree. Verifiez votre email pour activer la connexion.`
        : `Votre compte a ete cree avec succes ! Bienvenue sur Ajant Bureau.`,
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
