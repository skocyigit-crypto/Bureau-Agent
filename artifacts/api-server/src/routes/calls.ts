import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and, gte, lte } from "drizzle-orm";
import { db, callsTable, contactsTable, tasksTable } from "@workspace/db";
import {
  ListCallsQueryParams,
  CreateCallBody,
  GetCallParams,
  UpdateCallParams,
  UpdateCallBody,
  DeleteCallParams,
} from "@workspace/api-zod";
import { processCallWithAI } from "../services/call-processor";
import { logAudit } from "./audit";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

const callSortColumns: Record<string, any> = {
  createdAt: callsTable.createdAt,
  duration: callsTable.duration,
  status: callsTable.status,
  contactName: callsTable.contactName,
};

router.get("/calls", async (req, res): Promise<void> => {
  const query = ListCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const { status, limit, offset, search, sortBy, sortOrder, dateFrom, dateTo, direction } = query.data;

  const conditions: any[] = [eq(callsTable.organisationId, orgId)];
  if (status && status !== "all") {
    if (status === "answered") conditions.push(eq(callsTable.status, "repondu"));
    else if (status === "missed") conditions.push(eq(callsTable.status, "manque"));
    else if (status === "voicemail") conditions.push(eq(callsTable.status, "messagerie"));
    else if (status === "outgoing") conditions.push(eq(callsTable.direction, "sortant"));
    else conditions.push(eq(callsTable.status, status));
  }
  if (direction && direction !== "all") {
    conditions.push(eq(callsTable.direction, direction));
  }
  if (search) {
    conditions.push(
      or(
        ilike(callsTable.phoneNumber, `%${search}%`),
        ilike(callsTable.contactName, `%${search}%`),
        ilike(callsTable.notes, `%${search}%`)
      )!
    );
  }
  if (dateFrom) {
    conditions.push(gte(callsTable.createdAt, new Date(dateFrom)));
  }
  if (dateTo) {
    conditions.push(lte(callsTable.createdAt, new Date(dateTo)));
  }

  const whereClause = and(...conditions);

  const sortCol = callSortColumns[sortBy ?? "createdAt"] ?? callsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const [calls, countResult] = await Promise.all([
    db
      .select()
      .from(callsTable)
      .where(whereClause)
      .orderBy(orderFn(sortCol))
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

  const orgId = getOrgId(req);
  const data = parsed.data;

  if (data.contactId) {
    const [contact] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, data.contactId), eq(contactsTable.organisationId, orgId)));
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
    organisationId: orgId,
  }).returning();

  logAudit((req.session as any)?.userId, (req.session as any)?.userEmail, "create", "call", String(call.id), { contactName: call.contactName, direction: call.direction });

  if (call.status === "repondu" && call.notes && call.notes.trim().length > 5) {
    processCallWithAI(call.id).catch((err) => {
      console.error(`[AI] Erreur traitement appel #${call.id}:`, err?.message || err);
    });
  }

  res.status(201).json(call);
});

router.post("/calls/:id/process", async (req, res): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const result = await processCallWithAI(id);
    res.json({
      analysis: result.analysis,
      tasksCreated: result.createdTasks.length,
      tasks: result.createdTasks,
      appointmentCreated: !!result.createdAppointment,
      appointment: result.createdAppointment,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erreur lors du traitement IA." });
  }
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.organisationId, orgId)));
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

  const orgId = getOrgId(req);
  const [call] = await db.update(callsTable)
    .set(parsed.data)
    .where(and(eq(callsTable.id, params.data.id), eq(callsTable.organisationId, orgId)))
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

  const orgId = getOrgId(req);
  const [call] = await db.delete(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.organisationId, orgId))).returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.relatedCallId, params.data.id));

  res.sendStatus(204);
});

export default router;
