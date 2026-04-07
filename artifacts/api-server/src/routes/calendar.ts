import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, insertCalendarEventSchema, tasksTable } from "@workspace/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { logAudit } from "./audit";

const router = Router();

const ALLOWED_UPDATE_FIELDS = new Set([
  "title", "description", "type", "startDate", "endDate", "allDay",
  "location", "color", "relatedContactId", "relatedTaskId", "reminder", "recurrence"
]);

router.get("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { start, end, type } = req.query;

  let conditions: any[] = [];
  if (start && typeof start === "string") {
    const d = new Date(start);
    if (!isNaN(d.getTime())) conditions.push(gte(calendarEventsTable.startDate, d));
  }
  if (end && typeof end === "string") {
    const d = new Date(end);
    if (!isNaN(d.getTime())) conditions.push(lte(calendarEventsTable.endDate, d));
  }
  if (type && type !== "tous" && typeof type === "string") conditions.push(eq(calendarEventsTable.type, type));

  const events = await db
    .select()
    .from(calendarEventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(calendarEventsTable.startDate);

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      start && end
        ? and(
            gte(tasksTable.dueDate, new Date(start as string)),
            lte(tasksTable.dueDate, new Date(end as string))
          )
        : undefined
    );

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

  res.json({ events, taskEvents });
});

router.post("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const parsed = insertCalendarEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.issues });
    return;
  }

  const [event] = await db.insert(calendarEventsTable).values({
    ...parsed.data,
    createdBy: userId,
  }).returning();

  logAudit(userId, (req.session as any)?.userEmail, "create", "calendar_event", String(event.id), { title: event.title });
  res.status(201).json(event);
});

router.patch("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(req.params.id);
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

  const [updated] = await db
    .update(calendarEventsTable)
    .set(updateData)
    .where(eq(calendarEventsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Evenement non trouve." }); return; }
  logAudit(userId, (req.session as any)?.userEmail, "update", "calendar_event", String(id), updateData);
  res.json(updated);
});

router.delete("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  logAudit(userId, (req.session as any)?.userEmail, "delete", "calendar_event", String(id));
  res.json({ success: true });
});

export default router;
