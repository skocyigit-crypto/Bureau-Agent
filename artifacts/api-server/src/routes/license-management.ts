import { Router, type Request, type Response } from "express";
import { db, organisationsTable, subscriptionsTable, invoicesTable, paymentsTable, facturesClientTable, paymentRemindersTable, licenseAuditLogTable, PLANS } from "@workspace/db";
import { eq, sql, and, desc, gte, lte, lt, isNull, ne } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { Resend } from "resend";

const router = Router();

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const APP_URL = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "agentdebureau.fr"}`;

function generateEmailWrapper(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<div style="background:linear-gradient(135deg,#0f1729 0%,#1a2744 100%);padding:40px 32px;text-align:center;">
<div style="width:64px;height:64px;background:#f59e0b;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;"><span style="font-size:28px;color:#0f1729;">&#9742;</span></div>
<h1 style="color:#fff;font-size:24px;margin:0;">Agent de Bureau</h1>
<p style="color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0;">${escapeHtml(title)}</p>
</div>
<div style="padding:32px;">${body}</div>
<div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">Agent de Bureau SAS - <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a></p>
<p style="color:#94a3b8;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} Tous droits reserves</p>
</div></div></body></html>`;
}

async function sendEmailViaResend(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { console.log(`[Email] Pas de cle Resend. Email pour ${to}: ${subject}`); return false; }
    const resend = new Resend(apiKey);
    await resend.emails.send({ from: "Agent de Bureau <onboarding@resend.dev>", to: [to], subject, html });
    console.log(`[Email/Resend] Envoye a ${to}: ${subject}`);
    return true;
  } catch (err: any) {
    console.error(`[Email/Resend] Erreur:`, err.message);
    return false;
  }
}

async function logAudit(orgId: number, action: string, details: string, userId?: number, metadata?: Record<string, any>) {
  try {
    await db.insert(licenseAuditLogTable).values({ organisationId: orgId, action, details, performedBy: userId || null, metadata: metadata || null });
  } catch {}
}

router.get("/license-management/dashboard", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userRole = (req.session as any)?.userRole;
    if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces refuse" }); return; }

    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));

    const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.organisationId, orgId)).orderBy(desc(invoicesTable.createdAt)).limit(12);

    const pendingInvoices = invoices.filter(i => i.status === "en_attente");
    const paidInvoices = invoices.filter(i => i.status === "payee");
    const totalOwed = pendingInvoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0);
    const totalPaid = paidInvoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0);

    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.organisationId, orgId)).orderBy(desc(paymentsTable.createdAt)).limit(20);

    const reminders = await db.select().from(paymentRemindersTable).where(eq(paymentRemindersTable.organisationId, orgId)).orderBy(desc(paymentRemindersTable.createdAt)).limit(10);

    const clientInvoices = await db.select().from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId)).orderBy(desc(facturesClientTable.createdAt)).limit(20);

    const overdueClientInvoices = clientInvoices.filter(f => f.status !== "payee" && f.dueDate && new Date(f.dueDate) < new Date());
    const pendingClientInvoices = clientInvoices.filter(f => f.status === "envoyee");

    const totalClientOwed = clientInvoices.filter(f => f.status !== "payee" && f.status !== "brouillon")
      .reduce((s, f) => s + Number(f.totalAmount || 0) - Number(f.paidAmount || 0), 0);
    const totalClientPaid = clientInvoices.filter(f => f.status === "payee")
      .reduce((s, f) => s + Number(f.totalAmount || 0), 0);

    const now = new Date();
    const trialDaysLeft = sub?.trialEndsAt ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - now.getTime()) / 86400000)) : null;

    const securityAlerts: Array<{ type: string; severity: string; message: string }> = [];

    if (sub?.plan === "essai" && trialDaysLeft !== null && trialDaysLeft <= 3) {
      securityAlerts.push({ type: "trial_expiring", severity: "critique", message: `Periode d'essai expire dans ${trialDaysLeft} jour${trialDaysLeft > 1 ? "s" : ""}. Mettez a jour votre abonnement.` });
    }
    if (pendingInvoices.length > 0) {
      securityAlerts.push({ type: "unpaid_invoices", severity: "alerte", message: `${pendingInvoices.length} facture${pendingInvoices.length > 1 ? "s" : ""} en attente de paiement (${totalOwed.toFixed(2)} EUR)` });
    }
    if (overdueClientInvoices.length > 0) {
      securityAlerts.push({ type: "overdue_client", severity: "critique", message: `${overdueClientInvoices.length} facture${overdueClientInvoices.length > 1 ? "s" : ""} client en retard de paiement (${overdueClientInvoices.reduce((s, f) => s + Number(f.totalAmount || 0) - Number(f.paidAmount || 0), 0).toFixed(2)} EUR)` });
    }
    if (!org?.bankIban) {
      securityAlerts.push({ type: "missing_bank", severity: "info", message: "Coordonnees bancaires non configurees. Ajoutez votre IBAN pour les paiements." });
    }
    if (!org?.siret) {
      securityAlerts.push({ type: "missing_siret", severity: "info", message: "Numero SIRET manquant. Ajoutez-le pour vos factures." });
    }

    res.json({
      organisation: { id: org?.id, name: org?.name, bankIban: org?.bankIban ? `****${org.bankIban.slice(-4)}` : null, bankBic: org?.bankBic, siret: org?.siret, tvaNumber: org?.tvaNumber, autoInvoiceEnabled: org?.autoInvoiceEnabled, autoEmailInvoice: org?.autoEmailInvoice },
      subscription: sub ? { plan: sub.plan, status: sub.status, price: Number(sub.price), licenseKey: sub.licenseKey, trialEndsAt: sub.trialEndsAt, currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd, trialDaysLeft, aiEnabled: sub.aiEnabled, stockEnabled: sub.stockEnabled, automationEnabled: sub.automationEnabled, maxUsers: sub.maxUsers, maxContacts: sub.maxContacts, maxCallsPerMonth: sub.maxCallsPerMonth } : null,
      billing: { totalOwed, totalPaid, pendingCount: pendingInvoices.length, paidCount: paidInvoices.length, invoices: invoices.map(i => ({ ...i, totalAmount: Number(i.totalAmount), baseAmount: Number(i.baseAmount), overageAmount: Number(i.overageAmount) })) },
      clientBilling: { totalClientOwed, totalClientPaid, overdueCount: overdueClientInvoices.length, pendingCount: pendingClientInvoices.length, recentInvoices: clientInvoices.slice(0, 10).map(f => ({ id: f.id, reference: f.reference, clientName: f.clientName, clientEmail: f.clientEmail, totalAmount: Number(f.totalAmount), paidAmount: Number(f.paidAmount), status: f.status, dueDate: f.dueDate, createdAt: f.createdAt })) },
      payments: payments.map(p => ({ ...p, amount: Number(p.amount), matchConfidence: p.matchConfidence ? Number(p.matchConfidence) : null })),
      reminders: reminders.map(r => ({ ...r })),
      securityAlerts,
    });
  } catch (err: any) {
    console.error("Erreur license dashboard:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

router.post("/license-management/send-payment-reminder", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
    const { factureClientId, customMessage } = req.body;

    if (!factureClientId) { res.status(400).json({ error: "factureClientId requis" }); return; }

    const [facture] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, factureClientId), eq(facturesClientTable.organisationId, orgId)));
    if (!facture) { res.status(404).json({ error: "Facture introuvable" }); return; }
    if (!facture.clientEmail) { res.status(400).json({ error: "Aucun email client" }); return; }

    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));

    const remaining = Number(facture.totalAmount) - Number(facture.paidAmount);
    const isOverdue = facture.dueDate && new Date(facture.dueDate) < new Date();

    const previousReminders = await db.select({ c: sql<number>`count(*)::int` }).from(paymentRemindersTable).where(and(eq(paymentRemindersTable.factureClientId, factureClientId), eq(paymentRemindersTable.status, "sent")));
    const reminderLevel = (previousReminders[0]?.c || 0) + 1;

    const levelLabels: Record<number, string> = { 1: "Premier rappel", 2: "Deuxieme rappel", 3: "Dernier rappel avant suspension", 4: "Mise en demeure" };
    const levelLabel = levelLabels[Math.min(reminderLevel, 4)] || `Rappel n°${reminderLevel}`;

    const subject = `${levelLabel} - Facture ${facture.reference} - ${remaining.toFixed(2)} EUR`;

    const urgencyColor = reminderLevel >= 3 ? "#dc2626" : reminderLevel >= 2 ? "#ea580c" : "#f59e0b";
    const urgencyBg = reminderLevel >= 3 ? "#fef2f2" : reminderLevel >= 2 ? "#fff7ed" : "#fffbeb";

    const body = `
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">${levelLabel} de paiement</h2>
      <p style="color:#64748b;font-size:15px;line-height:1.6;">
        Bonjour ${escapeHtml(facture.clientName)},
      </p>
      ${customMessage ? `<p style="color:#64748b;font-size:14px;line-height:1.6;">${escapeHtml(customMessage)}</p>` : ""}
      <div style="background:${urgencyBg};border:2px solid ${urgencyColor};border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:${urgencyColor};font-size:16px;margin:0 0 16px;">Facture ${escapeHtml(facture.reference)}</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:180px;">Montant total</td><td style="padding:8px 0;font-weight:700;font-size:16px;">${Number(facture.totalAmount).toFixed(2)} EUR</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Deja paye</td><td style="padding:8px 0;color:#22c55e;font-weight:600;">${Number(facture.paidAmount).toFixed(2)} EUR</td></tr>
          <tr><td style="padding:8px 0;color:${urgencyColor};font-size:13px;font-weight:700;">Reste a payer</td><td style="padding:8px 0;color:${urgencyColor};font-weight:700;font-size:18px;">${remaining.toFixed(2)} EUR</td></tr>
          ${facture.dueDate ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Date d'echeance</td><td style="padding:8px 0;font-weight:600;${isOverdue ? "color:" + urgencyColor : ""}">${new Date(facture.dueDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${isOverdue ? " (EN RETARD)" : ""}</td></tr>` : ""}
        </table>
      </div>
      ${org?.bankIban ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="color:#166534;font-size:16px;margin:0 0 16px;">Coordonnees bancaires pour le virement</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#166534;font-size:13px;width:120px;">Beneficiaire</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(org.name)}</td></tr>
          <tr><td style="padding:6px 0;color:#166534;font-size:13px;">IBAN</td><td style="padding:6px 0;font-family:monospace;font-weight:600;">${escapeHtml(org.bankIban)}</td></tr>
          ${org.bankBic ? `<tr><td style="padding:6px 0;color:#166534;font-size:13px;">BIC</td><td style="padding:6px 0;font-family:monospace;font-weight:600;">${escapeHtml(org.bankBic)}</td></tr>` : ""}
          <tr><td style="padding:6px 0;color:#166534;font-size:13px;">Reference</td><td style="padding:6px 0;font-family:monospace;font-weight:700;color:#0f1729;">${escapeHtml(facture.reference)}</td></tr>
        </table>
        <p style="color:#166534;font-size:11px;margin:12px 0 0;font-style:italic;">Merci d'indiquer la reference ${escapeHtml(facture.reference)} dans le libelle du virement.</p>
      </div>` : ""}
      ${reminderLevel >= 3 ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin:24px 0;">
        <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600;">
          Attention : En cas de non-paiement dans les 7 jours, nous serons contraints de suspendre les services associes a votre compte.
        </p>
      </div>` : ""}
      <p style="color:#64748b;font-size:13px;line-height:1.6;">
        Si vous avez deja effectue le paiement, veuillez ne pas tenir compte de ce message.
        Pour toute question, n'hesitez pas a nous contacter.
      </p>
      <p style="color:#64748b;font-size:13px;">Cordialement,<br><strong>${escapeHtml(org?.name || "Agent de Bureau")}</strong></p>`;

    const html = generateEmailWrapper("Rappel de paiement", body);
    const sent = await sendEmailViaResend(facture.clientEmail, subject, html);

    await db.insert(paymentRemindersTable).values({
      organisationId: orgId,
      factureClientId: facture.id,
      type: "payment_due",
      recipientEmail: facture.clientEmail,
      recipientName: facture.clientName,
      subject,
      content: customMessage || null,
      status: sent ? "sent" : "failed",
      sentAt: sent ? new Date() : null,
      reminderLevel,
      error: sent ? null : "Echec envoi email",
    });

    await logAudit(orgId, "payment_reminder_sent", `Rappel niveau ${reminderLevel} envoye pour facture ${facture.reference} a ${facture.clientEmail}`, userId, { factureId: facture.id, reminderLevel, amount: remaining });

    res.json({ success: sent, reminderLevel, message: sent ? `Rappel de paiement envoye a ${facture.clientEmail}` : "Echec de l'envoi du rappel" });
  } catch (err: any) {
    console.error("Erreur envoi rappel:", err);
    res.status(500).json({ error: "Erreur envoi rappel" });
  }
});

router.post("/license-management/auto-generate-invoice", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userId = (req.session as any)?.userId;
    const userRole = (req.session as any)?.userRole;
    if (userRole !== "super_admin") { res.status(403).json({ error: "Super admin requis" }); return; }

    const { targetOrgId } = req.body;
    const tgtOrg = targetOrgId || orgId;

    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, tgtOrg));
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organisationId, tgtOrg));

    if (!org || !sub) { res.status(404).json({ error: "Organisation ou abonnement introuvable" }); return; }

    const now = new Date();
    const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const existing = await db.select().from(invoicesTable).where(and(eq(invoicesTable.organisationId, tgtOrg), eq(invoicesTable.periodLabel, monthLabel)));
    if (existing.length > 0) { res.status(400).json({ error: `Facture deja generee pour ${monthLabel}` }); return; }

    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const baseAmount = Number(sub.price);
    const plan = sub.plan as keyof typeof PLANS;
    const planConfig = PLANS[plan];

    const [userCount] = await db.select({ c: sql<number>`count(*)::int` }).from(sql`users`).where(sql`organisation_id = ${tgtOrg} AND actif = true`);
    const [contactCount] = await db.select({ c: sql<number>`count(*)::int` }).from(sql`contacts`).where(sql`organisation_id = ${tgtOrg}`);
    const [callCount] = await db.select({ c: sql<number>`count(*)::int` }).from(sql`calls`).where(sql`organisation_id = ${tgtOrg} AND created_at >= ${periodStart}`);

    const extraUsers = Math.max(0, (userCount?.c || 0) - (planConfig?.maxUsers || sub.maxUsers));
    const extraContacts = Math.max(0, (contactCount?.c || 0) - (planConfig?.maxContacts || sub.maxContacts));
    const extraCalls = Math.max(0, (callCount?.c || 0) - (planConfig?.maxCallsPerMonth || sub.maxCallsPerMonth));

    const extraUsersAmount = extraUsers * 10;
    const extraContactsAmount = Math.ceil(extraContacts / 100) * 2;
    const extraCallsAmount = Math.ceil(extraCalls / 100) * 3;
    const overageAmount = extraUsersAmount + extraContactsAmount + extraCallsAmount;
    const totalAmount = baseAmount + overageAmount;

    const [invoice] = await db.insert(invoicesTable).values({
      organisationId: tgtOrg,
      periodLabel: monthLabel,
      periodStart,
      periodEnd,
      plan: sub.plan,
      baseAmount: baseAmount.toFixed(2),
      overageAmount: overageAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      status: "en_attente",
      usageSnapshot: {
        users: { current: userCount?.c || 0, max: planConfig?.maxUsers || sub.maxUsers, overage: extraUsers },
        contacts: { current: contactCount?.c || 0, max: planConfig?.maxContacts || sub.maxContacts, overage: extraContacts },
        calls: { current: callCount?.c || 0, max: planConfig?.maxCallsPerMonth || sub.maxCallsPerMonth, overage: extraCalls },
        overageDetails: { extraUsers, extraUsersAmount, extraContacts, extraContactsAmount, extraCalls, extraCallsAmount },
      },
    }).returning();

    if (org.autoEmailInvoice && org.email) {
      const invoiceBody = `
        <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Facture mensuelle - ${monthLabel}</h2>
        <p style="color:#64748b;font-size:15px;">Bonjour,</p>
        <p style="color:#64748b;font-size:14px;">Votre facture Agent de Bureau pour la periode du ${periodStart.toLocaleDateString("fr-FR")} au ${periodEnd.toLocaleDateString("fr-FR")} a ete generee.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin:24px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Plan ${escapeHtml(sub.plan)}</td><td style="padding:10px 0;text-align:right;font-weight:600;border-bottom:1px solid #e2e8f0;">${baseAmount.toFixed(2)} EUR</td></tr>
            ${overageAmount > 0 ? `<tr><td style="padding:10px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;">Depassements</td><td style="padding:10px 0;text-align:right;font-weight:600;color:#ea580c;border-bottom:1px solid #e2e8f0;">+${overageAmount.toFixed(2)} EUR</td></tr>` : ""}
            ${extraUsers > 0 ? `<tr><td style="padding:6px 0 6px 20px;color:#94a3b8;font-size:11px;">${extraUsers} utilisateur${extraUsers > 1 ? "s" : ""} supplementaire${extraUsers > 1 ? "s" : ""}</td><td style="padding:6px 0;text-align:right;color:#94a3b8;font-size:11px;">${extraUsersAmount.toFixed(2)} EUR</td></tr>` : ""}
            ${extraContacts > 0 ? `<tr><td style="padding:6px 0 6px 20px;color:#94a3b8;font-size:11px;">${extraContacts} contacts supplementaires</td><td style="padding:6px 0;text-align:right;color:#94a3b8;font-size:11px;">${extraContactsAmount.toFixed(2)} EUR</td></tr>` : ""}
            ${extraCalls > 0 ? `<tr><td style="padding:6px 0 6px 20px;color:#94a3b8;font-size:11px;">${extraCalls} appels supplementaires</td><td style="padding:6px 0;text-align:right;color:#94a3b8;font-size:11px;">${extraCallsAmount.toFixed(2)} EUR</td></tr>` : ""}
            <tr><td style="padding:12px 0;font-size:16px;font-weight:700;color:#0f1729;">TOTAL</td><td style="padding:12px 0;text-align:right;font-size:18px;font-weight:700;color:#0f1729;">${totalAmount.toFixed(2)} EUR</td></tr>
          </table>
        </div>
        ${org.bankIban ? `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:24px 0;">
          <h3 style="color:#166534;font-size:14px;margin:0 0 12px;">Paiement par virement</h3>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:4px 0;color:#166534;font-size:12px;width:80px;">IBAN</td><td style="font-family:monospace;font-size:12px;">${escapeHtml(org.bankIban)}</td></tr>
            ${org.bankBic ? `<tr><td style="padding:4px 0;color:#166534;font-size:12px;">BIC</td><td style="font-family:monospace;font-size:12px;">${escapeHtml(org.bankBic)}</td></tr>` : ""}
            <tr><td style="padding:4px 0;color:#166534;font-size:12px;">Reference</td><td style="font-family:monospace;font-weight:700;font-size:12px;">INV-${monthLabel}-${tgtOrg}</td></tr>
          </table>
        </div>` : ""}
        <div style="text-align:center;margin:24px 0;">
          <a href="${APP_URL}" style="display:inline-block;background:#0f1729;color:#fff;text-decoration:none;padding:14px 48px;border-radius:10px;font-size:15px;font-weight:600;">Voir dans Agent de Bureau</a>
        </div>`;

      const html = generateEmailWrapper(`Facture ${monthLabel}`, invoiceBody);
      await sendEmailViaResend(org.email, `Facture Agent de Bureau - ${monthLabel} - ${totalAmount.toFixed(2)} EUR`, html);
    }

    await logAudit(orgId, "invoice_generated", `Facture ${monthLabel} generee: ${totalAmount.toFixed(2)} EUR`, userId, { invoiceId: invoice.id, amount: totalAmount });

    res.json({ success: true, invoice: { ...invoice, totalAmount: Number(invoice.totalAmount), baseAmount: Number(invoice.baseAmount), overageAmount: Number(invoice.overageAmount) } });
  } catch (err: any) {
    console.error("Erreur generation facture:", err);
    res.status(500).json({ error: "Erreur generation facture" });
  }
});

router.post("/license-management/send-invoice-email", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { factureClientId } = req.body;

    if (!factureClientId) { res.status(400).json({ error: "factureClientId requis" }); return; }

    const [facture] = await db.select().from(facturesClientTable).where(and(eq(facturesClientTable.id, factureClientId), eq(facturesClientTable.organisationId, orgId)));
    if (!facture) { res.status(404).json({ error: "Facture introuvable" }); return; }
    if (!facture.clientEmail) { res.status(400).json({ error: "Pas d'email client" }); return; }

    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));

    const items = (facture.items || []) as Array<{ description: string; quantity: number; unitPrice: number; taxRate: number; total: number }>;
    const itemRows = items.map(item => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px;">${escapeHtml(item.description)}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:13px;">${item.quantity}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;">${item.unitPrice.toFixed(2)} EUR</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;">${item.taxRate}%</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;font-size:13px;">${item.total.toFixed(2)} EUR</td>
      </tr>
    `).join("");

    const body = `
      <h2 style="color:#0f1729;font-size:20px;margin:0 0 8px;">Facture ${escapeHtml(facture.reference)}</h2>
      <p style="color:#64748b;font-size:14px;">Bonjour ${escapeHtml(facture.clientName)},</p>
      <p style="color:#64748b;font-size:14px;">Veuillez trouver ci-dessous le detail de votre facture.</p>
      <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:24px 0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#64748b;font-size:12px;">Reference</td><td style="font-weight:600;">${escapeHtml(facture.reference)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:12px;">Date</td><td>${new Date(facture.createdAt).toLocaleDateString("fr-FR")}</td></tr>
          ${facture.dueDate ? `<tr><td style="padding:6px 0;color:#64748b;font-size:12px;">Echeance</td><td style="font-weight:600;">${new Date(facture.dueDate).toLocaleDateString("fr-FR")}</td></tr>` : ""}
        </table>
      </div>
      ${items.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;margin:24px 0;">
        <thead><tr style="background:#f1f5f9;">
          <th style="padding:10px;text-align:left;font-size:12px;color:#64748b;">Description</th>
          <th style="padding:10px;text-align:center;font-size:12px;color:#64748b;">Qte</th>
          <th style="padding:10px;text-align:right;font-size:12px;color:#64748b;">Prix HT</th>
          <th style="padding:10px;text-align:right;font-size:12px;color:#64748b;">TVA</th>
          <th style="padding:10px;text-align:right;font-size:12px;color:#64748b;">Total</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr><td colspan="4" style="padding:10px;text-align:right;font-size:13px;color:#64748b;">Sous-total HT</td><td style="padding:10px;text-align:right;font-weight:600;">${Number(facture.subtotal).toFixed(2)} EUR</td></tr>
          <tr><td colspan="4" style="padding:10px;text-align:right;font-size:13px;color:#64748b;">TVA</td><td style="padding:10px;text-align:right;font-weight:600;">${Number(facture.taxAmount).toFixed(2)} EUR</td></tr>
          <tr style="background:#0f1729;"><td colspan="4" style="padding:12px;text-align:right;color:#fff;font-weight:700;">TOTAL TTC</td><td style="padding:12px;text-align:right;color:#f59e0b;font-weight:700;font-size:16px;">${Number(facture.totalAmount).toFixed(2)} EUR</td></tr>
        </tfoot>
      </table>` : ""}
      ${org?.bankIban ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:24px 0;">
        <h3 style="color:#166534;font-size:14px;margin:0 0 12px;">Paiement par virement bancaire</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:4px 0;color:#166534;font-size:12px;width:100px;">Beneficiaire</td><td style="font-size:12px;">${escapeHtml(org.name)}</td></tr>
          <tr><td style="padding:4px 0;color:#166534;font-size:12px;">IBAN</td><td style="font-family:monospace;font-size:12px;font-weight:600;">${escapeHtml(org.bankIban)}</td></tr>
          ${org.bankBic ? `<tr><td style="padding:4px 0;color:#166534;font-size:12px;">BIC</td><td style="font-family:monospace;font-size:12px;">${escapeHtml(org.bankBic)}</td></tr>` : ""}
          <tr><td style="padding:4px 0;color:#166534;font-size:12px;">Reference</td><td style="font-family:monospace;font-weight:700;">${escapeHtml(facture.reference)}</td></tr>
        </table>
      </div>` : ""}
      ${facture.conditions ? `<p style="color:#94a3b8;font-size:11px;margin-top:20px;line-height:1.6;">${escapeHtml(facture.conditions)}</p>` : ""}
      ${org?.invoiceFooter ? `<p style="color:#94a3b8;font-size:10px;margin-top:16px;line-height:1.4;">${escapeHtml(org.invoiceFooter)}</p>` : ""}`;

    const html = generateEmailWrapper(`Facture ${facture.reference}`, body);
    const sent = await sendEmailViaResend(facture.clientEmail, `Facture ${facture.reference} - ${Number(facture.totalAmount).toFixed(2)} EUR - ${org?.name || "Agent de Bureau"}`, html);

    if (sent && facture.status === "brouillon") {
      await db.update(facturesClientTable).set({ status: "envoyee" }).where(eq(facturesClientTable.id, facture.id));
    }

    await logAudit(orgId, "invoice_email_sent", `Facture ${facture.reference} envoyee a ${facture.clientEmail}`, (req.session as any)?.userId);

    res.json({ success: sent, message: sent ? `Facture envoyee a ${facture.clientEmail}` : "Echec de l'envoi" });
  } catch (err: any) {
    console.error("Erreur envoi facture:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

router.post("/license-management/auto-reminders", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userRole = (req.session as any)?.userRole;
    if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces refuse" }); return; }

    const now = new Date();
    const overdueInvoices = await db.select().from(facturesClientTable).where(and(
      eq(facturesClientTable.organisationId, orgId),
      ne(facturesClientTable.status, "payee"),
      ne(facturesClientTable.status, "brouillon"),
      lt(facturesClientTable.dueDate, now),
    ));

    let sent = 0;
    let skipped = 0;

    for (const facture of overdueInvoices) {
      if (!facture.clientEmail) { skipped++; continue; }

      const recentReminder = await db.select().from(paymentRemindersTable).where(and(
        eq(paymentRemindersTable.factureClientId, facture.id),
        eq(paymentRemindersTable.status, "sent"),
        gte(paymentRemindersTable.sentAt, new Date(now.getTime() - 7 * 86400000)),
      )).limit(1);

      if (recentReminder.length > 0) { skipped++; continue; }

      const prevCount = await db.select({ c: sql<number>`count(*)::int` }).from(paymentRemindersTable).where(and(eq(paymentRemindersTable.factureClientId, facture.id), eq(paymentRemindersTable.status, "sent")));
      const level = (prevCount[0]?.c || 0) + 1;

      const remaining = Number(facture.totalAmount) - Number(facture.paidAmount);
      const daysOverdue = Math.ceil((now.getTime() - new Date(facture.dueDate!).getTime()) / 86400000);

      const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
      const levelLabels: Record<number, string> = { 1: "Rappel de paiement", 2: "Deuxieme rappel", 3: "Dernier rappel" };
      const subject = `${levelLabels[Math.min(level, 3)] || `Rappel n°${level}`} - Facture ${facture.reference} en retard de ${daysOverdue} jours`;

      const body = `
        <h2 style="color:#dc2626;font-size:18px;">${levelLabels[Math.min(level, 3)] || `Rappel n°${level}`}</h2>
        <p style="color:#64748b;font-size:14px;">Bonjour ${escapeHtml(facture.clientName)},</p>
        <p style="color:#64748b;font-size:14px;">La facture <strong>${escapeHtml(facture.reference)}</strong> d'un montant de <strong>${remaining.toFixed(2)} EUR</strong> est en retard de <strong>${daysOverdue} jour${daysOverdue > 1 ? "s" : ""}</strong>.</p>
        <div style="background:#fef2f2;border:2px solid #dc2626;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#dc2626;">${remaining.toFixed(2)} EUR</div>
          <div style="font-size:12px;color:#dc2626;margin-top:4px;">a regler dans les meilleurs delais</div>
        </div>
        ${org?.bankIban ? `<p style="color:#64748b;font-size:13px;">Virement : IBAN <strong>${escapeHtml(org.bankIban)}</strong> - Reference: <strong>${escapeHtml(facture.reference)}</strong></p>` : ""}
        <p style="color:#64748b;font-size:13px;">Cordialement,<br><strong>${escapeHtml(org?.name || "Agent de Bureau")}</strong></p>`;

      const html = generateEmailWrapper("Rappel automatique", body);
      const emailSent = await sendEmailViaResend(facture.clientEmail, subject, html);

      await db.insert(paymentRemindersTable).values({
        organisationId: orgId, factureClientId: facture.id, type: "auto_reminder",
        recipientEmail: facture.clientEmail, recipientName: facture.clientName, subject,
        status: emailSent ? "sent" : "failed", sentAt: emailSent ? new Date() : null, reminderLevel: level,
        metadata: { daysOverdue, amount: remaining },
      });

      if (emailSent) sent++;
    }

    await logAudit(orgId, "auto_reminders_run", `${sent} rappels envoyes, ${skipped} ignores sur ${overdueInvoices.length} factures en retard`, (req.session as any)?.userId);

    res.json({ success: true, total: overdueInvoices.length, sent, skipped });
  } catch (err: any) {
    console.error("Erreur auto-reminders:", err);
    res.status(500).json({ error: "Erreur" });
  }
});

router.get("/license-management/audit-log", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const logs = await db.select().from(licenseAuditLogTable).where(eq(licenseAuditLogTable.organisationId, orgId)).orderBy(desc(licenseAuditLogTable.createdAt)).limit(50);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur" });
  }
});

router.post("/license-management/update-billing-settings", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const userRole = (req.session as any)?.userRole;
    if (userRole !== "super_admin" && userRole !== "administrateur") { res.status(403).json({ error: "Acces refuse" }); return; }

    const { bankName, bankIban, bankBic, siret, tvaNumber, legalForm, capital, invoiceFooter, autoInvoiceEnabled, autoEmailInvoice } = req.body;

    const updateData: Record<string, any> = {};
    if (bankName !== undefined) updateData.bankName = bankName;
    if (bankIban !== undefined) updateData.bankIban = bankIban;
    if (bankBic !== undefined) updateData.bankBic = bankBic;
    if (siret !== undefined) updateData.siret = siret;
    if (tvaNumber !== undefined) updateData.tvaNumber = tvaNumber;
    if (legalForm !== undefined) updateData.legalForm = legalForm;
    if (capital !== undefined) updateData.capital = capital;
    if (invoiceFooter !== undefined) updateData.invoiceFooter = invoiceFooter;
    if (autoInvoiceEnabled !== undefined) updateData.autoInvoiceEnabled = autoInvoiceEnabled;
    if (autoEmailInvoice !== undefined) updateData.autoEmailInvoice = autoEmailInvoice;

    if (Object.keys(updateData).length === 0) { res.status(400).json({ error: "Aucune donnee a mettre a jour" }); return; }

    await db.update(organisationsTable).set(updateData).where(eq(organisationsTable.id, orgId));
    await logAudit(orgId, "billing_settings_updated", `Parametres de facturation mis a jour: ${Object.keys(updateData).join(", ")}`, (req.session as any)?.userId);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Erreur" });
  }
});

export default router;
