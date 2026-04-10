import { Router, type IRouter } from "express";
import { eq, desc, and, sql, asc, ilike, or, lt } from "drizzle-orm";
import { db, compteClientTable, facturesClientTable, contactsTable, organisationsTable, notificationsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { Resend } from "resend";

const router: IRouter = Router();

function calculateHealthScore(data: {
  nbFactures: number; nbFacturesPayees: number; nbFacturesEnRetard: number;
  totalFacture: number; totalPaye: number; delaiMoyen: number; paymentTermDays: number;
}): { score: number; risk: string } {
  let score = 100;
  if (data.nbFactures === 0) return { score: 100, risk: "faible" };
  const paymentRate = data.nbFactures > 0 ? data.nbFacturesPayees / data.nbFactures : 1;
  score -= Math.round((1 - paymentRate) * 30);
  if (data.nbFacturesEnRetard > 0) score -= Math.min(data.nbFacturesEnRetard * 10, 30);
  if (data.delaiMoyen > data.paymentTermDays) {
    const overDays = data.delaiMoyen - data.paymentTermDays;
    score -= Math.min(Math.round(overDays / 5) * 5, 20);
  }
  const unpaidRatio = data.totalFacture > 0 ? (data.totalFacture - data.totalPaye) / data.totalFacture : 0;
  if (unpaidRatio > 0.5) score -= 10;
  if (unpaidRatio > 0.8) score -= 10;
  score = Math.max(0, Math.min(100, score));
  let risk = "faible";
  if (score < 30) risk = "critique";
  else if (score < 50) risk = "eleve";
  else if (score < 70) risk = "moyen";
  return { score, risk };
}

function calculateAging(factures: any[]): { a0to30: number; a31to60: number; a61to90: number; a90plus: number } {
  const now = Date.now();
  let a0to30 = 0, a31to60 = 0, a61to90 = 0, a90plus = 0;
  for (const f of factures) {
    if (f.status === "payee" || f.status === "brouillon") continue;
    const unpaid = Number(f.totalAmount) - Number(f.paidAmount);
    if (unpaid <= 0) continue;
    const due = f.dueDate ? new Date(f.dueDate).getTime() : new Date(f.createdAt).getTime() + 30 * 86400000;
    const daysOverdue = Math.max(0, Math.floor((now - due) / 86400000));
    if (daysOverdue <= 30) a0to30 += unpaid;
    else if (daysOverdue <= 60) a31to60 += unpaid;
    else if (daysOverdue <= 90) a61to90 += unpaid;
    else a90plus += unpaid;
  }
  return { a0to30, a31to60, a61to90, a90plus };
}

async function syncAccountForContact(orgId: number, contactId: number): Promise<any> {
  const [contact] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId)));
  if (!contact) return null;

  const factures = await db.select().from(facturesClientTable).where(and(
    eq(facturesClientTable.organisationId, orgId),
    eq(facturesClientTable.contactId, contactId)
  ));

  const now = new Date();
  const totalFacture = factures.reduce((s, f) => s + Number(f.totalAmount), 0);
  const totalPaye = factures.reduce((s, f) => s + Number(f.paidAmount), 0);
  const nbFactures = factures.length;
  const nbFacturesPayees = factures.filter(f => f.status === "payee").length;
  const nbFacturesEnRetard = factures.filter(f => (f.status === "envoyee" || f.status === "partielle") && f.dueDate && new Date(f.dueDate) < now).length;
  const montantEnRetard = factures.filter(f => (f.status === "envoyee" || f.status === "partielle") && f.dueDate && new Date(f.dueDate) < now)
    .reduce((s, f) => s + Number(f.totalAmount) - Number(f.paidAmount), 0);

  const paidFactures = factures.filter(f => f.status === "payee" && f.paidAt && f.createdAt);
  const delaiMoyen = paidFactures.length > 0
    ? Math.round(paidFactures.reduce((s, f) => s + (new Date(f.paidAt!).getTime() - new Date(f.createdAt).getTime()) / 86400000, 0) / paidFactures.length)
    : 0;

  const lastPayment = paidFactures.sort((a, b) => new Date(b.paidAt!).getTime() - new Date(a.paidAt!).getTime())[0];
  const lastInvoice = factures.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const aging = calculateAging(factures);

  const existing = await db.select().from(compteClientTable).where(and(
    eq(compteClientTable.organisationId, orgId),
    eq(compteClientTable.contactId, contactId)
  ));

  const paymentTermDays = existing[0]?.paymentTermDays ?? 30;
  const creditLimit = existing[0]?.creditLimit ?? "10000";
  const { score, risk } = calculateHealthScore({ nbFactures, nbFacturesPayees, nbFacturesEnRetard, totalFacture, totalPaye, delaiMoyen, paymentTermDays });

  const solde = totalFacture - totalPaye;
  let status = existing[0]?.status ?? "actif";
  if (solde > Number(creditLimit)) status = "bloque";
  else if (risk === "critique") status = "suspendu";
  else if (status === "bloque" || status === "suspendu") status = "actif";

  const accountData = {
    organisationId: orgId,
    contactId,
    clientName: `${contact.firstName} ${contact.lastName}`,
    clientEmail: contact.email,
    clientCompany: contact.company,
    totalFacture: String(totalFacture),
    totalPaye: String(totalPaye),
    solde: String(solde),
    nbFactures,
    nbFacturesPayees,
    nbFacturesEnRetard,
    montantEnRetard: String(montantEnRetard),
    aging0to30: String(aging.a0to30),
    aging31to60: String(aging.a31to60),
    aging61to90: String(aging.a61to90),
    aging90plus: String(aging.a90plus),
    healthScore: score,
    riskLevel: risk,
    status,
    delaiMoyenPaiement: delaiMoyen,
    lastPaymentDate: lastPayment?.paidAt || null,
    lastInvoiceDate: lastInvoice?.createdAt || null,
    lastSyncAt: new Date(),
  };

  if (existing.length > 0) {
    const [updated] = await db.update(compteClientTable).set(accountData)
      .where(eq(compteClientTable.id, existing[0].id)).returning();
    return updated;
  } else {
    const [created] = await db.insert(compteClientTable).values({
      ...accountData,
      creditLimit: "10000",
      paymentTermDays: 30,
    }).returning();
    return created;
  }
}

router.get("/comptes-clients", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const { search, risk, status, sort, limit, offset } = req.query;
  const conditions: any[] = [eq(compteClientTable.organisationId, orgId)];
  if (risk && risk !== "all") conditions.push(eq(compteClientTable.riskLevel, risk as string));
  if (status && status !== "all") conditions.push(eq(compteClientTable.status, status as string));
  if (search) {
    conditions.push(or(
      ilike(compteClientTable.clientName, `%${search}%`),
      ilike(compteClientTable.clientCompany, `%${search}%`),
      ilike(compteClientTable.clientEmail, `%${search}%`)
    )!);
  }
  const whereClause = and(...conditions);
  let orderBy: any = desc(compteClientTable.updatedAt);
  if (sort === "health_asc") orderBy = asc(compteClientTable.healthScore);
  if (sort === "health_desc") orderBy = desc(compteClientTable.healthScore);
  if (sort === "solde_desc") orderBy = desc(compteClientTable.solde);
  if (sort === "retard_desc") orderBy = desc(compteClientTable.nbFacturesEnRetard);

  const [accounts, countResult] = await Promise.all([
    db.select().from(compteClientTable).where(whereClause).orderBy(orderBy)
      .limit(Number(limit) || 50).offset(Number(offset) || 0),
    db.select({ count: sql<number>`count(*)::int` }).from(compteClientTable).where(whereClause),
  ]);
  res.json({ accounts, total: countResult[0]?.count ?? 0 });
});

router.get("/comptes-clients/dashboard", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const all = await db.select().from(compteClientTable).where(eq(compteClientTable.organisationId, orgId));

  const totalAccounts = all.length;
  const activeAccounts = all.filter(a => a.status === "actif").length;
  const blockedAccounts = all.filter(a => a.status === "bloque").length;
  const suspendedAccounts = all.filter(a => a.status === "suspendu").length;
  const totalFacture = all.reduce((s, a) => s + Number(a.totalFacture), 0);
  const totalPaye = all.reduce((s, a) => s + Number(a.totalPaye), 0);
  const totalSolde = all.reduce((s, a) => s + Number(a.solde), 0);
  const totalEnRetard = all.reduce((s, a) => s + Number(a.montantEnRetard), 0);
  const avgHealthScore = totalAccounts > 0 ? Math.round(all.reduce((s, a) => s + a.healthScore, 0) / totalAccounts) : 100;
  const riskDistribution = {
    faible: all.filter(a => a.riskLevel === "faible").length,
    moyen: all.filter(a => a.riskLevel === "moyen").length,
    eleve: all.filter(a => a.riskLevel === "eleve").length,
    critique: all.filter(a => a.riskLevel === "critique").length,
  };
  const agingTotal = {
    a0to30: all.reduce((s, a) => s + Number(a.aging0to30), 0),
    a31to60: all.reduce((s, a) => s + Number(a.aging31to60), 0),
    a61to90: all.reduce((s, a) => s + Number(a.aging61to90), 0),
    a90plus: all.reduce((s, a) => s + Number(a.aging90plus), 0),
  };
  const avgPaymentDays = totalAccounts > 0 ? Math.round(all.reduce((s, a) => s + a.delaiMoyenPaiement, 0) / totalAccounts) : 0;
  const topRiskAccounts = all.filter(a => a.riskLevel === "critique" || a.riskLevel === "eleve")
    .sort((a, b) => a.healthScore - b.healthScore).slice(0, 5);

  res.json({
    totalAccounts, activeAccounts, blockedAccounts, suspendedAccounts,
    totalFacture, totalPaye, totalSolde, totalEnRetard,
    avgHealthScore, riskDistribution, agingTotal, avgPaymentDays, topRiskAccounts,
  });
});

router.get("/comptes-clients/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [account] = await db.select().from(compteClientTable).where(and(eq(compteClientTable.id, id), eq(compteClientTable.organisationId, orgId)));
  if (!account) { res.status(404).json({ error: "Compte non trouve" }); return; }

  const factures = account.contactId
    ? await db.select().from(facturesClientTable).where(and(
        eq(facturesClientTable.organisationId, orgId),
        eq(facturesClientTable.contactId, account.contactId)
      )).orderBy(desc(facturesClientTable.createdAt))
    : [];

  res.json({ account, factures });
});

router.patch("/comptes-clients/:id", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const { creditLimit, paymentTermDays, autoReminderEnabled, status, notes } = req.body;
  const updateData: Record<string, any> = {};
  if (creditLimit !== undefined) updateData.creditLimit = String(creditLimit);
  if (paymentTermDays !== undefined) updateData.paymentTermDays = paymentTermDays;
  if (autoReminderEnabled !== undefined) updateData.autoReminderEnabled = autoReminderEnabled;
  if (status !== undefined) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;
  if (Object.keys(updateData).length === 0) { res.status(400).json({ error: "Aucune donnee" }); return; }
  const [updated] = await db.update(compteClientTable).set(updateData)
    .where(and(eq(compteClientTable.id, id), eq(compteClientTable.organisationId, orgId))).returning();
  if (!updated) { res.status(404).json({ error: "Compte non trouve" }); return; }
  res.json(updated);
});

router.post("/comptes-clients/sync", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const contactIds = await db.selectDistinct({ contactId: facturesClientTable.contactId })
    .from(facturesClientTable)
    .where(and(eq(facturesClientTable.organisationId, orgId), sql`${facturesClientTable.contactId} IS NOT NULL`));

  let synced = 0;
  for (const row of contactIds) {
    if (row.contactId) {
      await syncAccountForContact(orgId, row.contactId);
      synced++;
    }
  }
  res.json({ message: `${synced} comptes clients synchronises.`, synced });
});

router.post("/comptes-clients/:id/send-reminder", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [account] = await db.select().from(compteClientTable).where(and(eq(compteClientTable.id, id), eq(compteClientTable.organisationId, orgId)));
  if (!account) { res.status(404).json({ error: "Compte non trouve" }); return; }
  if (!account.clientEmail) { res.status(400).json({ error: "Aucune adresse email pour ce client." }); return; }
  if (Number(account.montantEnRetard) <= 0) { res.status(400).json({ error: "Aucun montant en retard pour ce client." }); return; }

  const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) { res.status(500).json({ error: "Service email non configure." }); return; }

  const overdueFactures = account.contactId
    ? await db.select().from(facturesClientTable).where(and(
        eq(facturesClientTable.organisationId, orgId),
        eq(facturesClientTable.contactId, account.contactId),
        sql`${facturesClientTable.status} IN ('envoyee', 'partielle')`,
        lt(facturesClientTable.dueDate, new Date())
      )).orderBy(asc(facturesClientTable.dueDate))
    : [];

  const factureRows = overdueFactures.map(f => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${f.reference}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${f.title}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${Number(f.totalAmount).toFixed(2)} €</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${(Number(f.totalAmount) - Number(f.paidAmount)).toFixed(2)} €</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;">${f.dueDate ? new Date(f.dueDate).toLocaleDateString("fr-FR") : "N/A"}</td>
    </tr>`).join("");

  const reminderHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;color:#1f2937;margin:0;padding:0;">
  <div style="max-width:700px;margin:0 auto;padding:40px;">
    <div style="background:#fef2f2;border:2px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:25px;">
      <h1 style="color:#dc2626;margin:0 0 8px;font-size:22px;">Rappel de paiement</h1>
      <p style="color:#991b1b;margin:0;font-size:14px;">Ce message est un rappel automatique concernant des factures en attente de reglement.</p>
    </div>
    <p>Bonjour ${account.clientName},</p>
    <p>Nous nous permettons de vous rappeler que les factures suivantes sont en attente de reglement :</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      <thead><tr style="background:#4f46e5;color:white;">
        <th style="padding:10px;text-align:left;">Reference</th>
        <th style="padding:10px;text-align:left;">Description</th>
        <th style="padding:10px;text-align:right;">Montant</th>
        <th style="padding:10px;text-align:right;">Reste du</th>
        <th style="padding:10px;text-align:center;">Echeance</th>
      </tr></thead>
      <tbody>${factureRows}</tbody>
    </table>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:15px;margin:20px 0;">
      <p style="margin:0;font-weight:bold;color:#16a34a;">Total en retard: ${Number(account.montantEnRetard).toFixed(2)} €</p>
    </div>
    ${(org?.bankIban || org?.bankBic) ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:15px;margin:20px 0;">
      <h3 style="margin:0 0 8px;color:#2563eb;font-size:13px;">COORDONNEES BANCAIRES POUR LE REGLEMENT</h3>
      ${org.bankName ? `<p style="margin:2px 0;font-size:13px;"><strong>Banque:</strong> ${org.bankName}</p>` : ""}
      ${org.bankIban ? `<p style="margin:2px 0;font-size:13px;"><strong>IBAN:</strong> ${org.bankIban}</p>` : ""}
      ${org.bankBic ? `<p style="margin:2px 0;font-size:13px;"><strong>BIC:</strong> ${org.bankBic}</p>` : ""}
    </div>` : ""}
    <p>Nous vous remercions de bien vouloir proceder au reglement dans les meilleurs delais.</p>
    <p>Cordialement,<br><strong>${org?.name || "Agent de Bureau"}</strong></p>
    <div style="margin-top:30px;border-top:1px solid #e5e7eb;padding-top:15px;font-size:11px;color:#9ca3af;text-align:center;">
      ${org?.name || "Agent de Bureau"}${org?.siret ? ` — SIRET: ${org.siret}` : ""}
    </div>
  </div></body></html>`;

  try {
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: `${org?.name || "Agent de Bureau"} <onboarding@resend.dev>`,
      to: account.clientEmail,
      subject: `Rappel de paiement — ${Number(account.montantEnRetard).toFixed(2)} € en attente — ${org?.name || "Agent de Bureau"}`,
      html: reminderHtml,
    });

    await db.update(compteClientTable).set({
      reminderCount: account.reminderCount + 1,
      lastReminderAt: new Date(),
    }).where(eq(compteClientTable.id, id));

    res.json({ message: `Rappel envoye a ${account.clientEmail}.`, success: true });
  } catch (err: any) {
    console.error("Reminder email error:", err.message);
    res.status(500).json({ error: `Erreur d'envoi: ${err.message}` });
  }
});

export default router;

export async function runAccountHealthMonitor(): Promise<void> {
  console.log("[ComptesClients] Demarrage du moniteur de sante des comptes...");

  const syncAll = async () => {
    try {
      const orgs = await db.select({ id: organisationsTable.id }).from(organisationsTable).where(eq(organisationsTable.actif, true));
      let totalSynced = 0;
      let reminderssSent = 0;

      for (const org of orgs) {
        const contactIds = await db.selectDistinct({ contactId: facturesClientTable.contactId })
          .from(facturesClientTable)
          .where(and(eq(facturesClientTable.organisationId, org.id), sql`${facturesClientTable.contactId} IS NOT NULL`));

        for (const row of contactIds) {
          if (row.contactId) {
            const account = await syncAccountForContact(org.id, row.contactId);
            if (account) totalSynced++;

            if (account && account.autoReminderEnabled && Number(account.montantEnRetard) > 0 && account.clientEmail) {
              const lastReminder = account.lastReminderAt ? new Date(account.lastReminderAt).getTime() : 0;
              const daysSinceReminder = (Date.now() - lastReminder) / 86400000;
              let reminderIntervalDays = 7;
              if (account.riskLevel === "critique") reminderIntervalDays = 3;
              else if (account.riskLevel === "eleve") reminderIntervalDays = 5;

              if (daysSinceReminder >= reminderIntervalDays) {
                const resendApiKey = process.env.RESEND_API_KEY;
                const [orgData] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, org.id));
                if (resendApiKey && orgData?.autoEmailInvoice) {
                  try {
                    const resend = new Resend(resendApiKey);
                    await resend.emails.send({
                      from: `${orgData.name || "Agent de Bureau"} <onboarding@resend.dev>`,
                      to: account.clientEmail,
                      subject: `Rappel: ${Number(account.montantEnRetard).toFixed(2)} € en attente — ${orgData.name || "Agent de Bureau"}`,
                      html: `<p>Bonjour ${account.clientName},</p><p>Nous vous rappelons qu'un montant de <strong>${Number(account.montantEnRetard).toFixed(2)} €</strong> est en attente de reglement.</p><p>Merci de proceder au paiement dans les meilleurs delais.</p><p>Cordialement,<br>${orgData.name || "Agent de Bureau"}</p>`,
                    });
                    await db.update(compteClientTable).set({ reminderCount: account.reminderCount + 1, lastReminderAt: new Date() })
                      .where(eq(compteClientTable.id, account.id));
                    reminderssSent++;
                  } catch { /* skip */ }
                }
              }
            }

            if (account && (account.riskLevel === "critique" || account.status === "bloque")) {
              try {
                const existingNotif = await db.select({ id: notificationsTable.id }).from(notificationsTable)
                  .where(and(
                    eq(notificationsTable.organisationId, org.id),
                    ilike(notificationsTable.title, `%${account.clientName}%`),
                    sql`${notificationsTable.createdAt} > NOW() - INTERVAL '24 hours'`
                  ));
                if (existingNotif.length === 0) {
                  await db.insert(notificationsTable).values({
                    organisationId: org.id,
                    title: `Compte critique: ${account.clientName}`,
                    message: `Score de sante: ${account.healthScore}/100. Solde impaye: ${Number(account.solde).toFixed(2)} €. ${account.nbFacturesEnRetard} facture(s) en retard.`,
                    type: "warning",
                    priority: "haute",
                  });
                }
              } catch { /* skip */ }
            }
          }
        }
      }
      console.log(`[ComptesClients] Sync terminee: ${totalSynced} comptes, ${reminderssSent} rappels envoyes.`);
    } catch (err: any) {
      console.error("[ComptesClients] Erreur sync:", err.message);
    }
  };

  await syncAll();
  setInterval(syncAll, 2 * 60 * 60 * 1000);
}
