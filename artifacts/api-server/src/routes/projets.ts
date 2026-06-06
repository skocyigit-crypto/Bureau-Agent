import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and, ne, type Column, type SQL } from "drizzle-orm";
import { db, projetsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";

const router: IRouter = Router();

const STATUSES = ["planifie", "en_cours", "en_pause", "termine", "annule"] as const;
const PRIORITIES = ["haute", "moyenne", "basse"] as const;

const sortCols: Record<string, any> = {
  createdAt: projetsTable.createdAt,
  updatedAt: projetsTable.updatedAt,
  title: projetsTable.title,
  endDate: projetsTable.endDate,
  priority: projetsTable.priority,
  progress: projetsTable.progress,
  budget: projetsTable.budget,
};

router.get("/projets", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status, priority, assignedTo, contactId: contactIdQ, limit = "50", offset = "0", sortBy = "createdAt", sortOrder = "desc" } = req.query as any;

  const conditions = [eq(projetsTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(projetsTable.status, status));
  if (priority && priority !== "all") conditions.push(eq(projetsTable.priority, priority));
  const useUnaccent = await ensureUnaccentExtension();
  if (assignedTo) conditions.push(accentInsensitiveIlike(projetsTable.assignedTo, `%${assignedTo}%`, useUnaccent));
  if (contactIdQ) {
    const cid = Number(contactIdQ);
    if (Number.isFinite(cid)) conditions.push(eq(projetsTable.contactId, cid));
  }
  if (search) {
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(projetsTable.title),
      il(projetsTable.clientName),
      il(projetsTable.clientCompany),
      il(projetsTable.description),
    )!);
  }

  const where = and(...conditions);
  const col = sortCols[sortBy] ?? projetsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(projetsTable).where(where).orderBy(orderFn(col)).limit(Number(limit)).offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(projetsTable).where(where),
    ]);
    res.json({ projets: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste projets");
    res.status(500).json({ error: "Erreur lors de la recuperation des projets." });
  }
});

router.get("/projets/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [byStatus, totals, budgetStats] = await Promise.all([
      db.select({
        status: projetsTable.status,
        count: sql<number>`count(*)::int`,
      }).from(projetsTable).where(eq(projetsTable.organisationId, orgId)).groupBy(projetsTable.status),
      db.select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${projetsTable.status} not in ('termine','annule'))::int`,
        termine: sql<number>`count(*) filter (where ${projetsTable.status} = 'termine')::int`,
        overdue: sql<number>`count(*) filter (where ${projetsTable.endDate} < now() and ${projetsTable.status} not in ('termine','annule'))::int`,
        avgProgress: sql<number>`coalesce(avg(${projetsTable.progress}), 0)::int`,
        highPriority: sql<number>`count(*) filter (where ${projetsTable.priority} = 'haute' and ${projetsTable.status} not in ('termine','annule'))::int`,
      }).from(projetsTable).where(eq(projetsTable.organisationId, orgId)),
      db.select({
        totalBudget: sql<number>`coalesce(sum(${projetsTable.budget}::numeric), 0)::numeric`,
        totalSpent: sql<number>`coalesce(sum(${projetsTable.spent}::numeric), 0)::numeric`,
        overBudget: sql<number>`count(*) filter (where ${projetsTable.spent}::numeric > ${projetsTable.budget}::numeric and ${projetsTable.budget}::numeric > 0)::int`,
      }).from(projetsTable).where(and(eq(projetsTable.organisationId, orgId), ne(projetsTable.status, "annule"))),
    ]);
    res.json({ byStatus, ...totals[0], ...budgetStats[0] });
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats projets");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

router.get("/projets/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Projet non trouve." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get projet");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/projets", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const {
    title, description, status = "planifie", priority = "moyenne",
    clientName, clientCompany, address, budget, currency = "EUR",
    progress = 0, startDate, endDate, assignedTo, teamMembers,
    milestones, tags, notes, contactId,
  } = req.body;

  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }

  try {
    const [row] = await db.insert(projetsTable).values({
      organisationId: orgId,
      title: title.trim(),
      description,
      status,
      priority,
      clientName,
      clientCompany,
      address,
      budget: budget ? String(budget) : null,
      currency,
      progress: Number(progress) || 0,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      assignedTo,
      teamMembers: teamMembers || [],
      milestones: milestones || [],
      tags: tags || [],
      notes,
      contactId: contactId ? Number(contactId) : null,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation projet");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/projets/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [existing] = await db.select({ id: projetsTable.id }).from(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Projet non trouve." }); return; }

    const {
      title, description, status, priority, clientName, clientCompany,
      address, budget, spent, currency, progress, startDate, endDate,
      actualEndDate, assignedTo, teamMembers, milestones, tags, notes, contactId,
    } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description;
    if (status !== undefined) {
      if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
      updates.status = status;
      if (status === "termine" && !actualEndDate) updates.actualEndDate = new Date();
    }
    if (priority !== undefined) updates.priority = priority;
    if (clientName !== undefined) updates.clientName = clientName;
    if (clientCompany !== undefined) updates.clientCompany = clientCompany;
    if (address !== undefined) updates.address = address;
    if (budget !== undefined) updates.budget = budget ? String(budget) : null;
    if (spent !== undefined) updates.spent = String(spent);
    if (currency !== undefined) updates.currency = currency;
    if (progress !== undefined) updates.progress = Math.min(100, Math.max(0, Number(progress)));
    if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
    if (actualEndDate !== undefined) updates.actualEndDate = actualEndDate ? new Date(actualEndDate) : null;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (teamMembers !== undefined) updates.teamMembers = teamMembers;
    if (milestones !== undefined) updates.milestones = milestones;
    if (tags !== undefined) updates.tags = tags;
    if (notes !== undefined) updates.notes = notes;
    if (contactId !== undefined) updates.contactId = contactId ? Number(contactId) : null;

    const [updated] = await db.update(projetsTable).set(updates).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId))).returning();
    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour projet");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.post("/projets/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [src] = await db.select().from(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));
    if (!src) { res.status(404).json({ error: "Projet non trouve." }); return; }
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = src as any;
    const [dup] = await db.insert(projetsTable).values({ ...rest, title: `${src.title} (copie)`, status: "planifie", progress: 0, actualEndDate: null }).returning();
    res.status(201).json(dup);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication projet");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.delete("/projets/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [deleted] = await db.delete(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId))).returning({ id: projetsTable.id });
    if (!deleted) { res.status(404).json({ error: "Projet non trouve." }); return; }
    res.status(204).end();
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression projet");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
