import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, contactsTable, callsTable, tasksTable, calendarEventsTable } from "@workspace/db";
import {
  ListContactsQueryParams,
  CreateContactBody,
  GetContactParams,
  UpdateContactParams,
  UpdateContactBody,
  DeleteContactParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const contactSortColumns: Record<string, any> = {
  createdAt: contactsTable.createdAt,
  firstName: contactsTable.firstName,
  lastName: contactsTable.lastName,
  company: contactsTable.company,
  totalCalls: contactsTable.totalCalls,
};

router.get("/contacts", async (req, res): Promise<void> => {
  const query = ListContactsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search, category, limit, offset, sortBy, sortOrder } = query.data;

  const conditions = [];
  if (category && category !== "all") {
    conditions.push(eq(contactsTable.category, category));
  }
  if (search) {
    conditions.push(
      or(
        ilike(contactsTable.firstName, `%${search}%`),
        ilike(contactsTable.lastName, `%${search}%`),
        ilike(contactsTable.company, `%${search}%`),
        ilike(contactsTable.phone, `%${search}%`),
        ilike(contactsTable.email, `%${search}%`)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol = contactSortColumns[sortBy ?? "createdAt"] ?? contactsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [contacts, countResult] = await Promise.all([
    db
      .select()
      .from(contactsTable)
      .where(whereClause)
      .orderBy(orderFn(sortCol))
      .limit(limit ?? 50)
      .offset(offset ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactsTable)
      .where(whereClause),
  ]);

  res.json({ contacts, total: countResult[0]?.count ?? 0 });
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db.insert(contactsTable).values(parsed.data).returning();
  res.status(201).json(contact);
});

router.get("/contacts/:id", async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, params.data.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json(contact);
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db.update(contactsTable)
    .set(parsed.data)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json(contact);
});

router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db.delete(contactsTable).where(eq(contactsTable.id, params.data.id)).returning();
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  await db.update(tasksTable).set({ relatedContactId: null }).where(eq(tasksTable.relatedContactId, params.data.id));
  await db.update(calendarEventsTable).set({ relatedContactId: null }).where(eq(calendarEventsTable.relatedContactId, params.data.id));

  res.sendStatus(204);
});

router.get("/contacts/:id/calls", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const limit = parseInt(req.query.limit as string || "20", 10);

  const [calls, countResult] = await Promise.all([
    db
      .select()
      .from(callsTable)
      .where(eq(callsTable.contactId, id))
      .orderBy(desc(callsTable.createdAt))
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(callsTable)
      .where(eq(callsTable.contactId, id)),
  ]);

  res.json({ calls, total: countResult[0]?.count ?? 0 });
});

router.get("/contacts/:id/tasks", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw!, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.relatedContactId, id))
    .orderBy(desc(tasksTable.createdAt));

  res.json({ tasks });
});

export default router;
