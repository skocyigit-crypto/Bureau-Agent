import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import {
  ListMessagesQueryParams,
  CreateMessageBody,
  GetMessageParams,
  UpdateMessageParams,
  UpdateMessageBody,
  DeleteMessageParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

const messageSortColumns: Record<string, any> = {
  createdAt: messagesTable.createdAt,
  priority: messagesTable.priority,
  type: messagesTable.type,
};

router.get("/messages", async (req, res): Promise<void> => {
  const query = ListMessagesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const { read, limit, offset, search, type, priority, sortBy, sortOrder } = query.data;

  const conditions: any[] = [eq(messagesTable.organisationId, orgId)];
  if (read !== undefined) {
    conditions.push(eq(messagesTable.isRead, read));
  }
  if (type && type !== "all") {
    conditions.push(eq(messagesTable.type, type));
  }
  if (priority && priority !== "all") {
    conditions.push(eq(messagesTable.priority, priority));
  }
  if (search) {
    conditions.push(
      or(
        ilike(messagesTable.content, `%${search}%`),
        ilike(messagesTable.contactName, `%${search}%`),
        ilike(messagesTable.phoneNumber, `%${search}%`)
      )!
    );
  }

  const whereClause = and(...conditions);

  const sortCol = messageSortColumns[sortBy ?? "createdAt"] ?? messagesTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [messages, countResult] = await Promise.all([
    db
      .select()
      .from(messagesTable)
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(limit ?? 50)
      .offset(offset ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(whereClause),
  ]);

  res.json({ messages, total: countResult[0]?.count ?? 0 });
});

router.post("/messages", async (req, res): Promise<void> => {
  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [message] = await db.insert(messagesTable).values({ ...parsed.data, organisationId: orgId }).returning();
  res.status(201).json(message);
});

router.get("/messages/:id", async (req, res): Promise<void> => {
  const params = GetMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [message] = await db.select().from(messagesTable).where(and(eq(messagesTable.id, params.data.id), eq(messagesTable.organisationId, orgId)));
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  res.json(message);
});

router.patch("/messages/:id", async (req, res): Promise<void> => {
  const params = UpdateMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [message] = await db.update(messagesTable)
    .set(parsed.data)
    .where(and(eq(messagesTable.id, params.data.id), eq(messagesTable.organisationId, orgId)))
    .returning();

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  res.json(message);
});

router.delete("/messages/:id", async (req, res): Promise<void> => {
  const params = DeleteMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [message] = await db.delete(messagesTable).where(and(eq(messagesTable.id, params.data.id), eq(messagesTable.organisationId, orgId))).returning();
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
