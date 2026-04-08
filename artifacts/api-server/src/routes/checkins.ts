import { Router, type IRouter } from "express";
import { eq, desc, asc, and, gte, lte, sql } from "drizzle-orm";
import { db, checkinsTable, usersTable } from "@workspace/db";
import {
  ListCheckinsQueryParams,
  CreateCheckinBody,
  GetCheckinParams,
  UpdateCheckinParams,
  UpdateCheckinBody,
  DeleteCheckinParams,
} from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { syncGoogleCalendarToCheckins } from "../services/google-calendar-sync";

const router: IRouter = Router();

const checkinSortColumns: Record<string, any> = {
  checkInAt: checkinsTable.checkInAt,
  employeeName: checkinsTable.employeeName,
  type: checkinsTable.type,
  status: checkinsTable.status,
  totalMinutes: checkinsTable.totalMinutes,
};

router.get("/checkins", async (req, res): Promise<void> => {
  const query = ListCheckinsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const { status, type, employeeName, limit, offset, sortBy, sortOrder, dateFrom, dateTo } = query.data;
  const conditions: any[] = [eq(checkinsTable.organisationId, orgId)];

  if (status) conditions.push(eq(checkinsTable.status, status));
  if (type) conditions.push(eq(checkinsTable.type, type));
  if (employeeName) conditions.push(eq(checkinsTable.employeeName, employeeName));
  if (dateFrom) conditions.push(gte(checkinsTable.checkInAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(checkinsTable.checkInAt, new Date(dateTo)));

  const where = and(...conditions);

  const sortCol = checkinSortColumns[sortBy ?? "checkInAt"] ?? checkinsTable.checkInAt;
  const order = sortOrder === "asc" ? asc(sortCol) : desc(sortCol);

  const [checkins, countResult] = await Promise.all([
    db.select().from(checkinsTable).where(where).orderBy(order).limit(limit ?? 50).offset(offset ?? 0),
    db.select({ count: sql<number>`count(*)::int` }).from(checkinsTable).where(where),
  ]);

  res.json({ checkins, total: countResult[0]?.count ?? 0 });
});

router.post("/checkins", async (req, res): Promise<void> => {
  const body = CreateCheckinBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [checkin] = await db.insert(checkinsTable).values({
    ...body.data,
    organisationId: orgId,
    checkInAt: body.data.checkInAt ? new Date(body.data.checkInAt) : new Date(),
    checkOutAt: body.data.checkOutAt ? new Date(body.data.checkOutAt) : null,
    ipAddress: req.ip || null,
  }).returning();

  res.status(201).json(checkin);
});

router.get("/checkins/stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { employeeName, dateFrom, dateTo } = req.query as Record<string, string>;
  const conditions: any[] = [eq(checkinsTable.organisationId, orgId)];

  if (employeeName) conditions.push(eq(checkinsTable.employeeName, String(employeeName)));
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d.getTime())) conditions.push(gte(checkinsTable.checkInAt, d));
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime())) conditions.push(lte(checkinsTable.checkInAt, d));
  }

  const where = and(...conditions);

  const [stats] = await db.select({
    totalSessions: sql<number>`count(*)::int`,
    totalMinutes: sql<number>`coalesce(sum(${checkinsTable.totalMinutes}), 0)::int`,
    totalBreakMinutes: sql<number>`coalesce(sum(${checkinsTable.breakMinutes}), 0)::int`,
    avgSessionMinutes: sql<number>`coalesce(avg(${checkinsTable.totalMinutes}), 0)::int`,
    bureauCount: sql<number>`count(*) filter (where ${checkinsTable.type} = 'bureau')::int`,
    distanceCount: sql<number>`count(*) filter (where ${checkinsTable.type} = 'distance')::int`,
    terrainCount: sql<number>`count(*) filter (where ${checkinsTable.type} = 'terrain')::int`,
    presentCount: sql<number>`count(*) filter (where ${checkinsTable.status} = 'present')::int`,
    enPauseCount: sql<number>`count(*) filter (where ${checkinsTable.status} = 'en_pause')::int`,
    terminatedCount: sql<number>`count(*) filter (where ${checkinsTable.status} = 'termine')::int`,
  }).from(checkinsTable).where(where);

  res.json(stats);
});

router.get("/checkins/current", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { employeeName } = req.query as Record<string, string>;
  const conditions: any[] = [
    eq(checkinsTable.organisationId, orgId),
    eq(checkinsTable.status, "present"),
  ];
  if (employeeName) conditions.push(eq(checkinsTable.employeeName, employeeName));

  const activeCheckins = await db.select()
    .from(checkinsTable)
    .where(and(...conditions))
    .orderBy(desc(checkinsTable.checkInAt))
    .limit(10);

  const pauseConditions: any[] = [eq(checkinsTable.organisationId, orgId), eq(checkinsTable.status, "en_pause")];
  if (employeeName) pauseConditions.push(eq(checkinsTable.employeeName, employeeName));

  const pausedCheckins = await db.select()
    .from(checkinsTable)
    .where(and(...pauseConditions))
    .orderBy(desc(checkinsTable.checkInAt))
    .limit(10);

  res.json({ active: activeCheckins, paused: pausedCheckins });
});

router.get("/checkins/:id", async (req, res): Promise<void> => {
  const params = GetCheckinParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [checkin] = await db.select().from(checkinsTable).where(and(eq(checkinsTable.id, params.data.id), eq(checkinsTable.organisationId, orgId)));
  if (!checkin) {
    res.status(404).json({ error: "Pointage introuvable" });
    return;
  }
  res.json(checkin);
});

router.patch("/checkins/:id", async (req, res): Promise<void> => {
  const params = UpdateCheckinParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateCheckinBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [existing] = await db.select().from(checkinsTable).where(and(eq(checkinsTable.id, params.data.id), eq(checkinsTable.organisationId, orgId)));
  if (!existing) {
    res.status(404).json({ error: "Pointage introuvable" });
    return;
  }

  const updateData: Record<string, any> = { ...body.data };
  if (body.data.checkOutAt) {
    const outDate = new Date(body.data.checkOutAt);
    if (outDate.getTime() < existing.checkInAt.getTime()) {
      res.status(400).json({ error: "L'heure de depart ne peut pas etre anterieure a l'heure d'arrivee" });
      return;
    }
    updateData.checkOutAt = outDate;
  }
  if (body.data.checkInAt) updateData.checkInAt = new Date(body.data.checkInAt);

  if (body.data.status === "termine" && (body.data.checkOutAt || existing.checkOutAt)) {
    const checkIn = existing.checkInAt.getTime();
    const checkOut = body.data.checkOutAt ? new Date(body.data.checkOutAt).getTime() : existing.checkOutAt!.getTime();
    const breakMins = body.data.breakMinutes ?? existing.breakMinutes ?? 0;
    updateData.totalMinutes = Math.max(0, Math.round((checkOut - checkIn) / 60000) - breakMins);
  }

  const [updated] = await db.update(checkinsTable)
    .set(updateData)
    .where(and(eq(checkinsTable.id, params.data.id), eq(checkinsTable.organisationId, orgId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Pointage introuvable" });
    return;
  }
  res.json(updated);
});

router.delete("/checkins/:id", async (req, res): Promise<void> => {
  const params = DeleteCheckinParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const orgId = getOrgId(req);
  const [deleted] = await db.delete(checkinsTable).where(and(eq(checkinsTable.id, params.data.id), eq(checkinsTable.organisationId, orgId))).returning();
  if (!deleted) {
    res.status(404).json({ error: "Pointage introuvable" });
    return;
  }
  res.sendStatus(204);
});

router.post("/checkins/sync-google", async (req, res): Promise<void> => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      res.status(401).json({ error: "Non authentifie." });
      return;
    }

    const orgId = getOrgId(req);
    const { dateFrom, dateTo } = req.body;

    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: "Les dates de debut et fin sont requises." });
      return;
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      res.status(400).json({ error: "Format de date invalide." });
      return;
    }

    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 90) {
      res.status(400).json({ error: "La periode ne peut pas depasser 90 jours." });
      return;
    }
    if (diffDays < 0) {
      res.status(400).json({ error: "La date de fin doit etre apres la date de debut." });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Utilisateur introuvable." });
      return;
    }

    const employeeName = `${user.prenom} ${user.nom}`;
    const employeeRole = user.role;

    const result = await syncGoogleCalendarToCheckins({
      userId,
      organisationId: orgId,
      dateFrom,
      dateTo,
      employeeName,
      employeeRole,
    });

    res.json({
      message: `Synchronisation terminee: ${result.imported} jour(s) importes, ${result.skipped} ignore(s).`,
      ...result,
    });
  } catch (err: any) {
    console.error("Google Calendar sync error:", err);
    const safeMessages = [
      "Aucun compte Google connecte",
      "Google Workspace n'est pas configure",
      "Token Google expire",
      "Impossible de rafraichir",
      "Reconnectez votre compte",
    ];
    const isSafeMessage = safeMessages.some(m => err.message?.includes(m));
    res.status(500).json({
      error: isSafeMessage ? err.message : "Erreur lors de la synchronisation avec Google Agenda.",
    });
  }
});

export default router;
