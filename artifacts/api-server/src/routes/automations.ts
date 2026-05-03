import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  automationRulesTable,
  automationLogsTable,
  notificationsTable,
} from "@workspace/db/schema";
import { eq, desc, and, sql, gte, inArray } from "drizzle-orm";
import { logAudit } from "./audit";

const router = Router();

router.get("/notifications", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
  const unreadOnly = req.query.unread === "true";

  try {
    const userFilter = eq(notificationsTable.userId, userId);
    const unreadFilter = eq(notificationsTable.read, false);
    const whereClause = unreadOnly
      ? and(userFilter, unreadFilter)
      : userFilter;

    const notifications = await db
      .select()
      .from(notificationsTable)
      .where(whereClause)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(and(userFilter, unreadFilter));

    res.json({ notifications, unreadCount: count });
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation notifications");
    res.status(500).json({ error: "Erreur lors de la recuperation des notifications." });
  }
});

router.patch("/notifications/:id/read", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    await db.update(notificationsTable).set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur marquer notification lue");
    res.status(500).json({ error: "Erreur lors de la mise a jour de la notification." });
  }
});

router.post("/notifications/read-all", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  try {
    await db.update(notificationsTable).set({ read: true })
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur marquer toutes notifications lues");
    res.status(500).json({ error: "Erreur lors de la mise a jour des notifications." });
  }
});

router.delete("/notifications/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    await db.delete(notificationsTable)
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression notification");
    res.status(500).json({ error: "Erreur lors de la suppression de la notification." });
  }
});

router.post("/notifications/delete-all", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  try {
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression toutes notifications");
    res.status(500).json({ error: "Erreur lors de la suppression des notifications." });
  }
});

router.get("/automations", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  try {
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
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste automations");
    res.status(500).json({ error: "Erreur lors de la recuperation des automations." });
  }
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

  try {
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
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation automation");
    res.status(500).json({ error: "Erreur lors de la creation de l'automation." });
  }
});

router.patch("/automations/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces refuse." }); return;
  }

  const id = parseInt(String(req.params.id));
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

  try {
    const [updated] = await db
      .update(automationRulesTable)
      .set(updateData)
      .where(eq(automationRulesTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Regle non trouvee." }); return; }
    logAudit(userId, (req.session as any)?.userEmail, "update", "automation_rule", String(id), updateData);
    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour automation");
    res.status(500).json({ error: "Erreur lors de la mise a jour de l'automation." });
  }
});

router.delete("/automations/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") {
    res.status(403).json({ error: "Acces refuse." }); return;
  }

  const id = parseInt(String(req.params.id));
  if (isNaN(id) || id < 1) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    await db.delete(automationRulesTable).where(eq(automationRulesTable.id, id));
    logAudit(userId, (req.session as any)?.userEmail, "delete", "automation_rule", String(id));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression automation");
    res.status(500).json({ error: "Erreur lors de la suppression de l'automation." });
  }
});

router.post("/automations/bulk/delete", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces refuse." }); return; }
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
  try {
    await db.delete(automationRulesTable).where(inArray(automationRulesTable.id, ids));
    res.json({ success: true, deleted: ids.length });
  } catch (err: any) {
    req.log.error({ err }, "Bulk delete automations error");
    res.status(500).json({ error: "Erreur suppression" });
  }
});

router.post("/automations/bulk/toggle", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces refuse." }); return; }
  const { ids, enabled } = req.body as { ids: number[]; enabled: boolean };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids requis" }); return; }
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled requis (boolean)" }); return; }
  try {
    await db.update(automationRulesTable).set({ enabled }).where(inArray(automationRulesTable.id, ids));
    res.json({ success: true, updated: ids.length });
  } catch (err: any) {
    req.log.error({ err }, "Bulk toggle automations error");
    res.status(500).json({ error: "Erreur mise a jour" });
  }
});

router.get("/automations/logs", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);

  try {
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
  } catch (err: any) {
    req.log.error({ err }, "Erreur logs automations");
    res.status(500).json({ error: "Erreur lors de la recuperation des logs." });
  }
});

router.post("/automations/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces refuse." }); return; }
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [original] = await db.select().from(automationRulesTable).where(eq(automationRulesTable.id, id));
    if (!original) { res.status(404).json({ error: "Automation non trouvee." }); return; }
    const [copy] = await db.insert(automationRulesTable).values({
      name: `${original.name} (copie)`,
      description: original.description,
      type: original.type,
      trigger: original.trigger,
      conditions: original.conditions,
      actions: original.actions,
      schedule: original.schedule,
      enabled: false,
      createdBy: userId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication automation");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.get("/automations/export/csv", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  const userRole = (req.session as any)?.userRole;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
  if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces refuse." }); return; }
  try {
    const rules = await db.select().from(automationRulesTable);
    const header = "ID,Nom,Type,Declencheur,Frequence,Actif,Executions,Derniere execution,Date creation\n";
    const rows = rules.map(r =>
      [r.id, r.name, r.type, r.trigger, r.schedule || "", r.enabled ? "oui" : "non",
        r.runCount, r.lastRun ? new Date(r.lastRun).toLocaleDateString("fr-FR") : "",
        r.createdAt ? new Date(r.createdAt).toLocaleDateString("fr-FR") : ""]
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="automations_${Date.now()}.csv"`);
    res.send("\uFEFF" + header + rows);
  } catch (err: any) {
    req.log.error({ err }, "Erreur export automations CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

export default router;
