import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, insertCalendarEventSchema, tasksTable } from "@workspace/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

const router = Router();

router.get("/calendar/events", async (req: Request, res: Response): Promise<void> => {
  const { start, end, type } = req.query;

  let conditions: any[] = [];
  if (start) conditions.push(gte(calendarEventsTable.startDate, new Date(start as string)));
  if (end) conditions.push(lte(calendarEventsTable.endDate, new Date(end as string)));
  if (type && type !== "tous") conditions.push(eq(calendarEventsTable.type, type as string));

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
  const parsed = insertCalendarEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Donnees invalides.", details: parsed.error.issues });
    return;
  }

  const [event] = await db.insert(calendarEventsTable).values({
    ...parsed.data,
    createdBy: (req.session as any)?.userId,
  }).returning();

  res.status(201).json(event);
});

router.patch("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const [updated] = await db
    .update(calendarEventsTable)
    .set(req.body)
    .where(eq(calendarEventsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Evenement non trouve." }); return; }
  res.json(updated);
});

router.delete("/calendar/events/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  res.json({ success: true });
});

export default router;
