import { Router, type IRouter } from "express";
import { eq, desc, ilike, or, sql, and } from "drizzle-orm";
import { db, facturesClientTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

router.get("/factures-client", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { status, search, limit, offset } = req.query;
  const conditions: any[] = [eq(facturesClientTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(facturesClientTable.status, status as string));
  if (search) {
    conditions.push(or(
      ilike(facturesClientTable.title, `%${search}%`),
      ilike(facturesClientTable.clientName, `%${search}%`),
      ilike(facturesClientTable.reference, `%${search}%`)
    )!);
  }
  const whereClause = and(...conditions);
  const [factures, countResult] = await Promise.all([
    db.select().from(facturesClientTable).where(whereClause).orderBy(desc(facturesClientTable.createdAt))
      .limit(Number(limit) || 50).offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(whereClause),
  ]);
  res.json({ factures, total: countResult[0]?.count ?? 0 });
});

router.get("/factures-client/stats", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const all = await db.select().from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
  const now = new Date();
  const stats = {
    total: all.length,
    brouillon: all.filter(f => f.status === "brouillon").length,
    envoyee: all.filter(f => f.status === "envoyee").length,
    payee: all.filter(f => f.status === "payee").length,
    en_retard: all.filter(f => f.status === "envoyee" && f.dueDate && new Date(f.dueDate) < now).length,
    partielle: all.filter(f => f.status === "partielle").length,
    totalAmount: all.reduce((s, f) => s + Number(f.totalAmount), 0),
    paidAmount: all.reduce((s, f) => s + Number(f.paidAmount), 0),
    unpaidAmount: all.reduce((s, f) => s + Number(f.totalAmount) - Number(f.paidAmount), 0),
    overdueAmount: all.filter(f => f.status === "envoyee" && f.dueDate && new Date(f.dueDate) < now).reduce((s, f) => s + Number(f.totalAmount) - Number(f.paidAmount), 0),
  };
  res.json(stats);
});

router.get("/factures-client/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [f] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
  if (!f) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  res.json(f);
});

router.post("/factures-client", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { title, contactId, devisId, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, notes, conditions, dueDate } = req.body;
  if (!title || !clientName) { res.status(400).json({ error: "Titre et nom client requis" }); return; }
  const count = await db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
  const ref = `FAC-${new Date().getFullYear()}-${String((count[0]?.count ?? 0) + 1).padStart(4, "0")}`;
  const parsedItems = items || [];
  const subtotal = parsedItems.reduce((s: number, i: any) => s + (i.quantity * i.unitPrice), 0);
  const taxAmount = parsedItems.reduce((s: number, i: any) => s + (i.quantity * i.unitPrice * (i.taxRate || 0) / 100), 0);
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: ref, title,
    contactId: contactId || null, devisId: devisId || null,
    clientName, clientEmail, clientPhone, clientAddress, clientCompany,
    items: parsedItems, subtotal: String(subtotal), taxAmount: String(taxAmount),
    totalAmount: String(subtotal + taxAmount), paidAmount: "0", notes, conditions,
    dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000),
  }).returning();
  res.status(201).json(f);
});

router.patch("/factures-client/:id", async (req, res): Promise<void> => {
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
  if (updateData.status === "payee" && !updateData.paidAt) {
    updateData.paidAt = new Date();
    updateData.paidAmount = updateData.totalAmount || updateData.paidAmount;
  }
  if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate);
  delete updateData.id; delete updateData.organisationId; delete updateData.createdAt; delete updateData.reference;
  const [f] = await db.update(facturesClientTable).set(updateData)
    .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId))).returning();
  if (!f) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  res.json(f);
});

router.delete("/factures-client/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [f] = await db.delete(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId))).returning();
  if (!f) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  res.sendStatus(204);
});

export default router;
