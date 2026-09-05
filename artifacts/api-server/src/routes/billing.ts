import { Router, type Request, type Response } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, invoicesTable, paymentsTable, organisationsTable } from "@workspace/db";
import { emettreFacturePlateforme } from "../services/platform-invoice-issue";
import { generateMonthlyInvoices, getOrgBillingSummary } from "../services/billing-engine";
import { logger } from "../lib/logger";
import { apparier } from "../services/payment-matching";
import { empreinte, lireCamt053, ReleveIllisible, texteRapprochement } from "../services/camt053";
import { requireSuperAdmin } from "../middleware/auth";
import { invalidateLicenseCache } from "../middleware/license-check";

const router = Router();

// Path-scoped guard: only intercept /billing/* requests. Without a path
// prefix, router.use(mw) would match every request that reaches this
// sub-router and block downstream sub-routers in the parent chain.
router.use("/billing", requireSuperAdmin);

router.get("/billing/invoices", async (req: Request, res: Response): Promise<void> => {
  try {
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
        id: r.invoice.id, organisationId: r.invoice.organisationId,
        organisationName: r.orgName, periodLabel: r.invoice.periodLabel,
        periodStart: r.invoice.periodStart, periodEnd: r.invoice.periodEnd,
        plan: r.invoice.plan, totalAmount: r.invoice.totalAmount,
        // Le numero et le TTC sont ce qui identifie et chiffre la facture:
        // les omettre de la liste obligerait a rouvrir chaque ligne.
        reference: r.invoice.reference, issuedAt: r.invoice.issuedAt,
        vatRate: r.invoice.vatRate, vatAmount: r.invoice.vatAmount,
        totalTtc: r.invoice.totalTtc,
        currency: r.invoice.currency, status: r.invoice.status,
        paidAt: r.invoice.paidAt, createdAt: r.invoice.createdAt,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste factures");
    res.status(500).json({ error: "Erreur lors de la recuperation des factures." });
  }
});

router.get("/billing/invoices/:orgId", async (req: Request, res: Response): Promise<void> => {
  const orgId = parseInt(String(req.params.orgId));
  if (isNaN(orgId)) { res.status(400).json({ error: "ID invalide." }); return; }

  try {
    const summary = await getOrgBillingSummary(orgId);
    res.json(summary);
  } catch (err: any) {
    req.log.error({ err }, "Erreur resume facturation organisation");
    res.status(500).json({ error: "Erreur lors de la recuperation du resume de facturation." });
  }
});

router.post("/billing/generate", async (req: Request, res: Response): Promise<void> => {
  const { year, month } = req.body;

  const now = new Date();
  const targetYear = year || now.getFullYear();
  const targetMonth = month || now.getMonth() + 1;

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
    logger.error({ err }, "Erreur generation factures");
    res.status(500).json({ error: "Erreur lors de la generation des factures." });
  }
});

router.patch("/billing/invoices/:id/status", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
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

  try {
    const [updated] = await db.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Facture introuvable." }); return; }

    // C'est ici qu'un brouillon devient une facture: numero de la sequence,
    // date d'emission, TVA et identite de l'acheteur figee. `annulee` est
    // exclu — une facture annulee avant d'avoir ete emise ne doit pas
    // consommer un numero, et une facture deja emise garde le sien
    // (l'emission est idempotente).
    if (status !== "annulee" && !updated.reference) {
      await emettreFacturePlateforme(updated.id);
    }

    invalidateLicenseCache(updated.organisationId);
    res.json({ message: "Statut mis a jour.", invoice: { id: updated.id, organisationId: updated.organisationId, status: updated.status, totalAmount: updated.totalAmount, currency: updated.currency, paidAt: updated.paidAt } });
  } catch (err: any) {
    req.log.error({ err }, "Erreur mise a jour statut facture");
    res.status(500).json({ error: "Erreur lors de la mise a jour du statut." });
  }
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
      req.log.error({ err }, "Erreur import ligne releve bancaire");
    }
  }

  res.json({
    message: `${inserted.length} paiement(s) importe(s) sur ${lines.length} ligne(s).`,
    payments: inserted,
  });
});

/**
 * Import d'un releve bancaire ISO 20022 (camt.053).
 *
 * Remplace la saisie ligne a ligne de `/billing/upload-bank`, qui obligeait a
 * recopier — donc a choisir, donc a perdre — les champs de reference. camt.053
 * ne tronque pas l'information de remise et la range dans des champs distincts;
 * c'est ce qui fait passer le rapprochement automatique de 50-60 % a 85-95 %.
 *
 * L'insertion est idempotente par CONTRAINTE, pas par verification: deux
 * imports simultanes du meme fichier passeraient a travers un `SELECT` prealable.
 */
router.post("/billing/import-camt", async (req: Request, res: Response): Promise<void> => {
  const xml = typeof req.body?.xml === "string" ? req.body.xml : null;
  if (!xml || xml.trim().length === 0) {
    res.status(400).json({ error: "Fichier camt.053 manquant (champ `xml`)." });
    return;
  }

  let ecritures;
  try {
    ecritures = lireCamt053(xml);
  } catch (err: unknown) {
    if (err instanceof ReleveIllisible) {
      // Entree invalide, pas panne: l'exploitant doit lire « ce fichier n'est
      // pas un releve », pas « erreur interne ».
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  let importes = 0;
  let doublons = 0;

  for (const e of ecritures) {
    const [ligne] = await db
      .insert(paymentsTable)
      .values({
        amount: String(e.montant),
        currency: e.devise,
        source: "camt053",
        bankRef: texteRapprochement(e).slice(0, 200) || null,
        bankDate: e.date,
        payerName: e.payeur,
        payerIban: e.payeurIban,
        status: "pending",
        rawLine: JSON.stringify(e),
        bankFingerprint: empreinte(e),
      })
      .onConflictDoNothing({ target: paymentsTable.bankFingerprint })
      .returning({ id: paymentsTable.id });

    if (ligne) importes += 1;
    else doublons += 1;
  }

  res.json({
    message:
      `${importes} ecriture(s) importee(s)` +
      (doublons > 0 ? `, ${doublons} deja connue(s) et ignoree(s).` : "."),
    imported: importes,
    duplicates: doublons,
    credits: ecritures.length,
  });
});
router.post("/billing/match-payments", async (req: Request, res: Response): Promise<void> => {
  try {
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
    let suggestionsCount = 0;
    const matchedInvoiceIds = new Set<number>();

    for (const payment of pendingPayments) {
      // Le rapprochement ne fait plus la somme de signaux faibles. L'ancien
      // calcul appliquait automatiquement des 50 points — c'est-a-dire sur le
      // MONTANT SEUL — alors que tous les clients d'un meme forfait paient la
      // meme somme au centime: deux abonnes a 29 EUR produisaient deux
      // virements identiques, et le premier trouve fermait la facture de
      // l'autre. L'erreur est silencieuse: le client credite a tort ne dit
      // rien, et le vrai debiteur continue de recevoir des relances.
      //
      // Seule une REFERENCE de facture trouvee dans le libelle applique
      // automatiquement. Le reste devient une suggestion, laissee en attente.
      const resultat = apparier(
        {
          bankRef: payment.bankRef,
          payerName: payment.payerName,
          rawLine: payment.rawLine,
          amount: Number(payment.amount),
        },
        pendingInvoices
          .filter((inv) => !matchedInvoiceIds.has(inv.invoice.id))
          .map((inv) => {
            // Le client vire le TTC. Les factures anterieures a la TVA ont un
            // `totalTtc` a zero: on retombe alors sur le HT, qui etait bien le
            // montant reclame a l'epoque.
            const ttc = Number(inv.invoice.totalTtc);
            return {
              id: inv.invoice.id,
              organisationId: inv.invoice.organisationId,
              reference: inv.invoice.reference,
              duMontant: ttc > 0 ? ttc : Number(inv.invoice.totalAmount),
              orgName: inv.orgName,
            };
          }),
      );

      const bestMatch = resultat.automatique
        ? {
            invoiceId: resultat.automatique.factureId,
            orgId: resultat.automatique.organisationId,
            confidence: resultat.automatique.confiance,
          }
        : null;

      suggestionsCount += resultat.suggestions.length;

      if (bestMatch) {
        matchedInvoiceIds.add(bestMatch.invoiceId);

        // Transaction : le paiement et la facture doivent basculer ensemble.
        // Sans cela, un crash entre les deux updates laisse le paiement
        // "matched" mais la facture impayee (etat partiel incoherent).
        const match = bestMatch;
        await db.transaction(async (tx) => {
          await tx.update(paymentsTable).set({
            invoiceId: match.invoiceId,
            organisationId: match.orgId,
            matchedBy: "auto",
            matchConfidence: String(match.confidence),
            status: "matched",
          }).where(eq(paymentsTable.id, payment.id));

          if (match.confidence >= 80) {
            await tx.update(invoicesTable).set({
              status: "payee",
              paidAt: new Date(),
            }).where(eq(invoicesTable.id, match.invoiceId));
          }
        });

        invalidateLicenseCache(match.orgId);
        matched++;
      }
    }

    // Les suggestions sont dites, pas cachees: un paiement qui n'a pas ete
    // rapproche automatiquement n'est pas un paiement perdu, c'est un paiement
    // qui attend une lecture. Sans ce compte, un exploitant croirait que le
    // rapprochement n'a « rien trouve » alors qu'il a trouve trop de choses.
    res.json({
      message:
        `Rapprochement termine: ${matched} paiement(s) rapproche(s) sur ${pendingPayments.length}` +
        (suggestionsCount > 0
          ? `, ${suggestionsCount} rapprochement(s) plausible(s) a valider a la main.`
          : "."),
      matched,
      suggestions: suggestionsCount,
      total: pendingPayments.length,
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur rapprochement paiements");
    res.status(500).json({ error: "Erreur lors du rapprochement des paiements." });
  }
});

router.get("/billing/payments", async (req: Request, res: Response): Promise<void> => {
  try {
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
        id: r.payment.id, invoiceId: r.payment.invoiceId,
        organisationId: r.payment.organisationId, organisationName: r.orgName,
        amount: r.payment.amount, currency: r.payment.currency,
        source: r.payment.source, status: r.payment.status,
        matchedBy: r.payment.matchedBy, matchConfidence: r.payment.matchConfidence,
        bankDate: r.payment.bankDate, createdAt: r.payment.createdAt,
      })),
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur liste paiements");
    res.status(500).json({ error: "Erreur lors de la recuperation des paiements." });
  }
});

router.post("/billing/payments/:id/assign", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }

  const { invoiceId } = req.body;
  if (!invoiceId) { res.status(400).json({ error: "invoiceId requis." }); return; }

  try {
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice) { res.status(404).json({ error: "Facture introuvable." }); return; }

    // Transaction : affectation du paiement + passage de la facture en "payee"
    // doivent etre atomiques, sinon un echec entre les deux laisse un etat
    // partiel (paiement affecte mais facture toujours impayee).
    await db.transaction(async (tx) => {
      await tx.update(paymentsTable).set({
        invoiceId,
        organisationId: invoice.organisationId,
        matchedBy: "manual",
        matchConfidence: "100",
        status: "matched",
      }).where(eq(paymentsTable.id, id));

      await tx.update(invoicesTable).set({
        status: "payee",
        paidAt: new Date(),
      }).where(eq(invoicesTable.id, invoiceId));
    });

    invalidateLicenseCache(invoice.organisationId);
    res.json({ message: "Paiement affecte et facture marquee comme payee." });
  } catch (err: any) {
    req.log.error({ err }, "Erreur affectation paiement");
    res.status(500).json({ error: "Erreur lors de l'affectation du paiement." });
  }
});

router.get("/billing/summary", async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (err: any) {
    req.log.error({ err }, "Erreur resume facturation");
    res.status(500).json({ error: "Erreur lors de la recuperation du resume." });
  }
});

router.get("/billing/saas-metrics", async (req: Request, res: Response): Promise<void> => {
  try {
    const { subscriptionsTable: subs } = await import("@workspace/db");

    const allOrgs = await db.select({
      id: organisationsTable.id,
      name: organisationsTable.name,
      email: organisationsTable.email,
      actif: organisationsTable.actif,
      createdAt: organisationsTable.createdAt,
    }).from(organisationsTable).orderBy(desc(organisationsTable.createdAt));

    const allSubs = await db.select().from(subs);

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const sixMonthsAgo = new Date(now.getTime() - 180 * 86400000);

    let mrr = 0;
    let paidCount = 0;
    let trialCount = 0;
    let suspendedCount = 0;
    const planDist: Record<string, number> = { essai: 0, starter: 0, professionnel: 0, entreprise: 0 };
    const trialExpiringSoon: { id: number; name: string; trialEndsAt: string; daysLeft: number }[] = [];
    const suspendedOrgs: { id: number; name: string; plan: string }[] = [];

    for (const org of allOrgs) {
      const sub = allSubs.find(s => s.organisationId === org.id);
      if (!org.actif) {
        suspendedCount++;
        suspendedOrgs.push({ id: org.id, name: org.name, plan: sub?.plan || "inconnu" });
        continue;
      }
      if (!sub) continue;

      planDist[sub.plan] = (planDist[sub.plan] || 0) + 1;

      if (sub.plan === "essai") {
        trialCount++;
        if (sub.trialEndsAt) {
          const endsAt = new Date(sub.trialEndsAt);
          if (endsAt > now && endsAt <= in7Days) {
            const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / 86400000);
            trialExpiringSoon.push({ id: org.id, name: org.name, trialEndsAt: sub.trialEndsAt.toISOString(), daysLeft });
          }
        }
      } else {
        paidCount++;
        mrr += Number(sub.price) || 0;
      }
    }

    const recentSignups = allOrgs
      .filter(o => new Date(o.createdAt) >= thirtyDaysAgo)
      .map(o => {
        const sub = allSubs.find(s => s.organisationId === o.id);
        return { id: o.id, name: o.name, plan: sub?.plan || "essai", createdAt: o.createdAt.toISOString(), actif: o.actif };
      });

    const revenueTrend = await db.select({
      month: sql<string>`TO_CHAR(created_at, 'YYYY-MM')`,
      total: sql<string>`COALESCE(SUM(total_amount), 0)::text`,
      count: sql<number>`count(*)::int`,
    }).from(invoicesTable)
      .where(sql`${invoicesTable.createdAt} >= ${sixMonthsAgo} AND ${invoicesTable.status} = 'payee'`)
      .groupBy(sql`TO_CHAR(created_at, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(created_at, 'YYYY-MM')`);

    const pendingRevenue = await db.select({
      total: sql<string>`COALESCE(SUM(total_amount), 0)::text`,
      count: sql<number>`count(*)::int`,
    }).from(invoicesTable)
      .where(sql`${invoicesTable.status} IN ('en_attente', 'retard', 'partiel')`);

    res.json({
      mrr: Math.round(mrr * 100) / 100,
      arr: Math.round(mrr * 12 * 100) / 100,
      totalCustomers: allOrgs.length,
      paidCustomers: paidCount,
      trialCustomers: trialCount,
      suspendedCustomers: suspendedCount,
      conversionRate: allOrgs.length > 0 ? Math.round((paidCount / Math.max(1, paidCount + trialCount)) * 100) : 0,
      planDistribution: planDist,
      trialExpiringSoon: trialExpiringSoon.sort((a, b) => a.daysLeft - b.daysLeft),
      suspendedOrgs,
      recentSignups,
      revenueTrend: revenueTrend.map(r => ({ month: r.month, revenue: Number(r.total), invoices: r.count })),
      pendingRevenue: {
        total: Number(pendingRevenue[0]?.total || 0),
        count: pendingRevenue[0]?.count || 0,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur metriques SaaS");
    res.status(500).json({ error: "Erreur lors du calcul des metriques SaaS." });
  }
});

export default router;
