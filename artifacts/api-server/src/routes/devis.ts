import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, devisTable, facturesClientTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

const sortCols: Record<string, any> = {
  createdAt: devisTable.createdAt,
  reference: devisTable.reference,
  totalAmount: devisTable.totalAmount,
  validUntil: devisTable.validUntil,
  status: devisTable.status,
  clientName: devisTable.clientName,
};

function generateRef(prefix: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${y}${m}-${rand}`;
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

router.get("/devis", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status, limit = "50", offset = "0", sortBy = "createdAt", sortOrder = "desc" } = req.query as any;

  const conditions = [eq(devisTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(devisTable.status, status));
  if (search) {
    conditions.push(or(
      ilike(devisTable.reference, `%${search}%`),
      ilike(devisTable.title, `%${search}%`),
      ilike(devisTable.clientName, `%${search}%`),
      ilike(devisTable.clientEmail, `%${search}%`),
      ilike(devisTable.clientCompany, `%${search}%`),
    )!);
  }

  const where = and(...conditions);
  const col = sortCols[sortBy] ?? devisTable.createdAt;
  const orderFn = sortOrder === "asc" ? asc : desc;

  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(devisTable).where(where).orderBy(orderFn(col)).limit(Number(limit)).offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(devisTable).where(where),
    ]);
    res.json({ devis: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste devis");
    res.status(500).json({ error: "Erreur lors de la recuperation des devis." });
  }
});

router.get("/devis/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const stats = await db.select({
      total: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${devisTable.totalAmount}::numeric), 0)::numeric`,
      brouillon: sql<number>`count(*) filter (where ${devisTable.status} = 'brouillon')::int`,
      envoye: sql<number>`count(*) filter (where ${devisTable.status} = 'envoye')::int`,
      accepte: sql<number>`count(*) filter (where ${devisTable.status} = 'accepte')::int`,
      refuse: sql<number>`count(*) filter (where ${devisTable.status} = 'refuse')::int`,
      expire: sql<number>`count(*) filter (where ${devisTable.status} = 'expire')::int`,
      amountAccepte: sql<number>`coalesce(sum(${devisTable.totalAmount}::numeric) filter (where ${devisTable.status} = 'accepte'), 0)::numeric`,
    }).from(devisTable).where(eq(devisTable.organisationId, orgId));
    res.json(stats[0]);
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats devis");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

router.get("/devis/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Devis non trouve." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get devis");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/devis", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { title, description, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items = [], currency = "EUR", status = "brouillon", validUntil, notes, conditions: condText, contactId, prospectId } = req.body;

  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le nom du client est obligatoire." }); return; }

  const { subtotal, taxAmount, totalAmount } = calcTotals(items);

  try {
    const [row] = await db.insert(devisTable).values({
      organisationId: orgId,
      reference: generateRef("DEV"),
      title: title.trim(),
      description,
      clientName: clientName.trim(),
      clientEmail,
      clientPhone,
      clientAddress,
      clientCompany,
      items,
      subtotal: String(subtotal),
      taxAmount: String(taxAmount),
      totalAmount: String(totalAmount),
      currency,
      status,
      validUntil: validUntil ? new Date(validUntil) : null,
      notes,
      conditions: condText,
      contactId: contactId ? Number(contactId) : null,
      prospectId: prospectId ? Number(prospectId) : null,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation devis");
    res.status(500).json({ error: "Erreur lors de la creation." });
  }
});

router.patch("/devis/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [existing] = await db.select().from(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Devis non trouve." }); return; }

    const { title, description, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, currency, status, validUntil, notes, conditions: condText } = req.body;
    const updates: any = { updatedAt: new Date() };

    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description;
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
      if (status === "accepte") updates.acceptedAt = new Date();
      if (status === "refuse") updates.rejectedAt = new Date();
    }
    if (validUntil !== undefined) updates.validUntil = validUntil ? new Date(validUntil) : null;
    if (notes !== undefined) updates.notes = notes;
    if (condText !== undefined) updates.conditions = condText;

    const [row] = await db.update(devisTable).set(updates).where(eq(devisTable.id, id)).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour devis");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.post("/devis/:id/convert", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [dv] = await db.select().from(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId)));
    if (!dv) { res.status(404).json({ error: "Devis non trouve." }); return; }
    if (dv.status !== "accepte") { res.status(400).json({ error: "Le devis doit etre accepte avant conversion." }); return; }

    const now = new Date();
    const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [facture] = await db.insert(facturesClientTable).values({
      organisationId: orgId,
      reference: generateRef("FAC"),
      title: dv.title,
      clientName: dv.clientName,
      clientEmail: dv.clientEmail,
      clientPhone: dv.clientPhone,
      clientAddress: dv.clientAddress,
      clientCompany: dv.clientCompany,
      items: dv.items as any,
      subtotal: dv.subtotal,
      taxAmount: dv.taxAmount,
      totalAmount: dv.totalAmount,
      paidAmount: "0",
      currency: dv.currency,
      status: "emise",
      dueDate,
      contactId: dv.contactId,
      devisId: dv.id,
    }).returning();

    await db.update(devisTable).set({ convertedToInvoice: facture.id, updatedAt: new Date() }).where(eq(devisTable.id, id));

    res.status(201).json({ facture, message: "Devis converti en facture avec succes." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur conversion devis");
    res.status(500).json({ error: "Erreur lors de la conversion." });
  }
});

router.delete("/devis/:id", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.delete(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId))).returning({ id: devisTable.id });
    if (!row) { res.status(404).json({ error: "Devis non trouve." }); return; }
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression devis");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
