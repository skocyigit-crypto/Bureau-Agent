import { Router, type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, invoicesTable, paymentsTable, organisationsTable } from "@workspace/db";
import { generateMonthlyInvoices, getOrgBillingSummary } from "../services/billing-engine";

const router = Router();

function requireSuperAdmin(req: Request, res: Response, next: () => void): void {
  const userRole = (req.session as any)?.userRole;
  if (userRole !== "super_admin") {
    res.status(403).json({ error: "Acces reserve au super administrateur." });
    return;
  }
  next();
}

router.use(requireSuperAdmin);

router.get("/billing/invoices", async (_req: Request, res: Response): Promise<void> => {
  const invoices = await db.select({
    invoice: invoicesTable,
    orgName: organisationsTable.name,
  })
    .from(invoicesTable)
    .leftJoin(organisationsTable, eq(invoicesTable.organisationId, organisationsTable.id))
    .orderBy(desc(invoicesTable.createdAt))
    .limit(200);

  res.json({
    invoices: invoices.map(r => ({
      ...r.invoice,
      organisationName: r.orgName,
    })),
  });
});

router.get("/billing/invoices/:orgId", async (req: Request, res: Response): Promise<void> => {
  const orgId = parseInt(req.params.orgId);
  if (isNaN(orgId)) { res.status(400).json({ error: "ID invalide." }); return; }

  const summary = await getOrgBillingSummary(orgId);
  res.json(summary);
});

router.post("/billing/generate", async (req: Request, res: Response): Promise<void> => {
  const { year, month } = req.body;

  const now = new Date();
  const targetYear = year || now.getFullYear();
  const targetMonth = month || now.getMonth();

  if (targetMonth < 1 || targetMonth > 12) {
    res.status(400).json({ error: "Mois invalide (1-12)." });
    return;
  }

  try {
    const result = await generateMonthlyInvoices(targetYear, targetMonth);
    res.json({
      message: `Facturation terminee: ${result.generated} facture(s) generee(s), ${result.skipped} ignoree(s), ${result.errors} erreur(s).`,
      ...result,
    });
  } catch (err: any) {
    console.error("[Billing] Erreur generation:", err);
    res.status(500).json({ error: "Erreur lors de la generation des factures." });
  }
});

router.patch("/billing/invoices/:id/status", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { status, notes } = req.body;
  const validStatuses = ["en_attente", "payee", "partiel", "annulee", "retard"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: "Statut invalide.", validStatuses });
    return;
  }

  const updateData: Record<string, any> = { status };
  if (status === "payee") updateData.paidAt = new Date();
  if (notes !== undefined) updateData.notes = notes;

  const [updated] = await db.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Facture introuvable." }); return; }

  res.json({ message: "Statut mis a jour.", invoice: updated });
});

router.post("/billing/upload-bank", async (req: Request, res: Response): Promise<void> => {
  const { lines } = req.body;

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "Aucune ligne de releve fournie." });
    return;
  }

  const inserted: any[] = [];
  for (const line of lines) {
    try {
      const [payment] = await db.insert(paymentsTable).values({
        amount: String(line.amount || 0),
        currency: line.currency || "EUR",
        source: "bank_upload",
        bankRef: line.ref || line.reference || null,
        bankDate: line.date ? new Date(line.date) : null,
        payerName: line.payerName || line.payer || null,
        payerIban: line.iban || null,
        status: "pending",
        rawLine: JSON.stringify(line),
      }).returning();
      inserted.push(payment);
    } catch (err: any) {
      console.error("[Billing] Erreur import ligne:", err.message);
    }
  }

  res.json({
    message: `${inserted.length} paiement(s) importe(s) sur ${lines.length} ligne(s).`,
    payments: inserted,
  });
});

router.post("/billing/match-payments", async (req: Request, res: Response): Promise<void> => {
  const pendingPayments = await db.select()
    .from(paymentsTable)
    .where(eq(paymentsTable.status, "pending"))
    .orderBy(desc(paymentsTable.createdAt));

  if (pendingPayments.length === 0) {
    res.json({ message: "Aucun paiement en attente a rapprocher.", matched: 0 });
    return;
  }

  const pendingInvoices = await db.select({
    invoice: invoicesTable,
    orgName: organisationsTable.name,
    orgEmail: organisationsTable.email,
  })
    .from(invoicesTable)
    .leftJoin(organisationsTable, eq(invoicesTable.organisationId, organisationsTable.id))
    .where(sql`${invoicesTable.status} IN ('en_attente', 'retard')`)
    .orderBy(desc(invoicesTable.createdAt));

  if (pendingInvoices.length === 0) {
    res.json({ message: "Aucune facture en attente.", matched: 0 });
    return;
  }

  let matched = 0;
  const matchedInvoiceIds = new Set<number>();

  for (const payment of pendingPayments) {
    let bestMatch: { invoiceId: number; orgId: number; confidence: number } | null = null;

    for (const inv of pendingInvoices) {
      if (matchedInvoiceIds.has(inv.invoice.id)) continue;

      let confidence = 0;
      const invoiceTotal = Number(inv.invoice.totalAmount);
      const paymentAmount = Number(payment.amount);

      if (Math.abs(invoiceTotal - paymentAmount) < 0.01) {
        confidence += 50;
      } else if (Math.abs(invoiceTotal - paymentAmount) < 1) {
        confidence += 30;
      }

      const payerName = (payment.payerName || "").toLowerCase();
      const orgName = (inv.orgName || "").toLowerCase();
      if (payerName && orgName && (payerName.includes(orgName) || orgName.includes(payerName))) {
        confidence += 40;
      }

      const bankRef = (payment.bankRef || "").toLowerCase();
      const periodLabel = inv.invoice.periodLabel || "";
      if (bankRef && (bankRef.includes(periodLabel) || bankRef.includes(orgName))) {
        confidence += 10;
      }

      if (confidence > (bestMatch?.confidence || 0) && confidence >= 50) {
        bestMatch = { invoiceId: inv.invoice.id, orgId: inv.invoice.organisationId, confidence };
      }
    }

    if (bestMatch) {
      matchedInvoiceIds.add(bestMatch.invoiceId);

      await db.update(paymentsTable).set({
        invoiceId: bestMatch.invoiceId,
        organisationId: bestMatch.orgId,
        matchedBy: "auto",
        matchConfidence: String(bestMatch.confidence),
        status: "matched",
      }).where(eq(paymentsTable.id, payment.id));

      if (bestMatch.confidence >= 80) {
        await db.update(invoicesTable).set({
          status: "payee",
          paidAt: new Date(),
        }).where(eq(invoicesTable.id, bestMatch.invoiceId));
      }

      matched++;
    }
  }

  res.json({
    message: `Rapprochement termine: ${matched} paiement(s) rapproche(s) sur ${pendingPayments.length}.`,
    matched,
    total: pendingPayments.length,
  });
});

router.get("/billing/payments", async (_req: Request, res: Response): Promise<void> => {
  const payments = await db.select({
    payment: paymentsTable,
    orgName: organisationsTable.name,
  })
    .from(paymentsTable)
    .leftJoin(organisationsTable, eq(paymentsTable.organisationId, organisationsTable.id))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(200);

  res.json({
    payments: payments.map(r => ({
      ...r.payment,
      organisationName: r.orgName,
    })),
  });
});

router.post("/billing/payments/:id/assign", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { invoiceId } = req.body;
  if (!invoiceId) { res.status(400).json({ error: "invoiceId requis." }); return; }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) { res.status(404).json({ error: "Facture introuvable." }); return; }

  await db.update(paymentsTable).set({
    invoiceId,
    organisationId: invoice.organisationId,
    matchedBy: "manual",
    matchConfidence: "100",
    status: "matched",
  }).where(eq(paymentsTable.id, id));

  await db.update(invoicesTable).set({
    status: "payee",
    paidAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));

  res.json({ message: "Paiement affecte et facture marquee comme payee." });
});

router.get("/billing/summary", async (_req: Request, res: Response): Promise<void> => {
  const [totalDue] = await db.select({
    total: sql<string>`COALESCE(SUM(total_amount), 0)::text`,
    count: sql<number>`count(*)::int`,
  }).from(invoicesTable).where(sql`${invoicesTable.status} IN ('en_attente', 'retard', 'partiel')`);

  const [totalPaid] = await db.select({
    total: sql<string>`COALESCE(SUM(total_amount), 0)::text`,
    count: sql<number>`count(*)::int`,
  }).from(invoicesTable).where(eq(invoicesTable.status, "payee"));

  const [overdue] = await db.select({
    total: sql<string>`COALESCE(SUM(total_amount), 0)::text`,
    count: sql<number>`count(*)::int`,
  }).from(invoicesTable).where(eq(invoicesTable.status, "retard"));

  const [pendingPayments] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(paymentsTable).where(eq(paymentsTable.status, "pending"));

  res.json({
    totalDue: totalDue?.total || "0",
    totalDueCount: totalDue?.count || 0,
    totalPaid: totalPaid?.total || "0",
    totalPaidCount: totalPaid?.count || 0,
    overdue: overdue?.total || "0",
    overdueCount: overdue?.count || 0,
    pendingPayments: pendingPayments?.count || 0,
  });
});

export default router;
