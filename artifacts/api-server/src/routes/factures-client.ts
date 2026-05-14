import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, ilike, or, sql, and, type Column, type SQL } from "drizzle-orm";
import { db, facturesClientTable } from "@workspace/db";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";

const router: IRouter = Router();

const STATUSES = ["brouillon", "envoyee", "payee", "partiellement_payee", "en_retard", "annulee"] as const;

// Backoffice SaaS (super-admin uniquement). Plus de filtre organisation_id
// par defaut: la vue est globale. Un parametre ?organisationId= permet de
// scoper une organisation specifique. Voir Tâche #53.
function parseOrgFilter(req: Request): number | null {
  const raw = (req.query as Record<string, unknown>).organisationId;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

router.get("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const { search, status, limit = "50", offset = "0" } = req.query as any;
  const conditions: SQL[] = [];
  const orgFilter = parseOrgFilter(req);
  if (orgFilter != null) conditions.push(eq(facturesClientTable.organisationId, orgFilter));
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
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  try {
    const [rows, countRes] = await Promise.all([
      (where ? db.select().from(facturesClientTable).where(where) : db.select().from(facturesClientTable))
        .orderBy(desc(facturesClientTable.createdAt)).limit(Number(limit)).offset(Number(offset)),
      where
        ? db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable).where(where)
        : db.select({ count: sql<number>`count(*)::int` }).from(facturesClientTable),
    ]);
    res.json({ factures: rows, total: countRes[0]?.count ?? 0 });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste factures");
    res.status(500).json({ error: "Erreur lors de la recuperation des factures." });
  }
});

router.get("/factures-client/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id));
    if (!row) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur get facture");
    res.status(500).json({ error: "Erreur lors de la recuperation." });
  }
});

router.post("/factures-client", async (req: Request, res: Response): Promise<void> => {
  const { reference, title, clientName, clientEmail, clientPhone, clientAddress, clientCompany, items, subtotal, taxAmount, totalAmount, paidAmount, currency = "EUR", status = "brouillon", dueDate, paymentMethod, notes, conditions, contactId, devisId, organisationId } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!clientName?.trim()) { res.status(400).json({ error: "Le client est obligatoire." }); return; }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
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
    const ref = (reference && String(reference).trim()) || `FAC-${Date.now()}`;
    const [row] = await db.insert(facturesClientTable).values({
      organisationId: targetOrg,
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
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [existing] = await db.select({ id: facturesClientTable.id }).from(facturesClientTable).where(eq(facturesClientTable.id, id));
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
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const result = await db.delete(facturesClientTable).where(eq(facturesClientTable.id, id)).returning({ id: facturesClientTable.id });
    if (result.length === 0) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression facture");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
