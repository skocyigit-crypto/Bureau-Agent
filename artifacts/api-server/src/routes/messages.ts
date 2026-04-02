import { Router, type IRouter } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db, messagesTable } from "@workspace/db";
import {
  ListMessagesQueryParams,
  CreateMessageBody,
  GetMessageParams,
  UpdateMessageParams,
  UpdateMessageBody,
  DeleteMessageParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/messages", async (req, res): Promise<void> => {
  const query = ListMessagesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { read, limit, offset } = query.data;

  const conditions = [];
  if (read !== undefined) {
    conditions.push(eq(messagesTable.isRead, read));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [messages, countResult] = await Promise.all([
    db
      .select()
      .from(messagesTable)
      .where(whereClause)
      .orderBy(desc(messagesTable.createdAt))
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

  const [message] = await db.insert(messagesTable).values(parsed.data).returning();
  res.status(201).json(message);
});

router.get("/messages/:id", async (req, res): Promise<void> => {
  const params = GetMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [message] = await db.select().from(messagesTable).where(eq(messagesTable.id, params.data.id));
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

  const [message] = await db.update(messagesTable)
    .set(parsed.data)
    .where(eq(messagesTable.id, params.data.id))
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

  const [message] = await db.delete(messagesTable).where(eq(messagesTable.id, params.data.id)).returning();
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
