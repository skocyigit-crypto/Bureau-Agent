import { Router, type Request, type Response } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { PLANS, type PlanKey } from "@workspace/db/schema";
import crypto from "crypto";
import { sendLicenseEmail } from "../services/email";

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

router.get("/organisations", async (_req: Request, res: Response): Promise<void> => {
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

  const result = orgs.map(org => {
    const sub = subscriptions.find(s => s.organisationId === org.id);
    const uc = userCounts.find(u => u.organisationId === org.id);
    const plan = sub ? PLANS[sub.plan as PlanKey] : null;
    return {
      ...org,
      subscription: sub ? {
        ...sub,
        planDetails: plan,
        isTrialExpired: sub.plan === "essai" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date(),
      } : null,
      userCount: uc?.count ?? 0,
    };
  });

  res.json({ organisations: result });
});

router.get("/organisations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

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
});

router.post("/organisations", async (req: Request, res: Response): Promise<void> => {
  const { name, email, phone, address, plan, maxUsers } = req.body;

  if (!name || name.trim().length < 2) {
    res.status(400).json({ error: "Le nom de l'organisation est requis (min 2 caracteres)." });
    return;
  }

  const planKey = (plan as PlanKey) || "essai";
  if (!PLANS[planKey]) {
    res.status(400).json({ error: "Plan invalide.", validPlans: Object.keys(PLANS) });
    return;
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

  try {
    const result = await db.transaction(async (tx) => {
      const [org] = await tx.insert(organisationsTable).values({
        name: name.trim(),
        slug: finalSlug,
        email: email || null,
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

      return { organisation: org, subscription: sub };
    });

    let emailResult = null;
    if (email) {
      emailResult = await sendLicenseEmail({
        to: email,
        orgName: name.trim(),
        plan: planConfig.name,
        licenseKey,
        trialEndsAt: result.subscription.trialEndsAt ? new Date(result.subscription.trialEndsAt) : null,
      });
    }

    res.status(201).json({
      message: `Organisation "${name}" creee avec le plan ${planConfig.name}.`,
      ...result,
      licenseKey,
      emailSent: emailResult ? emailResult.success : false,
      emailNote: !email ? "Aucun email fourni." : emailResult?.preview || (emailResult?.success ? "Email envoye." : `Erreur: ${emailResult?.error}`),
    });
  } catch (err: any) {
    console.error("Erreur creation organisation:", err);
    res.status(500).json({ error: "Erreur lors de la creation de l'organisation." });
  }
});

router.post("/organisations/:id/resend-license", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

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

  const plan = PLANS[sub.plan as PlanKey];
  const result = await sendLicenseEmail({
    to: org.email,
    orgName: org.name,
    plan: plan?.name || sub.plan,
    licenseKey: sub.licenseKey,
    trialEndsAt: sub.trialEndsAt,
  });

  if (result.success) {
    res.json({ message: `Licence renvoyee a ${org.email}.`, preview: result.preview });
  } else {
    res.status(500).json({ error: `Erreur d'envoi: ${result.error}` });
  }
});

router.put("/organisations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { name, email, phone, address, actif, maxUsers } = req.body;

  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (email !== undefined) updateData.email = email || null;
  if (phone !== undefined) updateData.phone = phone || null;
  if (address !== undefined) updateData.address = address || null;
  if (actif !== undefined) updateData.actif = actif;
  if (maxUsers !== undefined) updateData.maxUsers = maxUsers;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Aucune donnee a mettre a jour." });
    return;
  }

  const [updated] = await db.update(organisationsTable).set(updateData).where(eq(organisationsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Organisation non trouvee." }); return; }

  res.json({ message: "Organisation mise a jour.", organisation: updated });
});

router.put("/organisations/:id/plan", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
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
      console.error("Erreur mise a jour plan:", err);
      res.status(500).json({ error: "Erreur serveur." });
    }
  }
});

router.delete("/organisations/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  if (id === 1) {
    res.status(400).json({ error: "Impossible de supprimer l'organisation par defaut." });
    return;
  }

  const [deleted] = await db.delete(organisationsTable).where(eq(organisationsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Organisation non trouvee." }); return; }

  res.json({ message: `Organisation "${deleted.name}" supprimee.` });
});

export default router;
