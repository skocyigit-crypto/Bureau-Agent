import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, insertCalendarEventSchema, tasksTable } from "@workspace/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { logAudit } from "./audit";
import { getOrgId } from "../middleware/tenant";
import { resolveUserNames, enrichWithUserNames } from "../helpers/user-tracking";

const router = Router();

const ALLOWED_UPDATE_FIELDS = new Set([
  "title", "description", "type", "startDate", "endDate", "allDay",
  "location", "color", "relatedContactId", "relatedTaskId", "reminder", "recurrence",
  "contactName", "contactPhone", "contactEmail", "contactCompany", "contactNotes",
  "status", "priority",
]);

router.get("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const { start, end, type } = req.query;

  let conditions: any[] = [eq(calendarEventsTable.organisationId, orgId)];
  if (start && typeof start === "string") {
    const d = new Date(start);
    if (!isNaN(d.getTime())) conditions.push(gte(calendarEventsTable.startDate, d));
  }
  if (end && typeof end === "string") {
    const d = new Date(end);
    if (!isNaN(d.getTime())) conditions.push(lte(calendarEventsTable.endDate, d));
  }
  if (type && type !== "tous" && typeof type === "string") conditions.push(eq(calendarEventsTable.type, type));

  try {
    const events = await db
      .select()
      .from(calendarEventsTable)
      .where(and(...conditions))
      .orderBy(calendarEventsTable.startDate);

    const taskConditions: any[] = [eq(tasksTable.organisationId, orgId)];
    if (start && end) {
      taskConditions.push(gte(tasksTable.dueDate, new Date(start as string)));
      taskConditions.push(lte(tasksTable.dueDate, new Date(end as string)));
    }

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(taskConditions.length > 1 ? and(...taskConditions) : taskConditions[0]);

    const taskEvents = tasks
      .filter(t => t.dueDate)
      .map(t => ({
        id: `task-${t.id}`,
        title: t.title,
        description: t.description,
        type: "tache",
        startDate: t.dueDate,
        endDate: t.dueDate,
        allDay: true,
        color: t.priority === "haute" ? "#ef4444" : t.priority === "moyenne" ? "#f59e0b" : "#22c55e",
        relatedTaskId: t.id,
        status: t.status,
      }));

    const userIds = events.flatMap((e: any) => [e.createdBy, e.updatedBy]);
    const userMap = await resolveUserNames(userIds);
    res.json({ events: enrichWithUserNames(events, userMap), taskEvents });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste evenements agenda");
    res.status(500).json({ error: "Erreur lors de la recuperation des evenements." });
  }
});

router.post("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const body = { ...req.body };
  if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
  if (body.endDate && typeof body.endDate === "string") body.endDate = new Date(body.endDate);

  const parsed = insertCalendarEventSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.issues });
    return;
  }

  try {
    const [event] = await db.insert(calendarEventsTable).values({
      ...parsed.data,
      organisationId: orgId,
      createdBy: userId,
      updatedBy: userId,
    }).returning();

    logAudit(userId, (req.session as any)?.userEmail, "create", "calendar_event", String(event.id), { title: event.title });
    res.status(201).json(event);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation evenement agenda");
    res.status(500).json({ error: "Erreur lors de la creation de l'evenement." });
  }
});

router.patch("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const updateData: Record<string, any> = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (ALLOWED_UPDATE_FIELDS.has(key) && value !== undefined) {
      updateData[key] = value;
    }
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Aucune modification fournie." });
    return;
  }

  updateData.updatedBy = userId;

  try {
    const [updated] = await db
      .update(calendarEventsTable)
      .set(updateData)
      .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.organisationId, orgId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Evenement non trouve." }); return; }
    logAudit(userId, (req.session as any)?.userEmail, "update", "calendar_event", String(id), updateData);
    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour evenement agenda");
    res.status(500).json({ error: "Erreur lors de la mise a jour de l'evenement." });
  }
});

router.delete("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    await db.delete(calendarEventsTable).where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.organisationId, orgId)));
    logAudit(userId, (req.session as any)?.userEmail, "delete", "calendar_event", String(id));
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression evenement agenda");
    res.status(500).json({ error: "Erreur lors de la suppression de l'evenement." });
  }
});

router.get("/calendar/events/export/csv", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId)).limit(5000);
    const headers = ["Titre", "Type", "Statut", "Début", "Fin", "Lieu", "Contact", "Priorité", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.title), escape(r.type), escape(r.status),
      escape(fmtDate(r.startDate)), escape(fmtDate(r.endDate)), escape(r.location),
      escape(r.contactName), escape(r.priority), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="evenements_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export calendar CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

export default router;
