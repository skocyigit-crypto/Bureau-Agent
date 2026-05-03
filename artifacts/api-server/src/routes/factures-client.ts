import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, asc, ilike, or, sql, and } from "drizzle-orm";
import { db, facturesClientTable, organisationsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { sendEmail } from "../services/email";

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

router.post("/factures-client/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [fac] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!fac) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    const [copy] = await db.insert(facturesClientTable).values({
      organisationId: orgId,
      reference: generateRef(),
      title: `Copie — ${fac.title}`,
      clientName: fac.clientName,
      clientEmail: fac.clientEmail,
      clientPhone: fac.clientPhone,
      clientAddress: fac.clientAddress,
      clientCompany: fac.clientCompany,
      items: fac.items,
      subtotal: fac.subtotal,
      taxAmount: fac.taxAmount,
      totalAmount: fac.totalAmount,
      paidAmount: "0",
      currency: fac.currency,
      status: "brouillon",
      paymentMethod: fac.paymentMethod,
      notes: fac.notes,
      conditions: fac.conditions,
      contactId: fac.contactId,
    }).returning();
    res.status(201).json(copy);
  } catch (err: any) {
    req.log.error({ err }, "Erreur duplication facture");
    res.status(500).json({ error: "Erreur lors de la duplication." });
  }
});

router.post("/factures-client/:id/send", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const [[fac], [org]] = await Promise.all([
      db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId))),
      db.select({ name: organisationsTable.name, email: organisationsTable.email }).from(organisationsTable).where(eq(organisationsTable.id, orgId)),
    ]);
    if (!fac) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    if (!fac.clientEmail) { res.status(400).json({ error: "Aucun email client renseigne sur cette facture." }); return; }

    const fmtEur = (v: any) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(v || "0"));
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
    const orgName = org?.name || "Agent de Bureau";
    const remaining = parseFloat(fac.totalAmount) - parseFloat(fac.paidAmount ?? "0");

    const itemsHtml = (fac.items as any[] || []).map(it => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 8px;font-size:14px;">${it.description}</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;">${it.quantity}</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;">${fmtEur(it.unitPrice)}</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;">${it.taxRate || 0}%</td>
        <td style="padding:10px 8px;text-align:right;font-size:14px;font-weight:600;">${fmtEur(it.total)}</td>
      </tr>`).join("");

    const isOverdue = fac.dueDate && new Date(fac.dueDate) < new Date() && !["payee", "annulee"].includes(fac.status);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:680px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#064e3b 0%,#065f46 100%);padding:32px 40px;">
    <h1 style="color:#6ee7b7;margin:0;font-size:24px;font-weight:700;">Facture ${fac.reference}</h1>
    <p style="color:#a7f3d0;margin:8px 0 0;font-size:14px;">${orgName}</p>
  </div>
  <div style="padding:32px 40px;">
    <p style="font-size:15px;color:#374151;">Bonjour <strong>${fac.clientName}</strong>,</p>
    <p style="font-size:14px;color:#6b7280;line-height:1.6;">Veuillez trouver ci-dessous votre facture <strong>${fac.title}</strong>.</p>

    ${isOverdue ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:13px;color:#991b1b;">
      ⚠️ <strong>Cette facture est en retard.</strong> Date d'échéance dépassée : ${fmtDate(fac.dueDate)}
    </div>` : fac.dueDate ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:13px;color:#065f46;">
      <strong>Date d'échéance :</strong> ${fmtDate(fac.dueDate)}
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
      <div style="font-size:14px;color:#6b7280;margin-bottom:4px;">Sous-total HT : ${fmtEur(fac.subtotal)}</div>
      <div style="font-size:14px;color:#6b7280;margin-bottom:8px;">TVA : ${fmtEur(fac.taxAmount)}</div>
      <div style="font-size:20px;font-weight:700;color:#065f46;">Total TTC : ${fmtEur(fac.totalAmount)}</div>
      ${parseFloat(fac.paidAmount ?? "0") > 0 ? `
      <div style="font-size:14px;color:#059669;margin-top:8px;">Déjà payé : ${fmtEur(fac.paidAmount)}</div>
      <div style="font-size:18px;font-weight:700;color:#dc2626;margin-top:4px;">Restant dû : ${fmtEur(remaining)}</div>` : ""}
    </div>

    ${fac.paymentMethod ? `<div style="margin-top:20px;font-size:13px;color:#6b7280;"><strong>Mode de règlement accepté :</strong> ${fac.paymentMethod}</div>` : ""}
    ${fac.notes ? `<div style="margin-top:16px;padding:16px;background:#f8fafc;border-radius:8px;font-size:13px;color:#6b7280;"><strong>Notes :</strong> ${fac.notes}</div>` : ""}

    <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
      ${orgName} — Facture générée par Agent de Bureau
    </div>
  </div>
</div></body></html>`;

    const text = `Facture ${fac.reference} — ${fac.title}\n\nClient: ${fac.clientName}\nMontant TTC: ${fmtEur(fac.totalAmount)}\nRestant dû: ${fmtEur(remaining)}\n${fac.dueDate ? `Échéance: ${fmtDate(fac.dueDate)}\n` : ""}\n${orgName}`;

    const result = await sendEmail(fac.clientEmail, `Facture ${fac.reference} — ${orgName}`, html, text);

    if (result.success) {
      if (fac.status === "brouillon") {
        await db.update(facturesClientTable).set({ status: "emise", updatedAt: new Date() }).where(eq(facturesClientTable.id, id));
      }
      res.json({ success: true, message: `Facture envoyée à ${fac.clientEmail}` });
    } else {
      res.status(500).json({ error: result.error || "Echec d'envoi de l'email." });
    }
  } catch (err: any) {
    req.log.error({ err }, "Erreur envoi facture par email");
    res.status(500).json({ error: "Erreur lors de l'envoi." });
  }
});

router.post("/factures-client/:id/paiement", requireRole("operateur"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  const { montant, methode, notes: notesPaiement } = req.body;
  const amount = parseFloat(montant);
  if (!amount || amount <= 0) { res.status(400).json({ error: "Montant invalide." }); return; }
  try {
    const [fac] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    if (!fac) { res.status(404).json({ error: "Facture non trouvee." }); return; }
    if (["payee", "annulee"].includes(fac.status)) { res.status(400).json({ error: "Facture déjà soldée ou annulée." }); return; }
    const alreadyPaid = parseFloat(fac.paidAmount ?? "0");
    const total = parseFloat(fac.totalAmount);
    const newPaid = Math.min(alreadyPaid + amount, total);
    const newStatus = newPaid >= total ? "payee" : "partiellement_payee";
    const updates: any = {
      paidAmount: String(newPaid),
      status: newStatus,
      updatedAt: new Date(),
    };
    if (newStatus === "payee") updates.paidAt = new Date();
    if (methode) updates.paymentMethod = methode;
    if (notesPaiement) updates.notes = [fac.notes, `Paiement: ${notesPaiement}`].filter(Boolean).join("\n");
    const [row] = await db.update(facturesClientTable).set(updates).where(eq(facturesClientTable.id, id)).returning();
    res.json({ ...row, remainingAmount: parseFloat(row.totalAmount) - parseFloat(row.paidAmount ?? "0") });
  } catch (err: any) {
    req.log.error({ err }, "Erreur enregistrement paiement facture");
    res.status(500).json({ error: "Erreur lors de l'enregistrement du paiement." });
  }
});

router.get("/factures-client/export/csv", requireRole("agent"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select().from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId)).orderBy(desc(facturesClientTable.createdAt)).limit(5000);
    const headers = ["Référence", "Client", "Email", "Statut", "Sous-total HT", "TVA", "Total TTC", "Payé", "Échéance", "Créé le"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR") : "";
    const lines = [headers.join(","), ...rows.map(r => [
      escape(r.reference), escape(r.clientName), escape(r.clientEmail), escape(r.status),
      escape(r.subtotal), escape(r.taxAmount), escape(r.totalAmount), escape(r.paidAmount),
      escape(fmtDate(r.dueDate)), escape(fmtDate(r.createdAt)),
    ].join(","))];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="factures_${Date.now()}.csv"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err: any) {
    req.log.error({ err }, "Erreur export factures CSV");
    res.status(500).json({ error: "Erreur lors de l'export." });
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
