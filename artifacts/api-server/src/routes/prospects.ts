import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and, gte, lte } from "drizzle-orm";
import { db, prospectsTable, contactsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

const STAGES = ["nouveau", "contact", "qualification", "proposition", "negociation", "gagne", "perdu"] as const;
const PRIORITIES = ["haute", "moyenne", "basse"] as const;

const sortCols: Record<string, any> = {
  createdAt: prospectsTable.createdAt,
  title: prospectsTable.title,
  value: prospectsTable.value,
  probability: prospectsTable.probability,
  expectedCloseDate: prospectsTable.expectedCloseDate,
  stage: prospectsTable.stage,
};

router.get("/prospects", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, stage, priority, assignedTo, limit = "50", offset = "0", sortBy = "createdAt", sortOrder = "desc" } = req.query as any;

  const conditions = [eq(prospectsTable.organisationId, orgId)];
  if (stage && stage !== "all") conditions.push(eq(prospectsTable.stage, stage));
  if (priority && priority !== "all") conditions.push(eq(prospectsTable.priority, priority));
  if (assignedTo) conditions.push(ilike(prospectsTable.assignedTo, `%${assignedTo}%`));
  if (search) {
    conditions.push(or(
      ilike(prospectsTable.title, `%${search}%`),
      ilike(prospectsTable.contactName, `%${search}%`),
      ilike(prospectsTable.company, `%${search}%`),
      ilike(prospectsTable.email, `%${search}%`),
    )!);
  }

  const where = and(...conditions);
  const col = sortCols[sortBy] ?? prospectsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(prospectsTable).where(where).orderBy(orderFn(col)).limit(Number(limit)).offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable).where(where),
    ]);
    res.json({ prospects: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste prospects");
    res.status(500).json({ error: "Erreur lors de la recuperation des prospects." });
  }
});

router.get("/prospects/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [byStage, totals] = await Promise.all([
      db.select({
        stage: prospectsTable.stage,
        count: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${prospectsTable.value}), 0)::numeric`,
      }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)).groupBy(prospectsTable.stage),
      db.select({
        total: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${prospectsTable.value}), 0)::numeric`,
        avgValue: sql<number>`coalesce(avg(${prospectsTable.value}), 0)::numeric`,
        wonCount: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')::int`,
        lostCount: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')::int`,
      }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)),
    ]);
    res.json({ byStage, ...totals[0] });
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats prospects");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

router.get("/prospects/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(prospectsTable).where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get prospect");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/prospects", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { title, description, contactName, company, email, phone, stage = "nouveau", priority = "moyenne", value, currency = "EUR", probability = 50, source, assignedTo, expectedCloseDate, notes, tags, contactId } = req.body;

  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!STAGES.includes(stage)) { res.status(400).json({ error: "Etape invalide." }); return; }

  try {
    const [row] = await db.insert(prospectsTable).values({
      organisationId: orgId,
      title: title.trim(),
      description,
      contactName,
      company,
      email,
      phone,
      stage,
      priority,
      value: value ? String(value) : null,
      currency,
      probability: Number(probability),
      source,
      assignedTo,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      notes,
      tags: tags || [],
      contactId: contactId ? Number(contactId) : null,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation prospect");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/prospects/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [existing] = await db.select({ id: prospectsTable.id }).from(prospectsTable).where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Prospect non trouve." }); return; }

    const { title, description, contactName, company, email, phone, stage, priority, value, currency, probability, source, assignedTo, expectedCloseDate, notes, tags, contactId, lostReason } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description;
    if (contactName !== undefined) updates.contactName = contactName;
    if (company !== undefined) updates.company = company;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (stage !== undefined) { updates.stage = stage; if (stage === "gagne") updates.wonAt = new Date(); if (stage === "perdu") updates.lostAt = new Date(); }
    if (priority !== undefined) updates.priority = priority;
    if (value !== undefined) updates.value = value ? String(value) : null;
    if (currency !== undefined) updates.currency = currency;
    if (probability !== undefined) updates.probability = Number(probability);
    if (source !== undefined) updates.source = source;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (expectedCloseDate !== undefined) updates.expectedCloseDate = expectedCloseDate ? new Date(expectedCloseDate) : null;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = tags;
    if (contactId !== undefined) updates.contactId = contactId ? Number(contactId) : null;
    if (lostReason !== undefined) updates.lostReason = lostReason;

    const [row] = await db.update(prospectsTable).set(updates).where(eq(prospectsTable.id, id)).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour prospect");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.get("/prospects/export/csv", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)).orderBy(desc(prospectsTable.createdAt));
    const headers = ["Titre", "Contact", "Entreprise", "Email", "Téléphone", "Étape", "Priorité", "Valeur", "Probabilité", "Source", "Clôture prévue", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.title), escape(r.contactName), escape(r.company), escape(r.email), escape(r.phone),
      escape(r.stage), escape(r.priority), escape(r.value), escape(r.probability),
      escape(r.source), escape(fmtDate(r.expectedCloseDate)), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="prospects_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export prospects CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.post("/prospects/:id/convert", requireRole("agent"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select().from(prospectsTable)
      .where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId)));
    if (!prospect) { res.status(404).json({ error: "Prospect non trouvé." }); return; }

    const nameParts = (prospect.contactName || "").trim().split(" ");
    const firstName = nameParts[0] || prospect.title || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const [contact] = await db.insert(contactsTable).values({
      organisationId: orgId,
      firstName,
      lastName,
      email: prospect.email || null,
      phone: prospect.phone || "",
      company: prospect.company || null,
      notes: `Converti depuis prospect: ${prospect.title}`,
      category: "autre",
    } as any).returning();

    await db.update(prospectsTable).set({ stage: "gagne", updatedAt: new Date() } as any)
      .where(eq(prospectsTable.id, id));

    res.status(201).json({ contact, message: "Prospect converti en contact avec succès." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur conversion prospect en contact");
    res.status(500).json({ error: "Erreur lors de la conversion." });
  }
});

router.post("/prospects/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = (req.session as any)?.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [original] = await db.select().from(prospectsTable).where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId)));
    if (!original) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    const [copy] = await db.insert(prospectsTable).values({
      organisationId: orgId,
      title: `${original.title} (copie)`,
      contactName: original.contactName,
      company: original.company,
      email: original.email,
      phone: original.phone,
      stage: original.stage,
      priority: original.priority,
      value: original.value,
      probability: original.probability,
      source: original.source,
      notes: original.notes,
      expectedCloseDate: original.expectedCloseDate,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication prospect");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.delete("/prospects/:id", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.delete(prospectsTable).where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId))).returning({ id: prospectsTable.id });
    if (!row) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression prospect");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
