import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import {
  ListTasksQueryParams,
  CreateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  UpdateTaskBody,
  DeleteTaskParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { resolveUserNames, enrichWithUserNames, enrichSingle } from "../helpers/user-tracking";
import { zodErrorResponse } from "../lib/zod-error";

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
    res.status(400).json(zodErrorResponse(query.error));
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
  const useUnaccent = await ensureUnaccentExtension();
  if (search) {
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(
      or(
        il(tasksTable.title),
        il(tasksTable.description),
        il(tasksTable.assignedTo),
      )!
    );
  }

  const whereClause = and(...conditions);

  const sortCol = taskSortColumns[sortBy ?? "createdAt"] ?? tasksTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
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

    const userIds = tasks.flatMap((t: any) => [t.createdBy, t.updatedBy]);
    const userMap = await resolveUserNames(userIds);
    res.json({ tasks: enrichWithUserNames(tasks, userMap), total: countResult[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste taches");
    res.status(500).json({ error: "Erreur lors de la recuperation des taches." });
  }
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;

  try {
    const [task] = await db.insert(tasksTable).values({ ...parsed.data, organisationId: orgId, createdBy: userId, updatedBy: userId }).returning();
    res.status(201).json(task);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation tache");
    res.status(500).json({ error: "Erreur lors de la creation de la tache." });
  }
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);

  try {
    const [task] = await db.select().from(tasksTable).where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.organisationId, orgId)));
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const userMap = await resolveUserNames([task.createdBy, task.updatedBy]);
    res.json(enrichSingle(task, userMap));
  } catch (err: any) {
    req.log.error({ err }, "Erreur recuperation tache");
    res.status(500).json({ error: "Erreur lors de la recuperation de la tache." });
  }
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }

  const orgId = getOrgId(req);
  const userId = req.session?.userId;

  try {
    const [task] = await db.update(tasksTable)
      .set({ ...parsed.data, updatedBy: userId })
      .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.organisationId, orgId)))
      .returning();

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(task);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour tache");
    res.status(500).json({ error: "Erreur lors de la mise a jour de la tache." });
  }
});

router.get("/tasks/export/csv", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(tasksTable).where(eq(tasksTable.organisationId, orgId)).orderBy(desc(tasksTable.createdAt));
    const headers = ["Titre", "Statut", "Priorité", "Description", "Date d'échéance", "Récurrent", "Règle", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.title), escape(r.status), escape(r.priority), escape(r.description),
      escape(fmtDate(r.dueDate)), escape(r.isRecurring ? "Oui" : "Non"),
      escape(r.recurrenceRule), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="taches_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export taches CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.post("/tasks/:id/duplicate", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [orig] = await db.select().from(tasksTable).where(and(eq(tasksTable.id, id), eq(tasksTable.organisationId, orgId)));
    if (!orig) { res.status(404).json({ error: "Tâche introuvable." }); return; }
    const [copy] = await db.insert(tasksTable).values({
      organisationId: orgId,
      title: `${orig.title} (copie)`,
      description: orig.description,
      status: "en_attente",
      priority: orig.priority,
      dueDate: orig.dueDate,
      assignedTo: orig.assignedTo,
      relatedContactId: orig.relatedContactId,
      relatedCallId: orig.relatedCallId,
      createdBy: userId,
      updatedBy: userId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication tache");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json(zodErrorResponse(params.error));
    return;
  }

  const orgId = getOrgId(req);

  try {
    const [task] = await db.delete(tasksTable).where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.organisationId, orgId))).returning();
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.sendStatus(204);
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression tache");
    res.status(500).json({ error: "Erreur lors de la suppression de la tache." });
  }
});

export default router;
