import { Router, type IRouter } from "express";
import { eq, desc, ilike, or, sql, and } from "drizzle-orm";
import { db, callsTable, contactsTable } from "@workspace/db";
import {
  ListCallsQueryParams,
  CreateCallBody,
  GetCallParams,
  UpdateCallParams,
  UpdateCallBody,
  DeleteCallParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/calls", async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { status, limit, offset, search } = query.data;

  const conditions = [];
  if (status && status !== "all") {
    if (status === "answered") conditions.push(eq(callsTable.status, "repondu"));
    else if (status === "missed") conditions.push(eq(callsTable.status, "manque"));
    else if (status === "voicemail") conditions.push(eq(callsTable.status, "messagerie"));
    else if (status === "outgoing") conditions.push(eq(callsTable.direction, "sortant"));
    else conditions.push(eq(callsTable.status, status));
  }
  if (search) {
    conditions.push(
      or(
        ilike(callsTable.phoneNumber, `%${search}%`),
        ilike(callsTable.contactName, `%${search}%`),
        ilike(callsTable.notes, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [calls, countResult] = await Promise.all([
    db
      .select()
      .from(callsTable)
      .where(whereClause)
      .orderBy(desc(callsTable.createdAt))
      .limit(limit ?? 50)
      .offset(offset ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(callsTable)
      .where(whereClause),
  ]);

  res.json({ calls, total: countResult[0]?.count ?? 0 });
});

router.post("/calls", async (req, res): Promise<void> => {
  const parsed = CreateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  if (data.contactId) {
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, data.contactId));
    if (contact) {
      await db.update(contactsTable)
        .set({
          totalCalls: sql`${contactsTable.totalCalls} + 1`,
          lastCallAt: new Date(),
        })
        .where(eq(contactsTable.id, data.contactId));
    }
  }

  const [call] = await db.insert(callsTable).values({
    ...data,
    tags: data.tags ?? [],
  }).returning();

  res.status(201).json(call);
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  res.json(call);
});

router.patch("/calls/:id", async (req, res): Promise<void> => {
  const params = UpdateCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [call] = await db.update(callsTable)
    .set(parsed.data)
    .where(eq(callsTable.id, params.data.id))
    .returning();

  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  res.json(call);
});

router.delete("/calls/:id", async (req, res): Promise<void> => {
  const params = DeleteCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [call] = await db.delete(callsTable).where(eq(callsTable.id, params.data.id)).returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
