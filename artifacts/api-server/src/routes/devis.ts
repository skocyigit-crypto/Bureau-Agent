import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, ilike, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, devisTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";

const router: IRouter = Router();

const STATUSES = ["brouillon", "envoye", "accepte", "refuse", "expire"] as const;

router.get("/devis", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status, limit = "50", offset = "0" } = req.query as any;
  const conditions = [eq(devisTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(devisTable.status, status));
  if (search) {
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${search}%`;
    const il = (col: Column): SQL => accentInsensitiveIlike(col, pattern, useUnaccent);
    conditions.push(or(
      il(devisTable.title),
      il(devisTable.reference),
      il(devisTable.clientName),
      il(devisTable.clientCompany),
    )!);
  }
  const where = and(...conditions);
  try {
    const [rows, countRes] = await Promise.all([
      db.select().from(devisTable).where(where).orderBy(desc(devisTable.createdAt)).limit(Number(limit)).offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(devisTable).where(where),
    ]);
    res.json({ devis: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste devis");
    res.status(500).json({ error: "Erreur lors de la recuperation des devis." });
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
  const { reference, title, description, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, subtotal, taxAmount, totalAmount, currency = "EUR", status = "brouillon", validUntil, notes, conditions, contactId, prospectId } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le client est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
  try {
    const ref = (reference && String(reference).trim()) || `DEV-${Date.now()}`;
    const [row] = await db.insert(devisTable).values({
      organisationId: orgId,
      reference: ref,
      title: title.trim(),
      description: description ?? null,
      clientName: clientName.trim(),
      clientEmail: clientEmail ?? null,
      clientPhone: clientPhone ?? null,
      clientAddress: clientAddress ?? null,
      clientCompany: clientCompany ?? null,
      items: Array.isArray(items) ? items : [],
      subtotal: subtotal != null ? String(subtotal) : "0",
      taxAmount: taxAmount != null ? String(taxAmount) : "0",
      totalAmount: totalAmount != null ? String(totalAmount) : "0",
      currency,
      status,
      validUntil: validUntil ? new Date(validUntil) : null,
      notes: notes ?? null,
      conditions: conditions ?? null,
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
    const [existing] = await db.select({ id: devisTable.id }).from(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId)));
    if (!existing) { res.status(404).json({ error: "Devis non trouve." }); return; }
    const b = req.body ?? {};
    if (b.status !== undefined && !STATUSES.includes(b.status)) { res.status(400).json({ error: "Statut invalide." }); return; }
    const updates: any = { updatedAt: new Date() };
    for (const k of ["title", "description", "clientName", "clientEmail", "clientPhone", "clientAddress", "clientCompany", "currency", "status", "notes", "conditions", "reference"]) {
      if (b[k] !== undefined) updates[k] = b[k];
    }
    if (b.items !== undefined) updates.items = Array.isArray(b.items) ? b.items : [];
    for (const k of ["subtotal", "taxAmount", "totalAmount"]) {
      if (b[k] !== undefined) updates[k] = b[k] != null ? String(b[k]) : null;
    }
    if (b.validUntil !== undefined) updates.validUntil = b.validUntil ? new Date(b.validUntil) : null;
    if (b.status === "accepte") updates.acceptedAt = new Date();
    if (b.status === "refuse") updates.rejectedAt = new Date();
    const [row] = await db.update(devisTable).set(updates).where(eq(devisTable.id, id)).returning();
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour devis");
    res.status(500).json({ error: "Erreur lors de la mise a jour." });
  }
});

router.delete("/devis/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const result = await db.delete(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId))).returning({ id: devisTable.id });
    if (result.length === 0) { res.status(404).json({ error: "Devis non trouve." }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression devis");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
