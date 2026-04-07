import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  automationRulesTable,
  automationLogsTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { logAudit } from "./audit";

const router = Router();

router.get("/notifications", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
  const unreadOnly = req.query.unread === "true";

  let whereClause = undefined;
  if (unreadOnly) {
    whereClause = eq(notificationsTable.read, false);
  }

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(whereClause)
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(eq(notificationsTable.read, false));

  res.json({ notifications, unreadCount: count });
});

router.patch("/notifications/:id/read", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  await db.update(notificationsTable).set({ read: true }).where(eq(notificationsTable.id, id));
  res.json({ success: true });
});

router.post("/notifications/read-all", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  await db.update(notificationsTable).set({ read: true }).where(eq(notificationsTable.read, false));
  res.json({ success: true });
});

router.get("/automations", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const rules = await db
    .select()
    .from(automationRulesTable)
    .orderBy(desc(automationRulesTable.updatedAt));

  const builtInRules = [
    {
      id: -1,
      name: "Taches en retard",
      description: "Detecte les taches depassant leur echeance et cree des alertes automatiques.",
      type: "systeme",
      trigger: "schedule",
      schedule: "1min",
      enabled: true,
      runCount: null,
      lastRun: null,
      builtIn: true,
    },
    {
      id: -2,
      name: "Rappels calendrier",
      description: "Envoie des rappels 30 minutes avant chaque evenement du calendrier.",
      type: "systeme",
      trigger: "schedule",
      schedule: "1min",
      enabled: true,
      runCount: null,
      lastRun: null,
      builtIn: true,
    },
    {
      id: -3,
      name: "Messages non lus",
      description: "Alerte quand des messages restent non lus depuis plus d'une heure.",
      type: "systeme",
      trigger: "schedule",
      schedule: "1min",
      enabled: true,
      runCount: null,
      lastRun: null,
      builtIn: true,
    },
    {
      id: -4,
      name: "Contacts inactifs",
      description: "Identifie les contacts sans activite depuis 30 jours.",
      type: "systeme",
      trigger: "schedule",
      schedule: "1min",
      enabled: true,
      runCount: null,
      lastRun: null,
      builtIn: true,
    },
    {
      id: -5,
      name: "Appels manques",
      description: "Detecte les appels manques du jour et propose un rappel.",
      type: "systeme",
      trigger: "schedule",
      schedule: "1min",
      enabled: true,
      runCount: null,
      lastRun: null,
      builtIn: true,
    },
  ];

  res.json({ rules: [...builtInRules, ...rules] });
});

router.post("/automations", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces refuse." }); return;
  }

  const { name, description, type, trigger, conditions, actions, schedule } = req.body;
  if (!name || !type || !trigger || !actions) {
    res.status(400).json({ error: "Champs obligatoires manquants (name, type, trigger, actions)." });
    return;
  }

  const [rule] = await db.insert(automationRulesTable).values({
    name,
    description: description || null,
    type,
    trigger,
    conditions: conditions || null,
    actions,
    schedule: schedule || null,
    nextRun: schedule ? new Date() : null,
    createdBy: userId,
  }).returning();

  logAudit(userId, (req.session as any)?.userEmail, "create", "automation_rule", String(rule.id), { name });
  res.status(201).json(rule);
});

router.patch("/automations/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces refuse." }); return;
  }

  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) { res.status(400).json({ error: "ID invalide." }); return; }

  const { enabled, name, description, schedule } = req.body;
  const updateData: Record<string, any> = {};
  if (typeof enabled === "boolean") updateData.enabled = enabled;
  if (typeof name === "string") updateData.name = name;
  if (typeof description === "string") updateData.description = description;
  if (typeof schedule === "string") updateData.schedule = schedule;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Aucune modification fournie." });
    return;
  }

  const [updated] = await db
    .update(automationRulesTable)
    .set(updateData)
    .where(eq(automationRulesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Regle non trouvee." }); return; }
  logAudit(userId, (req.session as any)?.userEmail, "update", "automation_rule", String(id), updateData);
  res.json(updated);
});

router.delete("/automations/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces refuse." }); return;
  }

  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) { res.status(400).json({ error: "ID invalide." }); return; }

  await db.delete(automationRulesTable).where(eq(automationRulesTable.id, id));
  logAudit(userId, (req.session as any)?.userEmail, "delete", "automation_rule", String(id));
  res.json({ success: true });
});

router.get("/automations/logs", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

  const logs = await db
    .select()
    .from(automationLogsTable)
    .orderBy(desc(automationLogsTable.createdAt))
    .limit(limit);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [stats] = await db
    .select({
      totalToday: sql<number>`count(*)::int`,
      successToday: sql<number>`count(*) FILTER (WHERE status = 'success')::int`,
      errorToday: sql<number>`count(*) FILTER (WHERE status = 'error')::int`,
      itemsToday: sql<number>`coalesce(sum(items_processed), 0)::int`,
    })
    .from(automationLogsTable)
    .where(gte(automationLogsTable.createdAt, today));

  res.json({ logs, stats });
});

export default router;
