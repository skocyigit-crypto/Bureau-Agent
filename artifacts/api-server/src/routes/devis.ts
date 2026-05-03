import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, devisTable, facturesClientTable, organisationsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { sendEmail } from "../services/email";

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

router.post("/devis/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [dv] = await db.select().from(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId)));
    if (!dv) { res.status(404).json({ error: "Devis non trouve." }); return; }
    const [copy] = await db.insert(devisTable).values({
      organisationId: orgId,
      reference: generateRef("DEV"),
      title: `Copie — ${dv.title}`,
      description: dv.description,
      clientName: dv.clientName,
      clientEmail: dv.clientEmail,
      clientPhone: dv.clientPhone,
      clientAddress: dv.clientAddress,
      clientCompany: dv.clientCompany,
      items: dv.items,
      subtotal: dv.subtotal,
      taxAmount: dv.taxAmount,
      totalAmount: dv.totalAmount,
      currency: dv.currency,
      status: "brouillon",
      notes: dv.notes,
      conditions: dv.conditions,
      contactId: dv.contactId,
      prospectId: dv.prospectId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication devis");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.post("/devis/:id/send", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [[dv], [org]] = await Promise.all([
      db.select().from(devisTable).where(and(eq(devisTable.id, id), eq(devisTable.organisationId, orgId))),
      db.select({ name: organisationsTable.name, email: organisationsTable.email }).from(organisationsTable).where(eq(organisationsTable.id, orgId)),
    ]);
    if (!dv) { res.status(404).json({ error: "Devis non trouve." }); return; }
    if (!dv.clientEmail) { res.status(400).json({ error: "Aucun email client renseigne sur ce devis." }); return; }

    const fmtEur = (v: any) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(v || "0"));
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
    const orgName = org?.name || "Agent de Bureau";

    const itemsHtml = (dv.items as any[] || []).map(it => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 8px;font-size:14px;">${it.description}</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;">${it.quantity}</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;">${fmtEur(it.unitPrice)}</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;">${it.taxRate || 0}%</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;font-weight:600;">${fmtEur(it.total)}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:680px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#1a2744 0%,#2d3f6e 100%);padding:32px 40px;">
    <h1 style="color:#f59e0b;margin:0;font-size:24px;font-weight:700;">Devis ${dv.reference}</h1>
    <p style="color:#cbd5e1;margin:8px 0 0;font-size:14px;">${orgName}</p>
  </div>
  <div style="padding:32px 40px;">
    <p style="font-size:15px;color:#374151;">Bonjour <strong>${dv.clientName}</strong>,</p>
    <p style="font-size:14px;color:#6b7280;line-height:1.6;">Veuillez trouver ci-dessous notre devis <strong>${dv.title}</strong>.</p>

    ${dv.validUntil ? `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:13px;color:#854d0e;">
      <strong>Valable jusqu'au :</strong> ${fmtDate(dv.validUntil)}
    </div>` : ""}

    <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
      <thead><tr style="background:#f1f5f9;">
        <th style="padding:10px 8px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;">Description</th>
        <th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;text-transform:uppercase;">Qté</th>
        <th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;text-transform:uppercase;">P.U. HT</th>
        <th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;text-transform:uppercase;">TVA</th>
        <th style="padding:10px 8px;text-align:right;font-size:12px;color:#64748b;text-transform:uppercase;">Total HT</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div style="text-align:right;border-top:2px solid #e5e7eb;padding-top:16px;">
      <div style="font-size:14px;color:#6b7280;margin-bottom:4px;">Sous-total HT : ${fmtEur(dv.subtotal)}</div>
      <div style="font-size:14px;color:#6b7280;margin-bottom:8px;">TVA : ${fmtEur(dv.taxAmount)}</div>
      <div style="font-size:20px;font-weight:700;color:#1a2744;">Total TTC : ${fmtEur(dv.totalAmount)}</div>
    </div>

    ${dv.notes ? `<div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:8px;font-size:13px;color:#6b7280;"><strong>Notes :</strong> ${dv.notes}</div>` : ""}
    ${dv.conditions ? `<div style="margin-top:12px;padding:16px;background:#f8fafc;border-radius:8px;font-size:13px;color:#6b7280;"><strong>Conditions :</strong> ${dv.conditions}</div>` : ""}

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
      ${orgName} — Ce devis a été généré automatiquement par Agent de Bureau
    </div>
  </div>
</div></body></html>`;

    const text = `Devis ${dv.reference} — ${dv.title}\n\nClient: ${dv.clientName}\nMontant TTC: ${fmtEur(dv.totalAmount)}\n${dv.validUntil ? `Valable jusqu'au: ${fmtDate(dv.validUntil)}\n` : ""}\n${orgName}`;

    const result = await sendEmail(dv.clientEmail, `Devis ${dv.reference} — ${orgName}`, html, text);

    if (result.success) {
      await db.update(devisTable).set({ status: dv.status === "brouillon" ? "envoye" : dv.status, updatedAt: new Date() }).where(eq(devisTable.id, id));
      res.json({ success: true, message: `Devis envoyé à ${dv.clientEmail}` });
    } else {
      res.status(500).json({ error: result.error || "Echec d'envoi de l'email." });
    }
  } catch (err: any) {
    req.log.error({ err }, "Erreur envoi devis par email");
    res.status(500).json({ error: "Erreur lors de l'envoi." });
  }
});

router.get("/devis/export/csv", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(devisTable).where(eq(devisTable.organisationId, orgId)).orderBy(desc(devisTable.createdAt));
    const headers = ["Référence", "Titre", "Client", "Email", "Entreprise", "Statut", "Sous-total HT", "TVA", "Total TTC", "Valide jusqu'au", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.reference), escape(r.title), escape(r.clientName), escape(r.clientEmail),
      escape(r.clientCompany), escape(r.status), escape(r.subtotal), escape(r.taxAmount),
      escape(r.totalAmount), escape(fmtDate(r.validUntil)), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="devis_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export devis CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
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
