import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import {
  ListTasksQueryParams,
  CreateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  UpdateTaskBody,
  DeleteTaskParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

const taskSortColumns: Record<string, any> = {
  createdAt: tasksTable.createdAt,
  dueDate: tasksTable.dueDate,
  priority: tasksTable.priority,
  status: tasksTable.status,
  title: tasksTable.title,
};

router.get("/tasks", async (req, res): Promise<void> => {
  const query = ListTasksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const { status, priority, limit, offset, search, sortBy, sortOrder } = query.data;

  const conditions: any[] = [eq(tasksTable.organisationId, orgId)];
  if (status && status !== "all") {
    conditions.push(eq(tasksTable.status, status));
  }
  if (priority && priority !== "all") {
    conditions.push(eq(tasksTable.priority, priority));
  }
  if (search) {
    conditions.push(
      or(
        ilike(tasksTable.title, `%${search}%`),
        ilike(tasksTable.description, `%${search}%`),
        ilike(tasksTable.assignedTo, `%${search}%`)
      )!
    );
  }

  const whereClause = and(...conditions);

  const sortCol = taskSortColumns[sortBy ?? "createdAt"] ?? tasksTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [tasks, countResult] = await Promise.all([
    db
      .select()
      .from(tasksTable)
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(limit ?? 50)
      .offset(offset ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasksTable)
      .where(whereClause),
  ]);

  res.json({ tasks, total: countResult[0]?.count ?? 0 });
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [task] = await db.insert(tasksTable).values({ ...parsed.data, organisationId: orgId }).returning();
  res.status(201).json(task);
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [task] = await db.select().from(tasksTable).where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.organisationId, orgId)));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json(task);
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [task] = await db.update(tasksTable)
    .set(parsed.data)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.organisationId, orgId)))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json(task);
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [task] = await db.delete(tasksTable).where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.organisationId, orgId))).returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
