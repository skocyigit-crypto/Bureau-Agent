import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and, gte, lte, type Column, type SQL } from "drizzle-orm";
import { db, prospectsTable, contactsTable, devisTable, facturesClientTable, callsTable, tasksTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

const STAGES = ["nouveau", "contact", "qualification", "proposition", "negociation", "gagne", "perdu"] as const;
const PRIORITIES = ["haute", "moyenne", "basse"] as const;

// Backoffice SaaS (super-admin uniquement). Plus de filtre organisation_id
// par defaut: la vue est globale. Un parametre ?organisationId= permet de
// scoper une organisation pour le tri/QA. Voir Tâche #53.
function parseOrgFilter(req: Request): number | null {
  const raw = (req.query as Record<string, unknown>).organisationId;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const sortCols: Record<string, any> = {
  createdAt: prospectsTable.createdAt,
  title: prospectsTable.title,
  value: prospectsTable.value,
  probability: prospectsTable.probability,
  expectedCloseDate: prospectsTable.expectedCloseDate,
  stage: prospectsTable.stage,
};

router.get("/prospects", async (req: Request, res: Response): Promise<void> => {
  const { search, stage, priority, assignedTo, limit = "50", offset = "0", sortBy = "createdAt", sortOrder = "desc" } = req.query as any;

  const conditions: SQL[] = [];
  const orgFilter = parseOrgFilter(req);
  if (orgFilter != null) conditions.push(eq(prospectsTable.organisationId, orgFilter));
  if (stage && stage !== "all") conditions.push(eq(prospectsTable.stage, stage));
  if (priority && priority !== "all") conditions.push(eq(prospectsTable.priority, priority));
  const useUnaccent = await ensureUnaccentExtension();
  if (assignedTo) conditions.push(accentInsensitiveIlike(prospectsTable.assignedTo, `%${assignedTo}%`, useUnaccent));
  if (search) {
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(prospectsTable.title),
      il(prospectsTable.contactName),
      il(prospectsTable.company),
      il(prospectsTable.email),
    )!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const col = sortCols[sortBy] ?? prospectsTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      (where ? db.select().from(prospectsTable).where(where) : db.select().from(prospectsTable))
        .orderBy(orderFn(col)).limit(Number(limit)).offset(Number(offset)),
      where
        ? db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable).where(where)
        : db.select({ count: sql<number>`count(*)::int` }).from(prospectsTable),
    ]);
    res.json({ prospects: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste prospects");
    res.status(500).json({ error: "Erreur lors de la recuperation des prospects." });
  }
});

router.get("/prospects/stats", async (req: Request, res: Response): Promise<void> => {
  const orgFilter = parseOrgFilter(req);
  const where = orgFilter != null ? eq(prospectsTable.organisationId, orgFilter) : undefined;
  try {
    const stageQ = db.select({
      stage: prospectsTable.stage,
      count: sql<number>`count(*)::int`,
      totalValue: sql<number>`coalesce(sum(${prospectsTable.value}), 0)::numeric`,
    }).from(prospectsTable);
    const totalsQ = db.select({
      total: sql<number>`count(*)::int`,
      totalValue: sql<number>`coalesce(sum(${prospectsTable.value}), 0)::numeric`,
      avgValue: sql<number>`coalesce(avg(${prospectsTable.value}), 0)::numeric`,
      wonCount: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'gagne')::int`,
      lostCount: sql<number>`count(*) filter (where ${prospectsTable.stage} = 'perdu')::int`,
    }).from(prospectsTable);
    const [byStage, totals] = await Promise.all([
      where ? stageQ.where(where).groupBy(prospectsTable.stage) : stageQ.groupBy(prospectsTable.stage),
      where ? totalsQ.where(where) : totalsQ,
    ]);
    res.json({ byStage, ...totals[0] });
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats prospects");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

router.get("/prospects/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, id));
    if (!row) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get prospect");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/prospects", async (req: Request, res: Response): Promise<void> => {
  const { title, description, contactName, company, email, phone, stage = "nouveau", priority = "moyenne", value, currency = "EUR", probability = 50, source, assignedTo, expectedCloseDate, notes, tags, contactId, organisationId } = req.body;

  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!STAGES.includes(stage)) { res.status(400).json({ error: "Etape invalide." }); return; }

  const orgFromBody = organisationId != null && organisationId !== "" ? Number(organisationId) : null;
  if (orgFromBody != null && (!Number.isInteger(orgFromBody) || orgFromBody <= 0)) {
    res.status(400).json({ error: "organisationId invalide." });
    return;
  }
  const sessionOrg = req.session?.organisationId ?? null;
  const targetOrg = orgFromBody ?? sessionOrg;
  if (targetOrg == null) {
    res.status(400).json({ error: "organisationId requis (le super-admin n'a pas d'organisation rattachee)." });
    return;
  }

  try {
    const [row] = await db.insert(prospectsTable).values({
      organisationId: targetOrg,
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
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [existing] = await db.select({ id: prospectsTable.id }).from(prospectsTable).where(eq(prospectsTable.id, id));
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
  const orgFilter = parseOrgFilter(req);
  try {
    const baseQ = db.select().from(prospectsTable);
    const rows = await (orgFilter != null
      ? baseQ.where(eq(prospectsTable.organisationId, orgFilter))
      : baseQ
    ).orderBy(desc(prospectsTable.createdAt));
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
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, id));
    if (!prospect) { res.status(404).json({ error: "Prospect non trouvé." }); return; }

    const nameParts = (prospect.contactName || "").trim().split(" ");
    const firstName = nameParts[0] || prospect.title || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const [contact] = await db.insert(contactsTable).values({
      organisationId: prospect.organisationId,
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
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [original] = await db.select().from(prospectsTable).where(eq(prospectsTable.id, id));
    if (!original) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    const [copy] = await db.insert(prospectsTable).values({
      organisationId: original.organisationId,
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

router.get("/prospects/:id/devis", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select({
      organisationId: prospectsTable.organisationId,
      contactName: prospectsTable.contactName,
      company: prospectsTable.company,
      email: prospectsTable.email,
    }).from(prospectsTable).where(eq(prospectsTable.id, id)).limit(1);
    if (!prospect) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    if (prospect.organisationId == null) { res.json({ devis: [], factures: [] }); return; }

    const orgId: number = prospect.organisationId;
    const name = (prospect.contactName || "").trim();
    const company = (prospect.company || "").trim();
    const email = (prospect.email || "").trim();

    const nameMatch = (col: Column): SQL[] => {
      const arr: SQL[] = [];
      if (name) arr.push(ilike(col, `%${name}%`));
      if (company) arr.push(ilike(col, `%${company}%`));
      return arr;
    };
    const emailMatch = (col: Column): SQL | null => email ? ilike(col, email) : null;

    const devisConds: SQL[] = [eq(devisTable.prospectId, id), ...nameMatch(devisTable.clientName)];
    const dEmail = emailMatch(devisTable.clientEmail); if (dEmail) devisConds.push(dEmail);

    const factureConds: SQL[] = [...nameMatch(facturesClientTable.clientName)];
    const fEmail = emailMatch(facturesClientTable.clientEmail); if (fEmail) factureConds.push(fEmail);

    const [devisList, facturesList] = await Promise.all([
      db.select({ id: devisTable.id, reference: devisTable.reference, status: devisTable.status, totalAmount: devisTable.totalAmount, createdAt: devisTable.createdAt })
        .from(devisTable)
        .where(and(eq(devisTable.organisationId, orgId), or(...devisConds)))
        .orderBy(desc(devisTable.createdAt)).limit(20),
      factureConds.length > 0
        ? db.select({ id: facturesClientTable.id, reference: facturesClientTable.reference, status: facturesClientTable.status, totalAmount: facturesClientTable.totalAmount, paidAmount: facturesClientTable.paidAmount, createdAt: facturesClientTable.createdAt })
            .from(facturesClientTable)
            .where(and(eq(facturesClientTable.organisationId, orgId), or(...factureConds)))
            .orderBy(desc(facturesClientTable.createdAt)).limit(20)
        : Promise.resolve([] as any[]),
    ]);

    res.json({ devis: devisList, factures: facturesList });
  } catch (err: any) {
    req.log.error({ err }, "Erreur devis/factures prospect");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.get("/prospects/:id/history", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [prospect] = await db.select().from(prospectsTable)
      .where(eq(prospectsTable.id, id)).limit(1);
    if (!prospect) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    if (prospect.organisationId == null) { res.json({ calls: [], tasks: [] }); return; }

    const orgId: number = prospect.organisationId;
    const name = (prospect.contactName || "").trim();
    const phone = (prospect.phone || "").trim();
    const email = (prospect.email || "").trim();

    const callConds: SQL[] = [];
    if (prospect.contactId) callConds.push(eq(callsTable.contactId, prospect.contactId));
    if (phone) callConds.push(ilike(callsTable.phoneNumber, `%${phone}%`));
    if (name) callConds.push(ilike(callsTable.contactName, `%${name}%`));

    const taskConds: SQL[] = [];
    if (prospect.contactId) taskConds.push(eq(tasksTable.relatedContactId, prospect.contactId));
    if (name) taskConds.push(ilike(tasksTable.title, `%${name}%`));
    const company = (prospect.company || "").trim();
    if (company) taskConds.push(ilike(tasksTable.title, `%${company}%`));
    if (prospect.title) taskConds.push(ilike(tasksTable.title, `%${prospect.title}%`));

    const [calls, tasks] = await Promise.all([
      callConds.length > 0
        ? db.select({
            id: callsTable.id, direction: callsTable.direction, status: callsTable.status,
            phoneNumber: callsTable.phoneNumber, contactName: callsTable.contactName,
            duration: callsTable.duration, notes: callsTable.notes, createdAt: callsTable.createdAt,
          }).from(callsTable)
            .where(and(eq(callsTable.organisationId, orgId), or(...callConds)))
            .orderBy(desc(callsTable.createdAt)).limit(20)
        : Promise.resolve([] as any[]),
      taskConds.length > 0
        ? db.select({
            id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
            priority: tasksTable.priority, dueDate: tasksTable.dueDate, createdAt: tasksTable.createdAt,
          }).from(tasksTable)
            .where(and(eq(tasksTable.organisationId, orgId), or(...taskConds)))
            .orderBy(desc(tasksTable.createdAt)).limit(20)
        : Promise.resolve([] as any[]),
    ]);

    res.json({ calls, tasks });
  } catch (err: any) {
    req.log.error({ err }, "Erreur historique prospect");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'historique." });
  }
});

router.delete("/prospects/:id", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.delete(prospectsTable).where(eq(prospectsTable.id, id)).returning({ id: prospectsTable.id });
    if (!row) { res.status(404).json({ error: "Prospect non trouve." }); return; }
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression prospect");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
