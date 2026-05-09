import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, ilike, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, facturesClientTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";

const router: IRouter = Router();

const STATUSES = ["brouillon", "envoyee", "payee", "partiellement_payee", "en_retard", "annulee"] as const;

router.get("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status, limit = "50", offset = "0" } = req.query as any;
  const conditions = [eq(facturesClientTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(facturesClientTable.status, status));
  if (search) {
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(facturesClientTable.title),
      il(facturesClientTable.reference),
      il(facturesClientTable.clientName),
      il(facturesClientTable.clientCompany),
    )!);
  }
  const where = and(...conditions);
  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(facturesClientTable).where(where).orderBy(desc(facturesClientTable.createdAt)).limit(Number(limit)).offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(where),
    ]);
    res.json({ factures: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste factures");
    res.status(500).json({ error: "Erreur lors de la recuperation des factures." });
  }
});

router.get("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get facture");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { reference, title, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, subtotal, taxAmount, totalAmount, paidAmount, currency = "EUR", status = "brouillon", dueDate, paymentMethod, notes, conditions, contactId, devisId } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le client est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
  try {
    const ref = (reference && String(reference).trim()) || `FAC-${Date.now()}`;
    const [row] = await db.insert(facturesClientTable).values({
      organisationId: orgId,
      reference: ref,
      title: title.trim(),
      clientName: clientName.trim(),
      clientEmail: clientEmail ?? null,
      clientPhone: clientPhone ?? null,
      clientAddress: clientAddress ?? null,
      clientCompany: clientCompany ?? null,
      items: Array.isArray(items) ? items : [],
      subtotal: subtotal != null ? String(subtotal) : "0",
      taxAmount: taxAmount != null ? String(taxAmount) : "0",
      totalAmount: totalAmount != null ? String(totalAmount) : "0",
      paidAmount: paidAmount != null ? String(paidAmount) : "0",
      currency,
      status,
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentMethod: paymentMethod ?? null,
      notes: notes ?? null,
      conditions: conditions ?? null,
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
    const [existing] = await db.select({ id: facturesClientTable.id }).from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    const b = req.body ?? {};
    if (b.status !== undefined && !STATUSES.includes(b.status)) { res.status(400).json({ error: "Statut invalide." }); return; }
    const updates: any = { updatedAt: new Date() };
    for (const k of ["title", "clientName", "clientEmail", "clientPhone", "clientAddress", "clientCompany", "currency", "status", "notes", "conditions", "reference", "paymentMethod"]) {
      if (b[k] !== undefined) updates[k] = b[k];
    }
    if (b.items !== undefined) updates.items = Array.isArray(b.items) ? b.items : [];
    for (const k of ["subtotal", "taxAmount", "totalAmount", "paidAmount"]) {
      if (b[k] !== undefined) updates[k] = b[k] != null ? String(b[k]) : null;
    }
    if (b.dueDate !== undefined) updates.dueDate = b.dueDate ? new Date(b.dueDate) : null;
    if (b.status === "payee") updates.paidAt = new Date();
    const [row] = await db.update(facturesClientTable).set(updates).where(eq(facturesClientTable.id, id)).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour facture");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.delete("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const result = await db.delete(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId))).returning({ id: facturesClientTable.id });
    if (result.length === 0) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression facture");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
