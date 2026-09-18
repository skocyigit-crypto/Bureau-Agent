import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, subscriptionsTable, organisationsTable } from "@workspace/db";
import { PLANS, type PlanKey } from "@workspace/db/schema";
import { getOrgId } from "../middleware/tenant";
import { logger } from "../lib/logger";

const router = Router();

router.get("/subscription", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);

  try {
    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));
    const [organisation] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));

    if (!subscription) {
      res.status(404).json({ error: "Aucun abonnement trouve." });
      return;
    }

    const plan = PLANS[subscription.plan as PlanKey];
    const isTrialExpired = subscription.plan === "essai" && subscription.trialEndsAt && new Date(subscription.trialEndsAt) < new Date();

    res.json({
      subscription: {
        ...subscription,
        planDetails: plan,
        isTrialExpired,
      },
      organisation,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation abonnement");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'abonnement." });
  }
});

router.get("/subscription/plans", async (_req: Request, res: Response): Promise<void> => {
  const planList = Object.entries(PLANS).map(([key, value]) => ({
    id: key,
    ...value,
  }));

  res.json({ plans: planList });
});

router.post("/subscription/upgrade", async (req: Request, res: Response): Promise<void> => {
  const userRole = req.session?.userRole;
  if (userRole !== "super_admin") {
    res.status(403).json({
      error: "Le changement de plan se fait via votre portail de facturation Stripe.",
      hint: "Utilisez le bouton 'Gerer mon abonnement' pour modifier votre plan en toute securite.",
      code: "stripe_portal_required",
    });
    return;
  }

  const orgId = getOrgId(req);
  const { plan } = req.body;

  if (!plan || !PLANS[plan as PlanKey]) {
    res.status(400).json({ error: "Plan invalide.", validPlans: Object.keys(PLANS) });
    return;
  }

  const planConfig = PLANS[plan as PlanKey];

  try {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx.update(subscriptionsTable).set({
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
      }).where(eq(subscriptionsTable.organisationId, orgId)).returning();

      if (!updated) {
        throw new Error("NOT_FOUND");
      }

      await tx.update(organisationsTable).set({
        maxUsers: planConfig.maxUsers,
      }).where(eq(organisationsTable.id, orgId));

      return updated;
    });

    res.json({
      message: `Abonnement mis a jour vers le plan ${planConfig.name}.`,
      subscription: result,
    });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") {
      res.status(404).json({ error: "Abonnement non trouve." });
    } else {
      logger.error({ err: err }, "Erreur mise a jour abonnement:");
      res.status(500).json({ error: "Erreur serveur lors de la mise a jour." });
    }
  }
});

router.get("/subscription/usage", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);

  try {
    const [subscription] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));

    const { usersTable, contactsTable, callsTable } = await import("@workspace/db");
    const { sql, and, gte } = await import("drizzle-orm");

    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.organisationId, orgId));
    const [contactCount] = await db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId));

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [callCount] = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, monthStart)));

    // Organisation sans ligne d'abonnement (creee a la main, migration, ligne
    // supprimee): l'usage reste une information VRAIE et utile. On repondait
    // 404, et l'ecran « Utilisateurs » retombait en silence sur un plafond
    // invente de 5 utilisateurs — alors que le plafond reellement applique est
    // `organisations.max_users` (le declencheur de quota s'appuie dessus).
    // Mieux vaut dire le vrai plafond et le signaler.
    const [organisation] = subscription
      ? [null]
      : await db.select({ maxUsers: organisationsTable.maxUsers }).from(organisationsTable).where(eq(organisationsTable.id, orgId));
    const plafondUtilisateurs = subscription?.maxUsers ?? organisation?.maxUsers ?? 0;
    const fonctionsDuPlan = subscription ? PLANS[subscription.plan as PlanKey] : null;

    res.json({
      users: { current: userCount?.count ?? 0, max: plafondUtilisateurs },
      contacts: { current: contactCount?.count ?? 0, max: subscription?.maxContacts ?? null },
      callsThisMonth: { current: callCount?.count ?? 0, max: subscription?.maxCallsPerMonth ?? null },
      // Le PLAN fait foi, comme pour l'acces lui-meme
      // (services/droits-plan.ts). Les colonnes sont une photographie prise a
      // la souscription et que rien ne met a jour: les lire ferait diverger ce
      // que l'ecran annonce de ce que le serveur autorise. Sans abonnement,
      // rien n'est ouvert.
      features: {
        aiEnabled: fonctionsDuPlan?.aiEnabled ?? false,
        stockEnabled: fonctionsDuPlan?.stockEnabled ?? false,
        automationEnabled: fonctionsDuPlan?.automationEnabled ?? false,
      },
      ...(subscription ? {} : { sansAbonnement: true }),
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur usage abonnement");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'usage." });
  }
});

export default router;
