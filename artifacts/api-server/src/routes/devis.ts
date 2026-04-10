import { Router, type IRouter } from "express";
import { eq, desc, ilike, or, sql, and } from "drizzle-orm";
import { db, devisTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

router.get("/devis", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { status, search, limit, offset } = req.query;
  const conditions: any[] = [eq(devisTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(devisTable.status, status as string));
  if (search) {
    conditions.push(or(
      ilike(devisTable.title, `%${search}%`),
      ilike(devisTable.clientName, `%${search}%`),
      ilike(devisTable.reference, `%${search}%`)
    )!);
  }
  const whereClause = and(...conditions);
  const [devis, countResult] = await Promise.all([
    db.select().from(devisTable).where(whereClause).orderBy(desc(devisTable.createdAt))
      .limit(Number(limit) || 50).offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(devisTable).where(whereClause),
  ]);
  res.json({ devis, total: countResult[0]?.count ?? 0 });
});

router.get("/devis/stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const all = await db.select().from(devisTable).where(eq(devisTable.organisationId, orgId));
  const stats = {
    total: all.length,
    brouillon: all.filter(d => d.status === "brouillon").length,
    envoye: all.filter(d => d.status === "envoye").length,
    accepte: all.filter(d => d.status === "accepte").length,
    refuse: all.filter(d => d.status === "refuse").length,
    expire: all.filter(d => d.status === "expire").length,
    totalAmount: all.reduce((s, d) => s + Number(d.totalAmount), 0),
    acceptedAmount: all.filter(d => d.status === "accepte").reduce((s, d) => s + Number(d.totalAmount), 0),
    conversionRate: all.length > 0 ? Math.round((all.filter(d => d.status === "accepte").length / all.length) * 100) : 0,
  };
  res.json(stats);
});

router.get("/devis/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [d] = await db.select().from(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId)));
  if (!d) { res.status(404).json({ error: "Devis non trouve" }); return; }
  res.json(d);
});

router.post("/devis", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { title, description, contactId, prospectId, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, notes, conditions, validUntil } = req.body;
  if (!title || !clientName) { res.status(400).json({ error: "Titre et nom client requis" }); return; }
  const count = await db.select({ count: sql<number>`count(*)::int` }).from(devisTable).where(eq(devisTable.organisationId, orgId));
  const ref = `DEV-${new Date().getFullYear()}-${String((count[0]?.count ?? 0) + 1).padStart(4, "0")}`;
  const parsedItems = items || [];
  const subtotal = parsedItems.reduce((s: number, i: any) => s + (i.quantity * i.unitPrice), 0);
  const taxAmount = parsedItems.reduce((s: number, i: any) => s + (i.quantity * i.unitPrice * (i.taxRate || 0) / 100), 0);
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: ref, title, description,
    contactId: contactId || null, prospectId: prospectId || null,
    clientName, clientEmail, clientPhone, clientAddress, clientCompany,
    items: parsedItems, subtotal: String(subtotal), taxAmount: String(taxAmount),
    totalAmount: String(subtotal + taxAmount), notes, conditions,
    validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 30 * 86400000),
  }).returning();
  res.status(201).json(d);
});

router.patch("/devis/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const updateData: any = { ...req.body };
  if (updateData.items) {
    const items = updateData.items;
    updateData.subtotal = String(items.reduce((s: number, i: any) => s + (i.quantity * i.unitPrice), 0));
    updateData.taxAmount = String(items.reduce((s: number, i: any) => s + (i.quantity * i.unitPrice * (i.taxRate || 0) / 100), 0));
    updateData.totalAmount = String(Number(updateData.subtotal) + Number(updateData.taxAmount));
  }
  if (updateData.status === "accepte" && !updateData.acceptedAt) updateData.acceptedAt = new Date();
  if (updateData.status === "refuse" && !updateData.rejectedAt) updateData.rejectedAt = new Date();
  if (updateData.validUntil) updateData.validUntil = new Date(updateData.validUntil);
  delete updateData.id; delete updateData.organisationId; delete updateData.createdAt; delete updateData.reference;
  const [d] = await db.update(devisTable).set(updateData)
    .where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId))).returning();
  if (!d) { res.status(404).json({ error: "Devis non trouve" }); return; }
  res.json(d);
});

router.delete("/devis/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [d] = await db.delete(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId))).returning();
  if (!d) { res.status(404).json({ error: "Devis non trouve" }); return; }
  res.sendStatus(204);
});

export default router;
