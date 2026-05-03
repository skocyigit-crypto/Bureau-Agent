import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and, lte } from "drizzle-orm";
import { db, stockArticlesTable, stockMouvementsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

const sortCols: Record<string, any> = {
  createdAt: stockArticlesTable.createdAt,
  name: stockArticlesTable.name,
  reference: stockArticlesTable.reference,
  quantity: stockArticlesTable.quantity,
  unitPrice: stockArticlesTable.unitPrice,
  category: stockArticlesTable.category,
};

router.get("/stock", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, category, status, limit = "50", offset = "0", sortBy = "createdAt", sortOrder = "desc", lowStock } = req.query as any;

  const conditions = [eq(stockArticlesTable.organisationId, orgId)];
  if (category && category !== "all") conditions.push(eq(stockArticlesTable.category, category));
  if (status && status !== "all") conditions.push(eq(stockArticlesTable.status, status));
  if (lowStock === "true") conditions.push(sql`${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity}`);
  if (search) {
    conditions.push(or(
      ilike(stockArticlesTable.name, `%${search}%`),
      ilike(stockArticlesTable.reference, `%${search}%`),
      ilike(stockArticlesTable.barcode, `%${search}%`),
      ilike(stockArticlesTable.supplier, `%${search}%`),
    )!);
  }

  const where = and(...conditions);
  const col = sortCols[sortBy] ?? stockArticlesTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(stockArticlesTable).where(where).orderBy(orderFn(col)).limit(Number(limit)).offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(stockArticlesTable).where(where),
    ]);
    res.json({ articles: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste stock");
    res.status(500).json({ error: "Erreur lors de la recuperation du stock." });
  }
});

router.get("/stock/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [stats, byCategory] = await Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${stockArticlesTable.quantity} * ${stockArticlesTable.unitPrice}::numeric), 0)::numeric`,
        lowStock: sql<number>`count(*) filter (where ${stockArticlesTable.quantity} <= ${stockArticlesTable.minQuantity} and ${stockArticlesTable.quantity} > 0)::int`,
        outOfStock: sql<number>`count(*) filter (where ${stockArticlesTable.quantity} = 0)::int`,
        avgPrice: sql<number>`coalesce(avg(${stockArticlesTable.unitPrice}::numeric), 0)::numeric`,
      }).from(stockArticlesTable).where(eq(stockArticlesTable.organisationId, orgId)),
      db.select({
        category: stockArticlesTable.category,
        count: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${stockArticlesTable.quantity} * ${stockArticlesTable.unitPrice}::numeric), 0)::numeric`,
      }).from(stockArticlesTable).where(eq(stockArticlesTable.organisationId, orgId)).groupBy(stockArticlesTable.category),
    ]);
    res.json({ ...stats[0], byCategory });
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats stock");
    res.status(500).json({ error: "Erreur lors des statistiques stock." });
  }
});

router.get("/stock/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(stockArticlesTable).where(and(eq(stockArticlesTable.id, id), eq(stockArticlesTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Article non trouve." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get article stock");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/stock", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { name, reference, barcode, description, category = "general", quantity = 0, minQuantity = 5, unitPrice, supplier, location, unit = "piece", status = "en_stock", notes } = req.body;

  if (!name?.trim()) { res.status(400).json({ error: "Le nom est obligatoire." }); return; }
  if (!reference?.trim()) { res.status(400).json({ error: "La reference est obligatoire." }); return; }

  try {
    const existing = await db.select({ id: stockArticlesTable.id }).from(stockArticlesTable)
      .where(and(eq(stockArticlesTable.organisationId, orgId), eq(stockArticlesTable.reference, reference.trim())));
    if (existing.length > 0) { res.status(409).json({ error: "Cette reference existe deja." }); return; }

    const [row] = await db.insert(stockArticlesTable).values({
      organisationId: orgId,
      name: name.trim(),
      reference: reference.trim(),
      barcode: barcode?.trim() || null,
      description,
      category,
      quantity: Number(quantity),
      minQuantity: Number(minQuantity),
      unitPrice: unitPrice ? String(unitPrice) : null,
      supplier,
      location,
      unit,
      status,
      notes,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation article stock");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/stock/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [existing] = await db.select({ id: stockArticlesTable.id }).from(stockArticlesTable).where(and(eq(stockArticlesTable.id, id), eq(stockArticlesTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Article non trouve." }); return; }

    const { name, reference, barcode, description, category, quantity, minQuantity, unitPrice, supplier, location, unit, status, notes } = req.body;
    const updates: any = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (reference !== undefined) updates.reference = reference.trim();
    if (barcode !== undefined) updates.barcode = barcode;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (quantity !== undefined) updates.quantity = Number(quantity);
    if (minQuantity !== undefined) updates.minQuantity = Number(minQuantity);
    if (unitPrice !== undefined) updates.unitPrice = unitPrice ? String(unitPrice) : null;
    if (supplier !== undefined) updates.supplier = supplier;
    if (location !== undefined) updates.location = location;
    if (unit !== undefined) updates.unit = unit;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    if (updates.quantity !== undefined) {
      updates.status = updates.quantity === 0 ? "rupture" : updates.quantity <= (updates.minQuantity ?? 5) ? "stock_faible" : "en_stock";
    }

    const [row] = await db.update(stockArticlesTable).set(updates).where(eq(stockArticlesTable.id, id)).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour article stock");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.get("/stock/mouvements", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, type, limit = "30", offset = "0" } = req.query as any;
  try {
    const conditions: any[] = [eq(stockMouvementsTable.organisationId, orgId)];
    if (search) conditions.push(ilike(stockMouvementsTable.articleName, `%${search}%`));
    if (type && type !== "all") conditions.push(eq(stockMouvementsTable.type, type));

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(stockMouvementsTable).where(and(...conditions));
    const rows = await db.select().from(stockMouvementsTable).where(and(...conditions)).orderBy(desc(stockMouvementsTable.createdAt)).limit(parseInt(limit)).offset(parseInt(offset));
    res.json({ mouvements: rows, total: count });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mouvements stock");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.patch("/stock/:id/adjust", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = (req.session as any)?.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { delta, reason, type = "ajustement" } = req.body;
  if (typeof delta !== "number") { res.status(400).json({ error: "Delta numerique requis." }); return; }

  try {
    const [existing] = await db.select().from(stockArticlesTable).where(and(eq(stockArticlesTable.id, id), eq(stockArticlesTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Article non trouve." }); return; }

    const newQty = Math.max(0, existing.quantity + delta);
    const newStatus = newQty === 0 ? "rupture" : newQty <= existing.minQuantity ? "stock_faible" : "en_stock";

    const [row] = await db.update(stockArticlesTable).set({ quantity: newQty, status: newStatus, updatedAt: new Date() }).where(eq(stockArticlesTable.id, id)).returning();

    await db.insert(stockMouvementsTable).values({
      organisationId: orgId, articleId: id, articleName: existing.name,
      articleReference: existing.reference, type, delta,
      quantityBefore: existing.quantity, quantityAfter: newQty,
      reason: reason || null, userId: userId || null,
    } as any).catch(() => {});

    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur ajustement stock");
    res.status(500).json({ error: "Erreur lors de l'ajustement." });
  }
});

router.get("/stock/mouvements/export/csv", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(stockMouvementsTable).where(eq(stockMouvementsTable.organisationId, orgId)).orderBy(desc(stockMouvementsTable.createdAt)).limit(5000);
    const escape = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s; };
    const headers = ["Date", "Article", "Référence", "Type", "Delta", "Qté avant", "Qté après", "Raison"];
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR") : ""),
      escape(r.articleName), escape(r.articleReference), escape(r.type),
      escape(r.delta), escape(r.quantityBefore), escape(r.quantityAfter), escape(r.reason),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="mouvements_stock_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export mouvements stock CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.get("/stock/export/csv", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(stockArticlesTable).where(eq(stockArticlesTable.organisationId, orgId)).orderBy(asc(stockArticlesTable.name));
    const headers = ["Nom", "Référence", "Description", "Quantité", "Stock min.", "Unité", "Prix unitaire", "Fournisseur", "Emplacement", "Catégorie", "Statut", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.name), escape(r.reference), escape(r.description), escape(r.quantity),
      escape(r.minQuantity), escape(r.unit), escape(r.unitPrice),
      escape(r.supplier), escape(r.location), escape(r.category), escape(r.status),
      escape(r.createdAt ? new Date(r.createdAt).toLocaleDateString("fr-FR") : ""),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="stock_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export stock CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

router.delete("/stock/:id", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.delete(stockArticlesTable).where(and(eq(stockArticlesTable.id, id), eq(stockArticlesTable.organisationId, orgId))).returning({ id: stockArticlesTable.id });
    if (!row) { res.status(404).json({ error: "Article non trouve." }); return; }
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression article stock");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
