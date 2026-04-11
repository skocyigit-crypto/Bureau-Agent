import { Router, type IRouter } from "express";
import { eq, desc, ilike, or, sql, and } from "drizzle-orm";
import { db, projetsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";

const VALID_STATUSES = ["planifie", "en_cours", "en_pause", "termine", "annule"];
const VALID_PRIORITIES = ["basse", "moyenne", "haute", "urgente"];

function validateProjet(body: any, isUpdate = false): string | null {
  if (!isUpdate && (!body.title || typeof body.title !== "string" || body.title.trim().length === 0)) return "Titre requis";
  if (body.title && (typeof body.title !== "string" || body.title.length > 500)) return "Titre invalide (max 500 caracteres)";
  if (body.description && typeof body.description !== "string") return "Description invalide";
  if (body.status && !VALID_STATUSES.includes(body.status)) return "Statut invalide";
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) return "Priorite invalide";
  if (body.clientName && typeof body.clientName !== "string") return "Nom client invalide";
  return null;
}

function sanitizeProjetData(body: any): Record<string, any> {
  const allowed = ["title", "description", "contactId", "clientName", "clientCompany", "address", "status", "priority", "budget", "startDate", "endDate", "assignedTo", "teamMembers", "milestones", "tags", "notes", "spent", "actualEndDate", "progress"];
  const result: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  return result;
}

const router: IRouter = Router();

router.get("/projets", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { status, search, limit, offset } = req.query;
  const conditions: any[] = [eq(projetsTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(projetsTable.status, status as string));
  if (search) {
    conditions.push(or(
      ilike(projetsTable.title, `%${search}%`),
      ilike(projetsTable.clientName, `%${search}%`),
      ilike(projetsTable.clientCompany, `%${search}%`)
    )!);
  }
  const whereClause = and(...conditions);
  const [projets, countResult] = await Promise.all([
    db.select().from(projetsTable).where(whereClause).orderBy(desc(projetsTable.createdAt))
      .limit(Number(limit) || 50).offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(projetsTable).where(whereClause),
  ]);
  res.json({ projets, total: countResult[0]?.count ?? 0 });
});

router.get("/projets/stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const all = await db.select().from(projetsTable).where(eq(projetsTable.organisationId, orgId));
  const stats = {
    total: all.length,
    planifie: all.filter(p => p.status === "planifie").length,
    en_cours: all.filter(p => p.status === "en_cours").length,
    en_pause: all.filter(p => p.status === "en_pause").length,
    termine: all.filter(p => p.status === "termine").length,
    annule: all.filter(p => p.status === "annule").length,
    totalBudget: all.reduce((s, p) => s + Number(p.budget || 0), 0),
    totalSpent: all.reduce((s, p) => s + Number(p.spent || 0), 0),
    avgProgress: all.length > 0 ? Math.round(all.reduce((s, p) => s + p.progress, 0) / all.length) : 0,
    overdue: all.filter(p => p.endDate && new Date(p.endDate) < new Date() && p.status === "en_cours").length,
  };
  res.json(stats);
});

router.get("/projets/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [p] = await db.select().from(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));
  if (!p) { res.status(404).json({ error: "Projet non trouve" }); return; }
  res.json(p);
});

router.post("/projets", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const err = validateProjet(req.body);
  if (err) { res.status(400).json({ error: err }); return; }
  const { title, description, contactId, clientName, clientCompany, address, status, priority, budget, startDate, endDate, assignedTo, teamMembers, milestones, tags, notes } = req.body;
  const [p] = await db.insert(projetsTable).values({
    organisationId: orgId, title, description, contactId: contactId || null,
    clientName, clientCompany, address, status: status || "planifie",
    priority: priority || "moyenne", budget: budget ? String(budget) : null,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    assignedTo, teamMembers: teamMembers || [], milestones: milestones || [],
    tags: tags || [], notes,
  }).returning();
  res.status(201).json(p);
});

router.patch("/projets/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const valErr = validateProjet(req.body, true);
  if (valErr) { res.status(400).json({ error: valErr }); return; }
  const updateData: any = sanitizeProjetData(req.body);
  if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
  if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);
  if (updateData.actualEndDate) updateData.actualEndDate = new Date(updateData.actualEndDate);
  if (updateData.status === "termine" && !updateData.actualEndDate) updateData.actualEndDate = new Date();
  if (updateData.budget) updateData.budget = String(updateData.budget);
  if (updateData.spent) updateData.spent = String(updateData.spent);
  const [p] = await db.update(projetsTable).set(updateData)
    .where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId))).returning();
  if (!p) { res.status(404).json({ error: "Projet non trouve" }); return; }
  res.json(p);
});

router.delete("/projets/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [p] = await db.delete(projetsTable).where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId))).returning();
  if (!p) { res.status(404).json({ error: "Projet non trouve" }); return; }
  res.sendStatus(204);
});

export default router;
