import { Router, type IRouter } from "express";
import { eq, desc, ilike, or, sql, and } from "drizzle-orm";
import { db, facturesClientTable, organisationsTable, notificationsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { Resend } from "resend";

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

router.get("/factures-client/bank-info", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const [org] = await db.select({
    bankName: organisationsTable.bankName,
    bankIban: organisationsTable.bankIban,
    bankBic: organisationsTable.bankBic,
    siret: organisationsTable.siret,
    tvaNumber: organisationsTable.tvaNumber,
    legalForm: organisationsTable.legalForm,
    capital: organisationsTable.capital,
    invoiceFooter: organisationsTable.invoiceFooter,
    autoInvoiceEnabled: organisationsTable.autoInvoiceEnabled,
    autoEmailInvoice: organisationsTable.autoEmailInvoice,
    name: organisationsTable.name,
    email: organisationsTable.email,
    phone: organisationsTable.phone,
    address: organisationsTable.address,
  }).from(organisationsTable).where(eq(organisationsTable.id, orgId));
  res.json(org || {});
});

router.put("/factures-client/bank-info", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { bankName, bankIban, bankBic, siret, tvaNumber, legalForm, capital, invoiceFooter, autoInvoiceEnabled, autoEmailInvoice } = req.body;
  const updateData: Record<string, any> = {};
  if (bankName !== undefined) updateData.bankName = bankName || null;
  if (bankIban !== undefined) updateData.bankIban = bankIban || null;
  if (bankBic !== undefined) updateData.bankBic = bankBic || null;
  if (siret !== undefined) updateData.siret = siret || null;
  if (tvaNumber !== undefined) updateData.tvaNumber = tvaNumber || null;
  if (legalForm !== undefined) updateData.legalForm = legalForm || null;
  if (capital !== undefined) updateData.capital = capital || null;
  if (invoiceFooter !== undefined) updateData.invoiceFooter = invoiceFooter || null;
  if (autoInvoiceEnabled !== undefined) updateData.autoInvoiceEnabled = autoInvoiceEnabled;
  if (autoEmailInvoice !== undefined) updateData.autoEmailInvoice = autoEmailInvoice;
  const [updated] = await db.update(organisationsTable).set(updateData).where(eq(organisationsTable.id, orgId)).returning();
  res.json({ message: "Informations bancaires mises a jour.", data: updated });
});

router.get("/factures-client/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
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
  const id = parseInt(String(req.params.id));
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
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [f] = await db.delete(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId))).returning();
  if (!f) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  res.sendStatus(204);
});

function generateInvoiceHtml(facture: any, org: any): string {
  const items = facture.items || [];
  const itemRows = items.map((item: any) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.description}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(item.unitPrice).toFixed(2)} €</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.taxRate || 0}%</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold;">${Number(item.total || item.quantity * item.unitPrice).toFixed(2)} €</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:0;}
  .container{max-width:800px;margin:0 auto;padding:40px;}
  .header{display:flex;justify-content:space-between;margin-bottom:40px;}
  .logo-area h1{color:#4f46e5;margin:0;font-size:24px;}
  .invoice-badge{background:#4f46e5;color:white;padding:8px 20px;border-radius:8px;font-size:20px;font-weight:bold;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-bottom:30px;}
  .info-box{padding:15px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;}
  .info-box h3{margin:0 0 8px;color:#6366f1;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;}
  .info-box p{margin:2px 0;font-size:13px;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th{background:#4f46e5;color:white;padding:10px;text-align:left;font-size:12px;text-transform:uppercase;}
  .totals{margin-left:auto;width:300px;}
  .totals tr td{padding:6px 10px;font-size:14px;}
  .totals .total-row{font-size:18px;font-weight:bold;color:#4f46e5;border-top:2px solid #4f46e5;}
  .bank-info{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:15px;margin-top:25px;}
  .bank-info h3{margin:0 0 8px;color:#16a34a;font-size:13px;text-transform:uppercase;}
  .bank-info p{margin:2px 0;font-size:13px;}
  .footer{margin-top:30px;padding-top:15px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;}
  .paid-stamp{position:relative;} .paid-stamp::after{content:'PAYEE';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;font-weight:bold;color:rgba(22,163,74,0.15);pointer-events:none;}
  </style></head><body><div class="container ${facture.status === 'payee' ? 'paid-stamp' : ''}">
  <div class="header">
    <div class="logo-area"><h1>${org.name || 'Agent de Bureau'}</h1>
    ${org.legalForm ? `<p style="color:#6b7280;font-size:12px;">${org.legalForm}${org.capital ? ` — Capital: ${org.capital} €` : ''}</p>` : ''}</div>
    <div><div class="invoice-badge">FACTURE</div><p style="text-align:right;margin-top:8px;font-size:13px;color:#6b7280;">${facture.reference}</p>
    <p style="text-align:right;font-size:12px;color:#6b7280;">Date: ${new Date(facture.createdAt).toLocaleDateString('fr-FR')}</p>
    ${facture.dueDate ? `<p style="text-align:right;font-size:12px;color:#6b7280;">Echeance: ${new Date(facture.dueDate).toLocaleDateString('fr-FR')}</p>` : ''}</div>
  </div>
  <div class="info-grid">
    <div class="info-box"><h3>Emetteur</h3>
      <p><strong>${org.name || ''}</strong></p>
      ${org.address ? `<p>${org.address}</p>` : ''}
      ${org.phone ? `<p>Tel: ${org.phone}</p>` : ''}
      ${org.email ? `<p>Email: ${org.email}</p>` : ''}
      ${org.siret ? `<p>SIRET: ${org.siret}</p>` : ''}
      ${org.tvaNumber ? `<p>TVA: ${org.tvaNumber}</p>` : ''}
    </div>
    <div class="info-box"><h3>Client</h3>
      <p><strong>${facture.clientName}</strong></p>
      ${facture.clientCompany ? `<p>${facture.clientCompany}</p>` : ''}
      ${facture.clientAddress ? `<p>${facture.clientAddress}</p>` : ''}
      ${facture.clientPhone ? `<p>Tel: ${facture.clientPhone}</p>` : ''}
      ${facture.clientEmail ? `<p>Email: ${facture.clientEmail}</p>` : ''}
    </div>
  </div>
  <h3 style="color:#4f46e5;font-size:14px;margin-bottom:10px;">${facture.title}</h3>
  <table><thead><tr><th>Description</th><th style="text-align:center;">Qte</th><th style="text-align:right;">Prix unit.</th><th style="text-align:center;">TVA</th><th style="text-align:right;">Total</th></tr></thead>
  <tbody>${itemRows}</tbody></table>
  <table class="totals"><tbody>
    <tr><td>Sous-total HT</td><td style="text-align:right;">${Number(facture.subtotal).toFixed(2)} €</td></tr>
    <tr><td>TVA</td><td style="text-align:right;">${Number(facture.taxAmount).toFixed(2)} €</td></tr>
    <tr class="total-row"><td>Total TTC</td><td style="text-align:right;">${Number(facture.totalAmount).toFixed(2)} €</td></tr>
    ${facture.status === 'payee' ? `<tr><td style="color:#16a34a;">Paye le</td><td style="text-align:right;color:#16a34a;">${facture.paidAt ? new Date(facture.paidAt).toLocaleDateString('fr-FR') : 'N/A'}</td></tr>` : ''}
  </tbody></table>
  ${(org.bankIban || org.bankBic) ? `<div class="bank-info"><h3>Coordonnees bancaires</h3>
    ${org.bankName ? `<p><strong>Banque:</strong> ${org.bankName}</p>` : ''}
    ${org.bankIban ? `<p><strong>IBAN:</strong> ${org.bankIban}</p>` : ''}
    ${org.bankBic ? `<p><strong>BIC:</strong> ${org.bankBic}</p>` : ''}
  </div>` : ''}
  ${facture.notes ? `<div style="margin-top:15px;padding:10px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;"><p style="font-size:12px;color:#6b7280;margin:0;"><strong>Notes:</strong> ${facture.notes}</p></div>` : ''}
  ${facture.conditions ? `<div style="margin-top:10px;font-size:11px;color:#9ca3af;"><strong>Conditions:</strong> ${facture.conditions}</div>` : ''}
  <div class="footer">
    ${org.invoiceFooter || `${org.name || 'Agent de Bureau'}${org.siret ? ` — SIRET: ${org.siret}` : ''}${org.tvaNumber ? ` — TVA: ${org.tvaNumber}` : ''}`}
    <br>Facture generee automatiquement par Agent de Bureau
  </div></div></body></html>`;
}

router.post("/factures-client/:id/record-payment", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = (req.session as any)?.userId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { amount, paymentMethod, notes } = req.body;

  const [facture] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
  if (!facture) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  if (facture.status === "payee") { res.status(400).json({ error: "Cette facture est deja entierement payee." }); return; }

  const remaining = Number(facture.totalAmount) - Number(facture.paidAmount);
  const paymentAmount = amount !== undefined ? Number(amount) : remaining;
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    res.status(400).json({ error: "Montant invalide. Le montant doit etre un nombre positif." }); return;
  }
  if (paymentAmount > remaining + 0.01) {
    res.status(400).json({ error: `Montant trop eleve. Reste a payer: ${remaining.toFixed(2)} €` }); return;
  }
  const newPaidAmount = Number(facture.paidAmount) + Math.min(paymentAmount, remaining);
  const totalDue = Number(facture.totalAmount);
  const isFullyPaid = newPaidAmount >= totalDue;

  const updateData: any = {
    paidAmount: String(Math.min(newPaidAmount, totalDue)),
    paymentMethod: paymentMethod || facture.paymentMethod || "virement",
    status: isFullyPaid ? "payee" : "partielle",
  };
  if (isFullyPaid) updateData.paidAt = new Date();
  if (notes) updateData.notes = (facture.notes ? facture.notes + "\n" : "") + `[Paiement ${new Date().toLocaleDateString("fr-FR")}] ${notes}`;

  const [updated] = await db.update(facturesClientTable).set(updateData)
    .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId))).returning();

  const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));

  let emailSent = false;
  if (isFullyPaid && org?.autoInvoiceEnabled && org?.autoEmailInvoice && updated.clientEmail) {
    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      if (resendApiKey) {
        const resend = new Resend(resendApiKey);
        const invoiceHtml = generateInvoiceHtml(updated, org);
        await resend.emails.send({
          from: `${org.name || "Agent de Bureau"} <onboarding@resend.dev>`,
          to: updated.clientEmail,
          subject: `Facture ${updated.reference} — ${org.name || "Agent de Bureau"}`,
          html: invoiceHtml,
        });
        emailSent = true;
      }
    } catch (emailErr: any) {
      console.error("Auto-email invoice error:", emailErr.message);
    }
  }

  try {
    await db.insert(notificationsTable).values({
      userId: userId,
      organisationId: orgId,
      title: isFullyPaid ? `Facture ${updated.reference} payee` : `Paiement partiel: ${updated.reference}`,
      message: `${paymentAmount.toFixed(2)} € recu pour ${updated.clientName}. ${isFullyPaid ? "Facture entierement payee." : `Reste: ${(totalDue - newPaidAmount).toFixed(2)} €`}${emailSent ? " Facture envoyee par email." : ""}`,
      type: "info",
      priority: "moyenne",
    });
  } catch { /* notification optional */ }

  res.json({
    message: isFullyPaid
      ? `Paiement de ${paymentAmount.toFixed(2)} € enregistre. Facture entierement payee!${emailSent ? " Facture envoyee a " + updated.clientEmail + "." : ""}`
      : `Paiement partiel de ${paymentAmount.toFixed(2)} € enregistre. Reste: ${(totalDue - newPaidAmount).toFixed(2)} €`,
    facture: updated,
    emailSent,
    fullyPaid: isFullyPaid,
  });
});

router.post("/factures-client/:id/send-invoice", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [facture] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
  if (!facture) { res.status(404).json({ error: "Facture non trouvee" }); return; }
  if (!facture.clientEmail) { res.status(400).json({ error: "Le client n'a pas d'adresse email." }); return; }

  const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) { res.status(500).json({ error: "Service email non configure." }); return; }

  try {
    const resend = new Resend(resendApiKey);
    const invoiceHtml = generateInvoiceHtml(facture, org || {});
    await resend.emails.send({
      from: `${org?.name || "Agent de Bureau"} <onboarding@resend.dev>`,
      to: facture.clientEmail,
      subject: `Facture ${facture.reference} — ${org?.name || "Agent de Bureau"}`,
      html: invoiceHtml,
    });

    if (facture.status === "brouillon") {
      await db.update(facturesClientTable).set({ status: "envoyee" })
        .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    }

    res.json({ message: `Facture ${facture.reference} envoyee a ${facture.clientEmail}.`, success: true });
  } catch (err: any) {
    console.error("Send invoice email error:", err.message);
    res.status(500).json({ error: `Erreur d'envoi: ${err.message}` });
  }
});

export default router;
