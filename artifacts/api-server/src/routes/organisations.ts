import { Router, type Request, type Response } from "express";
import { eq, sql, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { PLANS, type PlanKey } from "@workspace/db/schema";
import crypto from "crypto";
import { sendLicenseEmail } from "../services/email";
import { logger } from "../lib/logger";

const SALT_ROUNDS = 12;

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

const router = Router();

function requireSuperAdmin(req: Request, res: Response, next: () => void): void {
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin") {
    res.status(403).json({ error: "Acces reserve au super administrateur." });
    return;
  }
  next();
}

router.use(requireSuperAdmin);

router.get("/organisations", async (req: Request, res: Response): Promise<void> => {
  const { contactsTable, callsTable } = await import("@workspace/db");
  const { gte, and } = await import("drizzle-orm");

  try {
    const orgs = await db.select().from(organisationsTable).orderBy(desc(organisationsTable.createdAt));

    const orgIds = orgs.map(o => o.id);
    const subscriptions = orgIds.length > 0
      ? await db.select().from(subscriptionsTable).where(sql`${subscriptionsTable.organisationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    const userCounts = orgIds.length > 0
      ? await db.select({
          organisationId: usersTable.organisationId,
          count: sql<number>`count(*)::int`,
        }).from(usersTable).where(sql`${usersTable.organisationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`).groupBy(usersTable.organisationId)
      : [];

    const contactCounts = orgIds.length > 0
      ? await db.select({
          organisationId: contactsTable.organisationId,
          count: sql<number>`count(*)::int`,
        }).from(contactsTable).where(sql`${contactsTable.organisationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`).groupBy(contactsTable.organisationId)
      : [];

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const callCounts = orgIds.length > 0
      ? await db.select({
          organisationId: callsTable.organisationId,
          count: sql<number>`count(*)::int`,
        }).from(callsTable).where(sql`${callsTable.organisationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)}) AND ${callsTable.createdAt} >= ${monthStart}`).groupBy(callsTable.organisationId)
      : [];

    const result = orgs.map(org => {
      const sub = subscriptions.find(s => s.organisationId === org.id);
      const uc = userCounts.find(u => u.organisationId === org.id);
      const cc = contactCounts.find(c => c.organisationId === org.id);
      const ac = callCounts.find(a => a.organisationId === org.id);
      const plan = sub ? PLANS[sub.plan as PlanKey] : null;
      return {
        ...org,
        subscription: sub ? {
          ...sub,
          planDetails: plan,
          isTrialExpired: sub.plan === "essai" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date(),
        } : null,
        userCount: uc?.count ?? 0,
        contactCount: cc?.count ?? 0,
        callCount: ac?.count ?? 0,
      };
    });

    res.json({ organisations: result });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste organisations");
    res.status(500).json({ error: "Erreur lors de la recuperation des organisations." });
  }
});

router.get("/organisations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, id));
    if (!org) { res.status(404).json({ error: "Organisation non trouvee." }); return; }

    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, id));
    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.organisationId, id));

    const plan = sub ? PLANS[sub.plan as PlanKey] : null;

    res.json({
      organisation: org,
      subscription: sub ? { ...sub, planDetails: plan } : null,
      userCount: userCount?.count ?? 0,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation organisation");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'organisation." });
  }
});

router.post("/organisations", async (req: Request, res: Response): Promise<void> => {
  const { name, email, phone, address, plan, maxUsers, adminPrenom, adminNom, adminEmail } = req.body;

  if (!name || name.trim().length < 2) {
    res.status(400).json({ error: "Le nom de l'organisation est requis (min 2 caracteres)." });
    return;
  }

  const planKey = (plan as PlanKey) || "essai";
  if (!PLANS[planKey]) {
    res.status(400).json({ error: "Plan invalide.", validPlans: Object.keys(PLANS) });
    return;
  }

  const contactEmail = adminEmail || email;

  if (adminEmail) {
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, adminEmail.toLowerCase().trim()));
    if (existing.length > 0) {
      res.status(409).json({ error: "Un utilisateur avec cet email existe deja." });
      return;
    }
  }

  const slug = name.trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 100);

  const [existingSlug] = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.slug, slug));
  const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

  const planConfig = PLANS[planKey];
  const licenseKey = `ADB-${planKey.toUpperCase().substring(0, 3)}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

  let generatedPassword: string | null = null;
  if (adminEmail && adminPrenom && adminNom) {
    generatedPassword = generateTempCode();
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [org] = await tx.insert(organisationsTable).values({
        name: name.trim(),
        slug: finalSlug,
        email: contactEmail || null,
        phone: phone || null,
        address: address || null,
        maxUsers: maxUsers || planConfig.maxUsers,
        actif: true,
      }).returning();

      const trialEnd = planKey === "essai" ? new Date(Date.now() + (planConfig.trialDays || 14) * 86400000) : null;

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
        currentPeriodEnd: trialEnd || new Date(Date.now() + 30 * 86400000),
      }).returning();

      let adminUser = null;
      if (generatedPassword && adminEmail && adminPrenom && adminNom) {
        const passwordHash = await bcrypt.hash(generatedPassword, SALT_ROUNDS);
        const avatar = `${adminPrenom[0]}${adminNom[0]}`.toUpperCase();
        [adminUser] = await tx.insert(usersTable).values({
          email: adminEmail.toLowerCase().trim(),
          passwordHash,
          nom: adminNom,
          prenom: adminPrenom,
          role: "administrateur",
          organisation: name.trim(),
          organisationId: org.id,
          avatar,
        }).returning({
          id: usersTable.id,
          email: usersTable.email,
          nom: usersTable.nom,
          prenom: usersTable.prenom,
          role: usersTable.role,
        });
      }

      return { organisation: org, subscription: sub, adminUser };
    });

    let emailResult = null;
    const sendTo = adminEmail || email;
    if (sendTo) {
      emailResult = await sendLicenseEmail({
        to: sendTo,
        orgName: name.trim(),
        plan: planConfig.name,
        licenseKey,
        trialEndsAt: result.subscription.trialEndsAt ? new Date(result.subscription.trialEndsAt) : null,
        adminName: (adminPrenom && adminNom) ? `${adminPrenom} ${adminNom}` : undefined,
        adminEmail: adminEmail || undefined,
        adminPassword: generatedPassword || undefined,
      });
    }

    res.status(201).json({
      message: `Organisation "${name}" creee avec le plan ${planConfig.name}.${result.adminUser ? ` Administrateur ${result.adminUser.prenom} ${result.adminUser.nom} cree.` : ""}`,
      ...result,
      licenseKey,
      emailSent: emailResult ? emailResult.success : false,
      emailNote: !sendTo ? "Aucun email fourni." : emailResult?.preview || (emailResult?.success ? "Email envoye avec licence et identifiants." : "Erreur lors de l'envoi de l'email."),
    });
  } catch (err: any) {
    logger.error({ err }, "Erreur creation organisation");
    res.status(500).json({ error: "Erreur lors de la creation de l'organisation." });
  }
});

router.post("/organisations/:id/resend-license", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, id));
    if (!org) { res.status(404).json({ error: "Organisation non trouvee." }); return; }

    if (!org.email) {
      res.status(400).json({ error: "Aucune adresse email associee a cette organisation." });
      return;
    }

    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, id));
    if (!sub || !sub.licenseKey) {
      res.status(404).json({ error: "Aucune licence trouvee pour cette organisation." });
      return;
    }

    let adminPassword: string = generateTempCode();
    let adminUser: any = null;

    const [existingAdmin] = await db.select({
      id: usersTable.id,
      email: usersTable.email,
      prenom: usersTable.prenom,
      nom: usersTable.nom,
    }).from(usersTable).where(eq(usersTable.organisationId, id));

    if (existingAdmin) {
      const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
      await db.update(usersTable).set({
        passwordHash,
        tentativesEchouees: 0,
        verrouilleJusqua: null,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, existingAdmin.id));
      adminUser = existingAdmin;
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
      const orgNameParts = org.name.trim().split(" ");
      const prenom = orgNameParts[0] || "Admin";
      const nom = orgNameParts.slice(1).join(" ") || org.name;
      const avatar = `${prenom[0]}${nom[0]}`.toUpperCase();
      const [newAdmin] = await db.insert(usersTable).values({
        email: org.email!.toLowerCase().trim(),
        passwordHash,
        nom,
        prenom,
        role: "administrateur",
        organisation: org.name,
        organisationId: id,
        avatar,
      }).returning({
        id: usersTable.id,
        email: usersTable.email,
        nom: usersTable.nom,
        prenom: usersTable.prenom,
      });
      adminUser = newAdmin;
    }

    const plan = PLANS[sub.plan as PlanKey];
    const result = await sendLicenseEmail({
      to: org.email,
      orgName: org.name,
      plan: plan?.name || sub.plan,
      licenseKey: sub.licenseKey,
      trialEndsAt: sub.trialEndsAt,
      adminName: `${adminUser.prenom} ${adminUser.nom}`,
      adminEmail: adminUser.email,
      adminPassword,
    });

    if (result.success) {
      res.json({
        message: `Email envoye a ${org.email} avec le code de connexion temporaire pour ${adminUser.email}.`,
        preview: result.preview,
      });
    } else {
      logger.warn({ err: result.error }, "Envoi licence email echoue");
      res.status(500).json({ error: "Mot de passe mis a jour mais erreur lors de l'envoi de l'email." });
    }
  } catch (err: any) {
    req.log.error({ err }, "Erreur renvoi licence");
    res.status(500).json({ error: "Erreur lors du renvoi de la licence." });
  }
});

router.put("/organisations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { name, email, phone, address, actif, maxUsers, bankName, bankIban, bankBic, siret, tvaNumber, legalForm, capital, invoiceFooter, autoInvoiceEnabled, autoEmailInvoice } = req.body;

  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (email !== undefined) updateData.email = email || null;
  if (phone !== undefined) updateData.phone = phone || null;
  if (address !== undefined) updateData.address = address || null;
  if (actif !== undefined) updateData.actif = actif;
  if (maxUsers !== undefined) updateData.maxUsers = maxUsers;
  if (bankName !== undefined) updateData.bankName = bankName || null;
  if (bankIban !== undefined) updateData.bankIban = bankIban || null;
  if (bankBic !== undefined) updateData.bankBic = bankBic || null;
  if (siret !== undefined) updateData.siret = siret || null;
  if (tvaNumber !== undefined) updateData.tvaNumber = tvaNumber || null;
  if (legalForm !== undefined) updateData.legalForm = legalForm || null;
  if (capital !== undefined) updateData.capital = capital || null;
  if (invoiceFooter !== undefined) updateData.invoiceFooter = invoiceFooter || null;
  if (autoInvoiceEnabled !== undefined) updateData.autoInvoiceEnabled = autoInvoiceEnabled;
  if (autoEmailInvoice !== undefined) updateData.autoEmailInvoice = autoEmailInvoice;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Aucune donnee a mettre a jour." });
    return;
  }

  try {
    const [updated] = await db.update(organisationsTable).set(updateData).where(eq(organisationsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Organisation non trouvee." }); return; }

    res.json({ message: "Organisation mise a jour.", organisation: updated });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour organisation");
    res.status(500).json({ error: "Erreur lors de la mise a jour de l'organisation." });
  }
});

router.put("/organisations/:id/plan", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { plan } = req.body;
  if (!plan || !PLANS[plan as PlanKey]) {
    res.status(400).json({ error: "Plan invalide.", validPlans: Object.keys(PLANS) });
    return;
  }

  const planConfig = PLANS[plan as PlanKey];

  try {
    await db.transaction(async (tx) => {
      const [sub] = await tx.update(subscriptionsTable).set({
        plan,
        maxUsers: planConfig.maxUsers,
        maxContacts: planConfig.maxContacts,
        maxCallsPerMonth: planConfig.maxCallsPerMonth,
        aiEnabled: planConfig.aiEnabled,
        stockEnabled: planConfig.stockEnabled,
        automationEnabled: planConfig.automationEnabled,
        price: String(planConfig.price),
        status: "active",
        trialEndsAt: plan === "essai" ? new Date(Date.now() + (planConfig.trialDays || 14) * 86400000) : null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      }).where(eq(subscriptionsTable.organisationId, id)).returning();

      if (!sub) throw new Error("NOT_FOUND");

      await tx.update(organisationsTable).set({ maxUsers: planConfig.maxUsers }).where(eq(organisationsTable.id, id));
    });

    res.json({ message: `Plan mis a jour vers ${planConfig.name}.` });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      res.status(404).json({ error: "Abonnement non trouve pour cette organisation." });
    } else {
      logger.error({ err }, "Erreur mise a jour plan");
      res.status(500).json({ error: "Erreur lors de la mise a jour du plan." });
    }
  }
});

router.delete("/organisations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  if (id === 1) {
    res.status(400).json({ error: "Impossible de supprimer l'organisation par defaut." });
    return;
  }

  try {
    const [deleted] = await db.delete(organisationsTable).where(eq(organisationsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Organisation non trouvee." }); return; }

    res.json({ message: `Organisation "${deleted.name}" supprimee.` });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression organisation");
    res.status(500).json({ error: "Erreur lors de la suppression de l'organisation." });
  }
});

export default router;
