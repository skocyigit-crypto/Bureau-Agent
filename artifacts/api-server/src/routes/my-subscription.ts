import { Router, type Request, type Response } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, organisationsTable, subscriptionsTable, usersTable, contactsTable, callsTable, invoicesTable } from "@workspace/db";
import { PLANS, type PlanKey } from "@workspace/db/schema";

const router = Router();

function getSession(req: Request) {
  const s = req.session;
  return {
    userId: s?.userId,
    orgId: s?.organisationId,
    role: s?.userRole,
  };
}

router.get("/my-subscription", async (req: Request, res: Response): Promise<void> => {
  const { orgId } = getSession(req);
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  try {
  const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
  if (!org) { res.status(404).json({ error: "Organisation introuvable." }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));

  const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.organisationId, orgId));
  const [contactCount] = await db.select({ count: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId));
  const [callCount] = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable).where(eq(callsTable.organisationId, orgId));

  const planKey = (sub?.plan || "essai") as PlanKey;
  const planDetails = PLANS[planKey] || PLANS.essai;

  const now = new Date();
  const trialExpired = sub?.trialEndsAt ? new Date(sub.trialEndsAt) < now : false;
  const isActive = org.actif && (!sub || (sub.status === "active" && !(sub.plan === "essai" && trialExpired)));

  const daysRemaining = sub?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  const periodEnd = sub?.currentPeriodEnd
    ? Math.max(0, Math.ceil((new Date(sub.currentPeriodEnd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  res.json({
    organisation: {
      id: org.id,
      name: org.name,
      actif: org.actif,
    },
    subscription: sub ? {
      plan: sub.plan,
      planName: planDetails.name,
      status: sub.status,
      licenseKey: sub.licenseKey,
      price: sub.price,
      currency: sub.currency,
      billingCycle: sub.billingCycle,
      trialEndsAt: sub.trialEndsAt,
      trialExpired,
      daysRemaining,
      currentPeriodEnd: sub.currentPeriodEnd,
      periodDaysRemaining: periodEnd,
      cancelledAt: sub.cancelledAt,
      createdAt: sub.createdAt,
    } : null,
    limits: {
      maxUsers: sub?.maxUsers || planDetails.maxUsers,
      maxContacts: sub?.maxContacts || planDetails.maxContacts,
      maxCallsPerMonth: sub?.maxCallsPerMonth || planDetails.maxCallsPerMonth,
      aiEnabled: sub?.aiEnabled ?? planDetails.aiEnabled,
      stockEnabled: sub?.stockEnabled ?? planDetails.stockEnabled,
      automationEnabled: sub?.automationEnabled ?? planDetails.automationEnabled,
    },
    usage: {
      users: userCount?.count || 0,
      contacts: contactCount?.count || 0,
      calls: callCount?.count || 0,
    },
    isActive,
    plans: Object.entries(PLANS).map(([key, plan]) => ({
      key,
      name: plan.name,
      price: plan.price,
      maxUsers: plan.maxUsers,
      maxContacts: plan.maxContacts,
      maxCallsPerMonth: plan.maxCallsPerMonth,
      aiEnabled: plan.aiEnabled,
      stockEnabled: plan.stockEnabled,
      automationEnabled: plan.automationEnabled,
      isCurrent: key === planKey,
    })),
  });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation abonnement utilisateur");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'abonnement." });
  }
});

router.post("/my-subscription/upgrade-request", async (req: Request, res: Response): Promise<void> => {
  const { orgId, userId } = getSession(req);
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  const { targetPlan, message } = req.body;
  if (!targetPlan || !PLANS[targetPlan as PlanKey]) {
    res.status(400).json({ error: "Plan cible invalide." }); return;
  }

  try {
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
    const [user] = userId ? await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)) : [null];

    const { notificationsTable } = await import("@workspace/db");
    const superAdmins = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.role, "super_admin"));

    for (const admin of superAdmins) {
      await db.insert(notificationsTable).values({
        userId: admin.id,
        organisationId: orgId,
        type: "info",
        title: "Demande de changement de plan",
        message: `${org?.name || "Organisation"} (${user?.email || "utilisateur"}) demande un passage au plan "${PLANS[targetPlan as PlanKey].name}". ${message || ""}`.trim(),
        priority: "haute",
        actionUrl: "/organisations",
      });
    }

    res.json({
      success: true,
      message: `Votre demande de passage au plan "${PLANS[targetPlan as PlanKey].name}" a ete envoyee a l'administrateur. Vous serez contacte sous peu.`,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur demande upgrade abonnement");
    res.status(500).json({ error: "Erreur lors de l'envoi de la demande de changement de plan." });
  }
});

router.get("/my-subscription/invoices", async (req: Request, res: Response): Promise<void> => {
  const { orgId } = getSession(req);
  if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

  try {
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.organisationId, orgId))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(24);

    res.json({ invoices });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation factures organisation");
    res.status(500).json({ error: "Erreur lors de la recuperation des factures." });
  }
});

router.get("/my-subscription/check-access", async (req: Request, res: Response): Promise<void> => {
  const { orgId, role } = getSession(req);

  if (role === "super_admin") { res.json({ allowed: true, reason: "super_admin" }); return; }

  if (!orgId) { res.json({ allowed: false, reason: "no_org" }); return; }

  try {
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
    if (!org || !org.actif) { res.json({ allowed: false, reason: "org_inactive" }); return; }

    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));
    if (!sub) { res.json({ allowed: true, reason: "no_subscription" }); return; }

    if (sub.status === "cancelled") {
      res.json({ allowed: false, reason: "cancelled" }); return;
    }

    if (sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
      if (sub.plan === "essai") {
        res.json({ allowed: false, reason: "trial_expired", trialEndsAt: sub.trialEndsAt }); return;
      }
    }

    res.json({ allowed: true, reason: "active" });
  } catch (err: any) {
    req.log.error({ err }, "Erreur verification acces abonnement");
    res.status(500).json({ error: "Erreur lors de la verification de l'acces." });
  }
});

export default router;
