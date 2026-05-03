import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { commandesFournisseurTable } from "@workspace/db/schema";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { sendEmail } from "../services/email";

const router: IRouter = Router();

const sortCols: Record<string, any> = {
  createdAt: commandesFournisseurTable.createdAt,
  reference: commandesFournisseurTable.reference,
  totalAmount: commandesFournisseurTable.totalAmount,
  expectedDelivery: commandesFournisseurTable.expectedDelivery,
  status: commandesFournisseurTable.status,
  fournisseurName: commandesFournisseurTable.fournisseurName,
};

function generateRef(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `BC-${y}${m}-${rand}`;
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

router.get("/commandes-fournisseur", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, status, limit = "50", offset = "0", sortBy = "createdAt", sortOrder = "desc" } = req.query as any;

  const conditions = [eq(commandesFournisseurTable.organisationId, orgId)];
  if (status && status !== "all") conditions.push(eq(commandesFournisseurTable.status, status));
  if (search) {
    conditions.push(or(
      ilike(commandesFournisseurTable.reference, `%${search}%`),
      ilike(commandesFournisseurTable.fournisseurName, `%${search}%`),
    )!);
  }

  const col = sortCols[sortBy] ?? commandesFournisseurTable.createdAt;
  const order = sortOrder === "asc" ? asc(col) : desc(col);

  try {
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(commandesFournisseurTable).where(and(...conditions)).orderBy(order)
        .limit(parseInt(limit)).offset(parseInt(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(commandesFournisseurTable).where(and(...conditions)),
    ]);
    res.json({ data: rows, total: count });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste commandes fournisseur");
    res.status(500).json({ error: "Erreur lors de la récupération." });
  }
});

router.get("/commandes-fournisseur/stats", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [stats] = await db.select({
      total: sql<number>`count(*)::int`,
      brouillon: sql<number>`count(*) filter (where ${commandesFournisseurTable.status} = 'brouillon')::int`,
      envoye: sql<number>`count(*) filter (where ${commandesFournisseurTable.status} = 'envoye')::int`,
      confirme: sql<number>`count(*) filter (where ${commandesFournisseurTable.status} = 'confirme')::int`,
      recu: sql<number>`count(*) filter (where ${commandesFournisseurTable.status} = 'recu')::int`,
      annule: sql<number>`count(*) filter (where ${commandesFournisseurTable.status} = 'annule')::int`,
      totalAmount: sql<number>`coalesce(sum(${commandesFournisseurTable.totalAmount}::numeric), 0)::numeric`,
      pendingAmount: sql<number>`coalesce(sum(${commandesFournisseurTable.totalAmount}::numeric) filter (where ${commandesFournisseurTable.status} not in ('recu','annule')), 0)::numeric`,
    }).from(commandesFournisseurTable).where(eq(commandesFournisseurTable.organisationId, orgId));
    res.json(stats);
  } catch (err: any) {
    req.log.error({ err }, "Erreur stats commandes fournisseur");
    res.status(500).json({ error: "Erreur lors des statistiques." });
  }
});

router.get("/commandes-fournisseur/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select().from(commandesFournisseurTable)
      .where(and(eq(commandesFournisseurTable.id, id), eq(commandesFournisseurTable.organisationId, orgId)));
    if (!row) { res.status(404).json({ error: "Commande introuvable." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur lecture commande fournisseur");
    res.status(500).json({ error: "Erreur lors de la récupération." });
  }
});

router.post("/commandes-fournisseur", requireRole("operateur"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { fournisseurName, fournisseurEmail, fournisseurPhone, fournisseurAddress, items = [], notes, conditions, currency = "EUR", expectedDelivery } = req.body;
  if (!fournisseurName) { res.status(400).json({ error: "Nom du fournisseur obligatoire." }); return; }
  const totals = calcTotals(items);
  try {
    const [row] = await db.insert(commandesFournisseurTable).values({
      organisationId: orgId,
      reference: generateRef(),
      fournisseurName, fournisseurEmail, fournisseurPhone, fournisseurAddress,
      items,
      subtotal: String(totals.subtotal),
      taxAmount: String(totals.taxAmount),
      totalAmount: String(totals.totalAmount),
      currency,
      notes, conditions,
      expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : undefined,
      status: "brouillon",
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur création commande fournisseur");
    res.status(500).json({ error: "Erreur lors de la création." });
  }
});

router.patch("/commandes-fournisseur/:id", requireRole("operateur"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const { fournisseurName, fournisseurEmail, fournisseurPhone, fournisseurAddress, items, notes, conditions, currency, expectedDelivery, status } = req.body;

  const update: Record<string, any> = {};
  if (fournisseurName !== undefined) update.fournisseurName = fournisseurName;
  if (fournisseurEmail !== undefined) update.fournisseurEmail = fournisseurEmail;
  if (fournisseurPhone !== undefined) update.fournisseurPhone = fournisseurPhone;
  if (fournisseurAddress !== undefined) update.fournisseurAddress = fournisseurAddress;
  if (notes !== undefined) update.notes = notes;
  if (conditions !== undefined) update.conditions = conditions;
  if (currency !== undefined) update.currency = currency;
  if (expectedDelivery !== undefined) update.expectedDelivery = expectedDelivery ? new Date(expectedDelivery) : null;
  if (status !== undefined) {
    const VALID = ["brouillon", "envoye", "confirme", "recu", "annule"];
    if (!VALID.includes(status)) { res.status(400).json({ error: "Statut invalide." }); return; }
    update.status = status;
    if (status === "recu") update.receivedAt = new Date();
  }
  if (items !== undefined) {
    const totals = calcTotals(items);
    update.items = items;
    update.subtotal = String(totals.subtotal);
    update.taxAmount = String(totals.taxAmount);
    update.totalAmount = String(totals.totalAmount);
  }

  try {
    const [row] = await db.update(commandesFournisseurTable).set(update)
      .where(and(eq(commandesFournisseurTable.id, id), eq(commandesFournisseurTable.organisationId, orgId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Commande introuvable." }); return; }
    res.json(row);
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise à jour commande fournisseur");
    res.status(500).json({ error: "Erreur lors de la mise à jour." });
  }
});

router.delete("/commandes-fournisseur/:id", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.delete(commandesFournisseurTable)
      .where(and(eq(commandesFournisseurTable.id, id), eq(commandesFournisseurTable.organisationId, orgId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Commande introuvable." }); return; }
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur suppression commande fournisseur");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

router.post("/commandes-fournisseur/:id/send", requireRole("operateur"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [bc] = await db.select().from(commandesFournisseurTable)
      .where(and(eq(commandesFournisseurTable.id, id), eq(commandesFournisseurTable.organisationId, orgId)));
    if (!bc) { res.status(404).json({ error: "Commande introuvable." }); return; }
    if (!bc.fournisseurEmail) { res.status(400).json({ error: "Email fournisseur manquant." }); return; }

    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e3a5f">Bon de Commande ${bc.reference}</h2>
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint notre bon de commande <strong>${bc.reference}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Article</th><th style="padding:8px;text-align:right">Qté</th><th style="padding:8px;text-align:right">PU HT</th><th style="padding:8px;text-align:right">Total HT</th></tr>
        ${(bc.items as any[] || []).map(item => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${item.description}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">${item.quantity}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">${Number(item.unitPrice).toFixed(2)} €</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">${(item.quantity * item.unitPrice).toFixed(2)} €</td></tr>`).join("")}
      </table>
      <p style="text-align:right"><strong>Total TTC: ${Number(bc.totalAmount).toFixed(2)} €</strong></p>
      ${bc.expectedDelivery ? `<p>Livraison souhaitée avant le : <strong>${new Date(bc.expectedDelivery).toLocaleDateString("fr-FR")}</strong></p>` : ""}
      ${bc.notes ? `<p>Notes: ${bc.notes}</p>` : ""}
    </div>`;

    await sendEmail(bc.fournisseurEmail, `Bon de commande ${bc.reference}`, html, `Bon de commande ${bc.reference} - Total: ${Number(bc.totalAmount).toFixed(2)} €`);
    await db.update(commandesFournisseurTable).set({ status: "envoye" })
      .where(and(eq(commandesFournisseurTable.id, id), eq(commandesFournisseurTable.organisationId, orgId)));
    res.json({ success: true, message: `Bon de commande envoyé à ${bc.fournisseurEmail}` });
  } catch (err: any) {
    req.log.error({ err }, "Erreur envoi commande fournisseur");
    res.status(500).json({ error: "Erreur lors de l'envoi." });
  }
});

router.post("/commandes-fournisseur/:id/duplicate", requireRole("operateur"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [bc] = await db.select().from(commandesFournisseurTable)
      .where(and(eq(commandesFournisseurTable.id, id), eq(commandesFournisseurTable.organisationId, orgId)));
    if (!bc) { res.status(404).json({ error: "Commande introuvable." }); return; }
    const [copy] = await db.insert(commandesFournisseurTable).values({
      organisationId: orgId,
      reference: generateRef(),
      fournisseurName: bc.fournisseurName,
      fournisseurEmail: bc.fournisseurEmail,
      fournisseurPhone: bc.fournisseurPhone,
      fournisseurAddress: bc.fournisseurAddress,
      items: bc.items,
      subtotal: bc.subtotal,
      taxAmount: bc.taxAmount,
      totalAmount: bc.totalAmount,
      currency: bc.currency,
      notes: bc.notes,
      conditions: bc.conditions,
      status: "brouillon",
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication commande fournisseur");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.get("/commandes-fournisseur/export/csv", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(commandesFournisseurTable).where(eq(commandesFournisseurTable.organisationId, orgId)).orderBy(desc(commandesFournisseurTable.createdAt));
    const headers = ["Référence", "Fournisseur", "Email", "Téléphone", "Statut", "Sous-total HT", "TVA", "Total TTC", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.reference), escape(r.fournisseurName), escape(r.fournisseurEmail),
      escape(r.fournisseurPhone), escape(r.status),
      escape(r.subtotal), escape(r.taxAmount), escape(r.totalAmount), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="commandes_fournisseur_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export commandes fournisseur CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
  }
});

export default router;
