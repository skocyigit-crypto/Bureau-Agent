import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, facturesClientTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

const sortCols: Record<string, any> = {
  createdAt: facturesClientTable.createdAt,
  reference: facturesClientTable.reference,
  totalAmount: facturesClientTable.totalAmount,
  dueDate: facturesClientTable.dueDate,
  status: facturesClientTable.status,
  clientName: facturesClientTable.clientName,
};

function generateRef(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `FAC-${y}${m}-${rand}`;
}

function calcTotals(items: any[]): { subtotal: number; taxAmount: number; totalAmount: number } {
  let subtotal = 0, taxAmount = 0;
  for (const item of items) {
    const lineTotal = (item.quantity || 0) * (item.unitPrice || 0);
    const tax = lineTotal * ((item.taxRate || 0) / 100);
    subtotal += lineTotal;
    taxAmount += tax;
  }
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

router.get("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status, limit = "50", offset = "0", sortBy = "createdAt", sortOrder = "desc", overdue } = req.query as any;

  const conditions = [eq(facturesClientTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(facturesClientTable.status, status));
  if (overdue === "true") {
    conditions.push(sql`${facturesClientTable.dueDate} < now()`);
    conditions.push(sql`${facturesClientTable.status} not in ('payee', 'annulee')`);
  }
  if (search) {
    conditions.push(or(
      ilike(facturesClientTable.reference, `%${search}%`),
      ilike(facturesClientTable.title, `%${search}%`),
      ilike(facturesClientTable.clientName, `%${search}%`),
      ilike(facturesClientTable.clientEmail, `%${search}%`),
      ilike(facturesClientTable.clientCompany, `%${search}%`),
    )!);
  }

  const where = and(...conditions);
  const col = sortCols[sortBy] ?? facturesClientTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(facturesClientTable).where(where).orderBy(orderFn(col)).limit(Number(limit)).offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(where),
    ]);

    const now = new Date();
    const enriched = rows.map(f => ({
      ...f,
      isOverdue: f.dueDate && new Date(f.dueDate) < now && !["payee", "annulee"].includes(f.status),
      remainingAmount: parseFloat(f.totalAmount) - parseFloat(f.paidAmount ?? "0"),
    }));

    res.json({ factures: enriched, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste factures");
    res.status(500).json({ error: "Erreur lors de la recuperation des factures." });
  }
});

router.get("/factures-client/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const stats = await db.select({
      total: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric), 0)::numeric`,
      totalPaid: sql<number>`coalesce(sum(${facturesClientTable.paidAmount}::numeric), 0)::numeric`,
      brouillon: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'brouillon')::int`,
      emise: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'emise')::int`,
      payee: sql<number>`count(*) filter (where ${facturesClientTable.status} = 'payee')::int`,
      en_retard: sql<number>`count(*) filter (where ${facturesClientTable.dueDate} < now() and ${facturesClientTable.status} not in ('payee', 'annulee'))::int`,
      amountEnRetard: sql<number>`coalesce(sum((${facturesClientTable.totalAmount}::numeric - ${facturesClientTable.paidAmount}::numeric)) filter (where ${facturesClientTable.dueDate} < now() and ${facturesClientTable.status} not in ('payee', 'annulee')), 0)::numeric`,
    }).from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
    res.json(stats[0]);
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats factures");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

router.get("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json({ ...row, remainingAmount: parseFloat(row.totalAmount) - parseFloat(row.paidAmount ?? "0") });
  } catch (err: any) {
    req.log.error({ err }, "Erreur get facture");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { title, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items = [], currency = "EUR", status = "brouillon", dueDate, paymentMethod, notes, contactId, devisId } = req.body;

  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le nom du client est obligatoire." }); return; }

  const { subtotal, taxAmount, totalAmount } = calcTotals(items);

  try {
    const [row] = await db.insert(facturesClientTable).values({
      organisationId: orgId,
      reference: generateRef(),
      title: title.trim(),
      clientName: clientName.trim(),
      clientEmail,
      clientPhone,
      clientAddress,
      clientCompany,
      items,
      subtotal: String(subtotal),
      taxAmount: String(taxAmount),
      totalAmount: String(totalAmount),
      paidAmount: "0",
      currency,
      status,
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentMethod,
      notes,
      contactId: contactId ? Number(contactId) : null,
      devisId: devisId ? Number(devisId) : null,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation facture");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [existing] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Facture non trouvee." }); return; }

    const { title, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, currency, status, dueDate, paymentMethod, notes, paidAmount } = req.body;
    const updates: any = { updatedAt: new Date() };

    if (title !== undefined) updates.title = title.trim();
    if (clientName !== undefined) updates.clientName = clientName.trim();
    if (clientEmail !== undefined) updates.clientEmail = clientEmail;
    if (clientPhone !== undefined) updates.clientPhone = clientPhone;
    if (clientAddress !== undefined) updates.clientAddress = clientAddress;
    if (clientCompany !== undefined) updates.clientCompany = clientCompany;
    if (items !== undefined) {
      const { subtotal, taxAmount, totalAmount } = calcTotals(items);
      updates.items = items;
      updates.subtotal = String(subtotal);
      updates.taxAmount = String(taxAmount);
      updates.totalAmount = String(totalAmount);
    }
    if (currency !== undefined) updates.currency = currency;
    if (status !== undefined) {
      updates.status = status;
      if (status === "payee") updates.paidAt = new Date();
    }
    if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
    if (paymentMethod !== undefined) updates.paymentMethod = paymentMethod;
    if (notes !== undefined) updates.notes = notes;
    if (paidAmount !== undefined) {
      updates.paidAmount = String(paidAmount);
      const total = parseFloat(existing.totalAmount);
      if (parseFloat(paidAmount) >= total) { updates.status = "payee"; updates.paidAt = new Date(); }
      else if (parseFloat(paidAmount) > 0) { updates.status = "partiellement_payee"; }
    }

    const [row] = await db.update(facturesClientTable).set(updates).where(eq(facturesClientTable.id, id)).returning();
    res.json({ ...row, remainingAmount: parseFloat(row.totalAmount) - parseFloat(row.paidAmount ?? "0") });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour facture");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.delete("/factures-client/:id", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.delete(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId))).returning({ id: facturesClientTable.id });
    if (!row) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression facture");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
