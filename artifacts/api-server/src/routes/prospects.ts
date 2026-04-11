import { Router, type IRouter } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, prospectsTable, contactsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

const PIPELINE_STAGES = [
  { id: "nouveau", label: "Nouveau", color: "#6366f1" },
  { id: "contact", label: "Contact", color: "#3b82f6" },
  { id: "qualification", label: "Qualification", color: "#0ea5e9" },
  { id: "proposition", label: "Proposition", color: "#f59e0b" },
  { id: "negociation", label: "Negociation", color: "#f97316" },
  { id: "gagne", label: "Gagne", color: "#22c55e" },
  { id: "perdu", label: "Perdu", color: "#ef4444" },
];

router.get("/prospects/stages", (_req, res) => {
  res.json(PIPELINE_STAGES);
});

router.get("/prospects", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { stage, search, limit, offset } = req.query;
  const conditions: any[] = [eq(prospectsTable.organisationId, orgId)];
  if (stage && stage !== "all") conditions.push(eq(prospectsTable.stage, stage as string));
  if (search) {
    conditions.push(or(
      ilike(prospectsTable.title, `%${search}%`),
      ilike(prospectsTable.contactName, `%${search}%`),
      ilike(prospectsTable.company, `%${search}%`)
    )!);
  }
  const whereClause = and(...conditions);
  const [prospects, countResult] = await Promise.all([
    db.select().from(prospectsTable).where(whereClause)
      .orderBy(desc(prospectsTable.createdAt))
      .limit(Number(limit) || 100).offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable).where(whereClause),
  ]);
  res.json({ prospects, total: countResult[0]?.count ?? 0 });
});

router.get("/prospects/pipeline", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const prospects = await db.select().from(prospectsTable)
    .where(eq(prospectsTable.organisationId, orgId))
    .orderBy(asc(prospectsTable.createdAt));
  const pipeline: Record<string, any[]> = {};
  for (const s of PIPELINE_STAGES) pipeline[s.id] = [];
  for (const p of prospects) {
    if (pipeline[p.stage]) pipeline[p.stage].push(p);
    else pipeline["nouveau"].push(p);
  }
  const stats = {
    totalValue: prospects.reduce((s, p) => s + (Number(p.value) || 0), 0),
    totalCount: prospects.length,
    wonCount: prospects.filter(p => p.stage === "gagne").length,
    wonValue: prospects.filter(p => p.stage === "gagne").reduce((s, p) => s + (Number(p.value) || 0), 0),
    avgProbability: prospects.length > 0 ? Math.round(prospects.reduce((s, p) => s + (p.probability || 0), 0) / prospects.length) : 0,
    weightedValue: prospects.reduce((s, p) => s + (Number(p.value) || 0) * ((p.probability || 0) / 100), 0),
  };
  res.json({ pipeline, stats, stages: PIPELINE_STAGES });
});

router.get("/prospects/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [prospect] = await db.select().from(prospectsTable).where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId)));
  if (!prospect) { res.status(404).json({ error: "Prospect non trouve" }); return; }
  res.json(prospect);
});

router.post("/prospects", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { title, description, contactId, contactName, company, email, phone, stage, priority, value, probability, source, assignedTo, expectedCloseDate, notes, tags } = req.body;
  if (!title) { res.status(400).json({ error: "Titre requis" }); return; }
  const [prospect] = await db.insert(prospectsTable).values({
    organisationId: orgId, title, description, contactId: contactId || null,
    contactName, company, email, phone, stage: stage || "nouveau",
    priority: priority || "moyenne", value, probability: probability || 50,
    source, assignedTo, expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
    notes, tags: tags || [],
  }).returning();
  res.status(201).json(prospect);
});

router.patch("/prospects/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const updateData: any = { ...req.body };
  if (updateData.expectedCloseDate) updateData.expectedCloseDate = new Date(updateData.expectedCloseDate);
  if (updateData.stage === "gagne" && !updateData.wonAt) updateData.wonAt = new Date();
  if (updateData.stage === "perdu" && !updateData.lostAt) updateData.lostAt = new Date();
  delete updateData.id; delete updateData.organisationId; delete updateData.createdAt;
  const [prospect] = await db.update(prospectsTable).set(updateData)
    .where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId))).returning();
  if (!prospect) { res.status(404).json({ error: "Prospect non trouve" }); return; }
  res.json(prospect);
});

router.delete("/prospects/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [prospect] = await db.delete(prospectsTable)
    .where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId))).returning();
  if (!prospect) { res.status(404).json({ error: "Prospect non trouve" }); return; }
  res.sendStatus(204);
});

export default router;
